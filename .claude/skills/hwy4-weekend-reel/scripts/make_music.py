#!/usr/bin/env python3
"""Compose an original, rights-clean soundtrack for the reel, synced to its scenes.

Everything is synthesized from scratch (plucked-string guitar, bass, drums, glockenspiel),
so there is no sample, loop, or recording for Facebook Rights Manager to match.
At 120 BPM one bar = 2.0 s, and the template's scene lengths are multiples of 2 s,
so every cut lands on a downbeat. Arrangement follows each scene's theme:
  hook -> intro strums, with a boom on the boot stomp (2.0 s)
  divider -> four-on-the-floor lift, crash, snare roll into the next scene
  night -> groove with rim clicks      sunrise -> full band, claps, glock melody
  trees -> mellow, shaker and sparse glock      list -> full band      end -> big G chord,
  glock arpeggio, and a plink on every frog hop.

Usage (normally called by render.py):
  python make_music.py timing.json out.wav
where timing.json = {"duration":60, "scenes":[...window.__scenes...], "end":{...window.__end...}}
"""
import json, sys, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

VOICINGS = {"G": [43, 47, 50, 55, 59, 67], "D": [50, 57, 62, 66], "Em": [40, 47, 52, 55, 59, 64], "C": [48, 52, 55, 60, 64]}
ROOT = {"G": 31, "D": 38, "Em": 28, "C": 36}
PROG = ["G", "D", "Em", "C"]
MELODY = {"G": [(0, 86), (3, 83), (4, 86), (6, 88)], "D": [(0, 86), (3, 81), (4, 83), (6, 81)],
          "Em": [(0, 88), (3, 86), (4, 83), (6, 79)], "C": [(0, 88), (2, 86), (4, 84), (6, 79)]}
PENTA = [79, 81, 83, 86, 88, 91, 93, 95]


def hz(m): return 440 * 2 ** ((m - 69) / 12)
def T(sec): return np.arange(int(sec * SR)) / SR
def band(x, lo, hi): return sosfilt(butter(2, [lo, hi], btype="band", fs=SR, output="sos"), x)
def hp(x, f): return sosfilt(butter(2, f, btype="high", fs=SR, output="sos"), x)
def lp(x, f): return sosfilt(butter(2, f, btype="low", fs=SR, output="sos"), x)
def noise(sec): return rng.uniform(-1, 1, int(sec * SR))


_pl = {}
def pluck(m, bright=.5, dur=2.4):
    """Karplus-Strong plucked string, vectorized one period at a time. Cached per pitch."""
    key = (m, round(bright, 1))
    if key in _pl: return _pl[key]
    N = int(round(SR / hz(m))); L = int(dur * SR)
    x = rng.uniform(-1, 1, N)
    for _ in range(max(1, int((1 - bright) * 6))): x = .5 * (x + np.roll(x, 1))
    z = np.zeros(L + 1); z[1:N + 1] = x
    d = .997 if m < 50 else .995
    i = N + 1
    while i < L + 1:
        j = min(i + N, L + 1); n = j - i
        z[i:j] = d * .5 * (z[i - N:i - N + n] + z[i - N - 1:i - N - 1 + n]); i = j
    y = z[1:]; y = y / (np.abs(y).max() + 1e-9)
    _pl[key] = y
    return y


def bass(m, dur=.9):
    t = T(dur); f = hz(m)
    y = np.sin(2 * np.pi * f * t) + .55 * np.sin(4 * np.pi * f * t) + .3 * np.sin(6 * np.pi * f * t)
    y *= np.minimum(1, t / .005) * np.exp(-t / .38)
    return np.tanh(1.6 * y) / np.tanh(1.6)


def kick(dur=.35, f0=50, sweep=90, tau=.18):
    t = T(dur); f = f0 + sweep * np.exp(-t / .03)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)
    y[:130] += noise(130 / SR) * .3
    return y


def snare():
    t = T(.3)
    return band(noise(.3), 1500, 7000) * np.exp(-t / .11) * .9 + np.sin(2 * np.pi * 185 * t) * np.exp(-t / .06) * .5


def rim():
    t = T(.06)
    return np.sin(2 * np.pi * 1700 * t) * np.exp(-t / .012) + hp(noise(.06), 3000) * np.exp(-t / .01) * .6


def clap():
    y = np.zeros(int(.35 * SR)); b = band(noise(.35), 1000, 2600)
    for k in range(3):
        s = int(k * .011 * SR); y[s:s + int(.008 * SR)] += b[s:s + int(.008 * SR)]
    t = T(.35); y += b * np.exp(-t / .09) * .7
    return y


