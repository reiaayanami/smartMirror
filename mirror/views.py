import asyncio
import datetime
import logging
import json
import os
import pytz
import random
import requests
import uuid

from collections import defaultdict
from dateutil.parser import parse as parse_date
from google.oauth2 import service_account
from notion_client import Client

from django.conf import settings
from django.http import HttpResponse, JsonResponse, HttpRequest
from django.shortcuts import render
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie, csrf_exempt
from django.views.decorators.http import require_GET, require_POST, require_http_methods
from typing import Dict, Any, Literal, List

from . import database_functions
from . import local_data
from .services import get_mcp_service
from .simple_ai import gemini_speech, interpret_voice_command, simple_gemini_reply

logger = logging.getLogger(__name__)
local_tz = pytz.timezone(getattr(settings, "MIRROR_TIMEZONE", "Europe/Kyiv"))
confirmations_db: Dict[str, Dict[str, Any]] = {}
thoughts_db: List[str] = []
db_lock = asyncio.Lock()
thought_db_lock = asyncio.Lock()
ConfirmationStatusLiteral = Literal[
    "pending", "confirmed", "denied", "timeout", "error", "not_found"
]
StoredConfirmationStatusLiteral = Literal[
    "pending", "confirmed", "denied", "timeout", "error"
]
seed_offset_vision_board = 0
seed_offset_affirmations = 0
notion = None
if settings.NOTION_API_KEY and settings.NOTION_API_KEY != "secret_xxxx":
    try:
        notion = Client(auth=settings.NOTION_API_KEY)
    except Exception as e:
        logger.warning("Notion client init failed: %s", e)
PRIORITY_ORDER = {"High": 1, "Medium": 2, "Low": 3}
STATUS_ORDER = {"Done": 3, "Not started": 1, "In progress": 2}
VISION_BOARD_IMAGE_COUNT = 24


def weather_forecast(request):
    lat = getattr(settings, "WEATHER_LAT", 50.4501)
    lon = getattr(settings, "WEATHER_LON", 30.5234)
    unit = getattr(settings, "WEATHER_UNIT", "celsius")
    url = (
        f"https://api.open-meteo.com/v1/forecast?"
        f"latitude={lat}&longitude={lon}"
        f"&current=temperature_2m,apparent_temperature,weather_code"
        f"&temperature_unit={unit}"
    )
    try:
        r = requests.get(url, timeout=8)
        data = r.json()["current"]
        return JsonResponse(
            {
                "temp": data["temperature_2m"],
                "feels_like": data["apparent_temperature"],
                "weather_code": data["weather_code"],
                "unit": "C" if unit == "celsius" else "F",
                "city": getattr(settings, "WEATHER_CITY", "Київ"),
            }
        )
    except Exception as e:
        print(e)
        return JsonResponse({"error": str(e)}, status=500)


def calendar_feed(request):
    try:
        if not settings.GOOGLE_CALENDAR_CRED_PATH:
            return JsonResponse({"events": [], "source": "local"})
        SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
        creds_path = os.path.join(settings.BASE_DIR, settings.GOOGLE_CALENDAR_CRED_PATH)
        calendar_ids = settings.GOOGLE_CALENDAR_IDS
        creds = service_account.Credentials.from_service_account_file(
            creds_path, scopes=SCOPES
        )
        events = database_functions.calendar_feed(creds, calendar_ids)
        return JsonResponse({"events": events})
    except Exception as e:
        print(e)
        return JsonResponse({"events": [], "error": str(e)})


def fetch_habit_group(request, emoji):  # emoji: ☀️, 🌙, 🌸
    if notion and settings.NOTION_HABIT_DB_ID:
        try:
            habits = database_functions.fetch_habit_group(
                notion, emoji, settings.NOTION_HABIT_DB_ID
            )
            if habits:
                return JsonResponse({"habits": habits, "source": "notion"})
        except Exception as e:
            logger.warning("Notion habits fallback: %s", e)
    return JsonResponse(
        {"habits": local_data.habits_for_emoji(emoji), "source": "local"}
    )


