import { useMemo } from 'react'
import { formatTime } from '../text.js'
import { groupVoices } from '../voices.js'
import { useReadAloud } from './context.jsx'
import { CloseIcon, LoadingDots, PauseIcon, PlayIcon, SkipIcon } from './icons.jsx'

/**
 * The transport controls for whatever is currently being read.
 *
 * Mounted once, near the root. It shows nothing until something is playing, so
 * it costs an app that never uses it exactly one empty render — and when it
 * does appear, it is the only player on the page, which is what lets a speaker
 * button stay a single 15px icon instead of growing its own controls.
 *
 * Shows the real elapsed and total time, never an estimate: the clip's duration
 * is known before the first frame plays, so there is no honest reason to round
 * it, hide it, or animate a bar that means nothing.
 *
 * @param {object} props
 * @param {'fixed'|'inline'} [props.placement] `fixed` docks it at the bottom of
 *   the viewport; `inline` renders it in normal flow wherever you put it.
 * @param {boolean} [props.voicePicker] Show the voice `<select>`.
 * @param {boolean} [props.speedControl] Show the playback-speed button.
 */
export function ReadAloudPlayer({
  placement = 'fixed',
  voicePicker = true,
  speedControl = true,
  className = '',
}) {
  const speech = useReadAloud()
  const grouped = useMemo(() => groupVoices(speech?.voices ?? []), [speech?.voices])

  if (!speech || !speech.passage) return null

  const { status, time, duration, error, skipSeconds, rate, voice } = speech
  const preparing = status === 'preparing'
  const playing = status === 'playing'
  const progress = duration > 0 ? Math.min(1, time / duration) : 0

  return (
    <div
      className={`ra-player ra-player--${placement} ${className}`.trim()}
      role="region"
      aria-label="Read aloud player"
    >
      <button
        type="button"
        className="ra-player__play"
        onClick={speech.toggle}
        disabled={preparing || status === 'error'}
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
      >
        {preparing ? <LoadingDots size={18} /> : playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>

      <button
        type="button"
        className="ra-player__icon"
        onClick={() => speech.skip(-skipSeconds)}
        disabled={preparing || !duration}
        aria-label={`Back ${skipSeconds} seconds`}
        title={`Back ${skipSeconds}s`}
      >
        <SkipIcon seconds={skipSeconds} back size={17} />
      </button>

      <button
        type="button"
        className="ra-player__icon"
        onClick={() => speech.skip(skipSeconds)}
        disabled={preparing || !duration}
        aria-label={`Forward ${skipSeconds} seconds`}
        title={`Forward ${skipSeconds}s`}
      >
        <SkipIcon seconds={skipSeconds} size={17} />
      </button>

      <div className="ra-player__track">
        {/* A real range input, not a div with pointer handlers: it arrives with
            keyboard support, a screen-reader announcement of the position, and
            the platform's own touch behaviour, none of which a custom scrubber
            gets for free. */}
        <input
          type="range"
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
      </div>

      <span className="ra-player__time" aria-hidden="true">
        {formatTime(time)} / {formatTime(duration)}
      </span>

      {speedControl && (
        <button
          type="button"
          className="ra-player__chip"
          onClick={speech.cycleRate}
          aria-label={`Playback speed ${rate}×. Click to change.`}
          title="Playback speed"
        >
          {rate}×
        </button>
      )}

      {voicePicker && grouped.length > 0 && (
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
      )}

      <p className="ra-player__title">
        {error ? <span className="ra-player__error">{error}</span> : speech.passage.title}
      </p>

      <button
        type="button"
        className="ra-player__icon ra-player__close"
        onClick={speech.stop}
        aria-label="Stop reading"
        title="Stop reading"
      >
        <CloseIcon size={16} />
      </button>
    </div>
  )
}

export default ReadAloudPlayer
