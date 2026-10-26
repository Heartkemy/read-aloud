# read-aloud

A speaker button on every paragraph, one shared player, and a voice that never
leaves the machine.

```jsx
<p>
  The ferry leaves from Pier 3 at 09:30, with room for bicycles on the upper deck.
  <ReadAloud text="The ferry leaves from Pier 3 at 09:30…" />
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
users' text to a third party. Neither is acceptable when the content should stay
on the machine that is reading it.

The interesting constraint is *granularity*. Narrating a whole page is easy;
putting a button on every passage is not, because a cold model load per click is
eight seconds and nobody clicks twice. So:

- the model is **loaded once and kept warm** in a stdin/stdout worker (7.6 s
  cold, **0.57 s** warm for a four-second passage on an M-series Mac). It starts
  loading when a page containing read-aloud opens — not on the first click,
  where the load *is* the first impression — and its idle countdown is restarted
  by playback finishing rather than by rendering, because a long passage renders
  everything in the first few seconds and is then listened to for minutes,
- a long passage is **cut into segments and starts playing on the first one**
  while the rest render behind it — 1.5 s to first audio on a 47-second passage
  instead of waiting for the whole thing,
- audio is **content-addressed** — same text, same voice, same normalizer output
  means the same file, so a second listen costs a static read,
- clips are served with **HTTP Range** support, so the scrubber seeks instead of
  re-downloading,
- markdown is turned into speakable prose by **one** normalizer that every
  engine shares, rather than a copy per engine that drifts.

## Install

```sh
npm install github:Heartkemy/read-aloud
```

On macOS that is the entire installation: the system voices work immediately.

For the neural engine (Apple Silicon), use an isolated Python environment:

```sh
npx read-aloud-setup --venv "$PWD/.venv/read-aloud"
```

Set `READ_ALOUD_PYTHON="$PWD/.venv/read-aloud/bin/python"` in the app that
uses it. The supported, tested baseline is Python 3.12 with the pinned top-level
set in [`python/requirements-neural.txt`](python/requirements-neural.txt):
`mlx-audio` 0.5.3, `misaki[en]` 0.9.4, and `spacy` 3.8.16. Recreate a disposable
venv before deliberately changing that set; do not let a later install silently
change a shared runtime.

The model (~350 MB) downloads on the first real neural synthesis into the
Hugging Face cache (`HF_HOME`, if set, otherwise its platform default). Rendered
audio remains in this service's `cacheDir` until eviction or cleanup. Browser
responses are never publicly cached. Remove the selected venv, model cache, and
audio cache independently when you no longer need them; use Hugging Face's
[cache-management instructions](https://huggingface.co/docs/huggingface_hub/guides/manage-cache)
to remove a selected model without deleting unrelated downloads. The selected
[Kokoro-82M model card](https://huggingface.co/prince-canuma/Kokoro-82M) declares
Apache-2.0, but its model, voice, and dependency terms remain separate from this
repository's MIT license.

On Apple Silicon, this dependency-only smoke verifies the isolated install with
no model download or real user text:

```sh
READ_ALOUD_PYTHON="$PWD/.venv/read-aloud/bin/python" \
  "$PWD/.venv/read-aloud/bin/python" -c "import espeakng_loader, misaki, mlx_audio, spacy; print('neural dependencies import')"
```

### Local consumer contract

The package name remains `@athanor-code/read-aloud` for compatibility. The
current local contract is version `0.1.0`: build it, make a tarball, and install
that tarball into a consumer or plugin checkout—no npm publication is needed.

```sh
npm run build
npm pack
# From the consumer checkout:
npm install /absolute/path/to/athanor-code-read-aloud-0.1.0.tgz
```

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

**Anything else** — a bare `http` server or a Node-compatible Fetch runtime:

```js
import { createReadAloudService } from '@athanor-code/read-aloud/server'

