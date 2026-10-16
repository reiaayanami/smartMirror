function updateClock() {
  const now = new Date();
  const time = now.toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const clock = document.getElementById("clock");
  if (clock) {
    clock.textContent = time.slice(0, 5);
  }
  const dateLine = document.getElementById("date-line");
  if (dateLine) {
    dateLine.textContent = now.toLocaleDateString("uk-UA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }
}
setInterval(updateClock, 1000);
updateClock();
