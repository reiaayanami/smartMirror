/**
 * Lightweight gesture layer for Pi camera:
 * - wave / hand near top = next tutorial
 * Uses face-api tiny detector landmarks as a cheap proxy when MediaPipe is heavy.
 * Also supports keyboard shortcuts for testing without camera.
 */

let gesturesOn = false;
let lastSwipeAt = 0;

function emitGesture(name) {
  const now = Date.now();
  if (now - lastSwipeAt < 1200) return;
  lastSwipeAt = now;
  document.dispatchEvent(new CustomEvent("mirror-gesture", { detail: name }));
  const status = document.getElementById("gesture-status");
  if (status) status.textContent = `Жест: ${name}`;
}

async function toggleGestures() {
  gesturesOn = !gesturesOn;
  const dock = document.querySelector(".camera-dock");
  const status = document.getElementById("gesture-status");
  if (!gesturesOn) {
    if (status) status.textContent = "Жести вимкнено";
    return;
  }
  try {
    const video = document.getElementById("mirror-cam");
    if (!video.srcObject) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
    }
    dock?.classList.add("active");
    if (status) status.textContent = "Жести увімкнено · махни рукою / ← →";
    startSimpleMotionGestures(video);
  } catch (e) {
    if (status) status.textContent = "Камера недоступна для жестів";
    gesturesOn = false;
  }
}

function startSimpleMotionGestures(video) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let prev = null;

  setInterval(() => {
    if (!gesturesOn || video.readyState < 2) return;
    canvas.width = 64;
    canvas.height = 48;
    ctx.drawImage(video, 0, 0, 64, 48);
    const frame = ctx.getImageData(0, 0, 64, 48).data;
    if (prev) {
      let left = 0;
      let right = 0;
      for (let y = 0; y < 48; y++) {
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4;
          const diff =
            Math.abs(frame[i] - prev[i]) +
            Math.abs(frame[i + 1] - prev[i + 1]) +
            Math.abs(frame[i + 2] - prev[i + 2]);
          if (diff > 80) {
            if (x < 32) left += 1;
            else right += 1;
          }
        }
      }
      if (right - left > 180) emitGesture("next");
      if (left - right > 180) emitGesture("prev");
    }
    prev = frame;
  }, 250);
}

async function setGestures(on) {
  if (on === gesturesOn) return;
  await toggleGestures();
}

document.getElementById("btn-gesture")?.addEventListener("click", toggleGestures);

document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") emitGesture("next");
  if (e.key === "ArrowLeft") emitGesture("prev");
});

window.MirrorUI = window.MirrorUI || {};
window.MirrorUI.toggleGestures = toggleGestures;
window.MirrorUI.setGestures = setGestures;
