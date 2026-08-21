import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_VOICE } from '../voices.js'
import { passageText, passageId } from '../text.js'

/**
 * One player for the whole app.
 *
 * Every speaker button in the tree talks to this provider, which owns a single
 * `Audio` element. That is the difference between "a page with audio on it" and
 * a read-aloud feature: pressing play on a second paragraph stops the first,
 * one set of transport controls always refers to whatever is speaking, and a
 * button knows whether the thing playing is its own passage.
 *
 * The audio element is created imperatively rather than rendered, so playback
 * survives the player widget unmounting — a route change should not silence
 * what someone is listening to.
 */

const ReadAloudContext = createContext(null)

/* Ten milliseconds of silence.
   ---------------------------------------------------------------------------
   Browsers only let an <audio> element play if a user gesture started it, and
   "started it" means the same task — an element whose src is set after an
   `await fetch(...)` has already lost the gesture, so the first click on a
   speaker button downloaded the clip and then sat there paused. Once an element
   has played once from a real gesture it stays unlocked, so the click handler
   plays this instead: inaudible, instant, and it costs one 272-byte data URI. */
const SILENCE =
  'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YaAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

/** Playback speeds offered by the player, in the order the button cycles them. */
export const DEFAULT_RATES = [1, 1.25, 1.5, 2]

/** Fallback speaking pace, in characters per second, for a segment that has not
 *  been rendered yet. Only used until the first segment reports a real duration,
 *  after which the passage's own measured pace replaces it — different voices
 *  and different languages are not the same speed, and a guess that adapts is
 *  better than a constant that cannot. */
const FALLBACK_CHARS_PER_SECOND = 17

/** Seconds per segment: real where known, estimated from character count where
 *  the audio does not exist yet. */
function segmentSeconds(segment, charsPerSecond) {
  if (typeof segment.seconds === 'number') return segment.seconds
  if (!segment.chars) return 0
  return segment.chars / charsPerSecond
}

/** The passage's measured pace, taken from whichever segments have real
 *  durations. This is what keeps the estimated total honest as it plays. */
function measurePace(segments) {
  let chars = 0
  let seconds = 0
  for (const segment of segments) {
    if (typeof segment.seconds === 'number' && segment.chars) {
      chars += segment.chars
      seconds += segment.seconds
    }
  }
  return seconds > 0 ? chars / seconds : FALLBACK_CHARS_PER_SECOND
}

function readStored(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeStored(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Private mode, a full quota — a remembered preference is not worth an
       exception in a click handler. */
  }
}

