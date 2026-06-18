// 🗺 карта
const map = L.map('map').setView([49.5883, 34.5514], 10);

const POLTAVA_CENTER = {
  lat: 49.5883,
  lng: 34.5514
};

const POLTAVA_BOUNDARY_URL =
  "https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=1&countrycodes=ua&q=%D0%9F%D0%BE%D0%BB%D1%82%D0%B0%D0%B2%D1%81%D1%8C%D0%BA%D0%B0%20%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C,%20%D0%A3%D0%BA%D1%80%D0%B0%D1%97%D0%BD%D0%B0";

const MANUAL_PLACES = [
  {
    name: "Лукищина",
    aliases: ["Лукищено", "Лукищена"],
    community: "біля Головача",
    placeType: "village",
    lat: 49.4886,
    lng: 34.5886
  },
  {
    name: "Коломацьке",
    aliases: ["Коломацьке дачі", "Коломацькому", "Коломацькі дачі"],
    community: "Коломацька громада",
    placeType: "village",
    lat: 49.6111,
    lng: 34.7689
  }
];

let poltavaBoundaryLayer = null;

// 🌍 базові шари
const osm = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {
    maxZoom: 19,
    attribution: 'OpenStreetMap'
  }
);

const googleHybrid = L.tileLayer(
  'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  {
    maxZoom: 20,
    attribution: 'Google Hybrid'
  }
);

// 🗺 стартовий шар
osm.addTo(map);

const baseLayers = {
  "🗺 OpenStreetMap": osm,
  "🛰 Google Hybrid": googleHybrid
};

let activeLayer = osm;

// створюємо UI
function initLayerControl() {
  const container = document.getElementById("layerControl");

  Object.keys(baseLayers).forEach(name => {
    const div = document.createElement("div");
    div.className = "layer-item";
    div.textContent = name;

    div.onclick = () => switchLayer(name, div);

    container.appendChild(div);
  });

  // активний стиль по дефолту
  const first = container.querySelector(".layer-item");
if (first) first.classList.add("layer-active");
map.addLayer(osm);
activeLayer = osm;
}

function switchLayer(name, el) {
  if (map.hasLayer(activeLayer)) {
    map.removeLayer(activeLayer);
  }

  activeLayer = baseLayers[name];
  map.addLayer(activeLayer);

  document.querySelectorAll("#layerControl .layer-item")
    .forEach(x => x.classList.remove("layer-active"));

  el.classList.add("layer-active");
}

async function loadPoltavaBoundary() {
  try {
    const res = await fetch(POLTAVA_BOUNDARY_URL);
    if (!res.ok) {
      throw new Error(`Boundary load failed: ${res.status}`);
    }

    const data = await res.json();

    if (poltavaBoundaryLayer) {
      map.removeLayer(poltavaBoundaryLayer);
    }

    poltavaBoundaryLayer = L.geoJSON(data, {
      style: {
        color: "#2d89ef",
        weight: 3,
        opacity: 0.95,
        fillOpacity: 0
      },
      interactive: false
    }).addTo(map);

    poltavaBoundaryLayer.bringToFront();
  } catch (e) {
    console.log("Poltava boundary error:", e);
  }
}


// 📦 база
let boreholes = [];
let currentLatLng = null;
let selectedMarker = null;
let selectedId = null;
let searchMarkers = [];
let activeSearchMarker = null;
let placeSearchTimer = null;
let placeSearchRequestId = 0;
let placesReady = false;
let lastWeatherPoint = {
  lat: POLTAVA_CENTER.lat,
  lng: POLTAVA_CENTER.lng,
  label: "Полтава"
};
let lastWeatherData = null;
let lastWeatherDayIndex = 0;
let isAdmin = false;
let accessClosed = false;
let userLocationMarker = null;
let activeYearFilter = "all";
const boreholeMarkers = new Map();
const LOCAL_BOREHOLES_KEY = "boreholes-app:boreholes";
const CITY_SETTLEMENTS = new Set([
  "полтава",
  "кременчук",
  "горішні плавні",
  "лубни",
  "миргород",
  "гадяч",
  "глобине",
  "гребінка",
  "заводське",
  "зіньків",
  "карлівка",
  "кобеляки",
  "лохвиця",
  "пирятин",
  "решетилівка",
  "хорол"
]);
const URBAN_SETTLEMENTS = new Set([
  "велика багачка",
  "градизьк",
  "диканька",
  "козельщина",
  "котельва",
  "машівка",
  "нові санжари",
  "опішня",
  "оржиця",
  "семенівка",
  "чорнухи",
  "чутове",
  "шишаки"
]);

const boreholeIcon = L.divIcon({
  className: "borehole-marker",
  html: `
    <span class="borehole-pin">
      <span class="borehole-pin-core"></span>
    </span>
  `,
  iconSize: [28, 36],
  iconAnchor: [14, 34],
  popupAnchor: [0, -32]
});

const tempBoreholeIcon = L.divIcon({
  className: "temp-borehole-marker",
  html: `
    <span class="temp-borehole-pulse"></span>
    <span class="temp-borehole-dot"></span>
  `,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  popupAnchor: [0, -15]
});

function getBoreholeMarkerId(data) {
  return String(data?.id || `${data?.lat || ""}_${data?.lng || ""}_${data?.num || ""}`);
}

function getBoreholeYear(data) {
  const match = String(data?.num || "").match(/\/\s*((?:19|20)\d{2})\b/);
  return match ? match[1] : "";
}

function getBoreholeDuplicateKey(data) {
  const lat = Number(data?.lat);
  const lng = Number(data?.lng);
  const num = normalizePlaceText(data?.num || "");

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const coordKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    return num ? `${num}|${coordKey}` : coordKey;
  }

  return num ? `num:${num}` : String(data?.id || "");
}

function getBoreholeCompleteness(data) {
  return [
    data?.num,
    data?.depth,
    data?.water,
    data?.soil,
    data?.note,
    data?.elevation,
    data?.distance,
    data?.placeName,
    data?.community,
    data?.placeLabel
  ].filter(value => String(value ?? "").trim()).length;
}

function isFirebaseBoreholeId(id) {
  return id && !String(id).startsWith("local-");
}

function mergeBoreholeRecords(existing, incoming) {
  if (!existing) return { ...incoming };

  const existingScore = getBoreholeCompleteness(existing);
  const incomingScore = getBoreholeCompleteness(incoming);
  const base = incomingScore >= existingScore ? incoming : existing;
  const extra = base === incoming ? existing : incoming;

  const merged = { ...extra, ...base };

  Object.keys(extra || {}).forEach(key => {
    const currentValue = merged[key];
    const extraValue = extra[key];
    if ((currentValue === undefined || currentValue === null || currentValue === "") && extraValue !== undefined) {
      merged[key] = extraValue;
    }
  });

  if (isFirebaseBoreholeId(existing.id)) merged.id = existing.id;
  if (isFirebaseBoreholeId(incoming.id)) merged.id = incoming.id;

  return merged;
}

function dedupeBoreholes(items) {
  const byKey = new Map();

  items.forEach(item => {
    const key = getBoreholeDuplicateKey(item);
    byKey.set(key, mergeBoreholeRecords(byKey.get(key), item));
  });

  return Array.from(byKey.values());
}

function normalizeBoreholePlaceDisplay(data) {
  if (needsManualPlaceName(data)) {
    data.placeName = "";
    data.placeLabel = "";
    return data;
  }

  const visibleLabel = getVisiblePlaceLabel(data);

  if (visibleLabel) {
    data.placeLabel = visibleLabel;
  }

  return data;
}

function getBoreholesByYear(year = activeYearFilter) {
  return boreholes.filter(item => year === "all" || getBoreholeYear(item) === year);
}

function shouldShowBorehole(data) {
  return activeYearFilter === "all" || getBoreholeYear(data) === activeYearFilter;
}

function clearBoreholeMarkers() {
  boreholeMarkers.forEach(({ marker }) => {
    if (map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });
  boreholeMarkers.clear();
}

function applyYearFilter() {
  boreholeMarkers.forEach(({ marker, data }) => {
    const visible = shouldShowBorehole(data);

    if (visible && !map.hasLayer(marker)) {
      marker.addTo(map);
    }

    if (!visible && map.hasLayer(marker)) {
      map.removeLayer(marker);
    }
  });

  updateYearFilterCount();
}

function updateYearFilterCount() {
  const countEl = document.getElementById("yearFilterCount");
  if (!countEl) return;

  const count = getBoreholesByYear().length;
  countEl.textContent = `${count} ${count === 1 ? "свердловина" : "свердловин"}`;
}

function refreshYearFilterOptions() {
  const select = document.getElementById("yearFilter");
  if (!select) return;

  const current = activeYearFilter;
  const years = Array.from(new Set(boreholes.map(getBoreholeYear).filter(Boolean)))
    .sort((a, b) => Number(b) - Number(a));

  select.innerHTML = '<option value="all">Всі роки</option>';

  years.forEach(year => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    select.appendChild(option);
  });

  activeYearFilter = current !== "all" && years.includes(current) ? current : "all";
  select.value = activeYearFilter;
  updateYearFilterCount();
}

function setYearFilter(year) {
  activeYearFilter = year || "all";
  applyYearFilter();
}

function removeTempPoint() {
  if (!window.tempMarker) return;

  const marker = window.tempMarker;
  window.tempMarker = null;

  if (map.hasLayer(marker)) {
    map.removeLayer(marker);
  }

  currentLatLng = null;
  selectedId = null;
  selectedMarker = null;
  clearForm();
  closePanel();
}

function bindTempMarkerClose(marker) {
  marker.on("popupopen", function (e) {
    const popupEl = e.popup && e.popup.getElement ? e.popup.getElement() : null;
    const closeBtn = popupEl ? popupEl.querySelector(".leaflet-popup-close-button") : null;

    if (!closeBtn) return;

    closeBtn.addEventListener("click", function () {
      if (window.tempMarker === marker) {
        removeTempPoint();
      }
    }, { once: true });
  });
}

function weatherText(code) {
  const codes = {
    0: "Ясно",
    1: "Переважно ясно",
    2: "Мінлива хмарність",
    3: "Хмарно",
    45: "Туман",
    48: "Паморозь",
    51: "Мала мряка",
    53: "Мряка",
    55: "Сильна мряка",
    61: "Невеликий дощ",
    63: "Дощ",
    65: "Сильний дощ",
    71: "Невеликий сніг",
    73: "Сніг",
    75: "Сильний сніг",
    80: "Короткий дощ",
    81: "Зливи",
    82: "Сильні зливи",
    95: "Гроза"
  };
  return codes[Number(code)] || "Поточна погода";
}

