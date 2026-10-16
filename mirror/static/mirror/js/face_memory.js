/**
 * Face memory for Raspberry Pi / Chromium kiosk.
 * Uses face-api.js from CDN when available; falls back to simple presence greeting.
 * Speaks time-of-day greetings via MirrorVoice when a known face appears.
 */

const FACE_MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/model";
let faceApiReady = false;
let knownFaces = [];
let cameraStream = null;
let faceLoopTimer = null;
let lastGreetingName = "";
let mirrorTimezone = "Europe/Kyiv";
let awaySince = null;
const AWAY_RESET_MS = 90 * 1000;

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

function matchFace(descriptor) {
  let best = null;
  let bestDist = 0.55;
  for (const face of knownFaces) {
    if (!face.descriptor || face.descriptor.length !== descriptor.length) continue;
    const dist = euclideanDistance(face.descriptor, descriptor);
    if (dist < bestDist) {
      bestDist = dist;
      best = face;
    }
  }
  return best;
}

function setGreeting(text) {
  const el = document.getElementById("face-greeting");
  if (el) el.textContent = text;
}

function emitFaceEvent(detail) {
  document.dispatchEvent(new CustomEvent("mirror-face", { detail }));
}

function greetingText(name) {
  if (window.MirrorVoice?.buildGreeting) {
    return MirrorVoice.buildGreeting(name, mirrorTimezone);
  }
  return name ? `Привіт, ${name}` : "Привіт!";
}

async function maybeSpeakGreeting(name, text) {
  const mv = window.MirrorVoice;
  if (!mv?.speak) return;
  if (!mv.canSpeakGreeting(name)) return;
  mv.markGreetingSpoken(name);
  await mv.speak(text);
}

async function loadKnownFaces() {
  const res = await fetch("/faces/");
  const data = await res.json();
  knownFaces = data.faces || [];
}

async function ensureFaceApi() {
  if (faceApiReady) return true;
  if (!window.faceapi) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.14/dist/face-api.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODEL_URL);
  await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL_URL);
  await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL_URL);
  faceApiReady = true;
  return true;
}

async function startCamera() {
  const video = document.getElementById("mirror-cam");
  const dock = document.querySelector(".camera-dock");
  if (!video) return null;
  if (!cameraStream) {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = cameraStream;
    await video.play();
  }
  dock?.classList.add("active");
  return video;
}

function onPersonAway() {
  if (!awaySince) awaySince = Date.now();
  if (lastGreetingName && Date.now() - awaySince >= AWAY_RESET_MS) {
    lastGreetingName = "";
    setGreeting("Нікого не бачу · soft glow mode");
    emitFaceEvent({ type: "away" });
  }
}

async function onPersonSeen(match) {
  awaySince = null;
  const name = match?.name || null;
  const key = name || "__guest__";
  if (key === lastGreetingName) return;

  lastGreetingName = key;
  const text = name
    ? greetingText(name)
    : "Привіт! Можу запам'ятати тебе кнопкою 📸";
  setGreeting(text);
  emitFaceEvent({ type: "seen", name, known: Boolean(name) });

  if (name) {
    await maybeSpeakGreeting(name, text);
  }
}

async function recognizeLoop() {
  try {
    if (window.MirrorVoice?.loadMirrorConfig) {
      const cfg = await MirrorVoice.loadMirrorConfig();
      if (cfg.timezone) mirrorTimezone = cfg.timezone;
    }
    await ensureFaceApi();
    await loadKnownFaces();
    const video = await startCamera();
    if (!video) return;

    if (faceLoopTimer) clearInterval(faceLoopTimer);
    faceLoopTimer = setInterval(async () => {
      if (video.readyState < 2) return;
      const detection = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection) {
        onPersonAway();
        return;
      }
      const match = matchFace(Array.from(detection.descriptor));
      await onPersonSeen(match);
    }, 1800);
  } catch (e) {
    console.warn("face memory unavailable", e);
    setGreeting("Камера недоступна · все одно ти прекрасна");
  }
}

async function enrollCurrentFace(name) {
  const status = document.getElementById("face-enroll-status");
  try {
    await ensureFaceApi();
    const video = await startCamera();
    const detection = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (!detection) {
      if (status) status.textContent = "Обличчя не знайдено. Подивись прямо в камеру.";
      return;
    }
    const res = await fetch("/faces/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        descriptor: Array.from(detection.descriptor),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "enroll failed");
    knownFaces = data.faces || [];
    if (status) status.textContent = `Збережено: ${name}`;
    const text = greetingText(name);
    setGreeting(text);
    lastGreetingName = name;
    await maybeSpeakGreeting(name, text);
  } catch (e) {
    if (status) status.textContent = `Помилка: ${e.message}`;
  }
}

document.getElementById("btn-face-enroll")?.addEventListener("click", async () => {
  const modalEl = document.getElementById("faceEnrollModal");
  if (!modalEl) return;
  await startCamera();
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
});

document.getElementById("face-enroll-save")?.addEventListener("click", async () => {
  const name = document.getElementById("face-name")?.value?.trim();
  if (!name) return;
  await enrollCurrentFace(name);
});

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (navigator.mediaDevices?.getUserMedia) {
      recognizeLoop();
    }
  }, 2500);
});
