import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatTime } from '../text.js'
import { groupVoices } from '../voices.js'
import { useReadAloud } from './context.jsx'
import { ChevronIcon, CloseIcon, LoadingDots, PauseIcon, PlayIcon, SkipIcon } from './icons.jsx'

const MINI_RING = 34
const CONTROL_RING = 54

/** How long the panel stays open after the pointer leaves it.
 *  Without a grace period, expanding on hover is a trap: the widget grows,
 *  reflows under the cursor, and the first move towards a button crosses a
 *  boundary that closes the thing you were reaching for. */
const CLOSE_DELAY_MS = 500

/**
 * A circle that fills as the passage is read.
 *
 * Used twice, and that is the point. Collapsed, it *is* the player: a 34px ring
 * in the corner answering the only question someone has while listening ("how
 * far through is it?"). Expanded, the same ring is the card's play button, in
 * the same corner — so the panel reads as unfolding around the control that was
 * already there, rather than as a different widget replacing it.
 */
function ProgressRing({ progress, status, variant = 'mini' }) {
  const size = variant === 'mini' ? MINI_RING : CONTROL_RING
  const stroke = variant === 'mini' ? 2 : 2.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const glyph = variant === 'mini' ? 12 : 20

  return (
    <span className={`ra-player__ring ra-player__ring--${variant}`} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--ra-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ra-player__ring-fill"
        />
      </svg>
      <span className="ra-player__ring-glyph">
        {status === 'preparing' ? (
          <LoadingDots size={glyph} />
        ) : status === 'playing' ? (
          <PauseIcon size={glyph} />
        ) : (
          <PlayIcon size={glyph} />
        )}
      </span>
    </span>
  )
}

/**
 * The transport controls for whatever is currently being read.
 *
 * Mounted once, near the root. Nothing is on screen until something plays, and
 * then as little as possible: a filling ring in the corner, which becomes a
 * small card when hovered, focused or tapped.
 *
 * The card is a three-row stack rather than one long strip — title and close on
 * top, the scrubber spanning the width beneath it, transport and settings along
 * the bottom. A single row forces the passage title into whatever space is left
 * over, which is how it ended up as a caption dangling under the controls; a
 * stack gives it the top line, where a title belongs, and keeps the widget the
 * same fixed width whatever it is reading.
 *
 * Times are real, never estimated: the clip's duration is known before the
 * first frame plays, so there is no honest reason to round it or to animate a
 * bar that means nothing.
 *
 * @param {object} props
 * @param {'fixed'|'inline'} [props.placement] `fixed` docks it to the viewport;
 *   `inline` renders it in normal flow, always open, wherever you put it.
 * @param {'end'|'center'|'start'} [props.align] Which side `fixed` docks to.
 * @param {boolean} [props.voicePicker] Show the voice `<select>`.
 * @param {boolean} [props.speedControl] Show the playback-speed button.
 * @param {boolean} [props.calmControl] Show the Calm toggle.
 */
