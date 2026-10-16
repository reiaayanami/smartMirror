async function loadBeautyTip() {
  try {
    const res = await fetch("/beauty-tip/");
    const data = await res.json();
    const el = document.getElementById("beauty-tip");
    if (el) el.textContent = `💡 ${data.tip}`;
  } catch (e) {
    console.error(e);
  }
}

document.addEventListener("DOMContentLoaded", loadBeautyTip);
setInterval(loadBeautyTip, 30 * 60 * 1000);
