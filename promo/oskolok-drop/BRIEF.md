---
workflow: general-video
flow: automation
storyboard: no
message: "Осколок — вся музыка в одном плеере, который чувствует бит"
destination: social / landing / showreel
aspect: "16:9"
canvas: { w: 1920, h: 1080, fps: 30 }
length: 30s
language: ru
music: "ева киллер — глупыйсвин (official, YouTube Topic), 0:00–0:30; drop = 808 at 12.05s; bass cut at 30.0s"
---

## Intent

Dynamic 30-second motion-graphics promo of the Осколок music player — a showreel-grade piece.
Real product UI (search, full player, word/syllable lyrics, «Моя волна», resume toast, Telegram profile track,
library transfer, platforms) rebuilt as animatable components, not raw screenshots.
Motion locked to the track: build 0–12s, logo flies in on the 808 drop at 12.05s, hard cut at 30.0s.

## Assets

- `assets/logo.png`, `assets/shards/*`, `assets/art/*`, `assets/fonts/*` — from the app's `public/`.
- `assets/cover.jpg` — Deezer cover of «капуста хаус» (the track's album).
- `assets/bgm.mp3` — first 30s of the track, 120ms tail fade.
- `assets/mascot.png` — project mascot (wip-render), used as Telegram avatar.

## Notes

- Autonomous run: user said "go all out"; no storyboard gate. Feature banners are a separate deliverable in `banners/`.