function weatherIcon(code) {
  const value = Number(code);
  if ([0, 1].includes(value)) return "☀";
  if ([2].includes(value)) return "⛅";
  if ([3, 45, 48].includes(value)) return "☁";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(value)) return "☔";
  if ([71, 73, 75].includes(value)) return "❄";
  if ([95].includes(value)) return "⚡";
  return "☁";
}

function weatherSeverity(code) {
  const value = Number(code);
  if ([95].includes(value)) return 6;
  if ([65, 75, 82].includes(value)) return 5;
  if ([61, 63, 71, 73, 80, 81].includes(value)) return 4;
  if ([51, 53, 55].includes(value)) return 3;
  if ([3, 45, 48].includes(value)) return 2;
  if ([2].includes(value)) return 1;
  return 0;
}

function formatWeatherDate(date, index) {
  if (index === 0) return "Сьогодні";
  if (index === 1) return "Завтра";

  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("uk-UA", {
    day: "2-digit",
    month: "2-digit"
  });
}

function shortWeatherDate(date, index) {
  if (index === 0) return "Сьог";
  if (index === 1) return "Зав";
  return formatWeatherDate(date, index);
}

function setWeatherLoading(label) {
  const place = document.getElementById("weatherPlace");
  const desc = document.getElementById("weatherDesc");
  if (place) place.textContent = "Зараз";
  if (desc) desc.textContent = "Оновлюю...";
}

function setWeatherEmpty(message) {
  const temp = document.getElementById("weatherTemp");
  const icon = document.getElementById("weatherIcon");
  const desc = document.getElementById("weatherDesc");
  const wind = document.getElementById("weatherWind");
  const humidity = document.getElementById("weatherHumidity");
  const rain = document.getElementById("weatherRain");

  if (temp) temp.textContent = "--°";
  if (icon) icon.textContent = "☁";
  if (desc) desc.textContent = message || "Погода недоступна";
  if (wind) wind.textContent = "-";
  if (humidity) humidity.textContent = "-";
  if (rain) rain.textContent = "-";
}

function populateWeatherDates(data) {
  const select = document.getElementById("weatherDate");
  const pills = document.getElementById("weatherDatePills");
  const dates = data?.daily?.time || [];
  if (!dates.length) return;

  if (select) select.innerHTML = "";
  if (pills) pills.innerHTML = "";
  dates.forEach((date, index) => {
    if (select) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = formatWeatherDate(date, index);
      select.appendChild(option);
    }

    if (pills) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "weather-date-pill";
      button.textContent = shortWeatherDate(date, index);
      button.addEventListener("click", () => changeWeatherDate(index));
      pills.appendChild(button);
    }
  });

  if (lastWeatherDayIndex >= dates.length) {
    lastWeatherDayIndex = 0;
  }
  if (select) select.value = String(lastWeatherDayIndex);
}

function getHourlyIndexesForBlock(date, startHour, endHour) {
  const times = lastWeatherData?.hourly?.time || [];
  return times
    .map((time, index) => ({ time, index }))
    .filter(item => {
      const time = item.time;
    if (!String(time).startsWith(date)) return false;
    const hour = Number(String(time).slice(11, 13));
    return hour >= startHour && hour < endHour;
    })
    .map(item => item.index);
}

function pickHourlyIndex(indexes, hourly) {
  return indexes
    .slice()
    .sort((a, b) => {
      const chanceDiff = (hourly.precipitation_probability?.[b] || 0) -
        (hourly.precipitation_probability?.[a] || 0);
      if (chanceDiff) return chanceDiff;

      return weatherSeverity(hourly.weather_code?.[b]) -
        weatherSeverity(hourly.weather_code?.[a]);
    })[0];
}

function renderWeatherHours(dayIndex) {
  const box = document.getElementById("weatherHourly");
  const dailyDate = lastWeatherData?.daily?.time?.[dayIndex];
  const hourly = lastWeatherData?.hourly || {};
  if (!box || !dailyDate || !hourly.time?.length) return;

  const blocks = [
    { start: 6, end: 9 },
    { start: 9, end: 12 },
    { start: 12, end: 16 },
    { start: 16, end: 20 }
  ];

  box.innerHTML = "";

  blocks.forEach(block => {
    const hourlyIndexes = getHourlyIndexesForBlock(dailyDate, block.start, block.end);
    const hourlyIndex = pickHourlyIndex(hourlyIndexes, hourly);
    if (!Number.isFinite(hourlyIndex)) return;

    const code = hourly.weather_code?.[hourlyIndex];
    const temp = hourly.temperature_2m?.[hourlyIndex];
    const chance = hourly.precipitation_probability?.[hourlyIndex];
    const item = document.createElement("div");
    item.className = "weather-hour";

    item.innerHTML = `
      <span>${String(block.start).padStart(2, "0")}:00-${String(block.end).padStart(2, "0")}:00</span>
      <b>${weatherIcon(code)} ${weatherText(code)}</b>
      <em>${Number.isFinite(temp) ? `${Math.round(temp)}°` : ""}${Number.isFinite(chance) ? ` · ${chance}%` : ""}</em>
    `;
    box.appendChild(item);
  });
}

function renderWeatherDay() {
  if (!lastWeatherData) return;

  const current = lastWeatherData.current || {};
  const daily = lastWeatherData.daily || {};
  const index = lastWeatherDayIndex;

  const tempEl = document.getElementById("weatherTemp");
  const iconEl = document.getElementById("weatherIcon");
  const descEl = document.getElementById("weatherDesc");
  const windEl = document.getElementById("weatherWind");
  const humidityEl = document.getElementById("weatherHumidity");
  const rainEl = document.getElementById("weatherRain");

  const code = index === 0 ? current.weather_code : daily.weather_code?.[index];
  const select = document.getElementById("weatherDate");

  if (select) select.value = String(index);
  document.querySelectorAll(".weather-date-pill").forEach((button, buttonIndex) => {
    button.classList.toggle("active", buttonIndex === index);
  });

  if (index === 0) {
    if (tempEl) {
      tempEl.textContent = Number.isFinite(current.temperature_2m)
        ? `${Math.round(current.temperature_2m)}°`
        : "--°";
    }
    if (humidityEl) {
      humidityEl.textContent = Number.isFinite(current.relative_humidity_2m)
        ? `${Math.round(current.relative_humidity_2m)}%`
        : "-";
    }
    if (rainEl) {
      rainEl.textContent = Number.isFinite(current.precipitation)
        ? `${current.precipitation} мм`
        : "-";
    }
    if (windEl) {
      windEl.textContent = Number.isFinite(current.wind_speed_10m)
        ? `${Math.round(current.wind_speed_10m)} км/год`
        : "-";
    }
  } else {
    const max = daily.temperature_2m_max?.[index];
    const min = daily.temperature_2m_min?.[index];

    if (tempEl) {
      tempEl.textContent = Number.isFinite(max) && Number.isFinite(min)
        ? `${Math.round(max)}/${Math.round(min)}°`
        : "--°";
    }
    if (humidityEl) humidityEl.textContent = "прогноз";
    if (rainEl) {
      const rain = daily.precipitation_sum?.[index];
      rainEl.textContent = Number.isFinite(rain) ? `${rain} мм` : "-";
    }
    if (windEl) {
      const wind = daily.wind_speed_10m_max?.[index];
      windEl.textContent = Number.isFinite(wind) ? `${Math.round(wind)} км/год` : "-";
    }
  }

  if (iconEl) iconEl.textContent = weatherIcon(code);
  if (descEl) descEl.textContent = weatherText(code);
  renderWeatherHours(index);
}

