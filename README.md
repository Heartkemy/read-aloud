# read-aloud

A speaker button on every paragraph, one shared player, and a voice that never
leaves the machine.

```jsx
<p>
  Anything sent here may be used as evidence of a breach of your court orders.
  <ReadAloud text="Anything sent here may be used as evidence…" />
</p>
```

That is the whole API at the call site. Everything else — one player at a time,
a warm model, a content-addressed audio cache, seeking, playback speed, a voice
picker that remembers what you chose — is handled by the provider and the server
adapter.

**Local by design.** Two engines, both on your own computer: Apple's `say`
(zero setup, and the only way to get Australian, Indian, Irish or South African
English) and [Kokoro-82M](https://huggingface.co/prince-canuma/Kokoro-82M) via
[mlx-audio](https://pypi.org/project/mlx-audio/) on Apple Silicon (neural, 15×
faster than real time). No API key, no per-character billing, no text leaving
the device — which matters when the text is a private message rather than a blog
post.

---

## Why this exists

Read-aloud is usually one of two things: a browser `speechSynthesis` call that
sounds like 2011 and can't seek, or a cloud TTS bill that means shipping your
users' text to a third party. Neither is acceptable if the content is personal —
a court-ordered co-parenting message, a therapy exercise, a private financial
briefing.

The interesting constraint is *granularity*. Narrating a whole page is easy;
putting a button on every passage is not, because a cold model load per click is
eight seconds and nobody clicks twice. So:

- the model is **loaded once and kept warm** in a stdin/stdout worker (7.6 s
  cold, **0.57 s** warm for a four-second passage on an M-series Mac),
- audio is **content-addressed** — same text, same voice, same normalizer output
  means the same file, so a second listen costs a static read,
- clips are served with **HTTP Range** support, so the scrubber seeks instead of
  re-downloading,
- markdown is turned into speakable prose by **one** normalizer that every
  engine shares, rather than a copy per engine that drifts.

## Install

```sh
npm install github:athanor-code/read-aloud
```

On macOS that is the entire installation: the system voices work immediately.

For the neural engine (Apple Silicon), install the Python side once per machine —
it is shared by every app that uses this library:

```sh
npx read-aloud-setup
```

That creates `~/.cache/read-aloud/venv` with `mlx-audio` and `misaki[en]`, and
tells you if `espeak-ng` (the out-of-vocabulary fallback, `brew install espeak-ng`)
is missing. The model itself (~350 MB) downloads on first use into the shared
Hugging Face cache.

## Wiring it up

### 1. Serve the API

**Vite**

```js
import { readAloud } from '@athanor-code/read-aloud/vite'

export default defineConfig({
  plugins: [react(), readAloud({ defaultVoice: 'say:Karen' })],
})
```

**Express**

```js
import { readAloudRouter } from '@athanor-code/read-aloud/express'

const readAloud = readAloudRouter({ basePath: '/api/read-aloud' })
app.use(readAloud.basePath, readAloud)   // mount before any body parser
```

**Anything else** — Next route handlers, Fastify, a bare `http` server:

```js
import { createReadAloudService } from '@athanor-code/read-aloud/server'

const service = createReadAloudService()
http.createServer((req, res) => service.handleRequest(req, res))
```

### 2. Wrap the app and drop in the player

```jsx
import { ReadAloudProvider, ReadAloudPlayer } from '@athanor-code/read-aloud'
import '@athanor-code/read-aloud/style.css'

<ReadAloudProvider voice="say:Karen" rates={[1, 1.25, 1.5, 2]}>
  <App />
  <ReadAloudPlayer />          {/* renders nothing until something plays */}
</ReadAloudProvider>
```

### 3. Put buttons where the prose is

```jsx
<ReadAloud text={message.text} title={`${sender}'s message`} />

{/* Arrays become paragraphs, so a heading and its body read as one passage
    with a pause in between — and a falsy branch just disappears. */}
<ReadAloud
  text={[technique.title, technique.how, showWhy && technique.why]}
  title={technique.title}
/>
```

## What the pieces do

| Export | What it is |
| --- | --- |
| `ReadAloudProvider` | Owns the single `Audio` element, the settings, and the fetch. |
| `ReadAloud` | The 24×24 speaker button. Renders `null` if no engine is available. |
| `ReadAloudPlayer` | Transport: play/pause, ±10 s, scrubber, time, speed, voice, close. |
| `useReadAloud()` | Everything above as state and callbacks, for custom UI. |
| `passageText`, `speakDigits` | Text helpers — array-to-paragraphs, and phone numbers spelled digit by digit so they can be written down. |
| `createReadAloudService` | The server: cache, engines, normalizer, HTTP handler. |

### Theming

Every colour, radius and shadow is a CSS custom property, so a host app maps its
own tokens in one block and never fights specificity:

```css
:root {
  --ra-accent: var(--color-primary);
  --ra-accent-ink: var(--color-primary-ink);
  --ra-surface: var(--color-panel);
  --ra-muted: var(--color-subtle);
}
```

Dark mode follows `prefers-color-scheme` out of the box, the dots animation
respects `prefers-reduced-motion`, and both the button and the player are hidden
in print.

## Voices

`GET /api/read-aloud` returns every voice the machine can actually produce,
already grouped for a picker. Ids are engine-qualified — `say:Karen`,
`kokoro:bm_fable` — because a stored preference has to survive both engines
being installed, and both of them have a "Daniel".

| Engine | Setup | Voices | Sounds like |
| --- | --- | --- | --- |
| `say` (macOS) | none | ~26 English, incl. Australian, Indian, Irish, South African | System TTS. Clear, a little flat. |
| `kokoro` | `npx read-aloud-setup` | 28 English (American + British), plus Spanish, French, Italian, Portuguese, Hindi, Japanese, Mandarin | Neural. Noticeably warmer. |

macOS's novelty and pre-2010 voices (Boing, Zarvox, Fred…) are hidden by
default; pass `includeNovelty: true` if you want them.

**Picking a default.** Rather than guess which voice sounds calm, render one
sentence in every voice and measure: speaking rate, pitch variation in semitones,
and loudness variation. `scripts/rank-voices.mjs` does exactly that and prints a
ranked table — a defensible starting point, and your ears get the final say via
the picker.

## Architecture

```
 <ReadAloud text=… />                    one <Audio> element, one passage at a time
        │  speak({id,text})                       ▲
        ▼                                         │
 ReadAloudProvider ── POST /api/read-aloud ──►  { url, seconds }
                                  │
                     ┌────────────┴─────────────┐
                     │  content-addressed cache │  hash(version, voice, spoken)
                     └────────────┬─────────────┘
                                  │ miss
                     normalizer (python3, stdlib) ── markdown → prose
                                  │
                   ┌──────────────┴───────────────┐
              say (instant)              kokoro worker (warm, ~0.5 s)
```

Design decisions worth knowing about, each of which was a bug or a measurement
first:

- **The synthesizer is a resident worker, not a subprocess per call.** A cold
  Kokoro load is 7.6 s; warm renders are 0.57 s. It is killed after ten idle
  minutes, because it holds ~1.5 GB.
- **The cache key is the *normalized* text**, so improving the normalizer
  invalidates exactly the clips it changes and nothing else.
- **Duration is read by walking the WAV chunks**, not from a fixed 44-byte
  header — macOS `say` writes a `LIST` chunk first, and a wrong duration is a
  scrubber that can't reach the end.
- **The scrubber is a real `<input type="range">`.** Keyboard support, screen
  reader announcements and touch behaviour come free; a custom div gets none of
  them.
- **`ReadAloud` renders nothing when no engine is available.** A speaker icon
  that does nothing when clicked is worse than no icon.
- **Text is named by the call site, never scraped from the DOM.** Harvesting
  `textContent` from a ref is one line shorter and always ends up reading button
  labels and timestamps aloud.

## Limits

- **Apple Silicon only for the neural engine.** `mlx-audio` is MLX; there is no
  CUDA or CPU path here. The macOS engine has no such requirement, and the engine
  interface is small (`available`, `voices`, `render`) if you want to add Piper or
  espeak-ng for Linux.
- **The system engine is macOS-only**, so on Linux without the neural setup there
  are no voices and the buttons stay hidden.
- **No word-level highlighting.** The clip is one file; there are no boundary
  events. Sentence-level highlighting would need timestamped synthesis.
- **Not a streaming API.** A passage is rendered fully before it plays, which is
  sub-second warm but means a very long article is not the target use.

## Development

```sh
npm test              # vitest — text helpers, voice catalogue, WAV probing, say parsing
npm run test:python   # the markdown normalizer's own suite
npm run build         # esbuild → dist/react.js (runs automatically on install)
```

## License

MIT © Shirin
