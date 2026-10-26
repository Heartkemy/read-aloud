"""Tests for the pause-widening pass (`breathe.py`).

Synthetic speech is easy to test: two sine bursts with a known gap between
them behave exactly like two sentences with a natural pause, and the assertions
are about silence arithmetic, not about listening.

Mirrors the read-aloud copy of this test; keep the two in step.
"""

import array
import math
import wave

import pytest

from breathe import CALM_PAUSE, DEFAULT_PAUSE, breathe

RATE = 24000


def _tone(seconds):
    """A 440 Hz sine burst — a speech stand-in with no internal silence."""
    a = array.array("h")
    for i in range(int(RATE * seconds)):
        a.append(int(12000 * math.sin(2 * math.pi * 440 * i / RATE)))
    return a


def _quiet(seconds):
    return array.array("h", b"\x00\x00") * int(RATE * seconds)


def _write_wav(path, segments):
    flat = array.array("h")
    for s in segments:
        flat.extend(s)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(flat.tobytes())
    return path


def _read_frames(path):
    with wave.open(str(path), "rb") as w:
        return array.array("h", w.readframes(w.getnframes()))


def test_breathe_lengthens_only_internal_pauses(tmp_path):
    src = _write_wav(tmp_path / "src.wav", [_quiet(0.05), _tone(0.15), _quiet(0.2), _tone(0.15), _quiet(0.1)])

    breathe(src, 0.4)

    # The 0.2 s internal gap grows to 0.6 s; lead/trail silence stays put.
    frames = _read_frames(src)
    assert len(frames) == int(RATE * (0.05 + 0.15 + 0.6 + 0.15 + 0.1))
    assert frames[: int(0.05 * RATE)] == _quiet(0.05)
    assert max(abs(s) for s in frames) > 5000  # the tone survived the rewrite


def test_breathe_leaves_micro_and_boundary_silence(tmp_path):
    src = _write_wav(tmp_path / "micro.wav", [_tone(0.15), _quiet(0.02), _tone(0.15), _quiet(0.3)])
    before = len(_read_frames(src))

    breathe(src, 0.4)

    # 0.02 s is a consonant closure, 0.3 s trailing is boundary: neither grows.
    assert len(_read_frames(src)) == before


def test_breathe_leaves_clause_commas_alone(tmp_path):
    """Real Kokoro output has many 30–100 ms gaps that are word/comma breaks,
    not sentence ends — widening them is what makes the voice sound cut off."""
    src = _write_wav(tmp_path / "clause.wav", [_tone(0.15), _quiet(0.1), _tone(0.15)])
    before = len(_read_frames(src))

    breathe(src, CALM_PAUSE)

    assert len(_read_frames(src)) == before  # 0.1 s stays untouched


def test_breathe_caps_the_widened_gap(tmp_path):
    """A flat 0.6 s on top of an already long pause makes a near-second hole.
    The widened gap is capped so quiet stays quiet, not robotic."""
    src = _write_wav(tmp_path / "cap.wav", [_tone(0.15), _quiet(0.6), _tone(0.15)])

    breathe(src, CALM_PAUSE)

    # 0.6 s natural + 0.6 s extra would be 1.2 s; the cap holds it at ~0.7 s.
    assert abs(len(_read_frames(src)) - int(RATE * (0.15 + 0.7 + 0.15))) <= 3


def test_breathe_is_a_noop_with_zero_extra_and_silent_files(tmp_path):
    src = _write_wav(tmp_path / "z.wav", [_tone(0.1)])
    breathe(src, 0.0)
    assert len(_read_frames(src)) == int(RATE * 0.1)

    quiet = _write_wav(tmp_path / "quiet.wav", [_quiet(0.2)])
    breathe(quiet, 0.4)
    assert len(_read_frames(quiet)) == int(RATE * 0.2)


def test_pause_amounts():
    assert DEFAULT_PAUSE == 0.25
    assert CALM_PAUSE == 0.6
    assert CALM_PAUSE > DEFAULT_PAUSE
