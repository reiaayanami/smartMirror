@echo off
cd /d "%~dp0\.."
call venv\Scripts\activate.bat
python manage.py collectstatic --noinput
uvicorn smartmirror.asgi:application --host 0.0.0.0 --port 8000
