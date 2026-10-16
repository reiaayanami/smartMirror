const weatherMap = {
  0: { icon: "☀️", desc: "Ясно" },
  1: { icon: "🌤️", desc: "Майже ясно" },
  2: { icon: "⛅", desc: "Мінлива хмарність" },
  3: { icon: "☁️", desc: "Хмарно" },
  45: { icon: "🌫️", desc: "Туман" },
  48: { icon: "🌫️", desc: "Туман" },
  51: { icon: "🌦️", desc: "Мряка" },
  53: { icon: "🌦️", desc: "Мряка" },
  55: { icon: "🌧️", desc: "Мряка" },
  61: { icon: "🌧️", desc: "Дощ" },
  63: { icon: "🌧️", desc: "Сильний дощ" },
  71: { icon: "❄️", desc: "Сніг" },
  95: { icon: "⛈️", desc: "Гроза" },
  99: { icon: "⛈️", desc: "Гроза" },
};

async function loadWeather() {
  try {
    const res = await fetch("/weather/");
    const data = await res.json();
    const code = data.weather_code;
    const icon = weatherMap[code]?.icon || "✨";
    const temp = Math.round(data.temp);
    const feels = Math.round(data.feels_like);
    const unit = data.unit || "C";
    const city = data.city || "";
    const el = document.getElementById("weather");
    if (el) {
      el.textContent = `${icon} ${city} ${temp}°${unit} · відчувається як ${feels}°${unit}`;
    }
  } catch (e) {
    const el = document.getElementById("weather");
    if (el) el.textContent = "Погода недоступна";
  }
}

loadWeather();
setInterval(loadWeather, 10 * 60 * 1000);
