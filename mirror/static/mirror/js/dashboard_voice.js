/**
 * Hands-free voice control for GlowMirror (no mouse / no touch).
 *
 * Browsers block mic until a user gesture — show a one-tap gate, then
 * keep SpeechRecognition alive with a restart loop (more reliable than continuous).
 */
(function () {
  const COMMAND_WINDOW_MS = 12000;
  const RESTART_DELAY_MS = 350;
  const TTS_COOLDOWN_MS = 450;

  let panelOpen = false;
  let handsFree = false;
  let listening = false;
  let busy = false;
  let speaking = false;
  let mutedUntil = 0;
  let armedUntil = 0;
  let recognition = null;
  let wantListen = false;
  let restartTimer = null;
  let micStream = null;
  let startedOnce = false;

  let interimEl = null;
  let logEl = null;
  let statusEl = null;
  let micBtn = null;
  let handsFreeEl = null;
  let gateEl = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setHandsFreeLabel(text) {
    if (handsFreeEl) handsFreeEl.textContent = text;
  }

  function addBubble(text, role) {
    if (!logEl || !text) return;
    const bubble = document.createElement("div");
    bubble.className = `voice-bubble voice-bubble--${role}`;
    bubble.textContent = text;
    logEl.appendChild(bubble);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function isArmed() {
    return Date.now() < armedUntil;
  }

  function isMuted() {
    return Date.now() < mutedUntil || speaking || busy;
  }

  function arm(ms = COMMAND_WINDOW_MS) {
    armedUntil = Date.now() + ms;
  }

  function disarm() {
    armedUntil = 0;
  }

  function muteFor(ms) {
    mutedUntil = Date.now() + ms;
  }

  function openPanel() {
    const panel = document.getElementById("voice-panel");
    if (!panel) return;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    panelOpen = true;
    document.getElementById("btn-voice-toggle")?.classList.add("active");
  }

  function closePanel() {
    const panel = document.getElementById("voice-panel");
    if (!panel) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    panelOpen = false;
    document.getElementById("btn-voice-toggle")?.classList.remove("active");
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  function hideGate() {
    gateEl?.classList.add("hidden");
    gateEl?.setAttribute("aria-hidden", "true");
  }

  function showGate(msg) {
    if (!gateEl) return;
    const p = gateEl.querySelector(".voice-gate__text");
    if (p && msg) p.textContent = msg;
    gateEl.classList.remove("hidden");
    gateEl.setAttribute("aria-hidden", "false");
  }

  async function ensureMicPermission() {
    if (!navigator.mediaDevices?.getUserMedia) return { ok: true };
    try {
      if (micStream) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
      }
      // Request once so Chrome unlocks SpeechRecognition
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      // Keep track alive briefly then stop — permission stays granted
      setTimeout(() => {
        try {
          micStream?.getTracks().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
        micStream = null;
      }, 800);
      return true;
    } catch (err) {
      console.warn("mic permission", err);
      return { ok: false, error: err };
    }
  }

  async function speakReply(text) {
    if (!text) return;
    speaking = true;
    muteFor(TTS_COOLDOWN_MS + Math.min(8000, String(text).length * 60));
    setStatus("Відповідаю…");
    window.MirrorUI?.duckMusic?.();
    try {
      await MirrorVoice.speak(text);
    } finally {
      window.MirrorUI?.restoreMusicVolume?.();
      speaking = false;
      muteFor(TTS_COOLDOWN_MS);
      if (handsFree) {
        setStatus(isArmed() ? "Слухаю команду…" : "Скажи «дзеркало»…");
        setHandsFreeLabel(isArmed() ? "👂 команда" : "👂 слухаю");
      }
    }
  }

  async function handleChat(text) {
    openPanel();
    addBubble(text, "user");
    setStatus("Думаю…");
    try {
      const data = await MirrorVoice.askMirror(text);
      const replies = Array.isArray(data.response) ? data.response : [];
      const spoken = replies.filter((r) => typeof r === "string" && r.trim());
      if (!spoken.length) {
        const msg = "Немає відповіді — перевір GEMINI_API_KEY у .env";
        addBubble(msg, "bot");
        await speakReply(msg);
        return;
      }
      for (const line of spoken) addBubble(line, "bot");
      await speakReply(spoken.join(". "));
    } catch (err) {
      console.error(err);
      const hint = err?.message?.trim();
      const msg =
        hint && hint.length < 280
          ? hint
          : "Ой, щось пішло не так з відповіддю.";
      addBubble(msg, "bot");
      await speakReply(msg);
    }
  }

  async function handleUtterance(raw) {
    if (!raw || isMuted()) return;
    const text = String(raw).trim();
    if (!text) return;

    // Strong UI commands work without wake word (hands-free kiosk)
    let intent = MirrorCommands.parseIntent(text, { requireWake: !isArmed() });
    if (!intent) {
      intent = MirrorCommands.parseIntent(text, { requireWake: false });
      if (
        !intent ||
        intent.type === "listen" ||
        (intent.type === "chat" && !MirrorCommands.isLikelyCommand(text))
      ) {
        // Show that we heard something, but still need wake for chat
        setHandsFreeLabel("👂 …");
        if (interimEl) interimEl.textContent = text;
        return;
      }
    }

    busy = true;
    micBtn?.classList.add("recording");
    openPanel();

    try {
      if (intent.type === "chat" && MirrorCommands.isLikelyCommand(text)) {
        setStatus("Уточнюю дію…");
        const inferred = await MirrorVoice.interpretCommand(text);
        if (inferred) intent = inferred;
      }

      if (intent.type === "listen") {
        arm();
        addBubble(text, "user");
        addBubble("Слухаю.", "bot");
        setHandsFreeLabel("👂 команда");
        setStatus("Слухаю команду…");
        // Short ack — don't block the next command for long
        muteFor(300);
        MirrorVoice.speak("Так?").finally(() => {
          speaking = false;
          muteFor(200);
        });
        speaking = true;
        setTimeout(() => {
          speaking = false;
        }, 700);
        return;
      }

      if (intent.type === "stop") {
        disarm();
        MirrorVoice.stopSpeaking();
        speaking = false;
        muteFor(400);
        addBubble(text, "user");
        addBubble("Добре.", "bot");
        setStatus("Скажи «дзеркало»…");
        setHandsFreeLabel("👂 слухаю");
        return;
      }

      if (intent.type === "chat") {
        arm();
        await handleChat(intent.args.message);
        arm(5000);
        return;
      }

      addBubble(text, "user");
      const reply = await MirrorCommands.execute(intent);
      if (reply === null) {
        await handleChat(intent.args?.message || text);
      } else {
        const spoken = reply || intent.speak || "Готово.";
        addBubble(spoken, "bot");
        await speakReply(spoken);
      }
      arm(5000);
    } finally {
      busy = false;
      if (!listening) micBtn?.classList.remove("recording");
    }
  }

  function scheduleRestart() {
    if (!wantListen || !handsFree) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      if (wantListen && handsFree && !listening) startRecognitionLoop();
    }, RESTART_DELAY_MS);
  }

  function stopListening(permanent = false) {
    if (permanent) {
      wantListen = false;
      handsFree = false;
    }
    listening = false;
    micBtn?.classList.remove("recording");
    if (interimEl) interimEl.textContent = "";
    try {
      recognition?.abort();
    } catch {
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
    }
  }

  function ensureRecognition() {
    if (recognition) return recognition;
    if (!window.MirrorVoice) return null;

    // Non-continuous + restart is more stable in Chrome than continuous:true
    recognition = MirrorVoice.createSpeechRecognizer({
      lang: "uk-UA",
      continuous: false,
      interimResults: true,
      onResult: ({ interim, finalText }) => {
        if (interim && handsFreeEl && !busy) {
          const short = interim.slice(0, 28);
          setHandsFreeLabel(short ? `👂 ${short}` : "👂 …");
        }
        if (interimEl) interimEl.textContent = interim || finalText || "";
        if (finalText && !isMuted()) {
          if (interimEl) interimEl.textContent = "";
          handleUtterance(finalText);
        }
      },
      onError: (e) => {
        listening = false;
        const code = e?.error || "";
        if (code === "not-allowed") {
          setStatus("Немає доступу до мікрофона");
          setHandsFreeLabel("🔇 мікрофон");
          wantListen = false;
          handsFree = false;
          showGate("Дозволь мікрофон у браузері, потім натисни тут");
          return;
        }
        if (code === "aborted") return;
        // no-speech / network / etc — just restart
        scheduleRestart();
      },
      onEnd: () => {
        listening = false;
        if (!busy) micBtn?.classList.remove("recording");
        scheduleRestart();
      },
    });
    return recognition;
  }

  function startRecognitionLoop() {
    if (!wantListen || !handsFree) return;
    if (!ensureRecognition()) {
      setStatus("Браузер не підтримує голос — потрібен Chrome / Chromium");
      setHandsFreeLabel("🔇 немає STT");
      showGate("Відкрий у Chrome / Chromium і натисни тут");
      return;
    }
    if (listening) return;
    try {
      recognition.start();
      listening = true;
      micBtn?.classList.add("recording");
      if (!busy && !speaking) {
        setStatus(isArmed() ? "Слухаю команду…" : "Скажи «дзеркало»…");
        if (!isArmed()) setHandsFreeLabel("👂 слухаю");
      }
    } catch (err) {
      // InvalidStateError if already started
      listening = true;
      scheduleRestart();
    }
  }

  async function enableHandsFree() {
    hideGate();
    setStatus("Запитую мікрофон…");
    setHandsFreeLabel("👂 …");
    const permission = await ensureMicPermission();
    if (!permission.ok) {
      const errorName = permission.error?.name;
      const status =
        errorName === "NotReadableError"
          ? "Мікрофон зайнятий або недоступний"
          : errorName === "NotFoundError"
            ? "Мікрофон не знайдено"
            : errorName === "NotAllowedError" || errorName === "SecurityError"
              ? "Браузер або Windows заблокував мікрофон"
              : `Не вдалося відкрити мікрофон${errorName ? ` (${errorName})` : ""}`;
      const hint =
        errorName === "NotReadableError"
          ? "Закрий Zoom, Teams та інші програми або вкладки, що використовують мікрофон, і спробуй ще раз"
          : errorName === "NotFoundError"
            ? "Під'єднай мікрофон і перевір пристрій введення Windows"
            : errorName === "NotAllowedError" || errorName === "SecurityError"
              ? "Дозволь мікрофон для цієї сторінки та в налаштуваннях конфіденційності Windows"
              : "Перевір мікрофон і спробуй ще раз";
      setStatus(status);
      setHandsFreeLabel("🔇 мікрофон");
      showGate(hint);
      return false;
    }
    handsFree = true;
    wantListen = true;
    startedOnce = true;
    openPanel();
    addBubble("Голос увімкнено. Скажи «дзеркало».", "bot");
    setStatus("Скажи «дзеркало»…");
    setHandsFreeLabel("👂 слухаю");
    startRecognitionLoop();
    void speakReply("Слухаю тебе.");
    return true;
  }

  function toggleMic() {
    openPanel();
    if (listening || wantListen) {
      stopListening(true);
      setStatus("Мікрофон вимкнено · натисни 🎤");
      setHandsFreeLabel("🔇 вимкнено");
      showGate("Натисни, щоб знову слухати");
    } else {
      MirrorVoice.stopSpeaking();
      enableHandsFree();
    }
  }

  async function sendTyped() {
    const input = document.getElementById("voice-text-input");
    const text = input?.value?.trim();
    if (!text) return;
    input.value = "";
    arm();
    const payload = /дзерк|зерк|люстр|glow|глоу/i.test(text)
      ? text
      : `дзеркало ${text}`;
    await handleUtterance(payload);
  }

  window.MirrorUI = window.MirrorUI || {};
  window.MirrorUI.stopListening = stopListening;
  window.MirrorUI.startHandsFree = enableHandsFree;

  document.addEventListener("DOMContentLoaded", () => {
    logEl = document.getElementById("voice-log");
    statusEl = document.getElementById("voice-status");
    interimEl = document.getElementById("voice-interim");
    micBtn = document.getElementById("btn-voice-mic");
    handsFreeEl = document.getElementById("voice-handsfree");
    gateEl = document.getElementById("voice-gate");
    const voiceSelect = document.getElementById("voice-voice-select");
    const voicePreview = document.getElementById("btn-voice-preview");

    if (voiceSelect) {
      voiceSelect.value = MirrorVoice.getGeminiVoice();
      voiceSelect.addEventListener("change", () => {
        MirrorVoice.setGeminiVoice(voiceSelect.value);
      });
    }
    voicePreview?.addEventListener("click", () => {
      speakReply("Привіт! Який голос тобі більше подобається?");
    });

    document
      .getElementById("btn-voice-toggle")
      ?.addEventListener("click", togglePanel);
    document
      .getElementById("btn-voice-close")
      ?.addEventListener("click", closePanel);
    micBtn?.addEventListener("click", toggleMic);
    document
      .getElementById("btn-voice-send")
      ?.addEventListener("click", sendTyped);
    document
      .getElementById("voice-text-input")
      ?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          sendTyped();
        }
      });

    const armGate = () => {
      if (startedOnce) return;
      enableHandsFree();
    };
    gateEl?.addEventListener("click", armGate);
    // First dock mic / toggle also enables
    document.getElementById("btn-voice-toggle")?.addEventListener(
      "click",
      () => {
        if (!startedOnce) enableHandsFree();
      },
      { once: true },
    );

    // Space / Enter anywhere = enable (handy if there is a keyboard for setup)
    document.addEventListener("keydown", (e) => {
      if (startedOnce) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        enableHandsFree();
      }
    });

    setStatus("Потрібен дозвіл мікрофона");
    setHandsFreeLabel("🔇 старт");
    showGate("Натисни будь-де на екран, щоб увімкнути голос");

    // Try auto-start (works if permission already granted, e.g. kiosk flags)
    setTimeout(async () => {
      if (startedOnce) return;
      try {
        const perm = await navigator.permissions?.query?.({
          name: "microphone",
        });
        if (perm?.state === "granted") {
          await enableHandsFree();
        }
      } catch {
        /* Safari / unsupported — wait for tap */
      }
    }, 500);
  });
})();
