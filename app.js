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

  document.getElementById("distance").value =
    Number(dist).toFixed(2);
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

  const input = document.getElementById("distance");
  if (input) input.value = dist;

  const data = {
    num: document.getElementById("num").value,
    depth: document.getElementById("depth").value,
    water: document.getElementById("water").value,
    soil: document.getElementById("soil").value,
    note: document.getElementById("note").value,
    elevation: document.getElementById("elevation").value || "0",
    distance: dist,
    lat: currentLatLng.lat,
    lng: currentLatLng.lng,
    createdAt: Date.now()
  };

  try {
    // 🔥 ЗБЕРЕЖЕННЯ В FIREBASE
    const docRef = await firebaseAddDoc(
      firebaseCollection(db, "boreholes"),
      data
    );

    // додаємо id з Firebase
    data.id = docRef.id;

    // локально для карти
    boreholes.push(data);
    addMarker(data);

  } catch (e) {
    console.log("Firebase error:", e);
    alert("Помилка збереження в Firebase");
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
    document.getElementById("elevation").value = data.elevation || "";
    document.getElementById("distance").value = data.distance || "";
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
      await firebaseDeleteDoc(
        firebaseDoc(db, "boreholes", selectedId)
      );
      map.removeLayer(selectedMarker);
      boreholes = boreholes.filter(
        b => b.id !== selectedId
      );
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
}


// 🧾 панель
function openPanel(){
  document.getElementById("formPanel").classList.add("open");
}
function closePanel(){
  document.getElementById("formPanel").classList.remove("open");
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
  document.getElementById("elevation").value = borehole.elevation || "";
  document.getElementById("distance").value = borehole.distance || "";

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
    note: document.getElementById("note").value
  };

  try {
    // 🔥 UPDATE FIREBASE
    await firebaseUpdateDoc(
      firebaseDoc(db, "boreholes", selectedId),
      updatedData
    );

    // 🔵 оновлюємо локально
    Object.assign(b, updatedData);

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
    alert("Помилка оновлення Firebase");
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
  document.getElementById("elevation").value = elevation;
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
  const handle = document.getElementById("drawerHandle");
  sidebar.classList.toggle("open");
  // міняємо стрілку
  if (sidebar.classList.contains("open")) {
    handle.innerHTML = "❮"; // закрити
  } else {
    handle.innerHTML = "❯"; // відкрити
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

async function searchCityPRO(q) {
  const box = document.getElementById("suggestions");
  if (!q || q.length < 2) {
    box.innerHTML = "";
    return;
  }
  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=20&accept-language=uk&q=${q}`;
  const res = await fetch(url);
  const data = await res.json();
  // 📍 ПОЛТАВСЬКА ОБЛАСТЬ (фільтр)
  const poltava = data.filter(p => {
    const lat = parseFloat(p.lat);
    const lon = parseFloat(p.lon);
    return (
      lat >= 48.8 &&
      lat <= 50.6 &&
      lon >= 32.0 &&
      lon <= 35.8
    );
  });
  const result = poltava.length > 0 ? poltava : data;
  if (result.length === 0) {
    box.innerHTML = "<div class='suggestion-item'>Нічого не знайдено</div>";
    return;
  }
  let html = "";
  result.forEach(p => {
    const name = p.display_name.split(",")[0];
    html += `
      <div class="suggestion-item"
        onclick="selectPlace(${p.lat}, ${p.lon}, \`${p.display_name}\`)">
        🚩 ${name}
        <div style="font-size:11px;opacity:0.6">
          ${p.display_name}
        </div>
      </div>
    `;
  });
  box.innerHTML = html;
}

document.getElementById("searchCity").addEventListener("input", (e) => {
  searchCityPRO(e.target.value);
});

function selectPlace(lat, lon, name) {
  // 🧹 заповнюємо поле і чистимо підказки
  document.getElementById("searchCity").value = name;
  document.getElementById("suggestions").innerHTML = "";

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

function setDistanceUI(value) {
  const el = document.getElementById("distance");
  if (!el) return;
  el.value = value ? Number(value).toFixed(2) : "";
}

function clearSearch() {
  document.getElementById("searchCity").value = "";
  document.getElementById("suggestions").innerHTML = "";
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
  const snap = await firebaseGetDocs(
    firebaseCollection(db, "boreholes")
  );

  boreholes = snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  boreholes.forEach(addMarker);
}

window.addEventListener("load", loadBoreholes);

function startAddPoint() {
  alert("Тапни по карті для додавання точки");
}