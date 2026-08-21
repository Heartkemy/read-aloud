#!/usr/bin/env python3
"""Local neural text-to-speech: Kokoro-82M through mlx-audio.

Nothing leaves the machine, nothing is metered, and on Apple Silicon it runs
roughly 15x faster than real time — a paragraph is spoken in well under a
second once the model is warm.

Two modes:

  one-shot   synthesize.py --text-file in.txt --out out.wav [--voice bm_fable]
             Prints one JSON object on stdout and exits. Simple, but pays the
             model load (~10-20s) every time, which is fine for a long article
             and hopeless for a read-aloud button on a paragraph.

  serve      synthesize.py --serve
             Loads the model once, then reads one JSON request per line on
             stdin and writes one JSON response per line on stdout. This is
             what the Node side uses: the first click after an idle period
             waits for the load, every click after that is near-instant.

Request (serve mode), one JSON object per line:
    {"id": "abc", "text": "...", "out": "/abs/path.wav",
     "voice": "bm_fable", "speed": 1.0, "normalize": true, "read_code": false}

Response, one JSON object per line:
    {"id": "abc", "ok": true, "seconds": 4.12, "voice": "bm_fable", "leaks": []}
    {"id": "abc", "ok": false, "error": "..."}

The first line written in serve mode is a banner:
    {"event": "ready", "model": "...", "voices": [...]}

`text` is raw markdown; `normalize.py` turns it into spoken prose in this
process rather than in the Node caller. The normalizer is ~370 lines of regex
with its own test suite, and one Python copy beats a hand-maintained
JavaScript twin that drifts.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import wave

# mlx-audio's generate_audio prints progress to stdout, and this script's
# contract is "stdout is JSON, one object per line". Everything the library
# writes is redirected to stderr; only our own json.dumps reaches the real
# stdout, held here before the swap.
_real_stdout = sys.stdout
sys.stdout = sys.stderr

from mlx_audio.tts.generate import generate_audio  # noqa: E402
from mlx_audio.tts.utils import load_model  # noqa: E402

from normalize import leaked_syntax, normalize  # noqa: E402

DEFAULT_MODEL = "prince-canuma/Kokoro-82M"
DEFAULT_VOICE = "bm_fable"


def lang_code_for(voice: str) -> str:
    """Kokoro picks its grapheme-to-phoneme front-end from a one-letter language
    code, and every voice name carries that letter as its first character:
    a=American English, b=British English, e=Spanish, f=French, h=Hindi,
    i=Italian, j=Japanese, p=Portuguese, z=Mandarin. Deriving the code from the
    voice keeps a British voice from being fed American phonemes, which is
    audible rather than cosmetic."""
    return voice[0] if voice and voice[0] in "abefhijpz" else "a"


def wav_seconds(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def available_voices(model) -> list[str]:
    """Voice ids this checkout of the model can actually produce, read off disk.

    The JS side ships its own catalogue (it needs labels and grouping before the
    model has loaded), so this exists to catch the one case that catalogue can't
    know about: a model snapshot that ships fewer voices than expected.
    """
    for attr in ("voice_dir", "voices_dir", "model_path", "path"):
        base = getattr(model, attr, None)
        if not base:
            continue
        candidates = [os.path.join(str(base), "voices"), str(base)]
        for directory in candidates:
            if os.path.isdir(directory):
                found = sorted(
                    os.path.splitext(f)[0]
                    for f in os.listdir(directory)
                    if f.endswith(".safetensors") and "_" in f
                )
                if found:
                    return found
    return []


def synthesize(model, *, text: str, out: str, voice: str, speed: float,
               do_normalize: bool, read_code: bool) -> dict:
    """Render one passage to `out`. Returns the JSON-able result body."""
    raw = (text or "").strip()
    if not raw:
        return {"ok": False, "error": "empty text"}

    spoken = normalize(raw, read_code=read_code) if do_normalize else raw
    if not spoken:
        return {"ok": False, "error": "nothing left to speak after normalizing"}
    # Any survivor here is a normalizer bug, not bad input — reported rather
    # than letting the model voice "asterisk asterisk" and calling it success.
    leaks = leaked_syntax(spoken)

    out_dir = os.path.dirname(os.path.abspath(out)) or "."
    os.makedirs(out_dir, exist_ok=True)
    # generate_audio names its output `<file_prefix>.<audio_format>`, so it gets
    # the prefix and appends the extension itself.
    prefix = os.path.splitext(os.path.basename(out))[0]

    generate_audio(
        text=spoken,
        model=model,
        voice=voice,
        speed=speed,
        lang_code=lang_code_for(voice),
        output_path=out_dir,
        file_prefix=prefix,
        audio_format="wav",
        join_audio=True,  # long text is chunked internally; we want one file
        play=False,
        verbose=False,
    )

    produced = os.path.join(out_dir, f"{prefix}.wav")
    if not os.path.exists(produced):
        return {"ok": False, "error": "synthesis produced no file"}

    return {
        "ok": True,
        "path": produced,
        "seconds": round(wav_seconds(produced), 2),
        "voice": voice,
        "leaks": leaks,
    }


def emit(payload: dict) -> None:
    print(json.dumps(payload), file=_real_stdout, flush=True)


def serve(model_path: str) -> int:
    """Model-resident mode. One JSON request per line in, one out.

    Requests are handled strictly in order on a single thread: MLX generation is
    GPU-bound and interleaving two passages would only make both slower, and a
    serial loop means the caller's queue is the only queue.
    """
    model = load_model(model_path=model_path)
    emit({"event": "ready", "model": model_path, "voices": available_voices(model)})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as err:
            emit({"ok": False, "error": f"bad request json: {err}"})
            continue

        req_id = req.get("id")
        try:
            body = synthesize(
                model,
                text=req.get("text", ""),
                out=req["out"],
                voice=req.get("voice") or DEFAULT_VOICE,
                speed=float(req.get("speed", 1.0)),
                do_normalize=bool(req.get("normalize", True)),
                read_code=bool(req.get("read_code", False)),
            )
        except KeyError as err:
            body = {"ok": False, "error": f"missing field {err}"}
        except Exception as err:  # noqa: BLE001 - the loop must outlive one bad passage
            body = {"ok": False, "error": f"{type(err).__name__}: {err}"}
        emit({"id": req_id, **body})

    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serve", action="store_true", help="model-resident stdin/stdout mode")
    parser.add_argument("--text-file", help="one-shot: file holding the text to speak")
    parser.add_argument("--out", help="one-shot: output .wav path")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument(
        "--no-normalize",
        action="store_true",
        help="feed the text to the model verbatim (it is already spoken prose)",
    )
    parser.add_argument(
        "--read-code",
        action="store_true",
        help="speak fenced code contents instead of announcing them",
    )
    args = parser.parse_args()

    if args.serve:
        return serve(args.model)

    if not args.text_file or not args.out:
        parser.error("one-shot mode needs --text-file and --out (or use --serve)")

    with open(args.text_file, "r", encoding="utf-8") as f:
        raw = f.read()

    result = synthesize(
        load_model(model_path=args.model),
        text=raw,
        out=args.out,
        voice=args.voice,
        speed=args.speed,
        do_normalize=not args.no_normalize,
        read_code=args.read_code,
    )
    emit(result)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
