#!/bin/bash
# Raspberry Pi launcher for GlowMirror
cd "$(dirname "$0")/.."
source venv/bin/activate
python manage.py collectstatic --noinput
uvicorn smartmirror.asgi:application --host 0.0.0.0 --port 8000