const service = createReadAloudService()
http.createServer((req, res) => service.handleRequest(req, res))
```

## Local service contract

The included adapters are for one local user. The Node adapter requires both a
loopback connection and a loopback `Host`; the Fetch adapter requires a loopback
request URL and cannot inspect the underlying socket. Both reject unapproved
browser origins. Audio replies use `Cache-Control: private, no-store`, while the
service's on-disk cache stays local to `cacheDir`.

Same-origin browser calls work without extra configuration. A local sidecar with
a non-browser origin must name that exact origin; the host and connection still
have to be loopback:

```js
const service = createReadAloudService({
  allowedOrigins: ['app://your-sidecar.example'],
})
```

The option grants CORS only to the listed exact origins; it is not a wildcard or
remote deployment switch. Do not expose these adapters on a network host. A
Fetch adapter cannot prove a socket peer, so it belongs only behind a handler
that preserves the loopback boundary. A remote application needs authentication
and user isolation outside this library.

The Fetch adapter uses Node file APIs for the audio cache, so it is not supported
in edge or Cloudflare runtimes.

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

Lists want both modes — play one, or play the lot. The play-all control gets its
own glyph (stacked lines and a triangle), because two identical speaker icons
side by side make a list look like it has a stray button in it:

```jsx
<h3>
  Facilitators
  <ReadAloud variant="list" text={people.flatMap((p) => [p.name, p.bio])} title="Facilitators" />
</h3>
{people.map((p) => (
  <p key={p.name}>
    {p.bio} <ReadAloud text={[p.name, p.bio]} title={p.name} />
  </p>
))}
```


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
| `ReadAloud` | The 24×24 speaker button. Renders `null` if no engine is available. `variant="list"` draws a play-all glyph instead. |
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
| `kokoro` | `npx read-aloud-setup --venv "$PWD/.venv/read-aloud"` | 28 English (American + British), plus Spanish, French, Italian, Portuguese, Hindi, Japanese, Mandarin | Neural. Noticeably warmer. |

macOS's novelty and pre-2010 voices (Boing, Zarvox, Fred…) are hidden by
default; pass `includeNovelty: true` if you want them.

**Picking a default.** Rather than guess which voice sounds calm, render one
sentence in every voice and measure: speaking rate, pitch variation in semitones,
and loudness variation. `scripts/rank-voices.mjs` does exactly that and prints a
ranked table — a defensible starting point, and your ears get the final say via
the picker.

## Starting before it has finished rendering

Rendering a five-minute briefing takes ~20 seconds even at 15× real time, and
nobody waits 20 seconds after pressing play. True streaming is not available —
MediaSource cannot take WAV — so the library does the thing that works instead:

1. the passage is cut into segments at **sentence boundaries** (never mid-clause,
   because a cut mid-sentence is audible on both sides), with a deliberately
   short first segment;
2. the first segment is rendered and returned, and playback starts;
3. the rest render in the background, **in order, serially** — generation is
   GPU-bound, so rendering them all at once makes segment two arrive later,
   which is the only arrival time a listener can feel;
4. every segment's URL is a content hash, so the client knows all of them before
   the audio exists and simply requests the next one. A request for a clip that
   is still rendering **waits for it** rather than 404ing.

The player presents this as one passage: elapsed and total are computed across
the whole list, seeking crosses segment boundaries, and a total that still
contains an estimate is shown with a `~` until the real durations arrive.
Segments that have been rendered are cached individually, so a second listen
starts instantly and a partially-heard passage costs nothing to resume.

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
- **Not a byte-streaming API.** Segmented reads start after the first clip is
  rendered, while later clips render in the background. Very long articles are
  still not the target use.

## Development

```sh
# Node 20.19+; `npm run test:python` uses uv and Python 3.12.
npm test              # vitest — text helpers, voice catalogue, WAV probing, say parsing
npm run test:python   # normalization and pause-widening suites
npm run build         # esbuild → dist/react.js (runs automatically on install)
npm pack --dry-run    # verify the files a consumer receives
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the public development workflow,
[SECURITY.md](SECURITY.md) for private vulnerability reporting, and
[SUPPORT.md](SUPPORT.md) for reproducible support requests.

## License

MIT, attributed to Heartkemy in [LICENSE](LICENSE). See [NOTICE.md](NOTICE.md)
for separate third-party terms.