export function ReadAloudProvider({
  children,
  /** Where the API is mounted. Must match the server's `basePath`. */
  endpoint = '/api/read-aloud',
  /** This app's default voice, before the listener picks one. */
  voice: initialVoice = DEFAULT_VOICE,
  /** Playback speeds the player offers. */
  rates = DEFAULT_RATES,
  /** Namespace for remembered settings, so two apps on localhost:*/
  storagePrefix = 'read-aloud',
  /** Seconds a skip button moves. */
  skipSeconds = 10,
  /**
   * How long the player stays on screen after a passage finishes, in ms.
   *
   * A transport bar for audio that stopped two minutes ago is clutter that the
   * listener has to dismiss by hand, having already got what they came for.
   * `0` keeps it up until it is closed.
   */
  dismissAfterMs = 4500,
}) {
  const audioRef = useRef(null)
  const requestRef = useRef(0)
  const resumeAtRef = useRef(0)
  const dismissTimerRef = useRef(null)
  /* The segment queue.
     ---------------------------------------------------------------------------
     A long passage is rendered in pieces so playback can start on the first one
     while the rest are still being generated (see `segmentText` on the server).
     The player presents them as one continuous passage: `segments` holds
     `{ url, seconds, chars }` per piece, `segmentIndex` is the one playing, and
     everything the UI shows — elapsed, total, seek position — is computed
     across the whole list rather than the current file. */
  const segmentsRef = useRef([])
  const indexRef = useRef(0)
  const [segments, setSegments] = useState([])
  const [segmentIndex, setSegmentIndex] = useState(0)

  const [service, setService] = useState({ available: null, voices: [], defaultVoice: initialVoice })
  const [passage, setPassage] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  /* Settings start at the app's defaults and are replaced from localStorage in
     an effect rather than in a lazy initializer. A client-only initial value is
     a hydration mismatch in any server-rendered app, and this library has no
     business caring which of the two the host is. */
  const [voice, setVoiceState] = useState(initialVoice)
  const [rate, setRateState] = useState(1)

  const voiceKey = `${storagePrefix}:voice`
  const rateKey = `${storagePrefix}:rate`

  useEffect(() => {
    setVoiceState(readStored(voiceKey, initialVoice))
    const storedRate = readStored(rateKey, 1)
    if (rates.includes(storedRate)) setRateState(storedRate)
    // Settings are read once, on mount, per provider instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Is there a model on the other end? Asked once. Until the answer arrives
     `available` is null and the buttons render nothing at all — a speaker icon
     that does nothing when clicked is worse than no speaker icon. */
  useEffect(() => {
    let cancelled = false
    fetch(endpoint)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setService({
          available: Boolean(data.available),
          reason: data.reason ?? null,
          voices: data.voices ?? [],
          defaultVoice: data.defaultVoice ?? initialVoice,
        })
      })
      .catch(() => {
        if (!cancelled) setService({ available: false, voices: [], defaultVoice: initialVoice })
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, initialVoice])

  // The one audio element, wired up once.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const audio = new window.Audio()
    audio.preload = 'metadata'
    audioRef.current = audio

    /* Events from the unlock clip are not events about a passage.
       -------------------------------------------------------------------------
       The element plays 10ms of silence inside the click to unlock itself, and
       that clip fires `play`, `timeupdate` and — the damaging one — `ended`. On
       a cold model load the fetch is still in flight when `ended` arrives, so
       the status went from 'preparing' to 'ended' and the auto-dismiss timer
       started counting down on a passage that had not begun. Four and a half
       seconds later the player cleared itself, and the audio arrived to a
       widget that no longer existed. The flag is cleared the moment the real
       clip's src is set. */
    const isUnlockClip = () => audio.dataset.unlockOnly === 'yes'

    const onTime = () => {
      if (isUnlockClip()) return
      setTime(audio.currentTime)
    }
    const onMeta = () => {
      if (isUnlockClip()) return
      // Every segment that loads turns one estimate into a fact.
      if (Number.isFinite(audio.duration)) {
        const list = segmentsRef.current
        const current = list[indexRef.current]
        if (current && current.seconds !== audio.duration) {
          current.seconds = audio.duration
          segmentsRef.current = [...list]
          setSegments(segmentsRef.current)
        }
      }
      // Restored position after a voice change: the listener was 40 seconds
      // into a passage and should not be sent back to the start by it.
      if (resumeAtRef.current > 0) {
        audio.currentTime = Math.min(resumeAtRef.current, audio.duration || 0)
        resumeAtRef.current = 0
      }
    }
    const onPlay = () => {
      if (isUnlockClip()) return
      setStatus('playing')
    }
    const onPause = () => {
      if (isUnlockClip()) return
      setStatus((s) => (s === 'playing' ? 'paused' : s))
    }
    const onEnded = () => {
      if (isUnlockClip()) return
      // The end of a segment is not the end of the passage. Advance, and let
      // the next file load and play with no gap the listener has to act on.
      const next = indexRef.current + 1
      if (next < segmentsRef.current.length) {
        indexRef.current = next
        setSegmentIndex(next)
        audio.src = segmentsRef.current[next].url
        audio.playbackRate = audio.playbackRate || 1
        void audio.play().catch(() => setStatus('paused'))
        return
      }
      setStatus('ended')
      setTime(0)
    }
    const onError = () => {
      if (isUnlockClip()) return
      setStatus('error')
      setError('That audio could not be played.')
    }

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate, passage])

  /* Clear the player a few seconds after the passage ends — but only from
     'ended', so a deliberate pause halfway through never has a countdown
     running under it. Any new status cancels the timer, which covers pressing
     play again during those seconds. */
  useEffect(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    if (status !== 'ended' || !dismissAfterMs) return undefined
    dismissTimerRef.current = setTimeout(() => stopRef.current(), dismissAfterMs)
    return () => clearTimeout(dismissTimerRef.current)
  }, [status, dismissAfterMs])

  /** Fetches the passage — as segments when it is long enough to be worth it —
   *  and starts the first one. */
  const load = useCallback(
    async (next, { voice: voiceOverride, resumeAt = 0 } = {}) => {
      const audio = audioRef.current
      if (!audio) return
      const token = ++requestRef.current
      resumeAtRef.current = resumeAt

      setPassage(next)
      setStatus('preparing')
      setError(null)
      setTime(resumeAt)
      setDuration(0)
      segmentsRef.current = []
      indexRef.current = 0
      setSegments([])
      setSegmentIndex(0)

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: next.text,
            intro: next.intro,
            voice: voiceOverride ?? voice,
            // Ask the server to start rendering in pieces. Short passages come
            // back as a single segment anyway, so this costs nothing there.
            segment: true,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not prepare the audio.')
        // A newer request has been made since; this one's result is stale.
        if (token !== requestRef.current) return

        const list = data.segments ?? [{ url: data.url, seconds: data.seconds, chars: null }]
        segmentsRef.current = list.map((segment) => ({ ...segment }))
        indexRef.current = 0
        setSegments(segmentsRef.current)
        setSegmentIndex(0)

        // From here on, every event from this element is about the passage.
        delete audio.dataset.unlockOnly
        audio.src = list[0].url
        audio.playbackRate = rate
        await audio.play()
      } catch (err) {
        if (token !== requestRef.current) return
        // A refused play() is not a failure to prepare: the clip is loaded and
        // ready, the browser just wants a press. Saying "could not prepare the
        // audio" there would be a lie about what happened, and the fix (press
        // play) is already sitting in front of them.
        if (err?.name === 'NotAllowedError') {
          setStatus('paused')
          return
        }
        setStatus('error')
        setError(err.message || 'Could not prepare the audio.')
      }
    },
    [endpoint, rate, voice],
  )

  /**
   * Play a passage, or toggle the one already loaded.
   *
   * Idempotent by passage id: pressing the same button again pauses, and
   * pressing it a third time resumes from where it stopped. Pressing a
   * different button always starts that passage from the beginning.
   */
  const speak = useCallback(
    (input) => {
      const text = passageText(input.text ?? input)
      if (!text) return
      const id = input.id ?? passageId(text)
      const audio = audioRef.current

      // Still inside the click, so this is the moment the element can be
      // unlocked for the programmatic play() that follows the fetch.
      if (audio && !audio.dataset.unlocked) {
        audio.dataset.unlocked = 'yes'
        audio.dataset.unlockOnly = 'yes'
        audio.src = SILENCE
        void audio.play().catch(() => {})
      }

      if (passage?.id === id && audio?.src) {
        if (status === 'playing') {
          audio.pause()
        } else {
          if (status === 'ended') audio.currentTime = 0
          audio.playbackRate = rate
          void audio.play()
        }
        return
      }
      void load({ id, text, title: input.title ?? null, intro: input.intro ?? null })
    },
    [load, passage, rate, status],
  )

  const pause = useCallback(() => audioRef.current?.pause(), [])

  // Written after `stop` is defined; read by the auto-dismiss effect above,
  // which must not re-run every time an unrelated callback identity changes.
  const stopRef = useRef(() => {})

  const resume = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !audio.src) return
    if (status === 'ended') audio.currentTime = 0
    void audio.play()
  }, [status])

  const toggle = useCallback(() => {
    if (status === 'playing') pause()
    else resume()
  }, [pause, resume, status])

  /** Stops and forgets the passage — the player widget disappears with it. */
  const stop = useCallback(() => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    const audio = audioRef.current
    requestRef.current += 1
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setPassage(null)
    setStatus('idle')
    setError(null)
    setTime(0)
    setDuration(0)
  }, [])

  /* The passage's timeline, across every segment.
     ---------------------------------------------------------------------------
     `elapsed` and `total` are what the player shows, and neither is the current
     audio file's own numbers: a listener 40 seconds into a briefing does not
     care that they are 4 seconds into its third clip. Segments that have not
     been rendered yet contribute an estimate, and `estimated` says so, so the
     total can be labelled rather than quietly wrong. */
  const pace = useMemo(() => measurePace(segments), [segments])
  const total = useMemo(
    () => segments.reduce((sum, segment) => sum + segmentSeconds(segment, pace), 0),
    [segments, pace],
  )
  const elapsedBefore = useMemo(
    () =>
      segments
        .slice(0, segmentIndex)
        .reduce((sum, segment) => sum + segmentSeconds(segment, pace), 0),
    [segments, segmentIndex, pace],
  )
  const estimated = segments.some((segment) => typeof segment.seconds !== 'number')

  /** Seeks across the whole passage, switching segment if the target is in a
   *  different one. */
  const seek = useCallback(
    (seconds) => {
      const audio = audioRef.current
      const list = segmentsRef.current
      if (!audio || list.length === 0) return
      const paceNow = measurePace(list)
      const target = Math.max(0, Math.min(seconds, list.reduce((sum, s2) => sum + segmentSeconds(s2, paceNow), 0)))

      let index = 0
      let offset = target
      while (index < list.length - 1 && offset > segmentSeconds(list[index], paceNow)) {
        offset -= segmentSeconds(list[index], paceNow)
        index += 1
      }

      if (index === indexRef.current) {
        if (!Number.isFinite(audio.duration)) return
        audio.currentTime = Math.min(offset, audio.duration)
        setTime(audio.currentTime)
        return
      }

      // A different segment: swap the source and land at the offset once its
      // metadata arrives (the same path a voice change uses).
      const wasPlaying = !audio.paused
      indexRef.current = index
      setSegmentIndex(index)
      resumeAtRef.current = offset
      audio.src = list[index].url
      audio.playbackRate = rate
      if (wasPlaying) void audio.play().catch(() => setStatus('paused'))
    },
    [rate],
  )

  const skip = useCallback((delta) => seek((audioRef.current?.currentTime ?? 0) + delta), [seek])

  const setRate = useCallback(
    (next) => {
      setRateState(next)
      writeStored(rateKey, next)
      if (audioRef.current) audioRef.current.playbackRate = next
    },
    [rateKey],
  )

  const cycleRate = useCallback(() => {
    const index = rates.indexOf(rate)
    setRate(rates[(index + 1) % rates.length])
  }, [rate, rates, setRate])

  /**
   * Switching voice re-renders the current passage in the new one and drops the
   * listener back where they were. A voice picker that restarts the paragraph
   * is a voice picker nobody uses twice.
   */
  const setVoice = useCallback(
    (next) => {
      setVoiceState(next)
      writeStored(voiceKey, next)
      if (passage) void load(passage, { voice: next, resumeAt: audioRef.current?.currentTime ?? 0 })
    },
    [load, passage, voiceKey],
  )

  stopRef.current = stop

  const value = useMemo(
    () => ({
      available: service.available,
      unavailableReason: service.reason ?? null,
      voices: service.voices,
      endpoint,
      passage,
      activeId: passage?.id ?? null,
      status,
      error,
      // Virtual, across the whole passage — not the current clip's own clock.
      time: elapsedBefore + time,
      duration: total || duration,
      /** True while any segment's length is still an estimate. */
      estimated,
      segments,
      segmentIndex,
      voice,
      rate,
      rates,
      skipSeconds,
      speak,
      toggle,
      pause,
      resume,
      stop,
      seek,
      skip,
      setRate,
      cycleRate,
      setVoice,
    }),
    [
      service,
      endpoint,
      passage,
      status,
      error,
      time,
      duration,
      elapsedBefore,
      total,
      estimated,
      segments,
      segmentIndex,
      voice,
      rate,
      rates,
      skipSeconds,
      speak,
      toggle,
      pause,
      resume,
      stop,
      seek,
      skip,
      setRate,
      cycleRate,
      setVoice,
    ],
  )

  return <ReadAloudContext.Provider value={value}>{children}</ReadAloudContext.Provider>
}

/**
 * Everything the player and the buttons run on — exported so an app can build
 * its own controls instead of using the ones here.
 *
 * Returns `null` outside a provider rather than throwing: a shared component
 * that renders a `<ReadAloud>` should be droppable into an app that hasn't
 * adopted this library without exploding.
 */
export function useReadAloud() {
  return useContext(ReadAloudContext)
}
