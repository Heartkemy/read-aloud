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

    const onTime = () => setTime(audio.currentTime)
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration)
      // Restored position after a voice change: the listener was 40 seconds
      // into a passage and should not be sent back to the start by it.
      if (resumeAtRef.current > 0) {
        audio.currentTime = Math.min(resumeAtRef.current, audio.duration || 0)
        resumeAtRef.current = 0
      }
    }
    const onPlay = () => setStatus('playing')
    const onPause = () => setStatus((s) => (s === 'playing' ? 'paused' : s))
    const onEnded = () => {
      setStatus('ended')
      setTime(0)
    }
    const onError = () => {
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

  /** Fetches (or picks up the cached) clip and starts it. */
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

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: next.text,
            intro: next.intro,
            voice: voiceOverride ?? voice,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not prepare the audio.')
        // A newer request has been made since; this one's result is stale.
        if (token !== requestRef.current) return

        setDuration(data.seconds ?? 0)
        audio.src = data.url
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

  const seek = useCallback((seconds) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    const clamped = Math.min(audio.duration, Math.max(0, seconds))
    audio.currentTime = clamped
    setTime(clamped)
  }, [])

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
      time,
      duration,
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
