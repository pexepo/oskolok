"""Synthesised sound design for the Осколок promo (no samples).

Every event is placed on the same timestamps the composition animates on (index.html).
Usage:  python make_sfx.py <out.wav>
"""
import sys
import numpy as np
from scipy import signal
import soundfile as sf

SR = 48000
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(20261012)
bus = np.zeros((N, 2))
S16 = 0.18743


def t_axis(d):
    return np.arange(int(d * SR)) / SR


def place(x, t0, gain=1.0, pan=0.0, pan_to=None):
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    x = x[: N - i0] * gain
    p = np.full(len(x), pan) if pan_to is None else np.linspace(pan, pan_to, len(x))
    a = (p + 1) * np.pi / 4
    bus[i0 : i0 + len(x), 0] += x * np.cos(a)
    bus[i0 : i0 + len(x), 1] += x * np.sin(a)


def bp(x, lo, hi):
    return signal.sosfilt(signal.butter(4, [lo, min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos"), x)


def hp(x, f):
    return signal.sosfilt(signal.butter(4, f, btype="high", fs=SR, output="sos"), x)


def lp(x, f):
    return signal.sosfilt(signal.butter(4, f, btype="low", fs=SR, output="sos"), x)


def norm(x, peak=1.0):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def noise(d):
    return rng.standard_normal(int(d * SR))


def reverb(x, tail=1.2, mix=0.25):
    ir = lp(noise(tail) * np.exp(-t_axis(tail) / (tail / 5)), 6000)
    wet = signal.fftconvolve(x, ir)
    out = np.zeros(len(wet))
    out[: len(x)] += x
    return out + norm(wet, np.max(np.abs(x)) * mix)


def sweep_band_noise(d, f0, f1, width=0.9, shape=None):
    """Noise whose pass band slides log-wise from f0 to f1 (STFT mask)."""
    x = noise(d)
    f, _, Z = signal.stft(x, SR, nperseg=1024)
    n = Z.shape[1]
    fc = np.exp(np.linspace(np.log(f0), np.log(f1), n))
    lf = np.log(np.maximum(f, 1))[:, None]
    mask = np.exp(-((lf - np.log(fc)[None, :]) ** 2) / (2 * width**2))
    _, y = signal.istft(Z * mask, SR, nperseg=1024)
    y = y[: int(d * SR)]
    if shape is not None:
        y = y * shape(np.linspace(0, 1, len(y)))
    return norm(y)


# ---------------- primitives ----------------
def whoosh(d=0.45, f0=300, f1=5000, peak=0.55):
    return sweep_band_noise(d, f0, f1, 0.8, lambda u: np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.6))


def rev_swell(d=0.35, f0=500, f1=9000):
    return sweep_band_noise(d, f0, f1, 1.0, lambda u: u**3.2)


def riser(d=3.0, f0=300, f1=9000):
    t = t_axis(d)
    n = sweep_band_noise(d, f0, f1, 0.7, lambda u: u**2.2)
    f = 140 * (2 ** (t / d * 2.5))
    saw = lp(signal.sawtooth(2 * np.pi * np.cumsum(f) / SR), 2500) * (t / d) ** 2.5 * (0.6 + 0.4 * np.sin(2 * np.pi * (4 + 18 * (t / d) ** 2) * t))
    return norm(n * 0.8 + norm(saw) * 0.45)


def impact(size=1.0, tail=1.4):
    d = 0.6 + 0.6 * size
    t = t_axis(d)
    f = 38 + 85 * np.exp(-t / 0.07)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.22 + 0.25 * size))
    body = lp(noise(d), 1400) * np.exp(-t / 0.07)
    crack = hp(noise(d), 2500) * np.exp(-t / 0.018)
    return norm(reverb(norm(sub + norm(body) * 0.45 + norm(crack) * 0.55 * size), tail * size, 0.22))


def thump(f=70, d=0.35):
    t = t_axis(d)
    ff = f + 120 * np.exp(-t / 0.03)
    return norm(np.sin(2 * np.pi * np.cumsum(ff) / SR) * np.exp(-t / 0.09) + hp(noise(d), 3000) * np.exp(-t / 0.006) * 0.4)


