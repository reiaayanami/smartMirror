"""Lightweight Gemini chat when MCP / Notion stack is unavailable."""

from __future__ import annotations

import logging
import os
import asyncio
import base64
import json
from typing import Optional

import requests

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Ти — мила голосова подруга для smart mirror на Raspberry Pi.
Говори українською, коротко і тепло. Допомагай з денною рутиною, макіяжем,
доглядом за шкірою, настроєм і організацією дня. Без токсичної позитивності —
будь підтримуючою і практичною. Відповідай 1–4 короткими реченнями."""

DEFAULT_GEMINI_MODEL = "gemini-3.6-flash"
PLACEHOLDER_KEYS = {"", "secret_xxxx", "your_key_here", "changeme"}
GEMINI_TTS_VOICES = {
    "Aoede",
    "Kore",
    "Leda",
    "Zephyr",
    "Charon",
    "Puck",
    "Fenrir",
    "Orus",
}


def _gemini_model() -> str:
    return (os.getenv("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL


def _api_key() -> Optional[str]:
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not key or key.lower() in PLACEHOLDER_KEYS:
        return None
    return key


async def simple_gemini_reply(message: str) -> Optional[str]:
    api_key = _api_key()
    if not api_key or not message.strip():
        return None
    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        response = await client.aio.models.generate_content(
            model=_gemini_model(),
            contents=f"{SYSTEM_PROMPT}\n\nКористувачка: {message}",
        )
        text = getattr(response, "text", None)
        if text:
            return text.strip()
        if response.candidates:
            parts = response.candidates[0].content.parts
            return "".join(getattr(p, "text", "") for p in parts).strip()
    except Exception as e:
        logger.warning("simple_gemini_reply failed: %s", e)
    return None


async def interpret_voice_command(message: str) -> Optional[dict]:
    api_key = _api_key()
    if not api_key or not message.strip():
        return None
    prompt = f"""Визнач намір користувача smart mirror. Поверни тільки JSON, без markdown.
Дозволені формати:
{{"type":"music","action":"play|pause|open"}}
{{"type":"tab","name":"music|tutorials"}}
{{"type":"tutorial_nav","dir":"next|prev"}}
{{"type":"routine","which":"morning|evening|daily|weekly"}}
{{"type":"mark_done","name":"назва наявної задачі або звички"}}
{{"type":"add_habit","which":"morning|evening|daily|weekly","title":"короткий пункт"}}
{{"type":"music_volume","direction":"up|down"}}
{{"type":"mirror_mode","on":true}}
{{"type":"mirror_mode","on":false}}
{{"type":"gestures","on":true}}
{{"type":"gestures","on":false}}
{{"type":"chat"}}

Розумій природні фрази українською або російською, виправляй очевидні помилки розпізнавання.
Для додавання звички визнач її категорію з контексту; якщо назви або категорії немає — поверни chat.
Не вигадуй назви існуючих задач. Повідомлення користувача:
<message>{message[:500]}</message>"""
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        response = await client.aio.models.generate_content(
            model=_gemini_model(),
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0,
            ),
        )
        parsed = json.loads((response.text or "").strip())
        action = parsed.get("type")
        if action == "music" and parsed.get("action") in {"play", "pause", "open"}:
            return {"type": "music", "args": {"action": parsed["action"]}}
        if action == "tab" and parsed.get("name") in {"music", "tutorials"}:
            return {"type": "tab", "args": {"name": parsed["name"]}}
        if action == "tutorial_nav" and parsed.get("dir") in {"next", "prev"}:
            return {"type": action, "args": {"dir": parsed["dir"]}}
        if action == "routine" and parsed.get("which") in {"morning", "evening", "daily", "weekly"}:
            return {"type": action, "args": {"which": parsed["which"]}}
        if action == "mark_done" and isinstance(parsed.get("name"), str):
            name = parsed["name"].strip()[:120]
            return {"type": action, "args": {"name": name}} if name else None
        if action == "add_habit":
            which = parsed.get("which")
            title = parsed.get("title")
            if which in {"morning", "evening", "daily", "weekly"} and isinstance(title, str):
                title = title.strip()[:120]
                if title:
                    return {"type": action, "args": {"which": which, "title": title}}
        if action == "music_volume" and parsed.get("direction") in {"up", "down"}:
            return {"type": action, "args": {"direction": parsed["direction"]}}
        if action == "mirror_mode" and isinstance(parsed.get("on"), bool):
            return {"type": action, "args": {"on": parsed["on"]}}
        if action == "gestures" and isinstance(parsed.get("on"), bool):
            return {"type": action, "args": {"on": parsed["on"]}}
    except Exception as e:
        logger.warning("interpret_voice_command failed: %s", e)
    return None


async def gemini_speech(text: str, voice: str) -> Optional[bytes]:
    api_key = _api_key()
    if not api_key or voice not in GEMINI_TTS_VOICES:
        return None
    payload = {
        "model": "gemini-3.8-flash-lite-tts",
        "input": [
            {
                "type": "user_input",
                "content": [
                    {
                        "type": "text",
                        "text": text[:1500],
                        "annotations": [
                            {"type": "speech_metadata", "style": "natural, warm, conversational Ukrainian"}
                        ],
                    }
                ],
            }
        ],
        "response_format": {"type": "audio", "mime_type": "audio/wav"},
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    try:
        response = await asyncio.to_thread(
            requests.post,
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            headers={"x-goog-api-key": api_key},
            json=payload,
            timeout=45,
        )
        response.raise_for_status()
        result = response.json()
        audio_data = result.get("output_audio", {}).get("data")
        if not audio_data:
            for step in reversed(result.get("steps", [])):
                for part in step.get("content", []):
                    if part.get("type") == "audio" and part.get("data"):
                        audio_data = part["data"]
                        break
                if audio_data:
                    break
        return base64.b64decode(audio_data) if audio_data else None
    except Exception as e:
        logger.warning("gemini_speech failed: %s", e)
        return None
