(function () {
  let tutorials = [];
  let tutorialIndex = 0;

  function setTutorial(index) {
    if (!tutorials.length) return;
    tutorialIndex = (index + tutorials.length) % tutorials.length;
    const video = tutorials[tutorialIndex];
    const frame = document.getElementById("youtube-frame");
    const title = document.getElementById("tutorial-title");
    if (frame) {
      const params = new URLSearchParams({ rel: "0", enablejsapi: "1" });
      if (window.location.origin && window.location.origin !== "null") {
        params.set("origin", window.location.origin);
      }
      frame.src = `https://www.youtube.com/embed/${encodeURIComponent(video.id)}?${params}`;
    }
    if (title) {
      title.textContent = video.title || "Makeup tutorial";
    }
    document.querySelectorAll("#tutorial-list li").forEach((li, i) => {
      li.classList.toggle("active", i === tutorialIndex);
    });
  }

  async function loadTutorials() {
    try {
      const res = await fetch("/tutorials-feed/");
      const data = await res.json();
      tutorials = data.videos || [];
      const list = document.getElementById("tutorial-list");
      if (!list) return;
      list.innerHTML = "";
      tutorials.forEach((video, i) => {
        const li = document.createElement("li");
        li.textContent = video.title;
        li.addEventListener("click", () => setTutorial(i));
        list.appendChild(li);
      });
      setTutorial(0);
    } catch (e) {
      console.error("tutorials", e);
    }
  }

  document
    .getElementById("tutorial-prev")
    ?.addEventListener("click", () => setTutorial(tutorialIndex - 1));
  document
    .getElementById("tutorial-next")
    ?.addEventListener("click", () => setTutorial(tutorialIndex + 1));

  document.addEventListener("DOMContentLoaded", loadTutorials);
  document.addEventListener("mirror-gesture", (e) => {
    if (e.detail === "next") setTutorial(tutorialIndex + 1);
    if (e.detail === "prev") setTutorial(tutorialIndex - 1);
  });

  window.MirrorUI = window.MirrorUI || {};
  window.MirrorUI.nextTutorial = () => setTutorial(tutorialIndex + 1);
  window.MirrorUI.prevTutorial = () => setTutorial(tutorialIndex - 1);
  window.MirrorUI.ensureTutorial = () => {
    if (tutorials.length) setTutorial(tutorialIndex);
  };
  window.MirrorUI.setTutorial = setTutorial;
})();
