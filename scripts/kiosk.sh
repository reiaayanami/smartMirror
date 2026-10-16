#!/bin/bash
# Fullscreen Chromium kiosk on Raspberry Pi
sleep 3
CHROMIUM="$(command -v chromium || command -v chromium-browser)"
if [ -z "$CHROMIUM" ]; then
  echo "Chromium is not installed. Install chromium or chromium-browser first."
  exit 1
fi

"$CHROMIUM" --kiosk --app=http://127.0.0.1:8000 \
  --disable-infobars \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  --window-size=1920,1080
