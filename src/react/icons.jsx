/**
 * Icons, inline.
 *
 * The library has no runtime dependencies and no icon-font or icon-package
 * requirement, because the three things a shared component must never do to a
 * host app are add a peer dependency, add a build step, and pick a design
 * system. Every path is drawn on the same 24-unit grid with `currentColor`, so
 * they inherit the surrounding text colour and size cleanly next to any icon
 * set the host already uses.
 */

function Icon({ size = 16, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export function SpeakerIcon(props) {
  return (
    <Icon {...props}>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </Icon>
  )
}

export function PlayIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 4.5 19 12 6 19.5z" fill="currentColor" strokeWidth="1.5" />
    </Icon>
  )
}

export function PauseIcon(props) {
  return (
    <Icon {...props}>
      <path d="M8 5v14M16 5v14" />
    </Icon>
  )
}

export function StopIcon(props) {
  return (
    <Icon {...props}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" strokeWidth="1.5" />
    </Icon>
  )
}

export function CloseIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

/** Skip back / forward. The arc plus a number is the convention every podcast
 *  player uses, and it beats a bare chevron for "how far does this jump?". */
export function SkipIcon({ seconds = 10, back = false, size = 16, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      {/* The arc is drawn pointing forwards; the *back* variant is the one that
          gets mirrored. Written the other way round first, which put a
          clockwise arrow on "back 10 seconds" and an anticlockwise one on
          "forward" — both wrong, and wrong in the way that is hardest to
          notice, because each looked right on its own. */}
      <g transform={back ? undefined : 'scale(-1,1) translate(-24,0)'}>
        <path d="M4 12a8 8 0 1 0 2.6-5.9" />
        <path d="M4 3.5V8h4.5" />
      </g>
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        {seconds}
      </text>
    </Icon>
  )
}

/**
 * Play-all: stacked lines with a play triangle.
 *
 * A list where every item has a speaker needs one more control — "read me all
 * of these" — and it cannot be a second identical speaker icon, or the two are
 * indistinguishable and the list looks like it has a stray button. Lines plus a
 * triangle is the queue/playlist convention, and it says "several things, in
 * order" without a label.
 */
export function PlayAllIcon(props) {
  return (
    <Icon {...props}>
      <path d="M4 6h10M4 12h7M4 18h5" />
      <path d="M15 12.5v7l6-3.5z" fill="currentColor" strokeWidth="1.5" />
    </Icon>
  )
}

/** The chevron on the voice picker. Drawn by us because a native `<select>`
 *  arrow cannot be positioned, sized or coloured, and on a pill-shaped control
 *  it sits hard against the rounded edge. */
export function ChevronIcon(props) {
  return (
    <Icon {...props}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

/** The waiting state: three dots, because a spinner implies a duration we do
 *  not know. Animated in CSS so `prefers-reduced-motion` can stop it. */
export function LoadingDots({ size = 16 }) {
  return (
    <span className="ra-dots" style={{ width: size, height: size }} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  )
}