async function loadWeather(lat = POLTAVA_CENTER.lat, lng = POLTAVA_CENTER.lng, label = "Полтава", keepDate = false) {
  lastWeatherPoint = { lat, lng, label };
  if (!keepDate) {
    lastWeatherDayIndex = 0;
  }
  setWeatherLoading(label);

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code");
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max");
    url.searchParams.set("hourly", "weather_code,temperature_2m,precipitation_probability");
    url.searchParams.set("past_hours", "24");
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Weather failed: ${res.status}`);

    lastWeatherData = await res.json();
    populateWeatherDates(lastWeatherData);
    renderWeatherDay();
  } catch (e) {
    console.log("Weather error:", e);
    setWeatherEmpty("Погода недоступна");
  }
}

function changeWeatherDate(value) {
  lastWeatherDayIndex = Number(value) || 0;
  renderWeatherDay();
}

function refreshWeather() {
  loadWeather(lastWeatherPoint.lat, lastWeatherPoint.lng, lastWeatherPoint.label, true);
}

async function refreshMap() {
  const nextZoom = Math.min(map.getZoom() + 1, map.getMaxZoom() || 20);
  map.setZoom(nextZoom);
  map.invalidateSize();
  await loadPoltavaBoundary();
  await loadBoreholes();
  refreshWeather();
}

function locateUser() {
  if (!navigator.geolocation) {
    alert("Геолокація не підтримується цим браузером");
    return;
  }

  logAppEvent("locate_user");

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
      }

      userLocationMarker = L.circleMarker([lat, lng], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#2d89ef",
        fillOpacity: 1
      }).addTo(map).bindPopup("Моє місце");

      map.setView([lat, lng], 15);
      userLocationMarker.openPopup();
    },
    error => {
      console.log("Geolocation error:", error);
      alert("Не вдалося отримати місцезнаходження. Перевір дозвіл у браузері");
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}

function registerPWA() {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.register("./service-worker.js")
    .then(registration => {
      registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
    })
    .catch(error => console.log("Service worker error:", error));

  let refreshedByServiceWorker = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshedByServiceWorker) return;
    refreshedByServiceWorker = true;
    window.location.reload();
  });
}

function logAppEvent(name, params = {}) {
  if (!window.firebaseAnalytics || !window.firebaseLogEvent) return;

  try {
    window.firebaseLogEvent(window.firebaseAnalytics, name, params);
  } catch (error) {
    console.log("Analytics event error:", error);
  }
}

function setPanelSectionCollapsed(id, trigger, collapsed) {
  const panel = document.getElementById(id);
  if (!panel) return;

  panel.classList.toggle("collapsed", collapsed);

  if (trigger) {
    trigger.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
}

function togglePanelSection(id, trigger) {
  const panel = document.getElementById(id);
  if (!panel) return;

  setPanelSectionCollapsed(id, trigger, !panel.classList.contains("collapsed"));
}

function initMobileCollapsibleSections() {
  if (!window.matchMedia("(max-width: 768px)").matches) return;

  setPanelSectionCollapsed(
    "calculatorPanel",
    document.querySelector("[onclick*='calculatorPanel']"),
    true
  );
  setPanelSectionCollapsed(
    "weatherBox",
    document.querySelector("[onclick*='weatherBox']"),
    true
  );
}

function isFirebaseReady() {
  return Boolean(
    window.firebaseReady &&
    window.db &&
    window.firebaseAddDoc &&
    window.firebaseCollection &&
    window.firebaseGetDocs &&
    window.firebaseUpdateDoc &&
    window.firebaseDeleteDoc &&
    window.firebaseDoc
  );
}

function canEdit() {
  return isAdmin;
}

function requireAdmin() {
  if (canEdit()) return true;
  alert("Редагування доступне тільки адміну");
  return false;
}

function setAdminUI(user) {
  isAdmin = Boolean(user);

  const status = document.getElementById("authStatus");
  if (status) {
    status.textContent = isAdmin ? "Адмін" : "Гостьовий перегляд";
  }

  document.body.classList.toggle("admin-mode", isAdmin);
  document.body.classList.toggle("guest-mode", !isAdmin);
  updateAccessOverlay();

  if (isAdmin) {
    loadBoreholes();
  }
}

function updateAccessOverlay() {
  const overlay = document.getElementById("accessOverlay");
  if (!overlay) return;
  overlay.classList.toggle("hidden", !accessClosed || isAdmin);
}

async function adminLogin() {
  if (!window.firebaseAuth || !window.firebaseSignInWithEmailAndPassword) {
    alert("Firebase Auth ще не підключений");
    return;
  }

  const email = document.getElementById("adminEmail")?.value.trim();
  const password = document.getElementById("adminPassword")?.value;

  if (!email || !password) {
    alert("Введи email і пароль адміна");
    return;
  }

  try {
    await firebaseSignInWithEmailAndPassword(firebaseAuth, email, password);
    document.getElementById("adminPassword").value = "";
  } catch (e) {
    console.log("Admin login error:", e);
    alert("Не вийшло увійти. Перевір email і пароль");
  }
}

async function adminLogout() {
  if (!window.firebaseAuth || !window.firebaseSignOut) return;
  await firebaseSignOut(firebaseAuth);
}

function initAdminAuth() {
  if (!window.firebaseAuth || !window.firebaseOnAuthStateChanged) {
    setAdminUI(null);
    return;
  }

  firebaseOnAuthStateChanged(firebaseAuth, user => {
    setAdminUI(user);
    checkAppAccess();
  });
}

async function checkAppAccess() {
  if (!isFirebaseReady() || !window.firebaseGetDoc) {
    updateAccessOverlay();
    return;
  }

  try {
    const snap = await firebaseGetDoc(firebaseDoc(db, "settings", "app"));
    accessClosed = snap.exists() && snap.data().appOpen === false;
  } catch (e) {
    console.log("Access settings error:", e);
  }

  updateAccessOverlay();
}

function createLocalId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLocalBoreholes() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_BOREHOLES_KEY) || "[]");
  } catch (e) {
    console.log("Local storage load error:", e);
    return [];
  }
}

function saveLocalBoreholes() {
  localStorage.setItem(LOCAL_BOREHOLES_KEY, JSON.stringify(boreholes));
}

function upsertBoreholeLocal(data) {
  normalizeBoreholePlaceDisplay(data);
  const incomingKey = getBoreholeDuplicateKey(data);
  const index = boreholes.findIndex(b =>
    b.id === data.id || getBoreholeDuplicateKey(b) === incomingKey
  );

  if (index >= 0) {
    boreholes[index] = mergeBoreholeRecords(boreholes[index], data);
  } else {
    boreholes.push(data);
  }

  boreholes = dedupeBoreholes(boreholes).map(normalizeBoreholePlaceDisplay);
  saveLocalBoreholes();
}

function hasFirebaseId(id) {
  return id && !String(id).startsWith("local-");
}

function getNumberFromText(value) {
  const match = String(value ?? "")
    .replace(",", ".")
    .match(/-?\d+(\.\d+)?/);

  return match ? Number(match[0]) : 0;
}

function formatDecimalComma(value, digits = 2) {
  const number = typeof value === "number" ? value : getNumberFromText(value);
  if (!Number.isFinite(number)) return "";
  return number.toFixed(digits).replace(".", ",");
}

function getExcelNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const number = getNumberFromText(value);
  return Number.isFinite(number) ? number : "";
}

function getFieldNumber(id) {
  const el = document.getElementById(id);
  return getNumberFromText(el ? el.value : "");
}

function formatDistanceField(value) {
  const number = getNumberFromText(value);
  return value === "" || value === null || value === undefined
    ? ""
    : `${formatDecimalComma(number, 2)} км, відстань від Полтави`;
}

function formatElevationField(value) {
  const number = getNumberFromText(value);
  return value === "" || value === null || value === undefined
    ? ""
    : `${Math.round(number)} м від рівня моря`;
}

function setDistanceUI(value) {
  const el = document.getElementById("distance");
  if (!el) return;
  el.value = formatDistanceField(value);
  setTransportByDistance(value);
}

function setElevationUI(value) {
  const el = document.getElementById("elevation");
  if (!el) return;
  el.value = formatElevationField(value);
}

function getTransportCostByDistance(distanceKm) {
  const roundTripKm = getNumberFromText(distanceKm) * 2;
  if (!roundTripKm) return 0;
  if (roundTripKm <= 50) return 2000;
  if (roundTripKm <= 75) return 2500;
  return 3000;
}

function setTransportByDistance(distanceKm) {
  const el = document.getElementById("transportCost");
  if (!el) return;

  const cost = getTransportCostByDistance(distanceKm);
  el.value = cost ? String(cost) : "";
  calculateCost();
}

function setDefaultCostValues() {
  const filter = document.getElementById("filterCost");
  if (filter && !filter.value) {
    filter.value = "600";
  }
}

function resetEstimateDepth() {
  const depth = document.getElementById("estDepth");
  if (depth) {
    depth.value = "";
  }
  calculateCost();
}

function getPlaceKey(place) {
  if (!place) return "";

  return [
    place.placeName || place.name || "",
    place.community || ""
  ].map(normalizePlaceText).join("|");
}

function hasSettlementPrefix(value) {
  return /^(м\.|с\.|с-ще|смт\.?)\s+/i.test(String(value || "").trim());
}

function stripSettlementPrefix(value) {
  return String(value || "")
    .trim()
    .replace(/^(м\.|с\.|с-ще|смт\.?)\s+/i, "")
    .trim();
}

function getMainPlaceText(value) {
  const mainText = String(value || "")
    .split("—")[0]
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

  return stripSettlementPrefix(mainText);
}

function isCommunityOnlyName(value) {
  const text = normalizePlaceText(getMainPlaceText(value));
  if (!text) return false;

  return text.includes("громад") ||
    /\b(сільська|селищна|міська)\b/.test(text);
}

function needsManualPlaceName(place) {
  if (place?.manualPlaceRequired) return true;

  return isCommunityOnlyName(place?.placeName || place?.name || "") ||
    isCommunityOnlyName(place?.placeLabel || place?.label || "");
}

function getSettlementKind(place, nameValue) {
  const rawType = normalizePlaceText(place?.placeType || place?.type || "");
  const name = normalizePlaceText(stripSettlementPrefix(nameValue || place?.placeName || place?.name || ""));

  if (needsManualPlaceName({ ...place, placeName: nameValue || place?.placeName || place?.name || "" })) return "";
  if (rawType === "city" || rawType === "town" || CITY_SETTLEMENTS.has(name)) return "city";
  if (rawType === "suburb" || rawType === "neighbourhood" || rawType === "neighborhood") return "";
  if (rawType === "village" || rawType === "hamlet") return "village";
  if (rawType === "settlement" || rawType === "locality" || URBAN_SETTLEMENTS.has(name)) {
    return "urban";
  }

  return name ? "village" : "";
}

function formatSettlementName(place, nameValue) {
  const name = String(nameValue || place?.placeName || place?.name || "").trim();
  if (!name || hasSettlementPrefix(name)) return name;

  const kind = getSettlementKind(place, name);
  if (kind === "city") return `м. ${name}`;
  if (kind === "urban") return `с-ще ${name}`;
  if (kind === "village") return `с. ${name}`;
  return name;
}

function formatPlaceLabelWithPrefix(place) {
  const rawLabel = String(place?.placeLabel || place?.label || "").trim();
  const rawName = String(place?.placeName || place?.name || "").trim();
  const source = rawLabel || rawName;
  if (!source) return "";

  const parts = source.split("—").map(part => part.trim()).filter(Boolean);
  const namePart = parts[0] || rawName;
  const formattedName = formatSettlementName(place, namePart);

  return parts.length > 1
    ? `${formattedName} (${parts.slice(1).join(", ")})`
    : formattedName;
}

function normalizeManualPlaceLabel(place, rawLabel) {
  const label = String(rawLabel || "").trim();
  if (!label) return "";

  const placeWithLabel = {
    ...place,
    label,
    placeLabel: label
  };
  const baseIsPoltava = isPoltavaCityPlace(placeWithLabel);

  if (!baseIsPoltava) return label;
  if (normalizePlaceText(label).includes("полтава")) return label;

  const district = label.replace(/[()]/g, "").trim();
  return district ? `м. Полтава (${district})` : "м. Полтава";
}

function getPoltavaDistrictFromLabel(value) {
  const label = String(value || "").trim();
  const match = label.match(/(?:м\.\s*)?полтава\s*\(([^)]+)\)/i);
  return match ? match[1].trim() : "";
}

function getPlaceFromForm() {
  const rawPlaceName = document.getElementById("placeName")?.value || "";
  const rawLabel = document.getElementById("placeLabel")?.value || "";
  const place = {
    name: rawPlaceName,
    placeName: rawPlaceName,
    community: document.getElementById("community")?.value || "",
    district: document.getElementById("district")?.value || "",
    label: rawLabel
  };
  const label = normalizeManualPlaceLabel(place, rawLabel);
  const isPoltava = isPoltavaCityPlace({
    ...place,
    label,
    placeLabel: label
  });
  const manualDistrict = isPoltava ? getPoltavaDistrictFromLabel(label) : "";

  return {
    ...place,
    name: rawPlaceName || (isPoltava ? "Полтава" : ""),
    placeName: rawPlaceName || (isPoltava ? "Полтава" : ""),
    district: manualDistrict || place.district,
    label
  };
}

function setPlaceUI(place) {
  const safePlace = place || {};
  const manualRequired = needsManualPlaceName(safePlace);
  const name = manualRequired ? "" : safePlace.placeName || safePlace.name || "";
  const community = safePlace.community || "";
  const district = safePlace.district || "";
  const label = manualRequired
    ? ""
    : getVisiblePlaceLabel({
      ...safePlace,
      name,
      placeName: name,
      community,
      district
    }) || safePlace.label || getPlaceLabel({ name, community, district, placeType: safePlace.placeType });

  const placeLabel = document.getElementById("placeLabel");
  const placeName = document.getElementById("placeName");
  const communityInput = document.getElementById("community");
  const districtInput = document.getElementById("district");

  if (placeLabel) {
    const editablePlace = {
      ...safePlace,
      name,
      placeName: name,
      community,
      district,
      label,
      placeLabel: label
    };
    const canEditPlaceLabel = manualRequired || (Boolean(label) && isPoltavaCityPlace(editablePlace));

    placeLabel.value = label || "";
    placeLabel.readOnly = !canEditPlaceLabel;
    placeLabel.classList.toggle("manual-place-label", canEditPlaceLabel);
    placeLabel.title = canEditPlaceLabel
      ? (manualRequired
        ? "Впиши населений пункт вручну, наприклад: с. Новоселівка (дачі)"
        : "Можна вручну дописати район: м. Полтава (Лісок)")
      : "";
  }
  if (placeName) placeName.value = name || "";
  if (communityInput) communityInput.value = community || "";
  if (districtInput) districtInput.value = district || "";
}

function clearPlaceUI() {
  setPlaceUI(null);
}

function average(values) {
  const nums = values.map(getNumberFromText).filter(value => value > 0);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function rangeText(values) {
  const nums = values.map(getNumberFromText).filter(value => value > 0);
  if (!nums.length) return "-";

  const min = Math.min(...nums);
  const max = Math.max(...nums);

  return min === max
    ? `${formatDecimalComma(min, 1)} м`
    : `${formatDecimalComma(min, 1)}-${formatDecimalComma(max, 1)} м`;
}

function mostCommon(values) {
  const counts = {};
  values
    .map(value => String(value || "").trim())
    .filter(Boolean)
    .forEach(value => {
      counts[value] = (counts[value] || 0) + 1;
    });

  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || "-";
}

function getAreaStatsItems(place) {
  const lat = Number(place?.lat);
  const lng = Number(place?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const radiusKm = 1;

  return boreholes.filter(item => {
    const itemLat = Number(item.lat);
    const itemLng = Number(item.lng);
    if (!Number.isFinite(itemLat) || !Number.isFinite(itemLng)) return false;

    return distanceKm(lat, lng, itemLat, itemLng) <= radiusKm;
  });
}

function getAreaStats(place) {
  const items = getAreaStatsItems(place);
  if (!items.length) return { count: 0 };

  return {
    count: items.length,
    depthRange: rangeText(items.map(item => item.depth)),
    waterRange: rangeText(items.map(item => item.water)),
    soil: mostCommon(items.map(item => item.soil))
  };
}

function getAreaStatsLabel(place) {
  if (needsManualPlaceName(place)) return "Обрана точка";

  const poltavaLabel = getPoltavaCityDisplayLabel(place);
  if (poltavaLabel) return poltavaLabel;

  const name = String(place?.placeName || place?.name || "").trim();
  const label = String(place?.label || "").trim();
  const lowerName = name.toLowerCase();
  const source = `${name} ${label}`.toLowerCase();

  if (lowerName.includes("полтава")) return "м. Полтава";

  if (name && (/^м\./i.test(name) || source.includes("місто") || source.includes("city") || source.includes("town"))) {
    return /^м\./i.test(name) ? name : `м. ${name}`;
  }

  return getStatsPlaceLabel({
    name,
    community: place?.community || ""
  }) || "Обрана точка";
}

function renderPlaceStats(place) {
  const stats = getAreaStats(place);
  const label = getAreaStatsLabel(place);

  const placeEl = document.querySelector(".stats-place");
  const countEl = document.getElementById("statsCount");
  const depthEl = document.getElementById("statsDepth");
  const waterEl = document.getElementById("statsWater");
  const soilEl = document.getElementById("statsSoil");

  if (depthEl?.previousElementSibling) depthEl.previousElementSibling.textContent = "Глибина від-до";
  if (waterEl?.previousElementSibling) waterEl.previousElementSibling.textContent = "Рівень 1-ї води";

  if (placeEl) placeEl.textContent = place ? label : "Вибери свердловину або населений пункт";
  if (countEl) countEl.textContent = stats ? String(stats.count) : "0";
  if (depthEl) depthEl.textContent = stats?.depthRange || "-";
  if (waterEl) waterEl.textContent = stats?.waterRange || "-";
  if (soilEl) soilEl.textContent = stats?.soil || "-";
}

boreholes.forEach(addMarker);
// 📍 клік по карті
map.on('click', async function(e) {
  currentLatLng = e.latlng;

  if (window.tempMarker) {
    map.removeLayer(window.tempMarker);
  }

  selectedId = null;
  selectedMarker = null;
  clearForm();
  resetEstimateDepth();

  window.tempMarker = L.marker(e.latlng, { icon: tempBoreholeIcon })
    .addTo(map)
    .bindPopup("Отримую висоту...");
  bindTempMarkerClose(window.tempMarker);
  window.tempMarker.openPopup();

  openPanel();

  getElevation(e.latlng.lat, e.latlng.lng);

  // 🚗 ОСМР відстань
  let dist = 0;
  try {
    dist = await getRoadDistanceKm(
      e.latlng.lat,
      e.latlng.lng,
      POLTAVA_CENTER.lat,
      POLTAVA_CENTER.lng
    );
  } catch (e) {
    console.log(e);
    dist = 0;
  }

  setDistanceUI(dist);

  const clickedLat = e.latlng.lat;
  const clickedLng = e.latlng.lng;
  getPlaceByLatLng(clickedLat, clickedLng)
    .then(place => {
      if (
        currentLatLng &&
        Math.abs(currentLatLng.lat - clickedLat) < 0.000001 &&
        Math.abs(currentLatLng.lng - clickedLng) < 0.000001
      ) {
        const pointPlace = {
          ...(place || {}),
          lat: clickedLat,
          lng: clickedLng
        };
        setPlaceUI(pointPlace);
        renderPlaceStats(pointPlace);
        loadWeather(clickedLat, clickedLng, pointPlace.label || pointPlace.placeName || "Обрана точка");
      }
    })
    .catch(error => console.log("Place detect error:", error));
});

async function saveBorehole() {
  if (!requireAdmin()) return;

  if (!currentLatLng) {
    alert("Спочатку вибери місце на карті");
    return;
  }

  let distance = 0;

  try {
    distance = await getRoadDistanceKm(
      currentLatLng.lat,
      currentLatLng.lng,
      POLTAVA_CENTER.lat,
      POLTAVA_CENTER.lng
    );
  } catch (e) {
    console.log("OSRM error:", e);
  }

  const dist = Number(distance || 0).toFixed(2);

  setDistanceUI(dist);

  let place = getPlaceFromForm();
  if (!place.placeName && !place.label) {
    try {
      place = await getPlaceByLatLng(currentLatLng.lat, currentLatLng.lng) || place;
      setPlaceUI(place);
    } catch (e) {
      console.log("Place save detect error:", e);
    }
  }

  const data = {
    num: document.getElementById("num").value,
    depth: document.getElementById("depth").value,
    water: document.getElementById("water").value,
    soil: document.getElementById("soil").value,
    note: document.getElementById("note").value,
    elevation: String(getFieldNumber("elevation")),
    distance: dist,
    placeName: place.placeName || place.name || "",
    community: place.community || "",
    district: place.district || "",
    neighbourhood: place.neighbourhood || place.neighborhood || place.suburb || "",
    placeLabel: place.label || getPlaceLabel(place),
    lat: currentLatLng.lat,
    lng: currentLatLng.lng,
    createdAt: Date.now()
  };

  try {
    if (isFirebaseReady()) {
      const docRef = await firebaseAddDoc(
        firebaseCollection(db, "boreholes"),
        data
      );

      data.id = docRef.id;
    } else {
      data.id = createLocalId();
    }

    upsertBoreholeLocal(data);
    addMarker(data);
    refreshYearFilterOptions();
    applyYearFilter();
    renderPlaceStats(data);

    alert(isFirebaseReady()
      ? "Точку збережено у Firebase"
      : "Точку збережено локально. Firebase ще треба налаштувати");

  } catch (e) {
    console.log("Save error:", e);

    data.id = createLocalId();
    upsertBoreholeLocal(data);
    addMarker(data);
    refreshYearFilterOptions();
    applyYearFilter();
    renderPlaceStats(data);

    alert("Firebase не відповів, тому точку збережено локально");
  }

  if (window.tempMarker) {
    map.removeLayer(window.tempMarker);
    window.tempMarker = null;
  }

  clearForm();
  currentLatLng = null;
  selectedId = null;
  selectedMarker = null;
  closePanel();
}

// 📍 створення маркера
function addMarker(data) {
  const markerId = getBoreholeMarkerId(data);
  const existing = boreholeMarkers.get(markerId);

  if (existing && map.hasLayer(existing.marker)) {
    map.removeLayer(existing.marker);
  }

  const marker = L.marker([data.lat, data.lng], { icon: boreholeIcon });
  boreholeMarkers.set(markerId, { marker, data });

  if (shouldShowBorehole(data)) {
    marker.addTo(map);
  }

  marker.on("click", function () {

    // 💥 прибрати тимчасову точку (ВАЖЛИВО)
    if (window.tempMarker) {
      map.removeLayer(window.tempMarker);
      window.tempMarker = null;
    }

    // 🧹 скинути режим нової точки
    currentLatLng = {
      lat: data.lat,
      lng: data.lng
    };

    selectedMarker = marker;
    selectedId = data.id;

    // Панель не відкриваємо автоматично: дані готові для редагування після ручного відкриття.

    // 🧠 заповнити форму
    document.getElementById("num").value = data.num || "";
    document.getElementById("depth").value = data.depth || "";
    document.getElementById("water").value = data.water || "";
    document.getElementById("soil").value = data.soil || "";
    document.getElementById("note").value = data.note || "";
    setElevationUI(data.elevation || "");
    setDistanceUI(data.distance || "");

    const markerPlace = {
      name: data.placeName || "",
      placeName: data.placeName || "",
      community: data.community || "",
      district: data.district || "",
      neighbourhood: data.neighbourhood || data.neighborhood || data.suburb || "",
      label: data.placeLabel || "",
      lat: data.lat,
      lng: data.lng
    };
    setPlaceUI(markerPlace);
    renderPlaceStats(markerPlace);
    loadWeather(data.lat, data.lng, data.placeLabel || data.placeName || `Свердловина №${data.num || ""}`);

    if (!data.placeName) {
      getPlaceByLatLng(data.lat, data.lng)
        .then(place => {
          if (!place) return;
          const markerPlace = {
            ...place,
            lat: data.lat,
            lng: data.lng
          };
          Object.assign(data, {
            placeName: place.placeName || place.name || "",
            community: place.community || "",
            district: place.district || "",
            placeLabel: place.label || getPlaceLabel(place)
          });
          upsertBoreholeLocal(data);
          setPlaceUI(markerPlace);
          renderPlaceStats(markerPlace);
        })
        .catch(error => console.log("Marker place detect error:", error));
    }
  });

  marker.bindPopup(`
    <b>№${data.num}</b><br>
    ${getVisiblePlaceLabel(data) ? `${getVisiblePlaceLabel(data)}<br>` : ""}
    Ґрунт: ${data.soil}<br>
    Глибина: ${data.depth} м<br>
    Рівень першої води: ${data.water} м<br>
    Висота над рівнем моря: ${data.elevation} м<br>
    ${data.distance ? `📍 відстань від Полтави: ${formatDecimalComma(data.distance, 2)} км<br>` : ""}
  `);
}

// 🗑 видалення
async function deleteSelected() {
  // 🟡 видалення тимчасової точки
  if (window.tempMarker) {
    removeTempPoint();
    return;
  }

  if (!requireAdmin()) return;

  // 🔴 видалення збереженої точки (FIREBASE)
  if (selectedMarker && selectedId) {
    try {
      const removed = boreholes.find(b => b.id === selectedId);
      if (isFirebaseReady() && hasFirebaseId(selectedId)) {
        await firebaseDeleteDoc(
          firebaseDoc(db, "boreholes", selectedId)
        );
      }

      map.removeLayer(selectedMarker);
      boreholeMarkers.delete(selectedId);
      boreholes = boreholes.filter(
        b => b.id !== selectedId
      );
      saveLocalBoreholes();
      refreshYearFilterOptions();
      applyYearFilter();
      selectedMarker = null;
      selectedId = null;
      renderPlaceStats(removed);
      alert("Свердловину видалено");
    } catch (e) {
      console.log("Delete error:", e);
      alert("Помилка видалення");
    }
    return;
  }
  alert("Вибери точку");
}

function clearForm(){
  document.getElementById("num").value = "";
  document.getElementById("depth").value = "";
  document.getElementById("water").value = "";
  document.getElementById("soil").value = "";
  document.getElementById("note").value = "";
  document.getElementById("elevation").value = "";
  document.getElementById("distance").value = "";
  setTransportByDistance("");
  resetEstimateDepth();
  clearPlaceUI();
}


// 🧾 панель
function openPanel(){
  document.getElementById("formPanel").classList.add("open");
syncRightArrow();
}

function closePanel(){
  document.getElementById("formPanel").classList.remove("open");
syncRightArrow();
}

function editBorehole(id){
  const borehole = boreholes.find(b => b.id === id);
  if(!borehole) return;

  selectedId = id;

  document.getElementById("num").value = borehole.num;
  document.getElementById("depth").value = borehole.depth;
  document.getElementById("water").value = borehole.water;
  document.getElementById("soil").value = borehole.soil;
  document.getElementById("note").value = borehole.note;

  // ✅ ОЦЕ ВАЖЛИВО
  setElevationUI(borehole.elevation || "");
  setDistanceUI(borehole.distance || "");
  setPlaceUI({
    name: borehole.placeName || "",
    placeName: borehole.placeName || "",
    community: borehole.community || "",
    district: borehole.district || "",
    neighbourhood: borehole.neighbourhood || borehole.neighborhood || borehole.suburb || "",
    label: borehole.placeLabel || "",
    placeLabel: borehole.placeLabel || ""
  });

  currentLatLng = {
    lat: borehole.lat,
    lng: borehole.lng
  };

  openPanel();
}

async function updateBorehole() {
  if (!requireAdmin()) return;

  if (!selectedId) {
    alert("Вибери свердловину");
    return;
  }

  let b = boreholes.find(x => x.id === selectedId);
  if (!b) return;

  const place = getPlaceFromForm();
  const updatedData = {
    num: document.getElementById("num").value,
    depth: document.getElementById("depth").value,
    water: document.getElementById("water").value,
    soil: document.getElementById("soil").value,
    note: document.getElementById("note").value,
    elevation: String(getFieldNumber("elevation")),
    distance: String(getFieldNumber("distance")),
    placeName: place.placeName || "",
    community: place.community || "",
    district: place.district || "",
    placeLabel: place.label || ""
  };

  try {
    if (isFirebaseReady() && hasFirebaseId(selectedId)) {
      await firebaseUpdateDoc(
        firebaseDoc(db, "boreholes", selectedId),
        updatedData
      );
    }

    // 🔵 оновлюємо локально
    Object.assign(b, updatedData);
    saveLocalBoreholes();
    const storedMarker = boreholeMarkers.get(selectedId);
    if (storedMarker) {
      storedMarker.data = b;
    }
    refreshYearFilterOptions();
    applyYearFilter();
    renderPlaceStats(b);

    if (selectedMarker) {
      selectedMarker.setPopupContent(`
        <b>№${b.num}</b><br>
        ${getVisiblePlaceLabel(b) ? `${getVisiblePlaceLabel(b)}<br>` : ""}
        Ґрунт: ${b.soil}<br>
        Глибина: ${b.depth} м<br>
        Рівень першої води: ${b.water} м<br>
        Висота над рівнем моря: ${b.elevation} м<br>
        📍 відстань від Полтави: ${formatDecimalComma(b.distance, 2)} км<br>
      `);
    }

    closePanel();
    alert("Оновлено");

  } catch (e) {
    console.log("Update error:", e);
    Object.assign(b, updatedData);
    saveLocalBoreholes();
    const storedMarker = boreholeMarkers.get(selectedId);
    if (storedMarker) {
      storedMarker.data = b;
    }
    refreshYearFilterOptions();
    applyYearFilter();
    alert("Firebase не відповів, але зміни збережено локально");
  }
}


async function getElevation(lat, lng) {
const { x, y } = latLngToTile(lat, lng, DEM_ZOOM);
const url = DEM_URL
  .replace("{z}", DEM_ZOOM)
  .replace("{x}", x)
  .replace("{y}", y);
const img = new Image();
img.crossOrigin = "anonymous";
img.onload = function () {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  // 🔥 16-point interpolation (4x4 сітка)
  const points = [];
  for (let x = 64; x <= 192; x += 42) {
    for (let y = 64; y <= 192; y += 42) {
      points.push([x, y]);
    }
  }
  let sum = 0;
  let count = 0;
  for (let p of points) {
    const pixel = ctx.getImageData(p[0], p[1], 1, 1).data;
    const h = decodeTerrain(pixel[0], pixel[1], pixel[2]);
    if (!isNaN(h)) {
      sum += h;
      count++;
    }
  }
  const elevation = Math.round(sum / count);
  // 🧾 запис у форму
  setElevationUI(elevation);
  // 🧷 popup тимчасової точки
  if (window.tempMarker) {
    window.tempMarker.setPopupContent(`
      <b>Нова свердловина</b><br>
      Висота над рівнем моря: ${elevation} м
    `);
  }
  // 🧮 перерахунок води

};
img.onerror = function () {
  alert("DEM не завантажився");
};
img.src = url;
}


function calculateBS() {
  // видалено
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  const themeButton = document.querySelector(".theme-card");
  if (themeButton) {
    themeButton.setAttribute("aria-pressed", document.body.classList.contains("dark") ? "true" : "false");
  }
}

function autoResize(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const handle = document.querySelector(".drawer-handle.left");

  sidebar.classList.toggle("open");

  if (sidebar.classList.contains("open")) {
    handle.textContent = "❮";
  } else {
    handle.textContent = "❯";
  }
}


const DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const DEM_ZOOM = 14;

function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const x = Math.floor((lng + 180) / 360 * n);
  const y = Math.floor(
    (1 - Math.log(
      Math.tan(lat * Math.PI / 180) +
      1 / Math.cos(lat * Math.PI / 180)
    ) / Math.PI) / 2 * n
  );
  return { x, y };
}

function decodeTerrain(r, g, b) {
  return (r * 256 + g + b / 256) - 32768;
}

function latLngToTile(lat, lng, zoom) {
  const n = Math.pow(2, zoom);
  const tileX = (lng + 180) / 360 * n;
  const tileY =
    (1 - Math.log(
      Math.tan(lat * Math.PI / 180) +
      1 / Math.cos(lat * Math.PI / 180)
    ) / Math.PI) / 2 * n;

  const x = Math.floor(tileX);
  const y = Math.floor(tileY);

  return {
    x,
    y,
    pixelX: (tileX - x) * 256,
    pixelY: (tileY - y) * 256
  };
}

async function getElevation(lat, lng) {
  const tile = latLngToTile(lat, lng, DEM_ZOOM);
  const url = DEM_URL
    .replace("{z}", DEM_ZOOM)
    .replace("{x}", tile.x)
    .replace("{y}", tile.y);

  const img = new Image();
  img.crossOrigin = "anonymous";

  img.onload = function () {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const px = Math.round(tile.pixelX);
    const py = Math.round(tile.pixelY);
    let sum = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = Math.min(255, Math.max(0, px + dx));
        const y = Math.min(255, Math.max(0, py + dy));
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const height = decodeTerrain(pixel[0], pixel[1], pixel[2]);

        if (!Number.isNaN(height)) {
          sum += height;
          count++;
        }
      }
    }

    const elevation = count ? Math.round(sum / count) : 0;
    setElevationUI(elevation);

    if (window.tempMarker) {
      window.tempMarker.setPopupContent(`
        <b>Нова свердловина</b><br>
        Висота над рівнем моря: ${elevation} м
      `);
    }
  };

  img.onerror = function () {
    alert("DEM не завантажився");
  };

  img.src = url;
}

function drawProfile(a, b) {
const steps = 20;
const profile = [];
for (let i = 0; i <= steps; i++) {
  const lat = a.lat + (b.lat - a.lat) * (i / steps);
  const lng = a.lng + (b.lng - a.lng) * (i / steps);
  const h = approximateElevation(lat, lng);
  profile.push(h);
}
console.log("PROFILE:", profile);
alert("Профіль побудовано (дивись console)");
}

function approximateElevation(lat, lng) {
const { x, y } = latLngToTile(lat, lng, DEM_ZOOM);
return Math.random() * 100 + 150; // тимчасово (можна замінити на DEM decode)
}

function calculateSlope(h1, h2, distance) {
const rise = h2 - h1;
const run = distance;
return (rise / run) * 100;
}

function groupPlaces(data) {
const groups = {};
data.forEach(p => {
  const name = p.display_name.split(",")[0];
  if (!groups[name]) {
    groups[name] = [];
  }
  groups[name].push(p);
});
return groups;
}

// ===============================
// 🔎 НОРМАЛЬНИЙ ПОШУК (СТАБІЛЬНИЙ)
// ===============================

function normalizePlaceText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/лукищен[оа]/g, "лукищина")
    .replace(/коломацькому/g, "коломацьке")
    .replace(/коломацькі дачі/g, "коломацьке дачі")
    .trim();
}

function renderPlaceSuggestions(results, message) {
  const box = document.getElementById("suggestions");
  if (!box) return;

  box.innerHTML = "";
  box.classList.toggle("has-results", Boolean(message || results.length));

  if (message) {
    const empty = document.createElement("div");
    empty.className = "suggestion-empty";
    empty.textContent = message;
    box.appendChild(empty);
    return;
  }

  results.forEach(place => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "suggestion-item";

    const pin = document.createElement("span");
    pin.className = "suggestion-pin";
    item.appendChild(pin);

    const text = document.createElement("span");
    text.className = "suggestion-text";

    const title = document.createElement("span");
    title.className = "suggestion-title";
    title.textContent = getPlaceLabel(place);
    text.appendChild(title);

    const detail = getPlaceDetail(place);

    item.appendChild(text);

    item.addEventListener("click", () => {
      setPlaceUI(place);
      renderPlaceStats(place);
      goToPlace(place.lat, place.lng, formatSettlementName(place, place.name), detail);
    });
    box.appendChild(item);
  });
}

function getPlaceLabel(place) {
  const poltavaLabel = getPoltavaCityDisplayLabel(place);
  if (poltavaLabel) return poltavaLabel;

  const detail = getPlaceDetail(place);
  const name = formatSettlementName(place, place?.placeName || place?.name || "");
  if (!name) return detail || "";
  return detail ? `${name} (${detail})` : name;
}

function getStatsPlaceLabel(place) {
  const poltavaLabel = getPoltavaCityDisplayLabel(place);
  if (poltavaLabel) return poltavaLabel;

  const name = formatSettlementName(place, place?.placeName || place?.name || "");
  const community = place?.community || "";
  if (!name) return formatPlaceLabelWithPrefix(place) || community;
  return community ? `${name} (${community})` : name;
}

function getVisiblePlaceLabel(place) {
  return getPoltavaCityDisplayLabel(place) || getStatsPlaceLabel(place) || formatPlaceLabelWithPrefix(place);
}

function getPlaceDetail(place) {
  const parts = [
    place.community
  ].filter(Boolean);

  return [...new Set(parts)].join(", ");
}

function getPlaceTextBlob(place) {
  return [
    place?.name,
    place?.placeName,
    place?.community,
    place?.district,
    place?.label,
    place?.placeLabel,
    place?.neighbourhood,
    place?.neighborhood,
    place?.suburb,
    place?.cityDistrict,
    place?.city_district,
    place?.quarter,
    place?.locality
  ].filter(Boolean).join(" ");
}

function getPoltavaNeighborhood(place) {
  const text = normalizePlaceText(getPlaceTextBlob(place));

  if (text.includes("вакуленці")) {
    return "Вакуленці";
  }

  if (text.includes("дублянщина")) {
    return "Дублянщина";
  }

  if (text.includes("затурине")) {
    return "Затурине";
  }

  if (text.includes("вороніна") || text.includes("затишне")) {
    return "Вороніна";
  }

  if (text.includes("лісок")) {
    return "Лісок";
  }

  return "";
}

function isPoltavaCityPlace(place) {
  const name = normalizePlaceText(place?.placeName || place?.name || "");
  const text = normalizePlaceText(getPlaceTextBlob(place));

  return name === "полтава" ||
    name === "м. полтава" ||
    text.includes("місто полтава") ||
    text.includes("м. полтава") ||
    text.includes("київський район") ||
    text.includes("шевченківський район") ||
    text.includes("подільський район") ||
    text.includes("лісок") ||
    text.includes("вакуленці") ||
    text.includes("дублянщина") ||
    text.includes("затурине") ||
    text.includes("вороніна") ||
    text.includes("затишне");
}

function getPoltavaCityDisplayLabel(place) {
  if (!place || !isPoltavaCityPlace(place)) return "";

  const customDistrict =
    getPoltavaDistrictFromLabel(place.placeLabel) ||
    getPoltavaDistrictFromLabel(place.label);
  if (customDistrict) {
    return `м. Полтава (${customDistrict})`;
  }

  const neighborhood = getPoltavaNeighborhood(place);
  return neighborhood ? `м. Полтава (${neighborhood})` : "м. Полтава";
}

function uniquePlaces(places) {
  const seen = new Set();

  return places.filter(place => {
    const key = [
      normalizePlaceText(place.name),
      Number(place.lat).toFixed(4),
      Number(place.lng).toFixed(4)
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = value => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function localPlaceResults(q) {
  const query = normalizePlaceText(q);

  return PLACES
    .filter(place => [
      place.name,
      Array.isArray(place.aliases) ? place.aliases.join(" ") : "",
      place.community,
      place.district,
      getPlaceLabel(place)
    ].some(value => normalizePlaceText(value).includes(query)))
    .slice(0, 20);
}

function isPoltavaRegionResult(place) {
  const text = normalizePlaceText([
    place.display_name,
    place.address?.state,
    place.address?.region
  ].filter(Boolean).join(" "));

  return text.includes("полтав");
}

function getRemotePlaceName(place) {
  const address = place.address || {};
  const namedetails = place.namedetails || {};
  const explicitSettlementName = address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.settlement ||
    address.locality;

  if (explicitSettlementName) {
    return namedetails["name:uk"] ||
      namedetails["official_name:uk"] ||
      namedetails["alt_name:uk"] ||
      explicitSettlementName;
  }

  const remoteType = normalizePlaceText(place.type || "");
  if (["city", "town", "village", "hamlet"].includes(remoteType)) {
    return namedetails["name:uk"] ||
      namedetails["official_name:uk"] ||
      namedetails["alt_name:uk"] ||
      place.name ||
      "";
  }

  return "";
}

function getSearchNameCandidate(q) {
  return String(q || "")
    .split(",")[0]
    .replace(/\s+(Полтавський|Кременчуцький|Лубенський|Миргородський)\s+район.*$/i, "")
    .replace(/\s+(Полтавської|Полтавська|Полтавськоі|Терешківської|Терешківська)\s+(міської|сільської|селищної)?\s*громади?.*$/i, "")
    .replace(/\s+(міської|сільської|селищної)\s+громади?.*$/i, "")
    .replace(/\s+громади?.*$/i, "")
    .replace(/\s+район.*$/i, "")
    .trim();
}

function normalizeUaRuName(value) {
  return normalizePlaceText(value)
    .replace(/[іїы]/g, "и")
    .replace(/[єэ]/g, "е")
    .replace(/ґ/g, "г");
}

function preferTypedUkrainianName(remoteName, q) {
  const typed = getSearchNameCandidate(q);
  if (!typed) return remoteName;

  const typedLoose = normalizeUaRuName(typed);
  const remoteLoose = normalizeUaRuName(remoteName);

  return typedLoose === remoteLoose ? typed : remoteName;
}

function getOSMName(tags) {
  return tags["name:uk"] ||
    tags["official_name:uk"] ||
    tags["alt_name:uk"] ||
    tags.name;
}

function getRemoteCommunity(place) {
  const address = place.address || {};

  return address.municipality ||
    address.territorial_community ||
    address.community ||
    "";
}

function getRemoteDistrict(place) {
  const address = place.address || {};

  return address.county ||
    address.district ||
    "";
}

function getRemoteNeighbourhood(place) {
  const address = place.address || {};

  return address.neighbourhood ||
    address.neighborhood ||
    address.suburb ||
    address.city_district ||
    address.quarter ||
    address.locality ||
    "";
}

async function remotePlaceResults(q) {
  const simpleName = getSearchNameCandidate(q);
  const queries = [...new Set([
    q,
    simpleName
  ].filter(Boolean))];

  const allResults = [];

  for (const query of queries) {
    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "1",
      namedetails: "1",
      "accept-language": "uk",
      countrycodes: "ua",
      dedupe: "1",
      limit: "12",
      q: `${query}, Полтавська область, Україна`
    });

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
    if (!res.ok) {
      throw new Error(`Nominatim не завантажився: ${res.status}`);
    }

    const data = await res.json();
    allResults.push(...data);
  }

  return uniquePlaces(
    allResults
      .filter(isPoltavaRegionResult)
      .map(place => ({
        name: preferTypedUkrainianName(getRemotePlaceName(place), q),
        community: getRemoteCommunity(place),
        district: getRemoteDistrict(place),
        neighbourhood: getRemoteNeighbourhood(place),
        placeType: place.type || place.address?.place || "",
        lat: Number(place.lat),
        lng: Number(place.lon)
      }))
      .filter(place => place.name && !isCommunityOnlyName(place.name) && !Number.isNaN(place.lat) && !Number.isNaN(place.lng))
  );
}

async function getPlaceByLatLng(lat, lng) {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    "accept-language": "uk",
    lat: String(lat),
    lon: String(lng),
    zoom: "14"
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
  if (!res.ok) {
    throw new Error(`Reverse geocode failed: ${res.status}`);
  }

  const place = await res.json();
  const name = getRemotePlaceName(place);
  const community = getRemoteCommunity(place);
  const district = getRemoteDistrict(place);
  const neighbourhood = getRemoteNeighbourhood(place);
  const placeType = place.type || place.address?.place || "";

  if (!name || isCommunityOnlyName(name)) {
    return {
      name: "",
      placeName: "",
      community,
      district,
      neighbourhood,
      placeType,
      label: "",
      manualPlaceRequired: true
    };
  }

  return {
    name,
    placeName: name,
    community,
    district,
    neighbourhood,
    placeType,
    label: getPlaceLabel({ name, community, district, neighbourhood, placeType })
  };
}

function searchCityPRO(q) {
  const query = String(q || "").trim();
  clearTimeout(placeSearchTimer);
  placeSearchRequestId += 1;
  const requestId = placeSearchRequestId;

  if (!query) {
    renderPlaceSuggestions([]);
    return;
  }

  if (query.length < 2) {
    renderPlaceSuggestions([], "Введіть ще одну літеру");
    return;
  }

  renderPlaceSuggestions([], "Шукаю населений пункт...");

  placeSearchTimer = setTimeout(async () => {
    try {
      const localResults = localPlaceResults(query);
      const remoteResults = await remotePlaceResults(query);
      if (requestId !== placeSearchRequestId) return;

      const combinedResults = uniquePlaces([...localResults, ...remoteResults]);

      if (combinedResults.length) {
        PLACES = uniquePlaces([...PLACES, ...combinedResults])
          .sort((a, b) => a.name.localeCompare(b.name, "uk"));
        renderPlaceSuggestions(combinedResults);
        return;
      }

      renderPlaceSuggestions(
        [],
        "Нічого не знайдено"
      );
    } catch (e) {
      console.error("Помилка онлайн-пошуку населеного пункту:", e);
      if (requestId === placeSearchRequestId) {
        renderPlaceSuggestions([], "Не вдалося виконати онлайн-пошук");
      }
    }
  }, 350);
}

function selectPlace(lat, lon, name) {
  // 🧹 заповнюємо поле і чистимо підказки
  document.getElementById("searchCity").value = name;
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("suggestions").classList.remove("has-results");

  // 🗺 просто переносимо карту
  map.setView([lat, lon], 14);
}

function removeSearchMarker() {
  if (activeSearchMarker) {
    map.removeLayer(activeSearchMarker);
    activeSearchMarker = null;
  }
  document.getElementById("searchCity").value = "";
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("suggestions").classList.remove("has-results");
}

// 🚗 відстань по дорогах OSRM
async function getDistanceKm(lat1, lon1, lat2, lon2){
const url =
`https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
const res = await fetch(url);
const data = await res.json();
if(data.routes && data.routes.length){
return (data.routes[0].distance / 1000).toFixed(2);
}
return "0";
}