@csrf_protect
@require_POST
def add_habit(request):
    if notion and settings.NOTION_HABIT_DB_ID:
        return JsonResponse(
            {"error": "Voice-added routine items are currently available in local routine mode."},
            status=409,
        )
    try:
        data = json.loads(request.body)
        habit = local_data.add_local_habit(data.get("which", ""), data.get("title", ""))
        return JsonResponse({"success": True, "habit": habit})
    except ValueError as e:
        return JsonResponse({"error": str(e)}, status=400)
    except Exception as e:
        logger.exception("add_habit failed")
        return JsonResponse({"error": "Could not add routine item."}, status=500)


@csrf_protect
@require_POST
async def voice_intent(request):
    try:
        data = json.loads(request.body)
        message = (data.get("message") or "").strip()
        if not message or len(message) > 500:
            return JsonResponse({"intent": None}, status=400)
        return JsonResponse({"intent": await interpret_voice_command(message)})
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON format."}, status=400)


@csrf_protect
@require_POST
async def voice_speech(request):
    try:
        data = json.loads(request.body)
        text = (data.get("text") or "").strip()
        voice = data.get("voice", "Aoede")
        if not text or len(text) > 1500:
            return JsonResponse({"error": "Text must be 1–1500 characters."}, status=400)
        audio = await gemini_speech(text, voice)
        if not audio:
            return JsonResponse({"error": "Gemini speech is unavailable."}, status=503)
        response = HttpResponse(audio, content_type="audio/wav")
        response["Cache-Control"] = "no-store"
        return response
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON format."}, status=400)


def task_feed(request):
    if notion and settings.NOTION_TASK_DB_ID:
        try:
            root_tasks = database_functions.task_feed(notion, settings.NOTION_TASK_DB_ID)
            if root_tasks:
                return JsonResponse({"tasks": root_tasks, "source": "notion"})
        except Exception as e:
            logger.warning("Notion tasks fallback: %s", e)
    return JsonResponse({"tasks": local_data.load_tasks(), "source": "local"})


@ensure_csrf_cookie
def dashboard(request):
    return render(
        request,
        "mirror/dashboard.html",
        {
            "soundcloud_url": getattr(settings, "SOUNDCLOUD_EMBED_URL", ""),
            "mirror_name": getattr(settings, "MIRROR_NAME", "GlowMirror"),
        },
    )


@ensure_csrf_cookie
def voice_chrome(request):
    return render(request, "mirror/voice_chat_chrome.html")


@ensure_csrf_cookie
def voice(request):
    return render(request, "mirror/voice_chat.html")


