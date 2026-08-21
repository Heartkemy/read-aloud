"""Rank rendered voice samples by acoustic proxies for "calm".

    python rank_voices.py <dir-written-by-scripts/rank-voices.mjs>

Not a taste judgement, and not pretending to be one: three measurable things
that correlate with a delivery people describe as calm — a slower speaking rate,
less pitch movement, and less loudness variation — each z-scored across the
field and averaged. Median pitch is printed but deliberately not scored: "deeper
is calmer" is a stereotype, not a finding.

Use it to shorten the list, then choose with your ears. Needs numpy, which lives
in the neural engine's virtualenv.
"""
import json, math, sys, wave
import numpy as np

manifest = json.load(open(sys.argv[1] + "/manifest.json"))
WORDS = manifest["words"]

def load(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        n = w.getnframes()
        raw = w.readframes(n)
        x = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
        if w.getnchannels() == 2:
            x = x.reshape(-1, 2).mean(axis=1)
    return x / 32768.0, sr

def f0_track(x, sr, fmin=60, fmax=350, frame=0.040, hop=0.020):
    fl, hl = int(sr*frame), int(sr*hop)
    out = []
    for start in range(0, max(0, len(x)-fl), hl):
        seg = x[start:start+fl]
        if np.sqrt(np.mean(seg**2)) < 0.01:
            continue
        seg = seg - seg.mean()
        corr = np.correlate(seg, seg, mode="full")[fl-1:]
        lo, hi = int(sr/fmax), int(sr/fmin)
        if hi >= len(corr):
            continue
        window = corr[lo:hi]
        if window.size == 0 or corr[0] <= 0:
            continue
        peak = int(np.argmax(window)) + lo
        if corr[peak] / corr[0] < 0.3:   # unvoiced / noisy frame
            continue
        out.append(sr / peak)
    return np.array(out)

rows = []
for v in manifest["voices"]:
    x, sr = load(v["file"])
    dur = len(x) / sr
    fl, hl = int(sr*0.030), int(sr*0.015)
    rms = np.array([np.sqrt(np.mean(x[i:i+fl]**2)) for i in range(0, max(1, len(x)-fl), hl)])
    db = 20*np.log10(np.maximum(rms, 1e-5))
    voiced = db > (db.max() - 35)
    f0 = f0_track(x, sr)
    semis = 12*np.log2(f0/np.median(f0)) if f0.size > 3 else np.array([0.0])
    rows.append({
        "id": v["id"], "name": v["name"], "accent": v["accent"],
        "engine": v["engine"], "type": v.get("voiceType", "?"),
        "rate": WORDS/dur,
        "energy_sd": float(db[voiced].std()) if voiced.sum() > 3 else 99.0,
        "pitch_sd": float(semis.std()),
        "median_f0": float(np.median(f0)) if f0.size else 0.0,
    })

def z(key, invert=True):
    vals = np.array([r[key] for r in rows])
    zs = (vals - vals.mean()) / (vals.std() or 1)
    return -zs if invert else zs

zr, ze, zp = z("rate"), z("energy_sd"), z("pitch_sd")
for i, r in enumerate(rows):
    r["calm"] = float((zr[i] + ze[i] + zp[i]) / 3)

rows.sort(key=lambda r: -r["calm"])
print(f"{'voice':34} {'accent':14} {'eng':7} {'calm':>6} {'wps':>5} {'engSD':>6} {'pitSD':>6} {'F0':>5}")
for r in rows:
    print(f"{r['id']:34} {r['accent']:14} {r['engine']:7} {r['calm']:6.2f} {r['rate']:5.2f} "
          f"{r['energy_sd']:6.2f} {r['pitch_sd']:6.2f} {r['median_f0']:5.0f}")

print("\nTOP 2 PER ACCENT")
seen = {}
for r in rows:
    key = r["accent"]
    seen.setdefault(key, [])
    if len(seen[key]) < 2:
        seen[key].append(r)
for accent, picks in seen.items():
    print(f"  {accent:14} " + ", ".join(f"{p['id']} ({p['calm']:.2f})" for p in picks))
