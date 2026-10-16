/**
 * Local Ukrainian voice intents for hands-free GlowMirror control.
 * Unknown phrases fall through to Gemini chat.
 */
(function (global) {
  const WAKE_PHRASES = [
    "окей дзеркало",
    "окей зеркало",
    "гей дзеркало",
    "гей зеркало",
    "привіт дзеркало",
    "слухай дзеркало",
    "glow mirror",
    "hey mirror",
    "ok mirror",
    "дзеркало",
    "дзеркала",
    "дзеркалом",
    "дзеркалу",
    "дзеркальце",
    "зеркало",
    "зеркала",
    "зеркалом",
    "люстро",
    "mirror",
    "glow",
    "глоу",
  ];

  // STT often mangles the wake word — match stem
  const WAKE_STEMS = ["дзерк", "зеркал", "люстр"];

  const HELP =
    "Скажи «дзеркало» і команду: музика, макіяж, далі, назад, " +
    "ранкова рутина, вечірня рутина, погода, афірмація, порада, " +
    "режим дзеркала, жести, тихо. Або просто спитай мене щось.";

  const MUSIC_WORDS = [
    "музик",
    "музык",
    "саундклауд",
    "soundcloud",
    "пісн",
    "трек",
    "плеєр",
    "music",
  ];
  const MUSIC_PLAY_WORDS = [
    "увімк",
    "включ",
    "запуст",
    "грай",
    "заграй",
    "слух",
    "послух",
    "воспроизвед",
    "играй",
    "вруби",
    "play",
  ];
  const MUSIC_PAUSE_WORDS = [
    "пауза",
    "зупин",
    "вимк",
    "останов",
    "выключ",
    "stop",
    "pause",
  ];
  const COMMAND_CUES = [
    "дод",
    "добав",
    "внес",
    "запиш",
    "хочу",
    "можеш",
    "зроб",
    "включ",
    "увімк",
    "вимк",
    "зупин",
    "запуст",
    "постав",
    "познач",
    "відміт",
    "відзнач",
    "відкрий",
    "перейд",
    "перемк",
    "покаж",
    "сховай",
    "прихов",
    "гучніш",
    "гучност",
    "тихіш",
    "тише",
    "погромче",
    "голосніш",
    "louder",
    "quieter",
    "зменш",
    "збільш",
    "увелич",
    "рутину",
    "рутин",
    "розпорядок",
    "послух",
    "послуш",
    "дай",
    "звичку",
    "задачу",
    "наступ",
  ];

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripWake(text) {
    let t = normalize(text);
    const sorted = [...WAKE_PHRASES].sort((a, b) => b.length - a.length);
    for (const wake of sorted) {
      if (t === wake) return { woke: true, command: "" };
      if (t.startsWith(wake + " ")) {
        return { woke: true, command: t.slice(wake.length).trim() };
      }
      const idx = t.indexOf(wake);
      if (idx >= 0) {
        const before = t.slice(0, idx).trim();
        const after = t.slice(idx + wake.length).trim();
        const command = [before, after].filter(Boolean).join(" ").trim();
        return { woke: true, command };
      }
    }

    // Fuzzy: "дзерк..." / "зеркал..." anywhere in the phrase
    const words = t.split(" ");
    const stemIdx = words.findIndex((w) =>
      WAKE_STEMS.some((stem) => w.includes(stem)),
    );
    if (stemIdx >= 0) {
      const command = words
        .filter((_, i) => i !== stemIdx)
        .join(" ")
        .trim();
      return { woke: true, command };
    }

    return { woke: false, command: t };
  }

  function includesAny(text, words) {
    return words.some((w) => text.includes(w));
  }

  function fuzzyIncludes(hay, needle) {
    const h = normalize(hay);
    const n = normalize(needle);
    if (!n) return false;
    if (h.includes(n) || n.includes(h)) return true;
    const hWords = h.split(" ").filter(Boolean);
    const nWords = n.split(" ").filter((w) => w.length > 2);
    if (!nWords.length) return false;
    return nWords.every((w) =>
      hWords.some((hw) => hw.includes(w) || w.includes(hw)),
    );
  }

  function isLikelyCommand(rawText) {
    const { command } = stripWake(rawText);
    return includesAny(command, COMMAND_CUES);
  }

  /**
   * @returns {{ type: string, args?: object, speak?: string } | null}
   * null = not a UI command (send to chat)
   */
  function parseIntent(rawText, { requireWake = true } = {}) {
    const { woke, command } = stripWake(rawText);
    if (requireWake && !woke) return null;

    const text = command;
    if (!text) {
      return { type: "listen", speak: "Слухаю." };
    }

    if (
      includesAny(text, ["стоп", "тихо", "мовчи", "замовкни", "stop", "quiet"])
    ) {
      return { type: "stop", speak: "Добре." };
    }

    if (includesAny(text, ["допомога", "команди", "що вмієш", "help"])) {
      return { type: "help", speak: HELP };
    }

    if (includesAny(text, ["дод", "добав", "внес", "запиш", "add", "create"])) {
      return { type: "chat", args: { message: text } };
    }

    if (includesAny(text, MUSIC_WORDS)) {
      const pause = includesAny(text, MUSIC_PAUSE_WORDS);
      const play = pause || includesAny(text, MUSIC_PLAY_WORDS);
      return {
        type: "music",
        args: { action: pause ? "pause" : play ? "play" : "open" },
        speak: pause
          ? "Зупиняю музику."
          : play
            ? "Увімкнула музику."
            : "Відкриваю музику.",
      };
    }

    if (
      includesAny(text, [
        "макіяж",
        "мейкап",
        "туторіал",
        "tutorial",
        "ютуб",
        "youtube",
        "відео",
      ])
    ) {
      return {
        type: "tab",
        args: { name: "tutorials" },
        speak: "Відкриваю туторіали.",
      };
    }

    if (includesAny(text, ["наступн", "далі", "вперед", "next"])) {
      return {
        type: "tutorial_nav",
        args: { dir: "next" },
        speak: "Наступний туторіал.",
      };
    }

    if (includesAny(text, ["попередн", "назад", "prev", "previous"])) {
      return {
        type: "tutorial_nav",
        args: { dir: "prev" },
        speak: "Попередній туторіал.",
      };
    }

    if (includesAny(text, ["ранков"])) {
      return {
        type: "routine",
        args: { which: "morning" },
        speak: "Ранкова рутина.",
      };
    }
    if (includesAny(text, ["вечірн"])) {
      return {
        type: "routine",
        args: { which: "evening" },
        speak: "Вечірня рутина.",
      };
    }
    if (includesAny(text, ["щоденн", "звички"])) {
      return {
        type: "routine",
        args: { which: "daily" },
        speak: "Щоденні звички.",
      };
    }
    if (includesAny(text, ["тижнев", "тиждень"])) {
      return {
        type: "routine",
        args: { which: "weekly" },
        speak: "Тижневі звички.",
      };
    }

    if (includesAny(text, ["погода", "weather"])) {
      return { type: "read_weather" };
    }
    if (includesAny(text, ["афірмац", "affirm"])) {
      return { type: "read_affirmation" };
    }
    if (includesAny(text, ["порад", "beauty tip", "тіп", "тип"])) {
      return { type: "read_tip" };
    }
    if (includesAny(text, ["час", "котра година", "який час"])) {
      return { type: "read_time" };
    }

    if (
      includesAny(text, [
        "режим дзеркала",
        "сховай",
        "приховай",
        "чисте дзеркало",
        "mirror mode",
      ])
    ) {
      const hide = includesAny(text, ["сховай", "приховай", "увімкн", "режим"]);
      const show = includesAny(text, ["покажи", "вимкн", "поверну"]);
      if (show && !hide) {
        return {
          type: "mirror_mode",
          args: { on: false },
          speak: "Показую інтерфейс.",
        };
      }
      return {
        type: "mirror_mode",
        args: { on: true },
        speak: "Режим дзеркала.",
      };
    }
    if (
      includesAny(text, ["покажи все", "покажи інтерфейс", "вийди з режиму"])
    ) {
      return {
        type: "mirror_mode",
        args: { on: false },
        speak: "Показую інтерфейс.",
      };
    }

    if (includesAny(text, ["жест"])) {
      const off = includesAny(text, ["вимкн", "стоп", "off"]);
      return {
        type: "gestures",
        args: { on: !off },
        speak: off ? "Жести вимкнено." : "Жести увімкнено.",
      };
    }

    const completionRequested = includesAny(text, [
      "виконаним",
      "виконаною",
      "выполненным",
      "выполненной",
      "готовим",
      "готовым",
      "зроблено",
      "виконано",
      "выполнено",
    ]);
    if (
      completionRequested &&
      includesAny(text, [
        "чекбокс",
        "галочк",
        "задач",
        "завдан",
        "checkbox",
        "task",
      ])
    ) {
      return {
        type: "clarify_task",
        speak: "Назви конкретну задачу або звичку, яку позначити виконаною.",
      };
    }

    // «познач … зроблено» / «зробила …» / «відміть …»
    const doneMatch = text.match(
      /(?:познач|відміть|відміти|відзнач|постав|поставь|отметь|отмети|сделай|зробила|зробив|готово|done)\s+(.+?)(?:\s+(?:як\s+)?(?:виконаним|виконаною|виконано|выполненным|выполненной|выполнено|готовим|готовою|готовым|готовой|зроблено))?$/,
    );
    if (doneMatch) {
      const name = doneMatch[1].replace(/\s+зроблено$/, "").trim();
      if (name) {
        return {
          type: "mark_done",
          args: { name },
          speak: `Позначаю: ${name}.`,
        };
      }
    }
    if (
      includesAny(text, ["зроблено", "виконала", "виконав"]) &&
      text.length > 8
    ) {
      const name = text
        .replace(/^(будь ласка\s+)?/, "")
        .replace(/\s*(зроблено|виконала|виконав|готово)\s*$/, "")
        .replace(/^(познач|відміть|відміти)\s+/, "")
        .trim();
      if (name.length > 1) {
        return {
          type: "mark_done",
          args: { name },
          speak: `Позначаю: ${name}.`,
        };
      }
    }

    // Not a known UI command → chat (only if woke or already armed)
    return { type: "chat", args: { message: text } };
  }

  function ui() {
    return global.MirrorUI || {};
  }

  async function execute(intent) {
    if (!intent) return "";
    const api = ui();

    switch (intent.type) {
      case "listen":
      case "help":
      case "stop":
        if (intent.type === "stop") {
          MirrorVoice?.stopSpeaking();
          api.stopListening?.(false);
        }
        return intent.speak || "";

      case "tab":
        api.showTab?.(intent.args.name);
        if (intent.args.name === "tutorials") api.ensureTutorial?.();
        return intent.speak || "";

      case "music":
        api.showTab?.("music");
        if (intent.args.action === "play") api.playMusic?.();
        if (intent.args.action === "pause") api.pauseMusic?.();
        return intent.speak || "";

      case "tutorial_nav":
        api.showTab?.("tutorials");
        if (intent.args.dir === "next") api.nextTutorial?.();
        else api.prevTutorial?.();
        return intent.speak || "";

      case "routine":
        api.expandRoutine?.(intent.args.which);
        return intent.speak || "";

      case "add_habit": {
        const result = await api.addHabit?.(
          intent.args.which,
          intent.args.title,
        );
        return result?.title
          ? `Додала до рутини: ${result.title}.`
          : result?.error || "Не вдалося додати пункт до рутини.";
      }

      case "music_volume":
        api.changeMusicVolume?.(intent.args.direction);
        return intent.args.direction === "up"
          ? "Зробила музику голосніше."
          : "Зробила музику тихіше.";

      case "read_weather": {
        const el = document.getElementById("weather");
        const t = el?.textContent?.trim() || "Погода зараз недоступна.";
        return t;
      }
      case "read_affirmation": {
        const el = document.getElementById("affirmations");
        return el?.textContent?.trim() || "Афірмація ще завантажується.";
      }
      case "read_tip": {
        const el = document.getElementById("beauty-tip");
        return el?.textContent?.trim() || "Поради ще немає.";
      }
      case "read_time": {
        const clock =
          document.getElementById("clock")?.textContent?.trim() || "";
        const date =
          document.getElementById("date-line")?.textContent?.trim() || "";
        return (
          [clock && `Зараз ${clock}`, date].filter(Boolean).join(". ") ||
          "Час недоступний."
        );
      }

      case "mirror_mode":
        api.setMirrorMode?.(!!intent.args.on);
        return intent.speak || "";

      case "gestures":
        await api.setGestures?.(!!intent.args.on);
        return intent.speak || "";

      case "mark_done": {
        const name = intent.args.name;
        const habit = await api.toggleHabitByName?.(name, true);
        if (habit) return `Готово: ${habit}.`;
        const task = await api.toggleTaskByName?.(name, true);
        if (task) return `Задачу позначено: ${task}.`;
        return `Не знайшла «${name}» у рутинах чи задачах.`;
      }

      case "clarify_task":
        return intent.speak;

      case "chat":
        return null; // signal caller to use Gemini

      default:
        return "";
    }
  }

  global.MirrorCommands = {
    WAKE_PHRASES,
    HELP,
    normalize,
    stripWake,
    parseIntent,
    execute,
    fuzzyIncludes,
    isLikelyCommand,
    MUSIC_WORDS,
    MUSIC_PLAY_WORDS,
    MUSIC_PAUSE_WORDS,
  };
})(window);
