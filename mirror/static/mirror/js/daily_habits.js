function getCSRFToken() {
  const name = "csrftoken";
  const cookies = document.cookie.split("; ");
  for (let cookie of cookies) {
    if (cookie.startsWith(name + "=")) {
      return decodeURIComponent(cookie.split("=")[1]);
    }
  }
  return null;
}

async function loadHabits(emoji, containerId) {
  try {
    const list = document.getElementById(containerId);
    const section = list.closest(".habit-section");

    // Set default loading state
    list.innerHTML = "<li class='text-muted'><i>Loading...</i></li>";

    const res = await fetch(`/habits/${encodeURIComponent(emoji)}/`);
    const data = await res.json();
    const now = new Date();
    const hour = now.getHours();
    const shouldExpand =
      (emoji === "☀️" && hour < 12) ||
      ((emoji === "🌸" || emoji === "✨") && hour >= 12 && hour < 17) ||
      (emoji === "🌙" && hour >= 17);

    list.innerHTML = "";

    if (!data.habits || data.habits.length === 0) {
      list.innerHTML = "<li class='text-muted'>No habits found.</li>";
      return;
    }
    const caret = section.querySelector(".caret-icon");
    const head = section.querySelector(".section-head") || caret;
    const toggle = () => {
      caret?.classList.toggle("expanded");
      list.classList.toggle("d-none");
    };
    head?.addEventListener("click", toggle);
    if (shouldExpand) {
      caret?.classList.add("expanded");
    } else {
      list.classList.add("d-none");
    }

    data.habits.forEach((habit) => {
      const li = document.createElement("li");
      li.className = "list-group-item d-flex align-items-center";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = habit.done;
      checkbox.className = "form-check-input me-2";

      checkbox.addEventListener("change", async () => {
        await fetch("/habits/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCSRFToken(),
          },
          body: JSON.stringify({
            page_id: habit.id,
            property: habit.property,
            done: checkbox.checked,
          }),
        });
      });

      const title = (habit.title || "")
        .replace(/^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]+\s*/u, "")
        .trim();
      li.appendChild(checkbox);
      li.appendChild(document.createTextNode(title || habit.title));
      list.appendChild(li);
    });
  } catch (error) {
    console.error(`Error loading habits for ${emoji}:`, error);
    const list = document.getElementById(containerId);
    if (list)
      list.innerHTML =
        "<li class='text-muted'>Локальні рутини недоступні.</li>";
  }
}

function loadAllHabitSections() {
  const sections = {
    "☀️": "morning-list",
    "🌙": "evening-list",
    "🌸": "daily-list",
    "✨": "weekly-list",
  };

  for (const [emoji, containerId] of Object.entries(sections)) {
    loadHabits(emoji, containerId);
  }
}

const ROUTINE_MAP = {
  morning: "morning-list",
  evening: "evening-list",
  daily: "daily-list",
  weekly: "weekly-list",
};

const ROUTINE_EMOJI = {
  morning: "☀️",
  evening: "🌙",
  daily: "🌸",
  weekly: "✨",
};

function expandRoutine(which) {
  const listId = ROUTINE_MAP[which];
  if (!listId) return false;
  const list = document.getElementById(listId);
  const section = list?.closest(".habit-section");
  if (!list || !section) return false;
  const caret = section.querySelector(".caret-icon");
  list.classList.remove("d-none");
  caret?.classList.add("expanded");
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

async function toggleHabitByName(name, done = true) {
  const fuzzy =
    window.MirrorCommands?.fuzzyIncludes ||
    ((a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()));
  const lists = Object.values(ROUTINE_MAP);
  for (const listId of lists) {
    const list = document.getElementById(listId);
    if (!list) continue;
    const items = list.querySelectorAll("li.list-group-item");
    for (const li of items) {
      const checkbox = li.querySelector('input[type="checkbox"]');
      const label = (li.textContent || "").trim();
      if (!checkbox || !fuzzy(label, name)) continue;
      if (checkbox.checked === !!done) return label;
      checkbox.checked = !!done;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      expandRoutine(
        Object.keys(ROUTINE_MAP).find((k) => ROUTINE_MAP[k] === listId),
      );
      return label;
    }
  }
  return null;
}

async function addHabit(which, title) {
  const response = await fetch("/habits/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCSRFToken(),
    },
    body: JSON.stringify({ which, title }),
  });
  const data = await response.json();
  if (!response.ok) return { error: data.error || "Не вдалося додати пункт." };
  await loadHabits(ROUTINE_EMOJI[which], ROUTINE_MAP[which]);
  expandRoutine(which);
  return { title: data.habit.title };
}

document.addEventListener("DOMContentLoaded", loadAllHabitSections);
setInterval(loadAllHabitSections, 10 * 60 * 1000);
document.addEventListener("reload-habits", loadAllHabitSections);

window.MirrorUI = window.MirrorUI || {};
window.MirrorUI.expandRoutine = expandRoutine;
window.MirrorUI.toggleHabitByName = toggleHabitByName;
window.MirrorUI.addHabit = addHabit;
