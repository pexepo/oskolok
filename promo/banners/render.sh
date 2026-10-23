#!/bin/zsh
# Renders every banner in index.html to png/<id>.png with headless Chrome.
cd "$(dirname "$0")"; mkdir -p png
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL=$(python3 -c "import pathlib;print(pathlib.Path('index.html').resolve().as_uri())")
for spec in hero-16x9:1920,1080 hero-9x16:1080,1920 f1-search:1080,1350 f2-lyrics:1080,1350 f3-wave:1080,1350 f4-player:1080,1350 f5-telegram:1080,1350 f6-transfer:1080,1350 f7-platforms:1080,1350; do
  id=${spec%%:*}; size=${spec#*:}
  "$CH" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files \
    --window-size=$size --virtual-time-budget=4000 --screenshot="$PWD/png/$id.png" "$URL#$id" >/dev/null 2>&1
  echo "$id $(sips -g pixelWidth -g pixelHeight png/$id.png | awk '/pixel/{printf $2" "}')"
done
