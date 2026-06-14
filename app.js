// 🗺 карта
const map = L.map('map').setView([49.5883, 34.5514], 9);

const POLTAVA_CENTER = {
  lat: 49.5883,
  lng: 34.5514
};

const POLTAVA_BOUNDARY_URL =
  "https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=1&countrycodes=ua&q=%D0%9F%D0%BE%D0%BB%D1%82%D0%B0%D0%B2%D1%81%D1%8C%D0%BA%D0%B0%20%D0%BE%D0%B1%D0%BB%D0%B0%D1%81%D1%82%D1%8C,%20%D0%A3%D0%BA%D1%80%D0%B0%D1%97%D0%BD%D0%B0";

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
const LOCAL_BOREHOLES_KEY = "boreholes-app:boreholes";

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

function setWeatherLoading(label) {
  const place = document.getElementById("weatherPlace");
  const desc = document.getElementById("weatherDesc");
  if (place) place.textContent = label || "Полтава";
  if (desc) desc.textContent = "Оновлюю...";
}

function setWeatherEmpty(message) {
  const temp = document.getElementById("weatherTemp");
  const desc = document.getElementById("weatherDesc");
  const wind = document.getElementById("weatherWind");
  const humidity = document.getElementById("weatherHumidity");
  const rain = document.getElementById("weatherRain");

  if (temp) temp.textContent = "--°";
  if (desc) desc.textContent = message || "Погода недоступна";
  if (wind) wind.textContent = "-";
  if (humidity) humidity.textContent = "-";
  if (rain) rain.textContent = "-";
}