@csrf_exempt
@require_http_methods(["POST"])
async def voice_chat(request):
    try:
        data = json.loads(request.body)
        msg = data.get("message", "").strip()
        confirmed_action_details = data.get(
            "confirmed_action_details"
        )  # Sent by frontend on confirm

        mcp_service = None
        mcp_ready = False
        try:
            mcp_service = await get_mcp_service()
            mcp_ready = bool(
                mcp_service
                and getattr(mcp_service, "is_connected", False)
                and getattr(mcp_service, "client", None)
                and getattr(mcp_service.client, "session", None)
            )
        except Exception as e:
            logger.warning("MCP unavailable, using simple Gemini chat: %s", e)
            mcp_ready = False

        if confirmed_action_details and not mcp_ready:
            return JsonResponse(
                {"error": "Voice tools unavailable; chat-only mode is active."},
                status=503,
            )

        if confirmed_action_details:
            # User has confirmed an action from the modal
            tool_name = confirmed_action_details.get("tool_name")
            parameters = confirmed_action_details.get("parameters", {})
            parameters["confirmed_by_user"] = True  # Crucial: signal confirmation

            if not tool_name:
                logger.error("Confirmed action details missing tool_name.")
                return JsonResponse(
                    {"error": "Invalid confirmation request."}, status=400
                )

            logger.info(
                f"Executing confirmed MCP tool: '{tool_name}' with params: {parameters}"
            )
            try:
                # Directly call the MCP tool via the session
                # Ensure mcp_service.client.session is valid
                if not mcp_service.client.session:
                    logger.error(
                        "MCP client session is not available for direct tool call."
                    )
                    return JsonResponse(
                        {"error": "Failed to execute confirmed action: session lost."},
                        status=500,
                    )

                tool_result = await mcp_service.client.session.call_tool(
                    tool_name, parameters
                )

                response_payload_str = None
                if (
                    hasattr(tool_result, "content")
                    and tool_result.content
                    and hasattr(tool_result.content[0], "text")
                ):
                    response_payload_str = tool_result.content[0].text

                if not response_payload_str:
                    logger.error(
                        f"No text content in tool_result for {tool_name}: {tool_result}"
                    )
                    return JsonResponse(
                        {"error": "Received empty response from confirmed action."},
                        status=500,
                    )

                response_payload = json.loads(response_payload_str)

                if response_payload.get("status") == "success":
                    return JsonResponse(
                        {
                            "response": [
                                response_payload.get(
                                    "message", "Action completed successfully."
                                )
                            ],
                            "action_confirmed_executed": True,
                            "updated_data": response_payload.get(
                                "updated_data"
                            ),  # Pass this to frontend
                        }
                    )
                else:  # Error from the MCP tool after confirmation
                    return JsonResponse(
                        {
                            "error": response_payload.get(
                                "message", "Confirmed action resulted in an error."
                            ),
                            "action_confirmed_executed": True,
                        },
                        status=400,
                    )

            except Exception as e:
                logger.error(
                    f"Error directly calling MCP tool '{tool_name}': {type(e).__name__}: {e}",
                    exc_info=True,
                )
                return JsonResponse(
                    {"error": f"Error executing confirmed action: {str(e)}"}, status=500
                )

        elif not msg:  # If not a confirmed action, a message is required
            logger.warning(
                "Voice chat request with empty message and no confirmed action."
            )
            return JsonResponse({"error": "Message cannot be empty."}, status=400)

        else:  # Standard query to Gemini
            logger.info(f"Processing voice chat query via Gemini: '{msg}'")
            if not mcp_ready:
                reply = await simple_gemini_reply(msg)
                if not reply:
                    return JsonResponse(
                        {
                            "response": [
                                "Я тут і чую тебе. Додай справжній GEMINI_API_KEY у файл .env "
                                "(не secret_xxxx) і перезапусти сервер — тоді зможу відповідати повністю."
                            ]
                        }
                    )
                return JsonResponse(
                    {
                        "response": [
                            line.strip()
                            for line in reply.split("\n")
                            if line.strip()
                        ]
                    }
                )
            try:
                response_text_from_gemini_or_tool = await mcp_service.process_query(msg)
            except Exception as e:
                logger.warning("MCP query failed, falling back to simple Gemini: %s", e)
                reply = await simple_gemini_reply(msg)
                if not reply:
                    return JsonResponse(
                        {
                            "response": [
                                "Зараз інструменти дзеркала недоступні. Перевір GEMINI_API_KEY у .env."
                            ]
                        }
                    )
                return JsonResponse(
                    {
                        "response": [
                            line.strip()
                            for line in reply.split("\n")
                            if line.strip()
                        ]
                    }
                )

            try:
                # Attempt to parse the response. If it's a JSON from our MCP tool (e.g., confirmation_required),
                # it means Gemini decided the tool's direct JSON output was the answer.
                parsed_tool_response = json.loads(response_text_from_gemini_or_tool)

                if (
                    isinstance(parsed_tool_response, dict)
                    and parsed_tool_response.get("status") == "confirmation_required"
                ):
                    return JsonResponse(
                        {
                            "needs_confirmation": True,
                            "action_details": parsed_tool_response.get(
                                "action_details"
                            ),
                            "response": [
                                parsed_tool_response.get("action_details", {}).get(
                                    "description", "Please confirm this action."
                                )
                            ],
                        }
                    )
                # If a tool ran successfully without confirmation (e.g. get_tasks) and Gemini returned its JSON:
                elif isinstance(parsed_tool_response, dict) and (
                    parsed_tool_response.get("status") == "success"
                    or parsed_tool_response.get("status") == "error"
                ):
                    return JsonResponse(
                        {
                            "response": [
                                parsed_tool_response.get("message", "Action processed.")
                            ],
                            "updated_data": parsed_tool_response.get(
                                "updated_data"
                            ),  # For get_tasks, get_habits etc.
                        }
                    )
                else:
                    # It was valid JSON but not in our expected tool format. Treat as plain text from Gemini.
                    response_lines = str(response_text_from_gemini_or_tool).split("\n")
                    return JsonResponse({"response": response_lines})

            except json.JSONDecodeError:
                # It's a natural language response from Gemini, not a direct JSON from our tools.
                response_lines = [
                    r.strip()
                    for r in response_text_from_gemini_or_tool.strip().split("\n")
                    if len(r.strip()) > 0
                ]
                return JsonResponse({"response": response_lines})
            except Exception as e:
                logger.error(
                    f"Error processing Gemini's response in voice_chat: {type(e).__name__}: {e}",
                    exc_info=True,
                )
                return JsonResponse(
                    {"error": f"Internal error processing response: {str(e)}"},
                    status=500,
                )

    except json.JSONDecodeError:
        logger.error("Invalid JSON received in voice_chat request.", exc_info=True)
        return JsonResponse({"error": "Invalid JSON format."}, status=400)
    except Exception as e:
        logger.error(
            f"Error processing voice_chat request: {type(e).__name__}: {e}",
            exc_info=True,
        )
        return JsonResponse(
            {"error": f"An internal error occurred: {str(e)}"}, status=500
        )

