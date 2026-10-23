#!/bin/zsh
# Rebuild assets/sfx.wav and the limited master (music + sound design) the composition plays.
cd "$(dirname "$0")/.."
/tmp/osk-venv/bin/python sfx/make_sfx.py assets/sfx.wav
ffmpeg -loglevel error -y -i assets/bgm.mp3 -i assets/sfx.wav -filter_complex "[0:a]volume=0.72[mus];[1:a]volume=0.6[fx];[mus][fx]amix=inputs=2:normalize=0,alimiter=limit=0.75:attack=2:release=60:level=disabled[m]" -map "[m]" -ar 48000 -c:a pcm_s16le assets/master.wav