async function loadWeather(lat = POLTAVA_CENTER.lat, lng = POLTAVA_CENTER.lng, label = "Полтава") {
  lastWeatherPoint = { lat, lng, label };
  setWeatherLoading(label);

  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Weather failed: ${res.status}`);

    const data = await res.json();
    const current = data.current || {};

    document.getElementById("weatherTemp").textContent =
      Number.isFinite(current.temperature_2m) ? `${Math.round(current.temperature_2m)}°` : "--°";
    document.getElementById("weatherDesc").textContent = weatherText(current.weather_code);
    document.getElementById("weatherWind").textContent =
      Number.isFinite(current.wind_speed_10m) ? `${Math.round(current.wind_speed_10m)} км/год` : "-";
    document.getElementById("weatherHumidity").textContent =
      Number.isFinite(current.relative_humidity_2m) ? `${Math.round(current.relative_humidity_2m)}%` : "-";
    document.getElementById("weatherRain").textContent =
      Number.isFinite(current.precipitation) ? `${current.precipitation} мм` : "-";
  } catch (e) {
    console.log("Weather error:", e);
    setWeatherEmpty("Погода недоступна");
  }
}

function refreshWeather() {
  loadWeather(lastWeatherPoint.lat, lastWeatherPoint.lng, lastWeatherPoint.label);
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
  const index = boreholes.findIndex(b => b.id === data.id);

  if (index >= 0) {
    boreholes[index] = data;
  } else {
    boreholes.push(data);
  }

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

function getFieldNumber(id) {
  const el = document.getElementById(id);
  return getNumberFromText(el ? el.value : "");
}

function formatDistanceField(value) {
  const number = getNumberFromText(value);
  return value === "" || value === null || value === undefined
    ? ""
    : `${number.toFixed(2)} км до центру Полтави`;
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

function getPlaceKey(place) {
  if (!place) return "";

  return [
    place.placeName || place.name || "",
    place.community || ""
  ].map(normalizePlaceText).join("|");
}

function getPlaceFromForm() {
  return {
    name: document.getElementById("placeName")?.value || "",
    placeName: document.getElementById("placeName")?.value || "",
    community: document.getElementById("community")?.value || "",
    district: document.getElementById("district")?.value || "",
    label: document.getElementById("placeLabel")?.value || ""
  };
}

function setPlaceUI(place) {
  const safePlace = place || {};
  const name = safePlace.placeName || safePlace.name || "";
  const community = safePlace.community || "";
  const district = safePlace.district || "";
  const label = safePlace.label || getPlaceLabel({ name, community, district });

  const placeLabel = document.getElementById("placeLabel");
  const placeName = document.getElementById("placeName");
  const communityInput = document.getElementById("community");
  const districtInput = document.getElementById("district");

  if (placeLabel) placeLabel.value = label || "";
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
    ? `${min.toFixed(1)} м`
    : `${min.toFixed(1)}-${max.toFixed(1)} м`;
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

function getPlaceStats(place) {
  const key = getPlaceKey(place);
  if (!key || key === "|") return null;

  const items = boreholes.filter(item => getPlaceKey(item) === key);
  if (!items.length) return { count: 0 };

  return {
    count: items.length,
    depthRange: rangeText(items.map(item => item.depth)),
    waterRange: rangeText(items.map(item => item.water)),
    soil: mostCommon(items.map(item => item.soil))
  };
}

function renderPlaceStats(place) {
  const stats = getPlaceStats(place);
  const label = place?.label || getPlaceLabel({
    name: place?.placeName || place?.name || "",
    community: place?.community || "",
    district: place?.district || ""
  });

  const placeEl = document.querySelector(".stats-place");
  const countEl = document.getElementById("statsCount");
  const depthEl = document.getElementById("statsDepth");
  const waterEl = document.getElementById("statsWater");
  const soilEl = document.getElementById("statsSoil");

  if (placeEl) placeEl.textContent = label || "Вибери свердловину або населений пункт";
  if (countEl) countEl.textContent = stats ? String(stats.count) : "0";
  if (depthEl) depthEl.textContent = stats?.avgDepth ? `${stats.avgDepth.toFixed(1)} м` : "-";
  if (waterEl) waterEl.textContent = stats?.avgWater ? `${stats.avgWater.toFixed(1)} м` : "-";
  if (soilEl) soilEl.textContent = stats?.soil || "-";
}

function renderPlaceStats(place) {
  const stats = getPlaceStats(place);
  const label = place?.label || getPlaceLabel({
    name: place?.placeName || place?.name || "",
    community: place?.community || "",
    district: place?.district || ""
  });

  const placeEl = document.querySelector(".stats-place");
  const countEl = document.getElementById("statsCount");
  const depthEl = document.getElementById("statsDepth");
  const waterEl = document.getElementById("statsWater");
  const soilEl = document.getElementById("statsSoil");

  if (depthEl?.previousElementSibling) depthEl.previousElementSibling.textContent = "Глибина від-до";
  if (waterEl?.previousElementSibling) waterEl.previousElementSibling.textContent = "До першої води";

  if (placeEl) placeEl.textContent = label || "Вибери свердловину або населений пункт";
  if (countEl) countEl.textContent = stats ? String(stats.count) : "0";
  if (depthEl) depthEl.textContent = stats?.depthRange || "-";
  if (waterEl) waterEl.textContent = stats?.waterRange || "-";
  if (soilEl) soilEl.textContent = stats?.soil || "-";
}

// показати старі точки
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

  window.tempMarker = L.marker(e.latlng)
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
        setPlaceUI(place);
        renderPlaceStats(place);
        loadWeather(clickedLat, clickedLng, place.label || place.placeName || "Обрана точка");
      }
    })
    .catch(error => console.log("Place detect error:", error));
});

async function saveBorehole() {
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
  if (!place.placeName) {
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
    renderPlaceStats(data);

    alert(isFirebaseReady()
      ? "Точку збережено у Firebase"
      : "Точку збережено локально. Firebase ще треба налаштувати");

  } catch (e) {
    console.log("Save error:", e);

    data.id = createLocalId();
    upsertBoreholeLocal(data);
    addMarker(data);
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
  const marker = L.marker([data.lat, data.lng]).addTo(map);

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
      label: data.placeLabel || ""
    };
    setPlaceUI(markerPlace);
    renderPlaceStats(markerPlace);
    loadWeather(data.lat, data.lng, data.placeLabel || data.placeName || `Свердловина №${data.num || ""}`);

    if (!data.placeName) {
      getPlaceByLatLng(data.lat, data.lng)
        .then(place => {
          if (!place) return;
          Object.assign(data, {
            placeName: place.placeName || place.name || "",
            community: place.community || "",
            district: place.district || "",
            placeLabel: place.label || getPlaceLabel(place)
          });
          upsertBoreholeLocal(data);
          setPlaceUI(place);
          renderPlaceStats(place);
        })
        .catch(error => console.log("Marker place detect error:", error));
    }
  });

  marker.bindPopup(`
    <b>№${data.num}</b><br>
    ${data.placeLabel || data.placeName ? `${data.placeLabel || data.placeName}<br>` : ""}
    Ґрунт: ${data.soil}<br>
    Глибина: ${data.depth} м<br>
    Рівень першої води: ${data.water} м<br>
    Висота над рівнем моря: ${data.elevation} м<br>
    ${data.distance ? `📍 Відстань до Полтави: ${Number(data.distance).toFixed(2)} км<br>` : ""}
  `);
}

// 🗑 видалення
async function deleteSelected() {
  // 🟡 видалення тимчасової точки
  if (window.tempMarker) {
    removeTempPoint();
    return;
  }
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
      boreholes = boreholes.filter(
        b => b.id !== selectedId
      );
      saveLocalBoreholes();
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

  currentLatLng = {
    lat: borehole.lat,
    lng: borehole.lng
  };

  openPanel();
}

async function updateBorehole() {
  if (!selectedId) {
    alert("Вибери свердловину");
    return;
  }

  let b = boreholes.find(x => x.id === selectedId);
  if (!b) return;

  const updatedData = {
    num: document.getElementById("num").value,
    depth: document.getElementById("depth").value,
    water: document.getElementById("water").value,
    soil: document.getElementById("soil").value,
    note: document.getElementById("note").value,
    elevation: String(getFieldNumber("elevation")),
    distance: String(getFieldNumber("distance")),
    placeName: getPlaceFromForm().placeName || "",
    community: getPlaceFromForm().community || "",
    district: getPlaceFromForm().district || "",
    placeLabel: getPlaceFromForm().label || ""
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
    renderPlaceStats(b);

    if (selectedMarker) {
      selectedMarker.setPopupContent(`
        <b>№${b.num}</b><br>
        ${b.placeLabel || b.placeName ? `${b.placeLabel || b.placeName}<br>` : ""}
        Ґрунт: ${b.soil}<br>
        Глибина: ${b.depth} м<br>
        Рівень першої води: ${b.water} м<br>
        Висота над рівнем моря: ${b.elevation} м<br>
        📍 Відстань до Полтави: ${b.distance} км<br>
      `);
    }

    closePanel();
    alert("Оновлено");

  } catch (e) {
    console.log("Update error:", e);
    Object.assign(b, updatedData);
    saveLocalBoreholes();
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
    title.textContent = place.name;
    text.appendChild(title);

    const detail = getPlaceDetail(place);
    if (detail) {
      const subtitle = document.createElement("span");
      subtitle.className = "suggestion-subtitle";
      subtitle.textContent = detail;
      text.appendChild(subtitle);
    }

    item.appendChild(text);

    item.addEventListener("click", () => {
      setPlaceUI(place);
      renderPlaceStats(place);
      goToPlace(place.lat, place.lng, place.name, detail);
    });
    box.appendChild(item);
  });
}

function getPlaceLabel(place) {
  const detail = getPlaceDetail(place);
  return detail ? `${place.name} — ${detail}` : place.name;
}

function getPlaceDetail(place) {
  const parts = [
    place.community,
    place.district
  ].filter(Boolean);

  return [...new Set(parts)].join(", ");
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

function localPlaceResults(q) {
  const query = normalizePlaceText(q);

  return PLACES
    .filter(place => [
      place.name,
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

  return namedetails["name:uk"] ||
    namedetails["official_name:uk"] ||
    namedetails["alt_name:uk"] ||
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.settlement ||
    address.locality ||
    place.name ||
    String(place.display_name || "").split(",")[0];
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
        lat: Number(place.lat),
        lng: Number(place.lon)
      }))
      .filter(place => place.name && !Number.isNaN(place.lat) && !Number.isNaN(place.lng))
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

  if (!name) return null;

  return {
    name,
    placeName: name,
    community,
    district,
    label: getPlaceLabel({ name, community, district })
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
      const remoteResults = await remotePlaceResults(query);
      if (requestId !== placeSearchRequestId) return;

      if (remoteResults.length) {
        PLACES = uniquePlaces([...PLACES, ...remoteResults])
          .sort((a, b) => a.name.localeCompare(b.name, "uk"));
        renderPlaceSuggestions(remoteResults);
        return;
      }

      renderPlaceSuggestions(
        localPlaceResults(query),
        localPlaceResults(query).length ? "" : "Нічого не знайдено"
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

window.addEventListener("load", function () {

  // карта
  initLayerControl();
  loadPoltavaBoundary();
  loadWeather();

  // калькулятор
  bindCostInputs();
  setDefaultCostValues();
  calculateCost();

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

async function loadBoreholes() {
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

      const merged = new Map();
      boreholes.forEach(item => merged.set(item.id, item));
      firebaseBoreholes.forEach(item => merged.set(item.id, item));
      boreholes = Array.from(merged.values());
      saveLocalBoreholes();
    } catch (e) {
      console.log("Firebase load error:", e);
    }
  }

  boreholes.forEach(addMarker);
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
    placesReady = true;
  }
}

window.addEventListener("load", loadPlaces);

function goToPlace(lat, lng, name, detail = "") {
  const label = detail ? `${name} — ${detail}` : name;

  document.getElementById("searchCity").value = label;
  document.getElementById("suggestions").innerHTML = "";
  document.getElementById("suggestions").classList.remove("has-results");

  map.setView([lat, lng], 13);
  renderPlaceStats({ name, placeName: name, label });
  loadWeather(lat, lng, name);

  if (activeSearchMarker) {
    map.removeLayer(activeSearchMarker);
    activeSearchMarker = null;
  }
}

window.searchCityPRO = searchCityPRO;
window.goToPlace = goToPlace;