export function ReadAloudPlayer({
  placement = 'fixed',
  align = 'end',
  voicePicker = true,
  speedControl = true,
  calmControl = true,
  className = '',
}) {
  const speech = useReadAloud()
  const grouped = useMemo(() => groupVoices(speech?.voices ?? []), [speech?.voices])
  const [open, setOpen] = useState(false)
  /* Pinned by a click or a touch, and stays pinned until the pointer actually
     leaves: hover does not exist on a touch screen, so "tap the ring to open
     the controls" has to work there too. Tapping the ring therefore opens
     rather than pausing — pause is one press away inside, and a control that
     means different things on different devices is worse than one extra tap. */
  const [pinned, setPinned] = useState(false)
  const closeTimer = useRef(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])

  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      setPinned(false)
    }, CLOSE_DELAY_MS)
  }, [cancelClose])

  useEffect(() => cancelClose, [cancelClose])

  /* Every new passage starts collapsed.
     ---------------------------------------------------------------------------
     This component stays mounted for the life of the app and only renders
     nothing while there is nothing playing, so without this reset the open/
     pinned state survives from one passage to the next: open the controls once,
     and every subsequent speaker button anywhere in the app pops a full card
     into the corner instead of the quiet ring. */
  const passageId = speech?.passage?.id ?? null
  useEffect(() => {
    setOpen(false)
    setPinned(false)
  }, [passageId])

  if (!speech || !speech.passage) return null

  const { status, time, duration, error, skipSeconds, rate, voice, calm, estimated } = speech
  const preparing = status === 'preparing'
  const playing = status === 'playing'
  const progress = duration > 0 ? Math.min(1, time / duration) : 0
  const expanded = placement === 'inline' || open || pinned

  return (
    <div
      className={`ra-player ra-player--${placement} ra-player--${align} ${className}`.trim()}
      role="region"
      aria-label="Read aloud player"
      /* `state` drives the fade before the widget clears itself; `active` means
         "this is what you are listening to right now"; `expanded` swaps the ring
         for the card. Preparing counts as active — the widget only just appeared
         because of something you pressed. */
      data-state={status}
      data-active={playing || preparing ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
      onPointerEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onPointerDown={() => {
        cancelClose()
        setPinned(true)
      }}
      onPointerLeave={scheduleClose}
      onFocusCapture={() => {
        cancelClose()
        setOpen(true)
      }}
      onBlurCapture={(event) => {
        // Keyboard focus leaving the widget entirely closes it; moving between
        // its own controls does not.
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
      }}
    >
      {!expanded ? (
        <button
          type="button"
          className="ra-player__collapsed"
          onClick={() => setPinned(true)}
          aria-expanded={false}
          aria-label={`Read aloud controls — ${Math.round(progress * 100)}% through ${
            speech.passage.title ?? 'this passage'
          }`}
          title={speech.passage.title ?? 'Read aloud'}
        >
          <ProgressRing progress={progress} status={status} />
        </button>
      ) : (
        <div className="ra-player__card">
          <div className="ra-player__head">
            <p className="ra-player__title" title={speech.passage.title ?? undefined}>
              {error ? <span className="ra-player__error">{error}</span> : speech.passage.title}
            </p>
            <button
              type="button"
              className="ra-player__icon ra-player__close"
              onClick={speech.stop}
              aria-label="Stop reading"
              title="Stop reading"
            >
              <CloseIcon size={15} />
            </button>
          </div>

          {/* A real range input, not a div with pointer handlers: keyboard
              support, a screen-reader announcement of the position, and the
              platform's own touch behaviour all come with it. */}
          <input
            type="range"
            className="ra-player__scrubber"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(time, duration || 0)}
            onChange={(event) => speech.seek(Number(event.target.value))}
            disabled={preparing || !duration}
            aria-label="Playback position"
            aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
            style={{ '--ra-progress': `${progress * 100}%` }}
          />

          {/* Elapsed on the left, total on the right, under the scrubber —
              where a music player puts them. Reading "0:18 / 0:25" as one
              string is a stopwatch; split to the ends of the bar they belong
              to, they are just the two ends of the bar. */}
          {/* The total carries a `~` while any segment is still being rendered
              and its length is an estimate. Showing an estimate as if it were
              measured is the kind of small lie a player has no reason to tell —
              and it resolves to the real number as the segments arrive. */}
          <div className="ra-player__times" aria-hidden="true">
            <span>{formatTime(time)}</span>
            <span title={estimated ? 'Estimated — still being generated' : undefined}>
              {estimated ? '~' : ''}
              {formatTime(duration)}
            </span>
          </div>

          {/* Transport centred, play at its centre and twice the size of
              anything else: one obvious thing to press, two smaller ones either
              side. The play control is the ring that was in the corner a moment
              ago, grown — same element, same meaning, more of it. */}
          <div className="ra-player__transport">
            <button
              type="button"
              className="ra-player__icon"
              onClick={() => speech.skip(-skipSeconds)}
              disabled={preparing || !duration}
              aria-label={`Back ${skipSeconds} seconds`}
              title={`Back ${skipSeconds}s`}
            >
              <SkipIcon seconds={skipSeconds} back size={22} />
            </button>

            <button
              type="button"
              className="ra-player__play"
              onClick={speech.toggle}
              disabled={preparing || status === 'error'}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
            >
              <ProgressRing progress={progress} status={status} variant="control" />
            </button>

            <button
              type="button"
              className="ra-player__icon"
              onClick={() => speech.skip(skipSeconds)}
              disabled={preparing || !duration}
              aria-label={`Forward ${skipSeconds} seconds`}
              title={`Forward ${skipSeconds}s`}
            >
              <SkipIcon seconds={skipSeconds} size={22} />
            </button>
          </div>

          {/* Settings last, and quietest: speed on the left, who is reading on
              the right. Both are things you set once and forget, so they sit
              below the controls you actually use. */}
          <div className="ra-player__settings">
            {speedControl && (
              <button
                type="button"
                className="ra-player__chip ra-player__rate"
                onClick={speech.cycleRate}
                aria-label={`Speed ${rate} times. Click to change.`}
                title="Playback speed"
              >
                {rate}× speed
              </button>
            )}

            {calmControl && (
              <button
                type="button"
                className="ra-player__chip ra-player__calm"
                onClick={speech.toggleCalm}
                aria-pressed={calm}
                aria-label={`Calm reading${calm ? ', on' : ', off'}. Click to toggle.`}
                title="Calm — slower default speed and longer pauses between sentences, for dense text"
              >
                Calm
              </button>
            )}

            {voicePicker && grouped.length > 0 && (
              <span className="ra-player__select">
                <select
                  className="ra-player__chip ra-player__voice"
                  value={voice}
                  onChange={(event) => speech.setVoice(event.target.value)}
                  aria-label="Voice"
                  title="Voice"
                >
                  {grouped.map(({ group, voices }) => (
                    <optgroup key={group} label={group}>
                      {voices.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <ChevronIcon size={14} />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ReadAloudPlayer