def vision_board_feed(request):
    global seed_offset_vision_board
    folder = local_data.vision_folder()
    folder.mkdir(parents=True, exist_ok=True)
    images = sorted(
        [
            f"/static/mirror/vision/{file}"
            for file in os.listdir(folder)
            if file.lower().endswith(local_data.IMAGE_EXTS)
        ]
    )
    seed = int(datetime.date.today().strftime("%Y%m%d")) + 42 + seed_offset_vision_board
    seed_offset_vision_board -= 1
    random.Random(seed).shuffle(images)
    return JsonResponse({"images": images[:VISION_BOARD_IMAGE_COUNT]})


def affirmations_feed(request):
    global seed_offset_affirmations
    file_path = os.path.join(
        settings.BASE_DIR, "mirror/static/mirror/data/affirmations.json"
    )
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            affirmations = json.load(f)
    except Exception:
        affirmations = ["Ти вже достатня. Решта — бонус."]

    seed = int(datetime.date.today().strftime("%Y%m%d")) + 42 + seed_offset_affirmations
    seed_offset_affirmations -= 1
    random.Random(seed).shuffle(affirmations)
    affirmations = affirmations[:1]
    return JsonResponse({"affirmations": affirmations})


@require_GET
def tutorials_feed(request):
    """Load videos from the configured YouTube channel RSS (no API key)."""
    import xml.etree.ElementTree as ET

    channel_id = getattr(settings, "YOUTUBE_CHANNEL_ID", "UC5lpfOXnVO6OxdFLuHSUmkQ")
    fallback = local_data.load_tutorials()
    try:
        rss_url = (
            f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
        )
        r = requests.get(rss_url, timeout=8)
        r.raise_for_status()
        root = ET.fromstring(r.text)
        ns = {
            "atom": "http://www.w3.org/2005/Atom",
            "yt": "http://www.youtube.com/xml/schemas/2015",
            "media": "http://search.yahoo.com/mrss/",
        }
        channel_title = root.findtext("atom:title", default="YouTube", namespaces=ns)
        videos = []
        for entry in root.findall("atom:entry", ns):
            vid = entry.findtext("yt:videoId", default="", namespaces=ns)
            title = entry.findtext("atom:title", default="", namespaces=ns)
            if vid:
                videos.append(
                    {
                        "id": vid,
                        "title": title,
                        "channel": channel_title,
                    }
                )
        if videos:
            return JsonResponse(
                {
                    "playlist_title": f"Мій YouTube · {channel_title}",
                    "channel_id": channel_id,
                    "videos": videos,
                }
            )
    except Exception as e:
        logger.warning("YouTube RSS failed, using local tutorials.json: %s", e)
    return JsonResponse(fallback)


@require_GET
def beauty_tip_feed(request):
    tips = local_data.load_beauty_tips()
    tip = random.choice(tips) if tips else "Будь ніжною до себе сьогодні."
    return JsonResponse({"tip": tip})


@require_GET
def mirror_config(request):
    return JsonResponse(
        {
            "name": getattr(settings, "MIRROR_NAME", "GlowMirror"),
            "soundcloud_url": getattr(settings, "SOUNDCLOUD_EMBED_URL", ""),
            "timezone": getattr(settings, "MIRROR_TIMEZONE", "Europe/Kyiv"),
            "city": getattr(settings, "WEATHER_CITY", "Київ"),
            "face_enabled": True,
            "gestures_enabled": True,
        }
    )