def shaker():
    t = T(.09)
    return hp(noise(.09), 6000) * np.minimum(1, t / .008) * np.exp(-t / .035)


def crash(dur=2.4):
    t = T(dur); y = hp(noise(dur), 5000) * np.exp(-t / .7)
    for f in (3120, 4215, 5380, 6710, 7980): y += .12 * np.sin(2 * np.pi * f * t + rng.uniform(0, 6)) * np.exp(-t / .8)
    return y


def boom():
    return kick(.9, 38, 70, .45) + lp(noise(.9), 300) * np.exp(-T(.9) / .08) * .8


def whoosh(dur=.35):
    t = T(dur); return band(noise(dur), 800, 5000) * (t / dur) ** 2


def glock(m, dur=1.6):
    t = T(dur); f = hz(m); y = np.zeros_like(t)
    for r, a, d in ((1, 1, 1.4), (2.756, .35, .45), (5.404, .15, .2), (8.933, .06, .1)):
        y += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d)
    return y * np.minimum(1, t / .002)


class Mix:
    def __init__(self, dur):
        n = int((dur + 3) * SR); self.dur = dur
        self.dry = np.zeros((2, n)); self.wet = np.zeros((2, n))

    def add(self, sig, at, gain=1., pan=0., rev=0., haas=0.):
        s = int(at * SR)
        if s < 0: sig = sig[-s:]; s = 0
        e = min(s + len(sig), self.dry.shape[1]); sig = sig[:e - s] * gain
        l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
        for buf, amt in ((self.dry, 1 - rev * .5), (self.wet, rev)):
            if amt <= 0: continue
            buf[0, s:e] += sig * l * amt
            h = int(haas * SR); e2 = min(e + h, buf.shape[1])
            buf[1, s + h:e2] += sig[:e2 - s - h] * r * amt

    def render(self):
        t = T(1.8); ir = lp(noise(1.8), 5000) * np.exp(-t / .5); ir /= np.abs(ir).sum() / 6
        out = self.dry.copy()
        for c in (0, 1): out[c] += fftconvolve(self.wet[c], ir)[:out.shape[1]]
        out = out[:, :int(self.dur * SR)]
        for c in (0, 1): out[c] = hp(out[c], 30)
        out = np.tanh(1.2 * out / (np.abs(out).max() + 1e-9)) / np.tanh(1.2) * .89
        f = int(.4 * SR); out[:, -f:] *= np.linspace(1, 0, f); out[:, :200] *= np.linspace(0, 1, 200)
        return out


def strum(mx, chord, at, down=True, vel=1., length=.5, bright=.55):
    notes = VOICINGS[chord] if down else list(reversed(VOICINGS[chord][-4:]))
    step = .012 if down else .008
    for k, m in enumerate(notes):
        y = pluck(m, bright).copy(); n = int(min(length + .08, 2.4) * SR); y = y[:n]
        fl = min(len(y), int(.05 * SR)); y[-fl:] *= np.linspace(1, 0, fl)
        mx.add(y, at + k * step, .42 * vel * (1 if down else .7), pan=-.25, rev=.25, haas=.012)


PATTERNS = {"full": [(0, 1, 1.), (2, 1, .8), (3, 0, .6), (5, 0, .6), (6, 1, .8), (7, 0, .55)],
            "soft": [(0, 1, .8), (2, 1, .6), (4, 1, .7), (6, 1, .6)],
            "ring": [(0, 1, 1.)]}


def bar_guitar(mx, chord, t0, pattern, vel=1., bright=.55):
    pat = PATTERNS[pattern]
    for k, (step, down, v) in enumerate(pat):
        nxt = pat[k + 1][0] if k + 1 < len(pat) else 8
        length = (nxt - step) * BEAT / 2 if pattern != "ring" else BAR * 1.1
        strum(mx, chord, t0 + step * BEAT / 2, bool(down), v * vel, length, bright)