def click(f=2400, d=0.05):
    t = t_axis(d)
    x = (np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.52 * t)) * np.exp(-t / 0.008)
    return norm(x + hp(noise(d), 4000) * np.exp(-t / 0.0015) * 0.6)


def key(seed):
    r = np.random.default_rng(seed)
    t = t_axis(0.06)
    x = norm(bp(r.standard_normal(len(t)), 1800, 6500) * np.exp(-t / 0.004))
    return norm(x + np.sin(2 * np.pi * r.uniform(160, 230) * t) * np.exp(-t / 0.012) * 0.6)


def pop(f0=1200, f1=520, d=0.12):
    t = t_axis(d)
    f = f1 + (f0 - f1) * np.exp(-t / 0.018)
    return norm(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.035))


def tick(f=5200):
    t = t_axis(0.03)
    return norm(np.sin(2 * np.pi * f * t) * np.exp(-t / 0.004) + hp(noise(0.03), 6000) * np.exp(-t / 0.001) * 0.5)


def sparkle(d=0.5, n=14, seed=1):
    r = np.random.default_rng(seed)
    out = np.zeros(int((d + 0.2) * SR))
    t = t_axis(0.18)
    for _ in range(n):
        st = int(r.uniform(0, d) * SR)
        out[st : st + len(t)] += np.sin(2 * np.pi * r.uniform(4000, 10500) * t) * np.exp(-t / 0.03) * r.uniform(0.4, 1)
    return norm(out)


def chime():
    out = np.zeros(int(1.0 * SR))
    t = t_axis(0.9)
    for f, dt in ((1318.5, 0), (1975.5, 0.09)):
        x = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(2 * np.pi * f * 3.01 * t)) * np.exp(-t / 0.25)
        i = int(dt * SR)
        out[i : i + len(t)] += x
    return norm(out)


def glitch(d=0.25, seed=3):
    r = np.random.default_rng(seed)
    out = np.zeros(int(d * SR))
    seg = int(0.022 * SR)
    for i in range(0, len(out), seg):
        t = np.arange(min(seg, len(out) - i)) / SR
        k = r.integers(0, 3)
        x = signal.square(2 * np.pi * r.uniform(80, 1800) * t) if k == 0 else (r.standard_normal(len(t)) if k == 1 else np.sin(2 * np.pi * r.uniform(200, 3000) * t) * (r.random() > 0.3))
        out[i : i + len(t)] = x * r.uniform(0.3, 1)
    return norm(np.round(out * 6) / 6)


def chatter(d=0.6, seed=5, rate=34):
    r = np.random.default_rng(seed)
    out = np.zeros(int((d + 0.05) * SR))
    for k in range(int(d * rate)):
        st = int((k / rate + r.uniform(0, 0.01)) * SR)
        c = tick(r.uniform(2600, 7000)) * r.uniform(0.3, 0.8)
        out[st : st + len(c)] += c
    return norm(out)


def clack():
    a, b = thump(110, 0.18) * 0.8, click(1500, 0.05)
    out = np.zeros(int(0.25 * SR))
    out[: len(a)] += a
    i = int(0.035 * SR)
    out[i : i + len(b)] += b * 0.7
    return norm(out)


def tape_stop(d=0.45):
    t = t_axis(d)
    f = 400 * (1 - t / d) ** 2 + 30
    return norm(lp(signal.sawtooth(2 * np.pi * np.cumsum(f) / SR), 1200) * (1 - t / d))


