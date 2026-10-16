/**
 * Shared voice helpers for GlowMirror: TTS, browser STT, chat API, greetings.
 */
(function (global) {
  const GREET_COOLDOWN_MS = 45 * 60 * 1000;
  const STORAGE_KEY = "glowmirror_last_spoken_greet";
  const GEMINI_VOICE_KEY = "glowmirror_gemini_voice";
  const GEMINI_VOICES = ["Aoede", "Kore", "Leda", "Zephyr"];

  let preferredVoice = null;
  let voicesReady = false;
  let activeAudio = null;
  let activeAudioUrl = null;
  let geminiVoice = "Aoede";

  try {
    const savedVoice = localStorage.getItem(GEMINI_VOICE_KEY);
    if (GEMINI_VOICES.includes(savedVoice)) geminiVoice = savedVoice;
  } catch {
    /* local storage may be disabled */
  }

  function getCsrfToken() {
    const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
    return input?.value || "";
  }

  function hourInTz(timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timeZone || "Europe/Kyiv",
        hour: "numeric",
        hour12: false,
      }).formatToParts(new Date());
      return Number(
        parts.find((p) => p.type === "hour")?.value ?? new Date().getHours(),
      );
    } catch {
      return new Date().getHours();
    }
  }

  function timeOfDayLabel(hour) {
    if (hour >= 5 && hour < 11) return "morning";
    if (hour >= 11 && hour < 17) return "day";
    if (hour >= 17 && hour < 22) return "evening";
    return "night";
  }

  function buildGreeting(name, timeZone) {
    const hour = hourInTz(timeZone);
    const period = timeOfDayLabel(hour);
    const who = name ? `, ${name}` : "";
    const map = {
      morning: `Добрий ранок${who}`,
      day: `Добрий день${who}`,
      evening: `Добрий вечір${who}`,
      night: `Доброї ночі${who}`,
    };
    return `${map[period]}. Рада тебе бачити.`;
  }

  function canSpeakGreeting(name) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      const key = name || "__guest__";
      const last = data[key] || 0;
      return Date.now() - last >= GREET_COOLDOWN_MS;
    } catch {
      return true;
    }
  }

  function markGreetingSpoken(name) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      data[name || "__guest__"] = Date.now();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function pickUkrainianVoice() {
    if (!global.speechSynthesis) return null;
    const voices = speechSynthesis.getVoices() || [];
    preferredVoice =
      voices.find((v) => /^uk(-|$)/i.test(v.lang)) ||
      voices.find((v) => /ukrain/i.test(v.name)) ||
      voices.find((v) => /^ru(-|$)/i.test(v.lang)) ||
      voices.find((v) => /^en(-|$)/i.test(v.lang)) ||
      voices[0] ||
      null;
    voicesReady = true;
    return preferredVoice;
  }

  if (global.speechSynthesis) {
    pickUkrainianVoice();
    speechSynthesis.onvoiceschanged = pickUkrainianVoice;
  }

  function speak(text, { interrupt = true } = {}) {
    if (!text) return Promise.resolve(false);
    if (interrupt) stopSpeaking();
    return speakGemini(text).then((spoken) =>
      spoken ? true : speakWithSystemVoice(text, false),
    );
  }

  async function speakGemini(text) {
    let audio = null;
    let audioUrl = null;
    try {
      const response = await fetch("/voice/speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify({ text: String(text).trim(), voice: geminiVoice }),
      });
      if (!response.ok) return false;
      audioUrl = URL.createObjectURL(await response.blob());
      audio = new Audio(audioUrl);
      activeAudio = audio;
      activeAudioUrl = audioUrl;
      const playbackEnded = new Promise((resolve) => {
        audio.onended = () => resolve(true);
        audio.onerror = () => resolve(false);
        audio.onabort = () => resolve(false);
      });
      await audio.play();
      await playbackEnded;
      return true;
    } catch (error) {
      console.warn("Gemini TTS unavailable; using system voice", error);
      return false;
    } finally {
      if (audio && activeAudio === audio) activeAudio = null;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (activeAudioUrl === audioUrl) activeAudioUrl = null;
    }
  }

  function speakWithSystemVoice(text, interrupt = true) {
    if (!text || !global.speechSynthesis) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        if (interrupt) stopSpeaking();
        const utter = new SpeechSynthesisUtterance(
          String(text).replace(/\s+/g, " ").trim(),
        );
        utter.lang = "uk-UA";
        utter.rate = 0.95;
        utter.pitch = 1.05;
        if (!voicesReady) pickUkrainianVoice();
        if (preferredVoice) utter.voice = preferredVoice;
        utter.onend = () => resolve(true);
        utter.onerror = () => resolve(false);
        speechSynthesis.speak(utter);
      } catch {
        resolve(false);
      }
    });
  }

  function stopSpeaking() {
    if (global.speechSynthesis) speechSynthesis.cancel();
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.src = "";
      activeAudio = null;
    }
    if (activeAudioUrl) {
      URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = null;
    }
  }

  function setGeminiVoice(name) {
    if (!GEMINI_VOICES.includes(name)) return false;
    geminiVoice = name;
    try {
      localStorage.setItem(GEMINI_VOICE_KEY, name);
    } catch {
      /* local storage may be disabled */
    }
    return true;
  }

  function createSpeechRecognizer({
    lang = "uk-UA",
    continuous = false,
    interimResults = true,
    onResult,
    onError,
    onEnd,
  } = {}) {
    const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) return null;

    const recognition = new SR();
    recognition.lang = lang;
    recognition.interimResults = interimResults;
    recognition.continuous = continuous;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      onResult?.({ interim, finalText: finalText.trim() });
    };
    recognition.onerror = (e) => onError?.(e);
    recognition.onend = () => onEnd?.();

    return recognition;
  }

  async function askMirror(message) {
    const text = String(message || "").trim();
    if (!text) return { response: [] };

    const res = await fetch("/voice/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCsrfToken(),
      },
      body: JSON.stringify({ message: text }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg =
        (data &&
          (data.error || (Array.isArray(data.response) && data.response[0]))) ||
        `Помилка сервера (${res.status})`;
      throw new Error(msg);
    }
    return data || { response: [] };
  }

  async function interpretCommand(message) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("/voice/intent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify({ message: String(message || "").trim() }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data.intent || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadMirrorConfig() {
    try {
      const res = await fetch("/mirror-config/");
      if (!res.ok) return {};
      return await res.json();
    } catch {
      return {};
    }
  }

  global.MirrorVoice = {
    GREET_COOLDOWN_MS,
    buildGreeting,
    canSpeakGreeting,
    markGreetingSpoken,
    speak,
    setGeminiVoice,
    getGeminiVoice: () => geminiVoice,
    stopSpeaking,
    createSpeechRecognizer,
    askMirror,
    interpretCommand,
    loadMirrorConfig,
    getCsrfToken,
    timeOfDayLabel,
    hourInTz,
  };
})(window);