async function getRoadDistanceKm(lat1, lng1, lat2, lng2) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${lng1},${lat1};${lng2},${lat2}?overview=false`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.routes || !data.routes.length) return 0;

  return data.routes[0].distance / 1000;
}

function clearSearch() {
  if (activeSearchMarker) {
    map.removeLayer(activeSearchMarker);
    activeSearchMarker = null;
  }

  document.getElementById("searchCity").value = "";
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("suggestions").classList.remove("has-results");
}

function setActiveLayer(el) {
  document.querySelectorAll("#layerControl *")
    .forEach(x => x.classList.remove("layer-active"));

  el.classList.add("layer-active");
}

function calculateCost() {
  const depth = getNumberFromText(document.getElementById("estDepth").value);
  const transport = getNumberFromText(document.getElementById("transportCost").value);
  const filter = getNumberFromText(document.getElementById("filterCost").value);

  const pipe = document.querySelector('input[name="pipeType"]:checked');
  const pipePrice = pipe ? Number(pipe.value) : 0;

  const pipeCost = depth * pipePrice;

  const total = pipeCost + transport + filter;

  document.getElementById("totalCost").value =
    total.toFixed(2);
}

function bindCostInputs() {
  const inputs = [
    "estDepth",
    "transportCost",
    "filterCost"
  ];

  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", calculateCost);
      el.addEventListener("change", calculateCost);
    }
  });

  document.querySelectorAll('input[name="pipeType"]').forEach(el => {
    el.addEventListener("change", calculateCost);
  });
}

function getPipePrice() {
  const selected = document.querySelector('input[name="pipeType"]:checked');
  return Number(selected ? selected.value : 0);
}

function getSelectedPipeLabel() {
  const selected = document.querySelector('input[name="pipeType"]:checked');
  if (!selected) return "-";

  const pipeName = selected.closest(".radio-item")?.querySelector(".pipe-name")?.textContent.trim();
  return pipeName || "-";
}

function money(value) {
  const formatted = Number(value || 0)
    .toLocaleString("uk-UA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
    .replace(/[\u00a0\u202f]/g, " ");

  return `${formatted} грн`;
}

function escapeExcelCell(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelCell(value, styleId = "") {
  const style = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Cell${style}><Data ss:Type="String">${escapeExcelCell(value)}</Data></Cell>`;
}