def compose(timing):
    dur = timing["duration"]; scenes = timing["scenes"]; end = timing["end"]
    mx = Mix(dur)

    def style_at(t):
        if t >= end["start"] - 1e-6: return "outro", None
        for i, s in enumerate(scenes):
            if s["start"] - 1e-6 <= t < s["start"] + s["dur"] - 1e-6:
                if i == 0: return "intro", s
                if s["layout"] == "divider": return "lift", s
                if s["layout"] == "list": return "full", s
                return {"night": "night", "sunrise": "day", "trees": "mellow"}.get(s["theme"], "night"), s
        return "full", None

    nbars = int(round(end["start"] / BAR))
    for b in range(nbars):
        t0 = b * BAR; chord = PROG[b % 4]; style, s = style_at(t0 + .01)
        first_bar_of_scene = s is not None and abs(s["start"] - t0) < 1e-6
        if style == "intro":
            bar_guitar(mx, chord, t0, "soft", .85)
            if t0 >= BAR - 1e-6:
                mx.add(bass(ROOT[chord]), t0, .5); mx.add(bass(ROOT[chord] + 7), t0 + 2 * BEAT, .45)
                for e in range(8): mx.add(shaker(), t0 + e * BEAT / 2, .08 if e % 2 == 0 else .12, pan=.3)
            continue
        if style == "lift":
            bar_guitar(mx, chord, t0, "ring", 1.)
            mx.add(crash(), t0, .14, pan=.2)
            for q in range(4): mx.add(kick(), t0 + q * BEAT, .75)
            mx.add(bass(ROOT[chord], 1.6), t0, .55)
            for k in range(4): mx.add(snare(), t0 + 3 * BEAT + k * BEAT / 4, .12 + k * .07, rev=.2)
            continue
        mellow = style == "mellow"
        bar_guitar(mx, chord, t0, "full", .8 if mellow else 1., .7 if mellow else .55)
        mx.add(bass(ROOT[chord]), t0, .5); mx.add(bass(ROOT[chord] + 7), t0 + 2 * BEAT, .42)
        if not mellow: mx.add(bass(ROOT[chord] + 12, .4), t0 + 3.5 * BEAT, .25)
        for e in range(8): mx.add(shaker(), t0 + e * BEAT / 2, (.07 if e % 2 == 0 else .11) * (1.2 if mellow else 1), pan=.3)
        if style == "night":
            mx.add(kick(), t0, .55); mx.add(kick(), t0 + 2 * BEAT, .5)
            for q in (1, 3): mx.add(rim(), t0 + q * BEAT, .2, pan=-.1, rev=.15)
        elif style in ("day", "full"):
            mx.add(kick(), t0, .75); mx.add(kick(), t0 + 1.5 * BEAT, .45); mx.add(kick(), t0 + 2 * BEAT, .7)
            for q in (1, 3): mx.add(clap(), t0 + q * BEAT, .3, rev=.3); mx.add(snare(), t0 + q * BEAT, .18, rev=.2)
        elif mellow:
            mx.add(kick(), t0, .45)
        if style in ("day", "full", "mellow"):
            for step, m in MELODY[chord]:
                if mellow and step not in (0, 4): continue
                mx.add(glock(m), t0 + step * BEAT / 2, .2 if not mellow else .16, pan=.35, rev=.35)
        if first_bar_of_scene and s.get("enter") == "theme" and style == "full":
            mx.add(crash(), t0, .14, pan=.2)

    for i, s in enumerate(scenes):
        if s.get("enter") == "slide": mx.add(whoosh(), s["start"] - .35, .12, pan=.4)
        if s.get("art") in ("stomp", "carshow"): mx.add(boom(), s["start"] + 2.0, .9); mx.add(crash(1.2), s["start"] + 2.0, .12)
        if s.get("art") == "gift": mx.add(crash(.6), s["start"] + 1.5, .1, pan=-.2)

    e0 = end["start"]
    strum(mx, "G", e0, True, 1.1, 3.6, .65); mx.add(crash(), e0, .16, pan=.2); mx.add(bass(ROOT["G"], 2.5), e0, .55); mx.add(kick(), e0, .8)
    for k, m in enumerate([79, 83, 86, 91]): mx.add(glock(m), e0 + .5 + k * .25, .22, pan=.35, rev=.4)
    for k in range(end.get("hops", 7)):
        mx.add(glock(PENTA[min(k, len(PENTA) - 1)], .5), e0 + end.get("frog_start", 1.9) + (k + 1) * end.get("hop", .2), .16, pan=-.2 + k * .07, rev=.2)
    return mx.render()


def write_wav(path, stereo):
    data = (np.clip(stereo.T, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())


if __name__ == "__main__":
    timing = json.load(open(sys.argv[1]))
    write_wav(sys.argv[2], compose(timing))
    print("wrote", sys.argv[2])
