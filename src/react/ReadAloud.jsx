import { useMemo } from 'react'
import { passageText, passageId } from '../text.js'
import { useReadAloud } from './context.jsx'
import { LoadingDots, PauseIcon, PlayAllIcon, SpeakerIcon } from './icons.jsx'

/**
 * The speaker button that sits next to a passage.
 *
 * Deliberately small and quiet: it is punctuation on a paragraph, not a call to
 * action. It shows three states and only three — idle, preparing, and speaking
 * *this* passage — because a button that also has to express "something else is
 * playing" is a button nobody reads.
 *
 * Renders nothing at all when there is no speech service on the other end (or
 * while we are still asking). An icon that does nothing when clicked is worse
 * than no icon, and this is the difference between the feature degrading and
 * the feature breaking.
 *
 * @param {object}   props
 * @param {string|Array} props.text  What to say. Arrays are joined as
 *   paragraphs, so `[title, body, why]` reads with pauses where you'd expect.
 * @param {string}   [props.title]   What the player calls it ("Parent B's message").
 * @param {string}   [props.id]      Stable id; derived from the text if absent.
 * @param {string}   [props.label]   Accessible name. Defaults to "Read aloud".
 * @param {number}   [props.size]    Icon size in px.
 * @param {string}   [props.className] Merged with the library's own classes.
 * @param {string}   [props.intro]   Spoken-only lead-in, not shown anywhere.
 * @param {'passage'|'list'} [props.variant] `list` draws the play-all glyph
 *   instead of a speaker. Use it for the control that reads a whole list whose
 *   items each have their own button — two identical speakers side by side is
 *   the fastest way to make a list look broken.
 */
export function ReadAloud({
  text,
  title = null,
  id,
  label = 'Read aloud',
  size = 15,
  className = '',
  intro,
  variant = 'passage',
  ...rest
}) {
  const speech = useReadAloud()
  const body = useMemo(() => passageText(text), [text])
  const key = id ?? (body ? passageId(body) : null)

  if (!speech || speech.available !== true || !body) return null

  const isCurrent = speech.activeId === key
  const preparing = isCurrent && speech.status === 'preparing'
  const speaking = isCurrent && speech.status === 'playing'
  const state = preparing ? 'preparing' : speaking ? 'speaking' : 'idle'

  return (
    <button
      type="button"
      onClick={() => speech.speak({ id: key, text: body, title, intro })}
      className={`ra-button ${className}`.trim()}
      data-state={state}
      data-variant={variant}
      aria-label={speaking ? `Pause ${title ?? 'reading'}` : label}
      title={speaking ? 'Pause' : label}
      {...rest}
    >
      {preparing ? (
        <LoadingDots size={size} />
      ) : speaking ? (
        <PauseIcon size={size} />
      ) : variant === 'list' ? (
        <PlayAllIcon size={size} />
      ) : (
        <SpeakerIcon size={size} />
      )}
    </button>
  )
}

export default ReadAloud