@require_GET
def faces_feed(request):
    return JsonResponse({"faces": local_data.load_faces()})


@csrf_exempt
@require_http_methods(["POST"])
def faces_enroll(request):
    try:
        payload = json.loads(request.body)
        name = (payload.get("name") or "").strip()
        descriptor = payload.get("descriptor")
        if not name or not isinstance(descriptor, list):
            return JsonResponse({"error": "name and descriptor required"}, status=400)
        faces = local_data.load_faces()
        faces = [f for f in faces if f.get("name", "").lower() != name.lower()]
        faces.append(
            {
                "id": str(uuid.uuid4()),
                "name": name,
                "descriptor": descriptor,
                "created_at": datetime.datetime.now().isoformat(),
            }
        )
        local_data.save_faces(faces)
        return JsonResponse({"success": True, "faces": faces})
    except Exception as e:
        logger.exception("faces_enroll failed")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
def faces_delete(request):
    try:
        payload = json.loads(request.body)
        face_id = payload.get("id")
        faces = [f for f in local_data.load_faces() if f.get("id") != face_id]
        local_data.save_faces(faces)
        return JsonResponse({"success": True, "faces": faces})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_protect
@require_POST
def update_habit(request):
    try:
        body = request.body.decode("utf-8")
        data = json.loads(body)
        page_id = data.get("page_id")
        prop = data.get("property")
        done = data.get("done")
        if not page_id or prop is None:
            logger.error("❌ Missing required fields")
            return JsonResponse({"error": "Missing page_id or property"}, status=400)
        if notion and settings.NOTION_HABIT_DB_ID and not str(page_id).startswith(
            ("m", "e", "d", "w")
        ):
            try:
                database_functions.update_habit(notion, page_id, prop, done)
                return JsonResponse({"success": True, "source": "notion"})
            except Exception as e:
                logger.warning("Notion habit update failed, local fallback: %s", e)
        ok = local_data.update_local_habit(page_id, done)
        return JsonResponse({"success": ok, "source": "local"})

    except Exception as e:
        logger.exception("❌ Exception in update_habit")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_protect
@require_POST
def update_task(request):
    try:
        body = request.body.decode("utf-8")
        data = json.loads(body)

        page_id = data.get("page_id")
        new_status = data.get("status")

        if not page_id or not new_status:
            logger.error("❌ Missing page_id or status in task update")
            return JsonResponse({"error": "Missing page_id or status"}, status=400)

        print(f"📝 Updating task {page_id} → status: {new_status}")

        if notion and settings.NOTION_TASK_DB_ID and not str(page_id).startswith("t"):
            try:
                database_functions.update_task(notion, page_id, new_status)
                return JsonResponse({"success": True, "source": "notion"})
            except Exception as e:
                logger.warning("Notion task update failed, local fallback: %s", e)
        ok = local_data.update_local_task(page_id, new_status)
        return JsonResponse({"success": ok, "source": "local"})

    except Exception as e:
        logger.exception("❌ Exception in update_task")
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@require_http_methods(["POST"])
async def handle_thought(request: HttpRequest):
    payload = json.loads(request.body)
    thought = payload.get("thought")
    if not thought:
        return JsonResponse({"error": "Need thought to add to thoughts."}, status=400)
    async with thought_db_lock:
        thoughts_db.append(thought)
    print(thoughts_db)
    return JsonResponse(
        {
            "thought": thought,
            "status": "added",
            "message": "Added thought for UI processing.",
        },
        status=202,
    )


@csrf_exempt
@require_http_methods(["POST"])
async def handle_request_confirmation(request: HttpRequest):
    """
    Called by mirrordb_server.py to INITIATE a confirmation.
    Stores the request for the UI to pick up.
    """
    try:
        payload = json.loads(request.body)
        action_id = payload.get("action_id")
        description = payload.get("description")
        details = payload.get("details", {})

        if not all([action_id, description]):
            return JsonResponse(
                {"error": "Missing action_id or description"}, status=400
            )

        async with db_lock:  # If this view is truly async
            if (
                action_id in confirmations_db
                and confirmations_db[action_id]["status"] != "pending"
            ):
                return JsonResponse(
                    {
                        "error": f"Action ID '{action_id}' already processed or conflict."
                    },
                    status=409,
                )

            confirmations_db[action_id] = {
                "action_id": action_id,
                "description": description,
                "details": details,
                "status": "pending",  # type: StoredConfirmationStatusLiteral
            }
        logger.info(
            f'[WEB APP VIEW] Confirmation requested: {action_id} - "{description[:50]}..."'
        )
        return JsonResponse(
            {
                "action_id": action_id,
                "status": "pending",
                "message": "Confirmation request received for UI processing.",
            },
            status=202,
        )
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON payload"}, status=400)
    except Exception as e:
        logger.error(f"Error in handle_request_confirmation: {e}", exc_info=True)
        return JsonResponse({"error": str(e)}, status=500)


