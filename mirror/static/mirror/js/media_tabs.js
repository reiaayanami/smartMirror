(function () {
  let soundCloudWidget = null;
  let soundCloudReady = false;
  let playWhenReady = false;
  let musicVolume = 65;
  let musicDucked = false;

  function showTab(name) {
    const tab = document.querySelector(`.panel-tabs .tab[data-tab="${name}"]`);
    if (!tab) return false;
    document
      .querySelectorAll(".panel-tabs .tab")
      .forEach((t) => t.classList.remove("active"));
    document
      .querySelectorAll(".tab-pane")
      .forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    const pane = document.getElementById(`tab-${name}`);
    if (pane) pane.classList.add("active");
    return true;
  }

  function getSoundCloudWidget() {
    const frame = document.getElementById("soundcloud-frame");
    if (!frame || !window.SC?.Widget) return null;
    if (!soundCloudWidget) {
      soundCloudWidget = window.SC.Widget(frame);
      soundCloudWidget.bind(window.SC.Widget.Events.READY, () => {
        soundCloudReady = true;
        soundCloudWidget.setVolume?.(
          musicDucked ? Math.min(musicVolume, 25) : musicVolume,
        );
        if (playWhenReady) {
          playWhenReady = false;
          soundCloudWidget.play();
        }
      });
    }
    return soundCloudWidget;
  }

  function enableEmbedAutoplay(frame) {
    try {
      const url = new URL(frame.src, window.location.href);
      if (url.searchParams.get("auto_play") === "true") return;
      url.searchParams.set("auto_play", "true");
      soundCloudWidget = null;
      soundCloudReady = false;
      frame.src = url.toString();
    } catch (error) {
      console.warn("Unable to enable SoundCloud autoplay", error);
    }
  }

  function playMusic() {
    const frame = document.getElementById("soundcloud-frame");
    if (!frame) return false;
    showTab("music");
    enableEmbedAutoplay(frame);
    const widget = getSoundCloudWidget();
    if (widget) {
      if (soundCloudReady) widget.play();
      else playWhenReady = true;
    }
    return true;
  }

  function pauseMusic() {
    const widget = getSoundCloudWidget();
    if (!widget) return false;
    widget.pause();
    return true;
  }

  function changeMusicVolume(direction) {
    musicVolume = Math.max(
      0,
      Math.min(100, musicVolume + (direction === "up" ? 10 : -10)),
    );
    if (soundCloudReady) soundCloudWidget.setVolume?.(musicVolume);
    return musicVolume;
  }

  function duckMusic() {
    if (!soundCloudReady || musicDucked) return;
    musicDucked = true;
    soundCloudWidget.setVolume?.(Math.min(musicVolume, 25));
  }

  function restoreMusicVolume() {
    if (!soundCloudReady || !musicDucked) return;
    musicDucked = false;
    soundCloudWidget.setVolume?.(musicVolume);
  }

  document.querySelectorAll(".panel-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => showTab(tab.dataset.tab));
  });

  window.MirrorUI = window.MirrorUI || {};
  window.MirrorUI.showTab = showTab;
  window.MirrorUI.playMusic = playMusic;
  window.MirrorUI.pauseMusic = pauseMusic;
  window.MirrorUI.changeMusicVolume = changeMusicVolume;
  window.MirrorUI.duckMusic = duckMusic;
  window.MirrorUI.restoreMusicVolume = restoreMusicVolume;
})();
