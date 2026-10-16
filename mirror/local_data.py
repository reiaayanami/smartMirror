"""Local JSON data helpers so the mirror works without Notion."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from django.conf import settings

DATA_DIR = Path(settings.BASE_DIR) / "mirror" / "static" / "mirror" / "data"
EMOJI_TO_KEY = {"☀️": "morning", "🌙": "evening", "🌸": "daily", "✨": "weekly"}


def _read(name: str, default: Any):
    path = DATA_DIR / name
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write(name: str, payload: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def load_routines() -> dict:
    return _read(
        "routines.json",
        {"morning": [], "evening": [], "daily": [], "weekly": []},
    )


def save_routines(data: dict) -> None:
    _write("routines.json", data)


def add_local_habit(which: str, title: str) -> dict:
    prefixes = {"morning": "m", "evening": "e", "daily": "d", "weekly": "w"}
    if which not in prefixes:
        raise ValueError("Unknown routine")
    clean_title = " ".join(str(title).split())[:120]
    if not clean_title:
        raise ValueError("Habit title is required")
    routines = load_routines()
    items = routines.setdefault(which, [])
    if any(item.get("title", "").casefold() == clean_title.casefold() for item in items):
        raise ValueError("This habit already exists")
    habit = {"id": prefixes[which] + uuid.uuid4().hex[:12], "title": clean_title, "done": False}
    items.append(habit)
    save_routines(routines)
    return habit


def habits_for_emoji(emoji: str) -> list[dict]:
    key = EMOJI_TO_KEY.get(emoji, "")
    routines = load_routines()
    items = routines.get(key, [])
    return [
        {
            "id": item["id"],
            "title": f"{emoji} {item['title']}",
            "done": bool(item.get("done")),
            "property": key,
        }
        for item in items
    ]


def update_local_habit(habit_id: str, done: bool) -> bool:
    routines = load_routines()
    for key, items in routines.items():
        for item in items:
            if item.get("id") == habit_id:
                item["done"] = bool(done)
                save_routines(routines)
                return True
    return False


def load_tasks() -> list[dict]:
    return _read("tasks.json", [])


def save_tasks(tasks: list[dict]) -> None:
    _write("tasks.json", tasks)


def update_local_task(task_id: str, status: str) -> bool:
    tasks = load_tasks()
    for task in tasks:
        if task.get("id") == task_id:
            task["status"] = status
            save_tasks(tasks)
            return True
    return False


def load_tutorials() -> dict:
    return _read("tutorials.json", {"playlist_title": "Tutorials", "videos": []})


def load_beauty_tips() -> list[str]:
    return _read("beauty_tips.json", ["Будь ніжною до себе сьогодні."])


def load_faces() -> list[dict]:
    return _read("faces.json", [])


def save_faces(faces: list[dict]) -> None:
    _write("faces.json", faces)


def vision_folder() -> Path:
    return Path(settings.BASE_DIR) / "mirror" / "static" / "mirror" / "vision"


IMAGE_EXTS = (".jpg", ".jpeg", ".jpe", ".png", ".webp", ".gif")