function excelRow(values, styleId = "") {
  return `<Row>${values.map(value => excelCell(value, styleId)).join("")}</Row>`;
}

function excelSheet(name, rows) {
  return `
    <Worksheet ss:Name="${escapeExcelCell(name)}">
      <Table>${rows.join("")}</Table>
    </Worksheet>
  `;
}

function setSheetNumberFormat(sheet, columns, format) {
  if (!sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  for (let row = 1; row <= range.e.r; row += 1) {
    columns.forEach(col => {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (cell && cell.t === "n") {
        cell.z = format;
        cell.s = cell.s || {};
        cell.s.numFmt = format;
      }
    });
  }
}

function applyExcelTableStyle(sheet) {
  if (!sheet["!ref"]) return;
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const baseStyle = {
    font: {
      name: "Arial",
      sz: 11
    },
    alignment: {
      horizontal: "center",
      vertical: "center",
      wrapText: true
    }
  };

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let col = range.s.c; col <= range.e.c; col += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address];
      if (!cell) continue;

      cell.s = {
        ...baseStyle,
        font: { ...baseStyle.font },
        alignment: { ...baseStyle.alignment }
      };
    }
  }

  sheet["!rows"] = Array.from(
    { length: range.e.r + 1 },
    (_, row) => ({ hpt: row === 0 ? 48.75 : 14.25 })
  );
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getExcelPlaceLabel(item) {
  const poltavaLabel = getPoltavaCityDisplayLabel(item);
  if (poltavaLabel) return poltavaLabel;

  const name = String(item?.placeName || item?.name || "").trim();
  if (name) return formatSettlementName(item, name);

  const label = String(item?.placeLabel || item?.label || "").trim();
  const community = String(item?.community || "").trim();
  if (label && community) {
    return label.replace(new RegExp(`\\s*—\\s*${escapeRegExp(community)}\\s*$`, "i"), "").trim();
  }

  return label;
}

