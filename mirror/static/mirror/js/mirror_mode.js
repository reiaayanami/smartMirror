(function () {
  function setMirrorMode(on) {
    document.body.classList.toggle("mirror-mode", !!on);
    document.getElementById("btn-mirror")?.classList.toggle("active", !!on);
  }

  function toggleMirrorMode() {
    setMirrorMode(!document.body.classList.contains("mirror-mode"));
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btn-mirror")?.addEventListener("click", toggleMirrorMode);
  });

  window.MirrorUI = window.MirrorUI || {};
  window.MirrorUI.setMirrorMode = setMirrorMode;
  window.MirrorUI.toggleMirrorMode = toggleMirrorMode;
})();
