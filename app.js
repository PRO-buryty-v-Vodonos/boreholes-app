// 🗺 карта
const map = L.map('map').setView([49.5, 32.0], 7);

const POLTAVA_CENTER = {
  lat: 49.5883,
  lng: 34.5514
};

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
const LOCAL_BOREHOLES_KEY = "boreholes-app:boreholes";

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
}

function setElevationUI(value) {
  const el = document.getElementById("elevation");
  if (!el) return;
  el.value = formatElevationField(value);
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
    .bindPopup("Отримую висоту...")
    .openPopup();

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

  const data = {
    num: document.getElementById("num").value,
    depth: document.getElementById("depth").value,
    water: document.getElementById("water").value,
    soil: document.getElementById("soil").value,
    note: document.getElementById("note").value,
    elevation: String(getFieldNumber("elevation")),
    distance: dist,
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

    alert(isFirebaseReady()
      ? "Точку збережено у Firebase"
      : "Точку збережено локально. Firebase ще треба налаштувати");

  } catch (e) {
    console.log("Save error:", e);

    data.id = createLocalId();
    upsertBoreholeLocal(data);
    addMarker(data);

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

    // 🧾 відкрити панель редагування
    openPanel();

    // 🧠 заповнити форму
    document.getElementById("num").value = data.num || "";
    document.getElementById("depth").value = data.depth || "";
    document.getElementById("water").value = data.water || "";
    document.getElementById("soil").value = data.soil || "";
    document.getElementById("note").value = data.note || "";
    setElevationUI(data.elevation || "");
    setDistanceUI(data.distance || "");
  });

  marker.bindPopup(`
    <b>№${data.num}</b><br><br>
    Ґрунт: ${data.soil}<br>
    Глибина: ${data.depth} м<br><br>
    Рівень першої води: ${data.water} м<br>
    Висота над рівнем моря: ${data.elevation} м<br>
    ${data.distance ? `📍 Відстань до Полтави: ${Number(data.distance).toFixed(2)} км<br>` : ""}
  `);
}

// 🗑 видалення
async function deleteSelected() {
  // 🟡 видалення тимчасової точки
  if (window.tempMarker) {
    map.removeLayer(window.tempMarker);
    window.tempMarker = null;
    currentLatLng = null;
    clearForm();
    closePanel();
    return;
  }
  // 🔴 видалення збереженої точки (FIREBASE)
  if (selectedMarker && selectedId) {
    try {
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
    distance: String(getFieldNumber("distance"))
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

    if (selectedMarker) {
      selectedMarker.setPopupContent(`
        <b>№${b.num}</b><br><br>
        Ґрунт: ${b.soil}<br>
        Глибина: ${b.depth} м<br><br>
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
      <b>Нова свердловина</b><br><br>
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
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    namedetails: "1",
    "accept-language": "uk",
    countrycodes: "ua",
    dedupe: "1",
    limit: "12",
    q: `${q}, Полтавська область, Україна`
  });

  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) {
    throw new Error(`Nominatim не завантажився: ${res.status}`);
  }

  const data = await res.json();

  return uniquePlaces(
    data
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

function searchCityPRO(q) {
  const query = String(q || "").trim();
  clearTimeout(placeSearchTimer);
  placeSearchRequestId += 1;
  const requestId = placeSearchRequestId;

  if (!query) {
    renderPlaceSuggestions([]);
    return;
  }

  const localResults = localPlaceResults(query);

  if (localResults.length) {
    renderPlaceSuggestions(localResults);
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
        [],
        placesReady ? "Нічого не знайдено" : "База населених пунктів завантажується..."
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
  const depth = Number(document.getElementById("estDepth").value || 0);
  const transport = Number(document.getElementById("transportCost").value || 0);
  const filter = Number(document.getElementById("filterCost").value || 0);

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

  // калькулятор
  bindCostInputs();
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

  if (activeSearchMarker) {
    map.removeLayer(activeSearchMarker);
  }

  const popup = document.createElement("div");
  popup.textContent = label;

  activeSearchMarker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup(popup)
    .openPopup();
}

window.searchCityPRO = searchCityPRO;
window.goToPlace = goToPlace;