function getEstimatePlaceLabel(place) {
  const baseLabel =
    getExcelPlaceLabel(place) ||
    String(document.getElementById("placeLabel")?.value || "").trim() ||
    "-";
  const community = String(place?.community || "").trim();

  if (!community || normalizePlaceText(baseLabel).includes(normalizePlaceText(community))) {
    return baseLabel;
  }

  return `${baseLabel} (${community})`;
}

function exportBoreholesExcel() {
  if (!requireAdmin()) return;

  if (!window.XLSX) {
    alert("Excel модуль ще не завантажився. Спробуй натиснути ще раз за кілька секунд.");
    return;
  }

  const visibleItems = dedupeBoreholes(Array.from(boreholeMarkers.values())
    .filter(({ marker, data }) => map.hasLayer(marker) && shouldShowBorehole(data))
    .map(({ data }) => data));

  const items = visibleItems.sort((a, b) => {
    const yearDiff = Number(getBoreholeYear(b) || 0) - Number(getBoreholeYear(a) || 0);
    if (yearDiff) return yearDiff;
    return String(a.num || "").localeCompare(String(b.num || ""), "uk", { numeric: true });
  });

  if (!items.length) {
    alert("Немає видимих свердловин для вигрузки");
    return;
  }

  const detailRows = [
    [
      "№ свердловини",
      "Рік",
      "Місцевість",
      "Громада",
      "Глибина, (м)",
      "Рівень 1-ї води, (м)",
      "Ґрунт",
      "Висота над рівнем моря, (м)",
      "Відстань від Полтави до місця буріння, (км)",
      "Примітка",
      "Широта",
      "Довгота"
    ],
    ...items.map(item => [
      item.num,
      getBoreholeYear(item) || "-",
      getExcelPlaceLabel(item),
      item.community || "",
      getExcelNumber(item.depth),
      getExcelNumber(item.water),
      item.soil,
      getExcelNumber(item.elevation),
      getExcelNumber(item.distance),
      item.note,
      getExcelNumber(item.lat),
      getExcelNumber(item.lng)
    ])
  ];

  const workbook = XLSX.utils.book_new();
  const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);

  applyExcelTableStyle(detailSheet);
  setSheetNumberFormat(detailSheet, [4, 5, 7, 8], "0.00");

  detailSheet["!cols"] = [
    { wch: 11.5 },
    { wch: 9.375 },
    { wch: 31 },
    { wch: 31 },
    { wch: 11.5 },
    { wch: 12.875 },
    { wch: 15.625 },
    { wch: 10.5 },
    { wch: 17.625 },
    { wch: 30.25 },
    { wch: 13 },
    { wch: 13 }
  ];
  detailSheet["!margins"] = {
    left: 0.7,
    right: 0.7,
    top: 0.75,
    bottom: 0.75,
    header: 0,
    footer: 0
  };
  detailSheet["!pageSetup"] = {
    orientation: "landscape"
  };

  XLSX.utils.book_append_sheet(workbook, detailSheet, "Свердловини");
  const yearSuffix = activeYearFilter === "all" ? "usi_roky" : activeYearFilter;
  XLSX.writeFile(workbook, `sverdlovyny_${yearSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function downloadEstimatePdf() {
  if (!window.pdfMake) {
    alert("PDF модуль ще не завантажився. Спробуй натиснути ще раз за кілька секунд.");
    return;
  }

  calculateCost();

  const depth = getNumberFromText(document.getElementById("estDepth").value);
  const pipePrice = getPipePrice();
  const pipeCost = depth * pipePrice;
  const transport = getNumberFromText(document.getElementById("transportCost").value);
  const filter = getNumberFromText(document.getElementById("filterCost").value);
  const total = pipeCost + transport + filter;

  if (!depth) {
    alert("Введи метраж у калькуляторі перед створенням кошторису");
    return;
  }

  const num = document.getElementById("num").value || "-";
  const formPlace = getPlaceFromForm();
  const place = getEstimatePlaceLabel(formPlace);
  const distanceKm = getFieldNumber("distance");
  const distance = distanceKm ? `${formatDecimalComma(distanceKm, 2)} км` : "-";
  const date = new Date().toLocaleDateString("uk-UA");
  const appUrl = "https://pro-buryty-v-vodonos.github.io/boreholes-app/";
  const youtubeUrl = "https://www.youtube.com/@PRO_buryty_v_vodonos";
  const telegramUrl = "https://t.me/PRO_buryty_v_Vodonos";
  const youtubeIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 44">
      <rect width="64" height="44" rx="10" fill="#ff0000"/>
      <path d="M26 13l18 9-18 9z" fill="#ffffff"/>
    </svg>
  `;
  const telegramIcon = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
      <circle cx="24" cy="24" r="24" fill="#229ed9"/>
      <path d="M11 23.2l25-9.7c1.2-.4 2.2.3 1.8 2l-4.3 20.1c-.3 1.4-1.2 1.8-2.4 1.1l-6.5-4.8-3.1 3c-.4.4-.7.7-1.4.7l.5-6.6 12-10.9c.5-.5-.1-.7-.8-.3L17 27.1l-6.4-2c-1.4-.5-1.4-1.4.4-2z" fill="#fff"/>
    </svg>
  `;

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 36],
    content: [
      { text: "Кошторис буріння свердловини", style: "title" },
      {
        columns: [
          { text: date, alignment: "left" },
          { text: "м. Полтава", alignment: "right" }
        ],
        style: "documentMeta"
      },
      {
        table: {
          widths: ["42%", "*"],
          body: [
            ["№ свердловини", num],
            ["Місцевість", place],
            ["Відстань від Полтави до місця буріння", distance]
          ]
        },
        layout: "lightHorizontalLines"
      },
      { text: "Розрахунок", style: "section" },
      {
        table: {
          widths: ["*", "auto", "auto", "auto"],
          body: [
            [
              { text: "Позиція", bold: true },
              { text: "К-сть", bold: true },
              { text: "Ціна за метр", bold: true },
              { text: "Сума", bold: true }
            ],
            [
              {
                stack: [
                  { text: "Вартість буріння" },
                  { text: `(${getSelectedPipeLabel()})`, fontSize: 9, color: "#667085" }
                ]
              },
              `${depth} м`,
              money(pipePrice),
              money(pipeCost)
            ],
            ["Транспортні нарахування", "-", "-", money(transport)],
            ["Фільтр", "1 шт.", "-", money(filter)],
            ["", "", { text: "Разом", bold: true, alignment: "right" }, { text: money(total), bold: true, alignment: "right" }]
          ]
        },
        layout: "lightHorizontalLines"
      },
      { text: "Примітка: кошторис є попереднім і може уточнюватися після огляду місця робіт.", style: "note" },
      {
        columns: [
          {
            width: "*",
            stack: [
              { qr: appUrl, fit: 105, alignment: "center", margin: [0, 12, 0, 5] },
              {
                text: "Додаток для отримання наявної інформації пробурених свердловин по вашій місцевості",
                link: appUrl,
                alignment: "center",
                color: "#2d89ef",
                fontSize: 9,
                lineHeight: 1.15
              }
            ]
          },
          {
            width: "*",
            stack: [
              { svg: youtubeIcon, width: 58, alignment: "center", margin: [0, 27, 0, 7] },
              {
                text: "PRO_бурити в_Vodonos",
                link: youtubeUrl,
                alignment: "center",
                color: "#2d89ef",
                bold: true,
                fontSize: 11
              }
            ]
          },
          {
            width: "*",
            stack: [
              { svg: telegramIcon, width: 48, alignment: "center", margin: [0, 25, 0, 7] },
              {
                text: "@PRO_бурити в_Vodonos",
                link: telegramUrl,
                alignment: "center",
                color: "#229ed9",
                bold: true,
                fontSize: 10
              }
            ]
          }
        ],
        columnGap: 14
      }
    ],
    styles: {
      title: { fontSize: 18, bold: true, alignment: "center", margin: [0, 0, 0, 8] },
      section: { fontSize: 13, bold: true, alignment: "center", margin: [0, 14, 0, 6] },
      documentMeta: { color: "#667085", margin: [0, 0, 0, 8] },
      note: { color: "#667085", fontSize: 10, margin: [0, 14, 0, 0] }
    },
    defaultStyle: {
      fontSize: 11
    }
  };

  const cleanNum = String(num).replace(/[^\d\wа-яА-ЯіїєґІЇЄҐ-]+/g, "_");
  logAppEvent("estimate_pdf_download", {
    depth,
    total: Math.round(total),
    pipe_price: pipePrice
  });
  pdfMake.createPdf(docDefinition).download(`koshtorys_sverdlovyna_${cleanNum || "nova"}.pdf`);
}

window.addEventListener("load", function () {

  // карта
  registerPWA();
  logAppEvent("app_open");
  initAdminAuth();
  checkAppAccess();
  initLayerControl();
  loadPoltavaBoundary();
  loadWeather();

  // калькулятор
  bindCostInputs();
  setDefaultCostValues();
  calculateCost();
  initMobileCollapsibleSections();

  // textarea note
  const note = document.getElementById("note");
  if (note) {
    autoResize(note);
    note.addEventListener("input", function () {
      autoResize(this);
    });
  }

});

async function testSave() {
  if (!isFirebaseReady()) {
    alert("Firebase ще не налаштований");
    return;
  }

  try {
    const docRef = await firebaseAddDoc(
      firebaseCollection(db, "test"),
      {
        name: "OK",
        time: Date.now()
      }
    );

    console.log("Збережено ID:", docRef.id);
    alert("Firebase працює 🔥");
  } catch (e) {
    console.error("Помилка Firebase:", e);
  }
}

async function syncNormalizedFirebaseBoreholes(originalItems, normalizedItems) {
  if (!isAdmin || !isFirebaseReady()) return;

  const updates = normalizedItems
    .map(item => {
      const original = originalItems.find(source => source.id === item.id) || {};
      return {
        id: item.id,
        patch: {
          placeLabel: item.placeLabel || ""
        },
        changed: hasFirebaseId(item.id) && (original.placeLabel || "") !== (item.placeLabel || "")
      };
    })
    .filter(item => item.changed && item.patch.placeLabel);

  for (const item of updates) {
    try {
      await firebaseUpdateDoc(firebaseDoc(db, "boreholes", item.id), item.patch);
    } catch (error) {
      console.log("Place label sync error:", error);
    }
  }
}

async function loadBoreholes() {
  clearBoreholeMarkers();
  boreholes = loadLocalBoreholes();

  if (isFirebaseReady()) {
    try {
      const snap = await firebaseGetDocs(
        firebaseCollection(db, "boreholes")
      );

      const firebaseBoreholes = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const normalizedFirebaseBoreholes = firebaseBoreholes.map(item =>
        normalizeBoreholePlaceDisplay({ ...item })
      );

      if (isAdmin) {
        await syncNormalizedFirebaseBoreholes(firebaseBoreholes, normalizedFirebaseBoreholes);
      }

      boreholes = dedupeBoreholes([...boreholes, ...normalizedFirebaseBoreholes]).map(normalizeBoreholePlaceDisplay);
      saveLocalBoreholes();
    } catch (e) {
      console.log("Firebase load error:", e);
    }
  }

  boreholes = dedupeBoreholes(boreholes).map(normalizeBoreholePlaceDisplay);
  saveLocalBoreholes();
  boreholes.forEach(addMarker);
  refreshYearFilterOptions();
  applyYearFilter();
}

window.addEventListener("load", loadBoreholes);

function startAddPoint() {
  alert("Тапни по карті для додавання точки");
}

function toggleFormPanel(){
  const panel = document.getElementById("formPanel");

  if (panel.classList.contains("open")) {
    closePanel();
  } else {
    openPanel();
  }
}

window.saveBorehole = saveBorehole;
window.updateBorehole = updateBorehole;
window.deleteSelected = deleteSelected;
window.toggleTheme = toggleTheme;
window.toggleSidebar = toggleSidebar;
window.toggleFormPanel = toggleFormPanel;
window.startAddPoint = startAddPoint;
window.clearSearch = clearSearch;
window.refreshWeather = refreshWeather;
window.changeWeatherDate = changeWeatherDate;
window.togglePanelSection = togglePanelSection;
window.downloadEstimatePdf = downloadEstimatePdf;
window.setYearFilter = setYearFilter;
window.exportBoreholesExcel = exportBoreholesExcel;
window.refreshMap = refreshMap;
window.adminLogin = adminLogin;
window.adminLogout = adminLogout;
window.locateUser = locateUser;

function syncRightArrow(){
  const panel = document.getElementById("formPanel");
  const arrow = document.querySelector(".drawer-handle.right");

  if (panel.classList.contains("open")) {
    arrow.textContent = "❯";
  } else {
    arrow.textContent = "❮";
  }
}

let PLACES = [];

async function loadPoltavaPlacesFromOSM() {
  const query = `
    [out:json][timeout:25];
    (
      area["ISO3166-2"="UA-53"]["admin_level"="4"];
      area["boundary"="administrative"]["admin_level"="4"]["name:uk"="Полтавська область"];
      area["boundary"="administrative"]["admin_level"="4"]["name"="Полтавская область"];
    )->.poltava;
    relation["boundary"="administrative"]["admin_level"="7"](area.poltava)->.communities;
    foreach.communities->.community(
      .community out tags;
      .community map_to_area->.communityArea;
      (
        node["place"~"^(city|town|village|hamlet)$"](area.communityArea);
        way["place"~"^(city|town|village|hamlet)$"](area.communityArea);
        relation["place"~"^(city|town|village|hamlet)$"](area.communityArea);
      );
      out center tags;
    );
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: new URLSearchParams({ data: query })
  });

  if (!res.ok) {
    throw new Error(`OSM не завантажився: ${res.status}`);
  }

  const data = await res.json();
  let currentCommunity = "";

  return data.elements
    .map(item => {
      const tags = item.tags || {};
      const center = item.center || item;

      if (tags.boundary === "administrative" && tags.admin_level === "7") {
        currentCommunity = getOSMName(tags) || "";
        return null;
      }

      return {
        name: getOSMName(tags),
        community: currentCommunity,
        placeType: tags.place || "",
        lat: Number(center.lat),
        lng: Number(center.lon)
      };
    })
    .filter(place => place && place.name && !Number.isNaN(place.lat) && !Number.isNaN(place.lng));
}

