## GlowMirror — smart mirror for Raspberry Pi

Веб-дзеркало на Django: денні рутини, голос + ШІ, розпізнавання обличчя, YouTube makeup-туторіали, SoundCloud, vision board, година/дата/погода.

Працює **без Notion** на локальних JSON-файлах. Notion / Google Calendar — опційно.

## Що вміє

- Година, дата, погода (Київ / °C за замовчуванням)
- Ранкова / вечірня / щоденна / тижнева beauty-рутина
- Афірмації + beauty tip
- SoundCloud плеєр
- YouTube туторіали з макіяжу (список у `mirror/static/mirror/data/tutorials.json`)
- Vision board (картинки з `.jpg/.jpeg/.jpe/.png/.webp`)
- Голосовий чат з Gemini (`/voice`) — працює навіть без MCP
- Запам'ятовування обличчя (камера + face-api.js)
- Прості жести рукою / стрілки ← → для наступного туторіалу

## Raspberry Pi setup

1. Raspberry Pi OS + Chromium
2. Python 3.11+
3. Камера (USB або Pi Camera) для обличчя/жестів
4. Мікрофон для голосу

```bash
git clone <URL_ВАШОГО_GITHUB_РЕПОЗИТОРІЮ> ~/smartmirror
cd ~/smartmirror
sudo apt update
sudo apt install -y python3-pip python3-venv chromium ffmpeg
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp example.env .env
python -c 'import secrets; print(secrets.token_urlsafe(50))'
# скопіюй згенерований ключ у DJANGO_SECRET_KEY у файлі .env
```

У `.env` на Raspberry Pi також задай `DJANGO_DEBUG=False` і додай адресу пристрою
до `DJANGO_ALLOWED_HOSTS`, наприклад:

```dotenv
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,raspberrypi.local,192.168.1.50
```

Заміни `192.168.1.50` на IP-адресу своєї Raspberry Pi. `GEMINI_API_KEY` потрібен
лише для відповідей Gemini та її синтезу мовлення. Файли `.env` і
`credentials.json` не завантажуй у GitHub.

### Запуск

```bash
source venv/bin/activate
python manage.py migrate
python manage.py collectstatic --noinput
uvicorn smartmirror.asgi:application --host 0.0.0.0 --port 8000
```

Відкрий `http://localhost:8000` або IP малини в мережі.

### Kiosk mode (повний екран на дзеркалі)

```bash
chromium --kiosk --app=http://127.0.0.1:8000 \
  --disable-infobars --check-for-update-interval=31536000
```

Або запусти `bash scripts/kiosk.sh` — скрипт знаходить команду `chromium` чи
`chromium-browser` автоматично. Для запуску сервера використовуй
`bash scripts/start_mirror.sh`.

Автозапуск можна додати через `~/.config/autostart/` або systemd.

## Vision board

Поклади фото сюди:

`mirror/static/mirror/vision/`

Підтримуються `.jpg`, `.jpeg`, `.jpe`, `.png`, `.webp`.

Або з Pinterest:

```bash
pip install gallery-dl
gallery-dl -d mirror/static/mirror/vision -o directory="" [PINTEREST_BOARD_URL]
```

## Налаштування

| Змінна                 | Опис                           |
| ---------------------- | ------------------------------ |
| `GEMINI_API_KEY`       | Голосовий / текстовий ШІ       |
| `SOUNDCLOUD_EMBED_URL` | Embed URL плейлиста SoundCloud |
| `WEATHER_LAT/LON/CITY` | Місто для погоди               |
| `MIRROR_NAME`          | Назва на екрані                |
| `NOTION_*`             | Опційно, якщо хочеш Notion     |

Туторіали редагуй у `mirror/static/mirror/data/tutorials.json` (YouTube video id).

Рутини: `mirror/static/mirror/data/routines.json`.

## Голос (без миші / без тачу)

На дашборді мікрофон слухає завжди. Скажи wake-слово:

**«дзеркало»** (також: люстро, glow)

Потім команду українською:

| Фраза                             | Дія                             |
| --------------------------------- | ------------------------------- |
| музика / саундклауд               | вкладка SoundCloud              |
| макіяж / туторіал                 | вкладка YouTube                 |
| далі / назад                      | наступний / попередній туторіал |
| ранкова / вечірня рутина          | відкрити список                 |
| погода / афірмація / порада / час | озвучити з екрана               |
| режим дзеркала / покажи все       | сховати / показати UI           |
| жести / вимкни жести              | камера-жести                    |
| познач … зроблено                 | чекбокс звички/задачі           |
| тихо / стоп                       | зупинити озвучку                |
| допомога                          | список команд                   |

Без команди після «дзеркало» — можна просто спитати (Gemini).

Повний чат: `/voice`. На Pi 5 краще Chromium + дозвіл мікрофона для сайту.

## Обличчя

Кнопка 📸 → ім'я → зберегти. Дескриптори лежать у `mirror/static/mirror/data/faces.json`.

## Примітка про оригінал

Репозиторій базується на FuekOS smart mirror (Lululemon). Цей форк адаптований під Raspberry Pi і girly daily-routine дзеркало.