# ---------------- arrangement (timestamps mirror index.html) ----------------
def score():
    place(sweep_band_noise(0.85, 250, 2400, 0.7, lambda u: u**2), 0.10, 0.35)
    place(sparkle(0.35, 10, 2), 0.99, 0.22); place(tick(5600), 0.99, 0.40)
    place(rev_swell(0.18), 1.37, 0.30); place(impact(0.45, 0.9), 1.55, 0.55); place(whoosh(0.5, 400, 6000), 1.55, 0.25, -0.6, 0.6)
    place(whoosh(0.22, 600, 5000), 2.12, 0.25); place(thump(80), 2.30, 0.35)
    place(glitch(0.08, 4), 2.68, 0.09); place(thump(60), 2.68, 0.3)
    for i in range(6):
        place(thump(70 + i * 6, 0.25), 3.05 + i * S16, 0.32, -0.5 + i * 0.2); place(tick(3000 + i * 400), 3.05 + i * S16, 0.29, -0.5 + i * 0.2)
    place(sparkle(0.4, 14, 3), 3.99, 0.25); place(whoosh(0.4, 800, 7000), 3.99, 0.2)
    place(whoosh(0.9, 300, 4000, 0.45), 4.37, 0.32, -0.9, 0.9)
    for i in range(5):
        place(pop(1300 + i * 120, 600), 4.37 + i * 0.12, 0.35, -0.8 + i * 0.4)
    place(chatter(0.6, 6), 4.93, 0.19)
    place(sparkle(0.3, 10, 7), 5.68, 0.2)
    place(rev_swell(0.25), 5.80, 0.4)
    place(whoosh(0.35, 200, 3000, 0.7), 5.95, 0.4)
    place(clack(), 6.05, 0.5); place(sparkle(0.4, 12, 8), 6.12, 0.18); place(thump(55), 6.05, 0.3)
    place(chatter(0.7, 9), 6.05, 0.16)
    for i in range(10):
        place(key(100 + i), 6.43 + i * 0.094, 0.8, float(rng.uniform(-0.3, 0.3)))
    for i in range(3):
        place(pop(900 + i * 150, 500), 7.55 + i * 0.09, 0.40)
    place(tick(4200), 8.11, 0.32)
    place(click(2100), 8.56, 0.64); place(click(2600), 8.62, 0.48); place(pop(1400, 700), 8.62, 0.32)
    place(rev_swell(0.3, 300, 9000), 8.75, 0.5); place(impact(0.5, 0.8), 9.05, 0.45)
    place(riser(2.95), 9.05, 0.75)
    place(chatter(0.5, 11), 9.30, 0.13)
    for t0, pn in ((9.80, -0.6), (10.36, 0.6), (11.11, 0.6), (11.49, -0.6)):
        place(whoosh(0.4, 600, 5000), t0 - 0.2, 0.18, pn * 1.4, pn); place(pop(1100, 550, 0.16), t0, 0.35, pn); place(sparkle(0.25, 6, int(t0 * 10)), t0, 0.15, pn)
    place(sparkle(0.6, 18, 91), 9.05, 0.25)
    place(rev_swell(0.38, 200, 10000), 11.68, 0.5)
    # ---- DROP ----
    place(impact(1.0, 1.8), 12.05, 1.0); place(glitch(0.1, 12), 12.05, 0.14); place(sparkle(0.7, 24, 13), 12.08, 0.3)
    place(impact(0.6, 0.9), 12.61, 0.55)
    for i in range(7):
        place(tick(3500 + i * 300), 12.79 + i * 0.046, 0.29, -0.6 + i * 0.2)
    place(sparkle(0.5, 14, 14), 13.36, 0.25)
    place(whoosh(0.42, 300, 8000, 0.6), 13.62, 0.55, -0.9, 0.9)
    place(impact(0.55, 0.8), 13.92, 0.5); place(whoosh(0.7, 250, 5000, 0.35), 13.92, 0.32, 0.6, 0.2)
    place(whoosh(0.3, 600, 6000), 14.40, 0.22, -0.6, 0)
    for t0 in (15.05, 15.61, 16.55):
        place(thump(65), t0, 0.32, -0.5)
    for i, t0 in enumerate((15.42, 15.61, 15.80, 16.17, 16.55)):
        place(pop(1000 + i * 130, 520), t0, 0.42, 0.5)
    for i in range(3):
        place(pop(1500 + i * 100, 800, 0.09), 16.73 + i * 0.09, 0.32, 0.5)
    place(pop(1800, 900), 16.92, 0.48, 0.5); place(sparkle(0.35, 10, 16), 16.94, 0.22, 0.5)
    place(impact(0.9, 1.4), 17.11, 0.85); place(glitch(0.13, 17), 17.11, 0.12); place(whoosh(0.4, 400, 7000, 0.3), 17.11, 0.3, 0.3, -0.6)
    for i in range(4):
        place(tick(4000 + i * 500), 17.25 + i * 0.07, 0.32, -0.4)
    place(rev_swell(0.2), 17.85, 0.35); place(thump(70), 18.05, 0.38)
    place(chatter(0.6, 18), 18.05, 0.14)
    syl = [18.05, 18.42, 18.61, 18.80, 19.17, 19.36, 19.55, 19.92, 20.30, 20.39, 20.48, 20.58, 20.67, 20.76, 20.86]
    notes = [523, 587, 659, 784, 523, 587, 659, 880, 659, 698, 784, 880, 784, 880, 1047]
    for t0, f in zip(syl, notes):
        place(pop(f * 2, f, 0.14), t0, 0.61, -0.3)
    place(whoosh(0.3, 500, 4000), 19.0, 0.15); place(whoosh(0.3, 500, 4000), 20.12, 0.15)
    place(rev_swell(0.22), 20.83, 0.4)
    place(impact(0.75, 1.2), 21.05, 0.65); place(sweep_band_noise(1.2, 120, 1400, 0.9, lambda u: np.sin(np.pi * u) ** 2), 21.05, 0.3)
    for i, t0 in enumerate((21.61, 21.80, 22.17, 22.55)):
        place(whoosh(0.2, 1500, 9000, 0.4), t0 - 0.05, 0.25, 0.9, -0.6 + i * 0.3)
    place(glitch(0.22, 23), 22.92, 0.5); place(tape_stop(0.45), 22.98, 0.35)
    place(chime(), 23.28, 0.75)
    place(whoosh(0.3, 1500, 6000), 23.40, 0.1, 0.8, 0)
    place(click(2000), 23.86, 0.72)
    place(impact(0.7, 1.0), 24.05, 0.6); place(whoosh(0.6, 200, 3000, 0.25), 24.05, 0.3)
    place(whoosh(0.5, 300, 5000), 24.07, 0.25, -0.8, -0.3)
    place(pop(1300, 650), 24.42, 0.45, -0.5)
    for i in range(5):
        place(whoosh(0.25, 2000, 9000, 0.5), 24.6 + i * 0.09, 0.14, -0.4, 0.9)
    place(chatter(0.4, 25), 24.98, 0.16); place(thump(70), 24.98, 0.3)
    place(whoosh(0.3, 500, 9000, 0.6), 25.30, 0.5, 0.9, -0.9)
    place(impact(0.9, 1.3), 25.55, 0.85); place(glitch(0.1, 26), 25.55, 0.12)
    for i in range(3):
        place(whoosh(0.28, 3000, 400, 0.8), 25.82 + i * 0.1, 0.25, -0.6 + i * 0.4, 0.4)
    place(chatter(0.45, 27, 40), 25.85, 0.16)
    place(whoosh(0.28, 500, 9000, 0.6), 26.06, 0.5, 0.9, -0.9)
    place(impact(0.6, 0.8), 26.30, 0.5)
    place(clack(), 26.48, 0.4)
    for i in range(5):
        place(pop(1100 + i * 140, 560), 26.48 + i * 0.094, 0.35, -0.8 + i * 0.4)
    place(rev_swell(0.22, 300, 10000), 26.84, 0.5)
    place(impact(1.0, 1.8), 27.04, 1.0); place(sparkle(0.8, 26, 28), 27.06, 0.3)
    place(impact(0.8, 1.2), 27.61, 0.75)
    for i in range(7):
        place(tick(3500 + i * 300), 27.61 + i * 0.045, 0.26, -0.6 + i * 0.2)
    place(pop(1400, 700), 28.17, 0.45); place(sparkle(0.6, 16, 29), 28.54, 0.28)
    place(riser(0.78, 600, 11000), 28.9, 0.7)
    for t0 in (29.11, 29.29, 29.48):
        place(thump(60, 0.3), t0, 0.35)
    place(impact(1.0, 0.6), 29.67, 0.7)


score()
bus = np.tanh(bus * 1.4) / np.tanh(1.4)  # glue + soft clip
bus = bus / (np.max(np.abs(bus)) + 1e-9) * 0.89
fade = int(0.06 * SR)
bus[-fade:] *= np.linspace(1, 0, fade)[:, None]
sf.write(sys.argv[1] if len(sys.argv) > 1 else "sfx.wav", bus.astype(np.float32), SR, subtype="PCM_24")
print("ok", bus.shape)