async function loadPlaces() {
  console.log("Починаю завантаження GEOJSON");

  try {
    const res = await fetch("data/poltava.geojson.geojson");

    console.log("Статус файлу:", res.status);
    if (!res.ok) {
      throw new Error(`GeoJSON не завантажився: ${res.status}`);
    }

    const data = await res.json();

    console.log("GEOJSON:", data);

    PLACES = uniquePlaces(
      data.features
        .filter(f => f.geometry?.type === "Point")
        .map(f => ({
          name: f.properties.name,
          placeType: f.properties.place || f.properties.type || "",
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0]
        }))
        .filter(place => place.name && !Number.isNaN(place.lat) && !Number.isNaN(place.lng))
    ).sort((a, b) => a.name.localeCompare(b.name, "uk"));

    console.log("PLACES:", PLACES);

  } catch(e) {
    console.error("ПОМИЛКА GEOJSON:", e);
  }

  try {
    if (PLACES.length < 50) {
      const osmPlaces = await loadPoltavaPlacesFromOSM();
      PLACES = uniquePlaces([...PLACES, ...osmPlaces])
        .sort((a, b) => a.name.localeCompare(b.name, "uk"));
      console.log("PLACES OSM:", PLACES);
    }
  } catch(e) {
    console.error("ПОМИЛКА OSM:", e);
  } finally {
    PLACES = uniquePlaces([...MANUAL_PLACES, ...PLACES])
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
    placesReady = true;
  }
}

window.addEventListener("load", loadPlaces);

function goToPlace(lat, lng, name, detail = "") {
  const label = detail ? `${name} (${detail})` : name;

  document.getElementById("searchCity").value = label;
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("suggestions").classList.remove("has-results");

  map.setView([lat, lng], 14);
  logAppEvent("settlement_search_select", {
    settlement: name,
    community: String(detail || "").split(",")[0].trim()
  });
  renderPlaceStats({
    name,
    placeName: name,
    community: String(detail || "").split(",")[0].trim(),
    label,
    lat,
    lng
  });
  loadWeather(lat, lng, name);

  if (activeSearchMarker) {
    map.removeLayer(activeSearchMarker);
    activeSearchMarker = null;
  }
}

window.searchCityPRO = searchCityPRO;
window.goToPlace = goToPlace;