@require_http_methods(["GET"])
async def handle_get_confirmation_status(request: HttpRequest, action_id: str):
    """
    Called by mirrordb_server.py to POLL for the status.
    """
    async with db_lock:  # If async view
        # with db_lock: # If sync view
        item = confirmations_db.get(action_id)

    if not item:
        return JsonResponse(
            {
                "action_id": action_id,
                "status": "not_found",  # type: ConfirmationStatusLiteral
                "description": None,
                "details": None,
            }
        )  # FastAPI version returned 200 with this, let's stick to that for client compatibility

    logger.info(
        f"[WEB APP VIEW] Status check for {action_id}: current status is {item['status']}"
    )
    return JsonResponse(
        {
            "action_id": item["action_id"],
            "status": item["status"],  # type: ConfirmationStatusLiteral
            "description": item.get("description"),
            "details": item.get("details"),
        }
    )


# === Endpoints for Frontend UI ===


@require_http_methods(["GET"])
async def get_pending_thoughts(request: HttpRequest):
    thoughts = []
    async with thought_db_lock:
        for i in range(len(thoughts_db)):
            item = thoughts_db.pop(0)
            thoughts.append(item)
    print(thoughts)
    return JsonResponse({"thoughts": thoughts})


@require_http_methods(["GET"])
async def get_pending_ui_confirmations(request: HttpRequest):
    pending_for_ui: List[Dict[str, Any]] = []
    async with db_lock:  # If async view
        for action_id, item_data in confirmations_db.items():
            if item_data["status"] == "pending":
                pending_for_ui.append(
                    {
                        "action_id": action_id,
                        "description": item_data["description"],
                        "details": item_data.get("details", {}),
                    }
                )
    return JsonResponse(pending_for_ui, safe=False)  # safe=False for list response


@csrf_exempt
@require_http_methods(["POST"])
async def submit_ui_confirmation(request: HttpRequest, action_id: str):
    """
    Called by your voice_chat page's JavaScript when the user clicks "Confirm" or "Deny".
    """
    try:
        payload = json.loads(request.body)
        user_confirmed = payload.get("confirmed")  # Expecting {"confirmed": true/false}

        if user_confirmed is None or not isinstance(user_confirmed, bool):
            return JsonResponse(
                {
                    "error": "Invalid payload: 'confirmed' boolean field missing or invalid."
                },
                status=400,
            )

        new_status: StoredConfirmationStatusLiteral = (
            "confirmed" if user_confirmed else "denied"
        )

        async with db_lock:  # If async view
            # with db_lock: # If sync view
            if action_id not in confirmations_db:
                return JsonResponse(
                    {"error": f"Action ID '{action_id}' not found."}, status=404
                )

            item = confirmations_db[action_id]
            if item["status"] != "pending":
                logger.info(
                    f"[WEB APP VIEW] UI submitted for already processed action {action_id} (current: {item['status']}). Ignoring."
                )
                return JsonResponse(
                    {
                        "action_id": action_id,
                        "status": item["status"],
                        "message": "Action already processed, UI input ignored.",
                    }
                )

            item["status"] = new_status

        logger.info(
            f"[WEB APP VIEW] UI submitted for {action_id}: User chose {'CONFIRMED' if user_confirmed else 'DENIED'}. Status set to {new_status}."
        )
        return JsonResponse(
            {
                "action_id": action_id,
                "status": new_status,
                "message": "Confirmation decision recorded.",
            }
        )
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON payload"}, status=400)
    except Exception as e:
        logger.error(
            f"Error in submit_ui_confirmation for {action_id}: {e}", exc_info=True
        )
        return JsonResponse({"error": str(e)}, status=500)
