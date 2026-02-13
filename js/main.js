import { LOGO_URL, COMMUNES, MASSIFS, RLVL, CC, DC, hc } from "./config.js";
import { PENA_REAL } from "./data/pena.js";
import { DZ_REAL } from "./data/dz.js";
import { PISTES_REAL } from "./data/pistes.js";
import { CARRO_REAL } from "./data/carro.js";
import { GRID_20K } from "./data/grid.js";
import { MASSIFS_REAL } from "./data/massifs.js";
import { COMMUNE_DFCI } from "./data/communes.js";
import { CD } from "./data/cd.js";

let auth = { ok: false, level: null, commune: null };
let geoOn = true,
  myPos = null,
  geoWatch = null;
let currentTab = "carte",
  navMode = "gps";
let map,
  layers = {},
  allMapItems = [];
let zoneRisks = {};
let showLayers = {
  risk: true,
  patrols: true,
  pei: true,
  dz: true,
  pistes: true,
  dfci: true,
};
let patrolPositions = {};
let missions = [],
  interventions = [];

// ============================================================
// DATA PERSISTENCE (localStorage)
// ============================================================
const STORAGE_PREFIX = "pyrovigil_";
function dbSave(key, data) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  } catch (e) {
    console.warn("Storage full", e);
  }
}
function dbLoad(key, def) {
  try {
    const d = localStorage.getItem(STORAGE_PREFIX + key);
    return d ? JSON.parse(d) : def;
  } catch (e) {
    return def;
  }
}
function dbAppend(key, item) {
  const arr = dbLoad(key, []);
  arr.push(item);
  dbSave(key, arr);
  return arr;
}

// Persistent data stores
let patrolRecords = dbLoad("patrols", []); // Array of patrol day records
let fieldPhotos = dbLoad("photos", []); // Array of photo records
let burnedZones = dbLoad("burned", []); // Array of burned zone records
let fireStarts = dbLoad("firestarts", []); // Array of fire start point records
let gpsTrackData = dbLoad("gpstracks", {}); // {trackId: [{lat,lon,ts},...]}
let activeTrackId = null; // Currently recording GPS track
let trackWatchId = null; // GPS watch for track recording
let vehicleFleet = dbLoad("fleet", []); // Array of registered vehicles

// Init risk levels (all vert = hors saison) — keyed by real massif names
MASSIFS.forEach((m) => {
  zoneRisks[m.nom] = "vert";
});
// Also key by MASSIFS_REAL names for polygon matching
if (typeof MASSIFS_REAL !== "undefined") {
  MASSIFS_REAL.forEach((mr) => {
    if (!zoneRisks[mr.nom]) zoneRisks[mr.nom] = "vert";
  });
}

// Simulate patrol positions WITH DFCI vehicle codes
// Code commune DFCI + numéro : 1=président, 2+=équipages
CD.forEach((c) => {
  const dfci =
    (typeof COMMUNE_DFCI !== "undefined" && COMMUNE_DFCI[c.n]) ||
    c.n.substring(0, 3).toUpperCase();
  // Président = code 1
  if (Math.random() > 0.7) {
    const heading = Math.round(Math.random() * 360);
    patrolPositions[dfci + "1"] = {
      lat: c.lat + (Math.random() - 0.5) * 0.025,
      lon: c.lon + (Math.random() - 0.5) * 0.025,
      up: new Date(Date.now() - Math.random() * 3600000).toISOString(),
      type: "president",
      commune: c.n,
      dfci: dfci,
      heading: heading,
    };
  }
  // Véhicules patrouille = 2,3,4...
  for (let i = 2; i <= 5; i++) {
    if (Math.random() > 0.6) {
      const heading = Math.round(Math.random() * 360);
      patrolPositions[dfci + i] = {
        lat: c.lat + (Math.random() - 0.5) * 0.03,
        lon: c.lon + (Math.random() - 0.5) * 0.03,
        up: new Date(Date.now() - Math.random() * 3600000).toISOString(),
        type: "surveillance",
        commune: c.n,
        dfci: dfci,
        heading: heading,
      };
    }
  }
});

// Show demo codes
document.getElementById("demo-codes").innerHTML =
  `<b style="color:#94a3b8">Démo :</b> Dept: <code style="color:#fca5a5;background:rgba(220,38,38,0.1);padding:0 4px;border-radius:3px">${DC}</code> | Toulon: <code style="color:#93c5fd;background:rgba(59,130,246,0.1);padding:0 4px;border-radius:3px">${CC["Toulon"]}</code> | Fréjus: <code style="color:#93c5fd;background:rgba(59,130,246,0.1);padding:0 4px;border-radius:3px">${CC["Fréjus"]}</code> | Draguignan: <code style="color:#93c5fd;background:rgba(59,130,246,0.1);padding:0 4px;border-radius:3px">${CC["Draguignan"]}</code>`;

// Enter key on login
document.getElementById("login-code").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});
// Set login logo
setTimeout(() => {
  if (typeof LOGO_URL !== "undefined") {
    const el = document.getElementById("login-logo");
    if (el) el.src = LOGO_URL;
  }
}, 50);

// ============================================================
// AUTH
// ============================================================
function doLogin() {
  const c = document.getElementById("login-code").value.trim();
  if (c === DC) {
    auth = { ok: true, level: "dept", commune: null };
  } else {
    const found = Object.entries(CC).find(([, v]) => v === c);
    if (found) auth = { ok: true, level: "commune", commune: found[0] };
    else {
      document.getElementById("login-error").style.display = "block";
      document.getElementById("login-error").textContent = "Code invalide";
      return;
    }
  }
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("main-app").style.display = "block";
  document.getElementById("auth-label").innerHTML =
    auth.level === "dept"
      ? '<span class="material-symbols-outlined" style="font-size:12px">account_balance</span> Accès département — Toutes les communes'
      : '<span class="material-symbols-outlined" style="font-size:12px">location_city</span> Commune de ' +
        auth.commune;
  initApp();
}

function logout() {
  auth = { ok: false, level: null, commune: null };
  document.getElementById("main-app").style.display = "none";
  document.getElementById("login-screen").style.display = "flex";
  document.getElementById("login-code").value = "";
  if (geoWatch) navigator.geolocation.clearWatch(geoWatch);
  if (map) {
    map.remove();
    map = null;
  }
}

// ============================================================
// APP INIT
// ============================================================
function initApp() {
  buildNav();
  initGeo();
  updateGeoBtn();
  // Set logos
  if (typeof LOGO_URL !== "undefined") {
    document
      .querySelectorAll("#login-logo,#header-logo,#map-logo")
      .forEach((el) => {
        if (el) el.src = LOGO_URL;
      });
  }
  setTimeout(initMap, 100);
  buildRisqueTab();
  buildLayerToggles();
  buildRiskLegend();
  buildLegendeOfficielle();
  switchTab("carte");
}

function buildNav() {
  const tabs = [
    {
      k: "carte",
      i: '<span class="material-symbols-outlined" style="font-size:14px">map</span>',
      l: "Carte",
    },
    {
      k: "dashboard",
      i: '<span class="material-symbols-outlined" style="font-size:14px">analytics</span>',
      l: "Bord",
    },
    ...(auth.level === "dept"
      ? [
          {
            k: "communes",
            i: '<span class="material-symbols-outlined" style="font-size:14px">location_city</span>',
            l: "Communes",
          },
        ]
      : []),
    {
      k: "patrouilles",
      i: '<span class="material-symbols-outlined" style="font-size:14px">local_fire_department</span>',
      l: "Patrouilles",
    },
    {
      k: "vehicules",
      i: '<span class="material-symbols-outlined" style="font-size:14px">directions_car</span>',
      l: "Véhicules",
    },
    {
      k: "missions",
      i: '<span class="material-symbols-outlined" style="font-size:14px">track_changes</span>',
      l: "Missions",
    },
    {
      k: "saisie",
      i: '<span class="material-symbols-outlined" style="font-size:14px">edit_note</span>',
      l: "Saisie",
    },
    {
      k: "historique",
      i: '<span class="material-symbols-outlined" style="font-size:14px">history_edu</span>',
      l: "Historique",
    },
    {
      k: "photos",
      i: '<span class="material-symbols-outlined" style="font-size:14px">photo_camera</span>',
      l: "Relevés",
    },
    {
      k: "risque",
      i: '<span class="material-symbols-outlined" style="font-size:14px">warning</span>',
      l: "Risque",
    },
    {
      k: "sos-config",
      i: '<span class="material-symbols-outlined" style="font-size:14px">phonelink_ring</span>',
      l: "SOS Tél.",
    },
    {
      k: "codes",
      i: '<span class="material-symbols-outlined" style="font-size:14px">key</span>',
      l: "Codes",
    },
  ];
  const nav = document.getElementById("nav-bar");
  nav.innerHTML = tabs
    .map(
      (t) =>
        `<button onclick="switchTab('${t.k}')" id="nav-${t.k}" class="btn" style="padding:6px 12px;font-size:11px;font-weight:600;background:${t.k === currentTab ? "#dc2626" : "rgba(255,255,255,0.05)"};color:${t.k === currentTab ? "#fff" : "#94a3b8"};white-space:nowrap">${t.i} ${t.l}</button>`,
    )
    .join("");
}

function switchTab(t) {
  currentTab = t;
  document
    .querySelectorAll(".tab-content")
    .forEach((el) => el.classList.remove("active"));
  const el = document.getElementById("tab-" + t);
  if (el) el.classList.add("active");
  document.querySelectorAll("#nav-bar button").forEach((b) => {
    const isActive = b.id === "nav-" + t;
    b.style.background = isActive ? "#dc2626" : "rgba(255,255,255,0.05)";
    b.style.color = isActive ? "#fff" : "#94a3b8";
  });
  if (t === "carte" && map) setTimeout(() => map.invalidateSize(), 100);
  // Add PyroVigil footer to non-map tabs
  if (t !== "carte") {
    const tabEl = document.getElementById("tab-" + t);
    if (tabEl && !tabEl.querySelector(".pv-footer")) {
      const ftDiv = document.createElement("div");
      ftDiv.className = "pv-footer";
      ftDiv.innerHTML = pvFooter();
      tabEl.appendChild(ftDiv);
    }
  }
  // Set map logo
  const ml = document.getElementById("map-logo");
  if (ml && typeof LOGO_URL !== "undefined") ml.src = LOGO_URL;
  if (t === "dashboard") buildDashboard();
  if (t === "communes") buildCommunes();
  if (t === "patrouilles") buildPatrouilles();
  if (t === "vehicules") buildVehicules();
  if (t === "missions") buildMissions();
  if (t === "saisie") buildSaisie();
  if (t === "historique") buildHistorique();
  if (t === "photos") buildPhotos();
  if (t === "codes") buildCodes();
  if (t === "sos-config") buildSOSConfig();
}

// ============================================================
// MAP
// ============================================================
function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true }).setView([43.4, 6.2], 9);
  layers.topo = L.tileLayer(
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&FORMAT=image/png&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    { maxZoom: 19, attribution: "© IGN" },
  );
  layers.ortho = L.tileLayer(
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    { maxZoom: 19, attribution: "© IGN Orthophotos" },
  );
  layers.osm = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "© OpenStreetMap" },
  );
  layers.topo.addTo(map);
  // Refresh markers on move/zoom
  map.on("moveend", updateMapMarkers);
  map.on("zoomend", updateMapMarkers);
  // DFCI lookup on click
  map.on("click", function (e) {
    if (typeof CARRO_REAL === "undefined") return;
    const lat = e.latlng.lat,
      lon = e.latlng.lng;
    // Find nearest DFCI cell
    let best = null,
      bestD = Infinity;
    for (let i = 0; i < CARRO_REAL.length; i++) {
      const c = CARRO_REAL[i];
      const d = Math.abs(c.a - lat) + Math.abs(c.o - lon);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && bestD < 0.02) {
      L.popup()
        .setLatLng(e.latlng)
        .setContent(
          `<b style="color:#f59e0b"><span class="material-symbols-outlined" style="font-size:14px">grid_4x4</span> DFCI: <code>${best.d}</code></b><br><code>${lat.toFixed(5)}, ${lon.toFixed(5)}</code><br><a href="https://waze.com/ul?ll=${lat},${lon}&navigate=yes" target="_blank" style="color:#33ccff"><span class="material-symbols-outlined" style="font-size:14px">explore</span> Waze</a>`,
        )
        .openOn(map);
    }
  });
  updateMapMarkers();
}

function switchLayer(name) {
  if (!map) return;
  ["topo", "ortho", "osm"].forEach((k) => {
    try {
      map.removeLayer(layers[k]);
    } catch (e) {}
    const btn = document.getElementById("ly-" + k);
    if (btn) {
      btn.style.border =
        k === name ? "1px solid #dc2626" : "1px solid rgba(255,255,255,0.1)";
      btn.style.background =
        k === name ? "rgba(220,38,38,0.2)" : "rgba(0,0,0,0.3)";
      btn.style.color = k === name ? "#fca5a5" : "#64748b";
    }
  });
  layers[name].addTo(map);
}

function updateMapMarkers() {
  if (!map) return;
  allMapItems.forEach((m) => {
    try {
      map.removeLayer(m);
    } catch (e) {}
  });
  allMapItems = [];

  // My position
  if (myPos && geoOn) {
    const me = L.circleMarker([myPos.lat, myPos.lon], {
      radius: 10,
      color: "#dc2626",
      fillColor: "#ef4444",
      fillOpacity: 0.9,
      weight: 3,
    }).bindPopup(
      `<b style="color:#dc2626"><span class="material-symbols-outlined" style="font-size:14px">my_location</span> Ma position</b><br><code>${myPos.lat.toFixed(5)}, ${myPos.lon.toFixed(5)}</code><br>Alt: ${myPos.alt}m ±${myPos.acc}m`,
    );
    me.addTo(map);
    allMapItems.push(me);
  }

  // Patrol positions — Orange car icons with heading
  if (showLayers.patrols) {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    Object.entries(patrolPositions).forEach(([code, pos]) => {
      if (
        pos.lat < bounds.getSouth() ||
        pos.lat > bounds.getNorth() ||
        pos.lon < bounds.getWest() ||
        pos.lon > bounds.getEast()
      )
        return;
      const isPres = pos.type === "president";
      const h = pos.heading || 0;
      const sz = zoom >= 13 ? 28 : zoom >= 11 ? 22 : 16;
      // SVG car icon rotated by heading
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 32 32" style="transform:rotate(${h}deg)">
        <g fill="${isPres ? "#dc2626" : "#f97316"}" stroke="#000" stroke-width="1">
          <rect x="8" y="4" width="16" height="24" rx="5" ry="5"/>
          <rect x="10" y="7" width="12" height="7" rx="2" ry="2" fill="${isPres ? "#fca5a5" : "#fed7aa"}" stroke="none"/>
          <rect x="10" y="18" width="12" height="4" rx="1" ry="1" fill="${isPres ? "#fca5a5" : "#fed7aa"}" stroke="none"/>
          <circle cx="10" cy="26" r="2.5" fill="#333"/>
          <circle cx="22" cy="26" r="2.5" fill="#333"/>
          <circle cx="10" cy="6" r="2.5" fill="#333"/>
          <circle cx="22" cy="6" r="2.5" fill="#333"/>
          <polygon points="16,1 13,5 19,5" fill="${isPres ? "#dc2626" : "#f97316"}"/>
        </g>
      </svg>`;
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative">${svg}${zoom >= 13 ? `<div style="position:absolute;top:${sz}px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,0.75);color:${isPres ? "#fca5a5" : "#fdba74"};font-size:9px;font-weight:700;padding:0 3px;border-radius:2px;font-family:'Space Grotesk',monospace">${code}</div>` : ""}</div>`,
        iconSize: [sz, sz + 16],
        iconAnchor: [sz / 2, sz / 2],
      });
      const m = L.marker([pos.lat, pos.lon], { icon: icon }).bindPopup(
        `<b style="color:${isPres ? "#dc2626" : "#f97316"}"><span class="material-symbols-outlined" style="font-size:14px">directions_car</span> ${code}</b> ${isPres ? '<span class="material-symbols-outlined" style="font-size:14px">stars</span> Président' : ""}<br>Commune: ${pos.commune || ""}<br>DFCI: ${pos.dfci || ""}<br>Cap: ${h}°<br><code>${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)}</code><br><small>MàJ ${new Date(pos.up).toLocaleTimeString("fr-FR")}</small><br><a href="https://waze.com/ul?ll=${pos.lat},${pos.lon}&navigate=yes" target="_blank" style="color:#33ccff"><span class="material-symbols-outlined" style="font-size:14px">explore</span> Waze</a>`,
      );
      m.addTo(map);
      allMapItems.push(m);
    });
  }
  document.getElementById("patrol-count").textContent =
    Object.keys(patrolPositions).length;

  // PENA - Real water points (1924)
  if (showLayers.pei && typeof PENA_REAL !== "undefined") {
    const natIcons = {
      CF: '<span class="material-symbols-outlined" style="font-size:14px">water_drop</span>',
      CE: '<span class="material-symbols-outlined" style="font-size:14px">water_drop</span>',
      RI: '<span class="material-symbols-outlined" style="color:#22d3ee;font-size:14px">crop_square</span>',
      RE: '<span class="material-symbols-outlined" style="font-size:14px">waves</span>',
      PE: '<span class="material-symbols-outlined" style="font-size:14px">waves</span>',
      CE2: '<span class="material-symbols-outlined" style="font-size:14px">landscape</span>',
      PU: '<span class="material-symbols-outlined" style="font-size:14px">square</span>',
    };
    const natNames = {
      CF: "Citerne fixe",
      CE: "Citerne enterrée",
      RI: "Réserve incendie",
      RE: "Retenue",
      PE: "Plan d'eau",
      CE2: "Cours d'eau",
      PU: "Puisard",
    };
    // Use marker cluster approach: only show markers at zoom >= 11
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    let count = 0;
    PENA_REAL.forEach((p) => {
      if (
        p.la < bounds.getSouth() ||
        p.la > bounds.getNorth() ||
        p.lo < bounds.getWest() ||
        p.lo > bounds.getEast()
      )
        return;
      if (zoom < 10 && count > 300) return; // Limit at low zoom
      count++;
      const icon =
        natIcons[p.na] ||
        '<span class="material-symbols-outlined" style="font-size:14px">water_drop</span>';
      const name = natNames[p.na] || p.na;
      const dispo = p.d
        ? '<span style="color:#22c55e"><span class="material-symbols-outlined" style="font-size:14px">check_circle</span> DISPO</span>'
        : '<span style="color:#ef4444"><span class="material-symbols-outlined" style="font-size:14px">cancel</span> INDISPO</span>';
      const m = L.circleMarker([p.la, p.lo], {
        radius: zoom >= 13 ? 6 : 4,
        color: p.d ? "#22d3ee" : "#ef4444",
        fillColor: p.d ? "#06b6d4" : "#dc2626",
        fillOpacity: 0.7,
        weight: 1.5,
      }).bindPopup(
        `<b>${icon} ${p.n || name}</b><br>${name} ${dispo}${p.c ? `<br>Capacité: <b>${p.c} m³</b>` : ""}${p.df ? `<br>DFCI: <code>${p.df}</code>` : ""}<br><a href="https://waze.com/ul?ll=${p.la},${p.lo}&navigate=yes" target="_blank" style="color:#33ccff"><span class="material-symbols-outlined" style="font-size:14px">explore</span> Naviguer Waze</a>`,
      );
      m.addTo(map);
      allMapItems.push(m);
    });
  }

  // DZ - Drop Zones hélicoptères (647)
  if (showLayers.dz && typeof DZ_REAL !== "undefined") {
    const bounds = map.getBounds();
    DZ_REAL.forEach((d) => {
      if (
        d.la < bounds.getSouth() ||
        d.la > bounds.getNorth() ||
        d.lo < bounds.getWest() ||
        d.lo > bounds.getEast()
      )
        return;
      const m = L.marker([d.la, d.lo], {
        icon: L.divIcon({
          className: "",
          html: '<div style="font-size:14px;text-shadow:1px 1px 2px #000"><span class="material-symbols-outlined" style="font-size:18px;color:#a855f7">helicopter</span></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      }).bindPopup(
        `<b><span class="material-symbols-outlined" style="font-size:14px">helicopter</span> ${d.n}</b><br>Revêtement: ${d.r || "N/C"}<br><code>${d.la.toFixed(5)}, ${d.lo.toFixed(5)}</code><br><a href="https://waze.com/ul?ll=${d.la},${d.lo}&navigate=yes" target="_blank" style="color:#33ccff"><span class="material-symbols-outlined" style="font-size:14px">explore</span> Waze</a>`,
      );
      m.addTo(map);
      allMapItems.push(m);
    });
  }

  // Pistes DFCI (4047 real tracks)
  if (showLayers.pistes && typeof PISTES_REAL !== "undefined") {
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const catColors = {
      1: "#ef4444",
      2: "#f97316",
      3: "#eab308",
      9: "#94a3b8",
    };
    const catWeights = { 1: 3, 2: 2.5, 3: 2, 9: 1.5 };
    const catNames = {
      1: "Cat. 1 (principale)",
      2: "Cat. 2 (secondaire)",
      3: "Cat. 3 (tertiaire)",
      9: "Autre",
    };
    // At low zoom, only show cat 1-2
    const minCat = zoom < 11 ? 2 : zoom < 13 ? 3 : 9;
    PISTES_REAL.forEach((p) => {
      if (p.c > minCat) return;
      // Check if any point is in view
      const inView = p.p.some(
        (pt) =>
          pt[0] >= bounds.getSouth() &&
          pt[0] <= bounds.getNorth() &&
          pt[1] >= bounds.getWest() &&
          pt[1] <= bounds.getEast(),
      );
      if (!inView) return;
      const col = catColors[p.c] || "#f97316";
      const w = catWeights[p.c] || 2;
      const l = L.polyline(p.p, {
        color: col,
        weight: w,
        opacity: 0.75,
        dashArray: p.c >= 3 ? "6,4" : null,
      }).bindPopup(
        `<b><span class="material-symbols-outlined" style="font-size:14px">alt_route</span> ${p.n || "Piste DFCI"}</b><br>${catNames[p.c] || ""}`,
      );
      l.addTo(map);
      allMapItems.push(l);
    });
  }

  // DFCI Grid (real 20km squares + sub-grid at high zoom)
  if (showLayers.dfci && typeof GRID_20K !== "undefined") {
    const zoom = map.getZoom();
    // Draw 20km square boundaries
    Object.entries(GRID_20K).forEach(([code, b]) => {
      const rect = L.rectangle(
        [
          [b.min_lat, b.min_lon],
          [b.max_lat, b.max_lon],
        ],
        {
          color: "#64748b",
          weight: zoom >= 12 ? 1.5 : 1,
          opacity: 0.4,
          fill: false,
          dashArray: zoom >= 12 ? null : "4,4",
        },
      );
      if (zoom >= 10) {
        rect.bindTooltip(code, {
          permanent: zoom >= 12,
          direction: "center",
          className: "dfci-label",
          offset: [0, 0],
        });
      }
      rect.addTo(map);
      allMapItems.push(rect);
    });
  }

  // Risk zones — Real polygons from prefectural GeoJSON
  if (showLayers.risk && typeof MASSIFS_REAL !== "undefined") {
    MASSIFS_REAL.forEach((mr) => {
      // Match to MASSIFS for risk level
      const massifMatch = MASSIFS.find((m) => m.id === mr.id);
      const nom = massifMatch ? massifMatch.nom : mr.nom;
      const riskKey =
        Object.keys(zoneRisks).find((k) =>
          k.toLowerCase().includes(mr.nom.toLowerCase().split(" ")[0]),
        ) || nom;
      const riskVal = zoneRisks[riskKey] || zoneRisks[nom] || "vert";
      const rl = RLVL.find((r) => r.v === riskVal) || RLVL[0];

      mr.polys.forEach((ring) => {
        const poly = L.polygon(ring, {
          color: rl.c,
          fillColor: rl.c,
          fillOpacity:
            riskVal === "vert"
              ? 0.08
              : riskVal === "jaune"
                ? 0.12
                : riskVal === "orange"
                  ? 0.18
                  : riskVal === "rouge"
                    ? 0.25
                    : 0.3,
          weight: 2,
          dashArray: riskVal === "vert" ? "4,4" : null,
        }).bindPopup(
          `<b style="color:${rl.c}"><span class="material-symbols-outlined" style="font-size:14px">warning</span> ${mr.id} — ${mr.nom}</b><br>Niveau: <b style="color:${rl.c}">${rl.ls.toUpperCase()}</b><br>${rl.desc}`,
        );
        poly.addTo(map);
        allMapItems.push(poly);
      });

      // Label at centroid
      if (map.getZoom() >= 10) {
        const label = L.marker([mr.clat, mr.clon], {
          icon: L.divIcon({
            className: "",
            html: `<div style="background:${rl.bg};border:1px solid ${rl.c};color:${rl.c};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap;font-family:'Space Grotesk',sans-serif;text-align:center">${mr.id}-${mr.nom}<br><span style="font-size:12px">${rl.ls.toUpperCase()}</span></div>`,
            iconSize: [120, 36],
            iconAnchor: [60, 18],
          }),
        });
        label.addTo(map);
        allMapItems.push(label);
      }
    });
  }
}

function buildLayerToggles() {
  const items = [
    {
      k: "risk",
      l: '<span class="material-symbols-outlined" style="font-size:14px">warning</span> Risque météo',
      c: "#ef4444",
    },
    {
      k: "patrols",
      l: '<span class="material-symbols-outlined" style="font-size:14px">local_fire_department</span> Patrouilles',
      c: "#3b82f6",
    },
    {
      k: "pei",
      l:
        '<span class="material-symbols-outlined" style="font-size:14px">water_drop</span> PENA (' +
        PENA_REAL.length +
        ")",
      c: "#22d3ee",
    },
    {
      k: "dz",
      l:
        '<span class="material-symbols-outlined" style="font-size:14px">helicopter</span> DZ héli (' +
        DZ_REAL.length +
        ")",
      c: "#a855f7",
    },
    {
      k: "pistes",
      l:
        '<span class="material-symbols-outlined" style="font-size:14px">alt_route</span> Pistes (' +
        PISTES_REAL.length +
        ")",
      c: "#f97316",
    },
    {
      k: "dfci",
      l: '<span class="material-symbols-outlined" style="font-size:14px">grid_4x4</span> Grille DFCI',
      c: "#94a3b8",
    },
  ];
  document.getElementById("layer-toggles").innerHTML =
    `<div style="font-size:10px;color:#94a3b8;font-weight:700;margin-bottom:6px">COUCHES</div>` +
    items
      .map(
        (t) =>
          `<label style="display:flex;align-items:center;gap:6px;font-size:10px;color:${showLayers[t.k] ? t.c : "#4b5563"};cursor:pointer;padding:2px 0"><input type="checkbox" ${showLayers[t.k] ? "checked" : ""} onchange="toggleLayer('${t.k}')" style="accent-color:${t.c}"/>${t.l}</label>`,
      )
      .join("");
}

function toggleLayer(k) {
  showLayers[k] = !showLayers[k];
  buildLayerToggles();
  updateMapMarkers();
  buildRiskLegend();
}

function buildRiskLegend() {
  if (!showLayers.risk) {
    document.getElementById("risk-legend").style.display = "none";
    return;
  }
  document.getElementById("risk-legend").style.display = "block";
  document.getElementById("risk-legend").innerHTML =
    `<div style="font-size:10px;color:#94a3b8;font-weight:700;margin-bottom:6px"><span class="material-symbols-outlined" style="font-size:12px">warning</span> RISQUE PRÉFECTORAL</div>` +
    MASSIFS.map((m) => {
      const rl = RLVL.find((r) => r.v === zoneRisks[m.nom]) || RLVL[0];
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)"><span style="font-size:9px;color:#cbd5e1">${m.id}. ${m.nom}</span><span style="padding:1px 6px;border-radius:8px;background:${rl.bg};color:${rl.c};font-size:9px;font-weight:700;border:1px solid ${rl.c}">${rl.ls}</span></div>`;
    }).join("") +
    `<div style="margin-top:6px;font-size:9px;color:#4b5563"><a href="https://www.risque-prevention-incendie.fr/var/" target="_blank" style="color:#93c5fd">📋 Source préfecture</a></div>`;
}

// ============================================================
// RISQUE TAB
// ============================================================
function buildRisqueTab() {
  const el = document.getElementById("risque-zones");
  el.innerHTML = MASSIFS.map((m) => {
    const rl = RLVL.find((r) => r.v === zoneRisks[m.nom]) || RLVL[0];
    return `<div class="card" style="margin-bottom:8px;border-left:4px solid ${rl.c}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div><div style="font-size:15px;font-weight:700;color:#f1f5f9;font-family:'Space Grotesk'">${m.id}. ${m.nom}</div><div style="font-size:11px;color:#64748b">${m.communes.length} communes</div></div>
        <span style="padding:4px 14px;border-radius:14px;background:${rl.bg};color:${rl.c};font-size:13px;font-weight:800;border:1px solid ${rl.c}"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${rl.c};margin-right:6px"></span>${rl.ls}</span>
      </div>
      ${auth.level === "dept" ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px">${RLVL.map((r) => `<button onclick="setRisk('${m.nom}','${r.v}')" class="risk-btn" style="background:${r.bg};color:${r.c};border-color:${zoneRisks[m.nom] === r.v ? r.c : "transparent"};opacity:${zoneRisks[m.nom] === r.v ? 1 : 0.35}">${r.ls}</button>`).join("")}</div>` : ""}
      <div style="font-size:10px;color:#4b5563;line-height:1.5">${m.communes.join(", ")}</div>
    </div>`;
  }).join("");
}

function buildLegendeOfficielle() {
  document.getElementById("risque-legende").innerHTML = RLVL.map(
    (r) =>
      `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:${r.bg};border:1px solid ${r.c}30;border-radius:6px">
      <span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${r.c};flex-shrink:0"></span>
      <div><div style="font-size:12px;font-weight:700;color:${r.c}">${r.ls}</div><div style="font-size:11px;color:#94a3b8">${r.desc}</div></div>
    </div>`,
  ).join("");
}

function setRisk(nom, val) {
  zoneRisks[nom] = val;
  buildRisqueTab();
  buildRiskLegend();
  updateMapMarkers();
}

// ============================================================
// GEOLOCATION
// ============================================================
function initGeo() {
  if (!geoOn || !navigator.geolocation) return;
  geoWatch = navigator.geolocation.watchPosition(
    (p) => {
      myPos = {
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        alt: Math.round(p.coords.altitude || 0),
        acc: Math.round(p.coords.accuracy),
      };
      updateGeoBtn();
      updateMapMarkers();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000 },
  );
}
function toggleGeo() {
  geoOn = !geoOn;
  if (!geoOn && geoWatch) {
    navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
  } else initGeo();
  updateGeoBtn();
  updateMapMarkers();
}
function updateGeoBtn() {
  const btn = document.getElementById("geo-btn");
  btn.style.border = `1px solid ${geoOn ? "#22c55e" : "#ef4444"}`;
  btn.style.background = geoOn ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)";
  btn.style.color = geoOn ? "#22c55e" : "#ef4444";
  btn.textContent = geoOn ? "GPS ON" : "GPS OFF";
  document.getElementById("pos-label").innerHTML =
    myPos && geoOn
      ? `<span class="material-symbols-outlined" style="font-size:10px">my_location</span> ${myPos.lat.toFixed(4)},${myPos.lon.toFixed(4)}`
      : "";
}

// SOS Phones per commune (1-3 phones)
let sosPhones = {};
COMMUNES.forEach((c) => {
  sosPhones[c] = [];
});
// Some defaults for demo
sosPhones["Toulon"] = ["06 12 34 56 78", "06 98 76 54 32", "04 94 00 00 01"];
sosPhones["Draguignan"] = ["06 11 22 33 44", "06 55 66 77 88"];
sosPhones["Fréjus"] = ["06 10 20 30 40"];
sosPhones["Hyères"] = ["06 41 42 43 44", "06 51 52 53 54"];
sosPhones["Brignoles"] = ["06 61 62 63 64"];
sosPhones["Saint-Raphaël"] = ["06 71 72 73 74", "06 81 82 83 84"];

let sosCountdownTimer = null;
let sosCountdownValue = 10;

// ============================================================
// SOS WITH 10s COUNTDOWN
// ============================================================
function triggerSOS() {
  // Start countdown
  sosCountdownValue = 10;
  const ov = document.getElementById("sos-countdown");
  ov.style.display = "flex";
  document.getElementById("sos-timer").textContent = "10";
  document.getElementById("sos-progress").style.width = "100%";
  document.getElementById("sos-countdown-pos").textContent = myPos
    ? ` ${myPos.lat.toFixed(5)}, ${myPos.lon.toFixed(5)}`
    : " Position GPS indisponible";

  // Force reflow for CSS transition
  setTimeout(() => {
    document.getElementById("sos-progress").style.width = "0%";
  }, 50);

  sosCountdownTimer = setInterval(() => {
    sosCountdownValue--;
    document.getElementById("sos-timer").textContent = sosCountdownValue;
    if (sosCountdownValue <= 0) {
      clearInterval(sosCountdownTimer);
      sosCountdownTimer = null;
      ov.style.display = "none";
      sendSOS();
    }
  }, 1000);
}

function cancelSOS() {
  if (sosCountdownTimer) {
    clearInterval(sosCountdownTimer);
    sosCountdownTimer = null;
  }
  document.getElementById("sos-countdown").style.display = "none";
}

function sendSOS() {
  const pos = myPos || { lat: "N/A", lon: "N/A" };
  const commune = auth.commune || "VAR";
  const phones = sosPhones[commune] || [];

  // Show sent overlay
  const sent = document.getElementById("sos-sent");
  sent.style.display = "flex";
  document.getElementById("sos-sent-pos").textContent = myPos
    ? ` ${myPos.lat.toFixed(5)}, ${myPos.lon.toFixed(5)}`
    : "";
  document.getElementById("sos-sent-phones").innerHTML =
    phones.length > 0
      ? `<span class="material-symbols-outlined" style="font-size:14px">call</span> Alertes envoyées à :<br>${phones.map((p) => `<b>${p}</b>`).join(" — ")}`
      : `<span class="material-symbols-outlined" style="font-size:14px">warning</span> Aucun téléphone SOS configuré pour ${commune}`;

  // Register mission
  missions.unshift({
    id: Date.now(),
    ts: new Date().toISOString(),
    mtype: "inter_feu",
    patrol: "SOS",
    commune: commune,
    dfci: "",
    gps: myPos ? `${myPos.lat.toFixed(5)},${myPos.lon.toFixed(5)}` : "N/A",
    instr: `<span class="material-symbols-outlined">emergency_share</span> ALERTE SOS — Phones: ${phones.join(", ") || "aucun configuré"}`,
    sos: true,
  });

  // Attempt to open phone dialer with first number
  if (phones.length > 0) {
    const cleanPhone = phones[0].replace(/\s/g, "");
    // On mobile, this would open the dialer
    try {
      window.open(`tel:${cleanPhone}`, "_self");
    } catch (e) {}
  }

  setTimeout(() => {
    sent.style.display = "none";
  }, 6000);
}

// ============================================================
// NAVIGATION / GUIDAGE GPS
// ============================================================
let navTarget = null; // {lat, lon, label}
let navRouteLine = null;
let navMarker = null;

function toggleNavPanel() {
  const body = document.getElementById("nav-panel-body");
  const btn = document.getElementById("nav-toggle");
  if (body.style.display === "none") {
    body.style.display = "block";
    btn.textContent = "▼";
  } else {
    body.style.display = "none";
    btn.textContent = "▲";
  }
}

function setNavMode(m) {
  navMode = m;
  ["gps", "dfci", "adresse", "pei"].forEach((k) => {
    const b = document.getElementById("nm-" + k);
    if (!b) return;
    b.style.border =
      k === m ? "1px solid #22c55e" : "1px solid rgba(255,255,255,0.1)";
    b.style.background = k === m ? "rgba(34,197,94,0.15)" : "rgba(0,0,0,0.3)";
    b.style.color = k === m ? "#22c55e" : "#64748b";
  });
  const ph = {
    gps: "43.4534, 6.2345",
    dfci: "KD80C4 ou KD48E8.5",
    adresse: "Adresse, lieu...",
    pei: "Nom citerne ou numéro...",
  };
  document.getElementById("nav-input").placeholder = ph[m] || "";
}

function navigateTarget() {
  const v = document.getElementById("nav-input").value.trim();
  if (!v) return;
  let lat, lon, label;

  if (navMode === "gps") {
    const p = v.split(/[,;\s]+/).map((s) => parseFloat(s.trim()));
    if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) {
      lat = p[0];
      lon = p[1];
      label = `GPS ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    }
  } else if (navMode === "dfci") {
    // Lookup in CARRO_REAL
    if (typeof CARRO_REAL !== "undefined") {
      const q = v.toUpperCase().trim();
      const found = CARRO_REAL.find((c) => c.d === q || c.d.startsWith(q));
      if (found) {
        lat = found.a;
        lon = found.o;
        label = `DFCI ${found.d}`;
      } else {
        // Try partial match
        const partial = CARRO_REAL.filter((c) => c.d.includes(q));
        if (partial.length > 0) {
          lat = partial[0].a;
          lon = partial[0].o;
          label = `DFCI ${partial[0].d} (${partial.length} résultats)`;
        }
      }
    }
    if (!lat) {
      // Fallback: old DFCI grid calculation
      const m = v.toUpperCase().match(/^([A-Z])([A-Z])(\d)(\d)/);
      if (m) {
        lat = 42 + (m[2].charCodeAt(0) - 65) * 0.2 + parseInt(m[4]) * 0.02;
        lon = 5 + (m[1].charCodeAt(0) - 65) * 0.2 + parseInt(m[3]) * 0.02;
        label = `DFCI ~${v.toUpperCase()}`;
      }
    }
  } else if (navMode === "adresse") {
    // Open Waze search directly
    window.open(
      `https://waze.com/ul?q=${encodeURIComponent(v)}&navigate=yes`,
      "_blank",
    );
    return;
  } else if (navMode === "pei") {
    // Search in PENA_REAL
    if (typeof PENA_REAL !== "undefined") {
      const q = v.toLowerCase();
      const found = PENA_REAL.find(
        (p) =>
          (p.n || "").toLowerCase().includes(q) ||
          (p.df || "").toLowerCase().includes(q),
      );
      if (found) {
        lat = found.la;
        lon = found.lo;
        label = `<span class="material-symbols-outlined" style="font-size:14px">water_drop</span> ${found.n || found.df} (${found.c || "?"}m³)`;
      }
    }
  }

  if (lat && lon) {
    navTarget = { lat, lon, label };
    // Show target on map
    showNavTarget();
    // Update info panel
    const info = document.getElementById("nav-target-info");
    info.style.display = "block";
    document.getElementById("nav-dest-label").textContent = label;
    // Distance from my position
    if (myPos) {
      const d = haversine(myPos.lat, myPos.lon, lat, lon);
      document.getElementById("nav-dist").textContent =
        d < 1 ? `${Math.round(d * 1000)}m` : `${d.toFixed(1)}km`;
    }
    // Center map
    if (map) map.setView([lat, lon], 14);
  } else {
    alert("Coordonnée non trouvée. Vérifiez votre saisie.");
  }
}

function showNavTarget() {
  if (!map || !navTarget) return;
  // Remove old marker/route
  if (navMarker) {
    try {
      map.removeLayer(navMarker);
    } catch (e) {}
  }
  if (navRouteLine) {
    try {
      map.removeLayer(navRouteLine);
    } catch (e) {}
  }

  // Target marker (big green pulsing)
  navMarker = L.marker([navTarget.lat, navTarget.lon], {
    icon: L.divIcon({
      className: "",
      html: `<div style="position:relative"><div style="width:20px;height:20px;background:#22c55e;border:3px solid #fff;border-radius:50%;box-shadow:0 0 12px #22c55e;animation:pulse 1.5s infinite"></div><div style="position:absolute;top:24px;left:50%;transform:translateX(-50%);white-space:nowrap;background:rgba(0,0,0,0.85);color:#22c55e;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;font-family:'Space Grotesk',monospace"><span class="material-symbols-outlined" style="font-size:10px">track_changes</span> ${navTarget.label}</div></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    }),
  }).addTo(map);

  // Route line from my pos
  if (myPos) {
    navRouteLine = L.polyline(
      [
        [myPos.lat, myPos.lon],
        [navTarget.lat, navTarget.lon],
      ],
      {
        color: "#22c55e",
        weight: 3,
        opacity: 0.7,
        dashArray: "8,6",
      },
    ).addTo(map);
  }
}

function launchNav(app) {
  if (!navTarget) {
    // Try to parse input first
    navigateTarget();
    if (!navTarget) return;
  }
  const { lat, lon } = navTarget;
  if (app === "waze")
    window.open(`https://waze.com/ul?ll=${lat},${lon}&navigate=yes`, "_blank");
  else if (app === "gmaps")
    window.open(
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`,
      "_blank",
    );
  else if (app === "osm")
    window.open(
      `https://www.openstreetmap.org/directions?from=&to=${lat}%2C${lon}&engine=fossgis_osrm_car`,
      "_blank",
    );
}

function showRouteOnMap() {
  if (!navTarget || !myPos || !map) return;
  if (!navTarget) {
    navigateTarget();
    if (!navTarget) return;
  }

  // Find nearest DFCI pistes between current pos and target
  // Draw route via nearby pistes
  if (typeof PISTES_REAL === "undefined") return;

  const from = { lat: myPos.lat, lon: myPos.lon };
  const to = navTarget;

  // Find pistes near the route corridor
  const corridor = 0.03; // ~3km corridor
  const minLat = Math.min(from.lat, to.lat) - corridor;
  const maxLat = Math.max(from.lat, to.lat) + corridor;
  const minLon = Math.min(from.lon, to.lon) - corridor;
  const maxLon = Math.max(from.lon, to.lon) + corridor;

  // Remove old route
  if (navRouteLine) {
    try {
      map.removeLayer(navRouteLine);
    } catch (e) {}
  }

  // Highlight all pistes in the corridor
  let routePts = [[from.lat, from.lon]];
  let pistesFound = 0;

  PISTES_REAL.forEach((p) => {
    const inCorridor = p.p.some(
      (pt) =>
        pt[0] >= minLat &&
        pt[0] <= maxLat &&
        pt[1] >= minLon &&
        pt[1] <= maxLon,
    );
    if (!inCorridor) return;
    pistesFound++;
    // Draw highlighted piste
    const hl = L.polyline(p.p, { color: "#22c55e", weight: 5, opacity: 0.8 });
    hl.bindPopup(
      `<b style="color:#22c55e"><span class="material-symbols-outlined" style="font-size:14px">alt_route</span> Route DFCI: ${p.n || "Piste"}</b>`,
    );
    hl.addTo(map);
    allMapItems.push(hl);
  });

  // Direct line overlay
  navRouteLine = L.polyline(
    [
      [from.lat, from.lon],
      [to.lat, to.lon],
    ],
    {
      color: "#22c55e",
      weight: 2,
      opacity: 0.5,
      dashArray: "4,8",
    },
  ).addTo(map);

  // Fit map to route
  map.fitBounds(
    [
      [minLat, minLon],
      [maxLat, maxLon],
    ],
    { padding: [30, 30] },
  );

  alert(
    `${pistesFound} pistes DFCI trouvées dans le corridor de route.\nLes pistes sont surlignées en vert sur la carte.`,
  );
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371,
    dLat = ((lat2 - lat1) * Math.PI) / 180,
    dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// DASHBOARD
// ============================================================
// ============================================================
// PYROVIGIL FOOTER
// ============================================================
function pvFooter() {
  return `<div style="margin-top:24px;padding:14px;border-top:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;gap:12px;opacity:0.7">
    <img src="${typeof LOGO_URL !== "undefined" ? LOGO_URL : ""}" style="height:32px;border-radius:4px" alt="PyroVigil"/>
    <div style="font-size:10px;color:#64748b;line-height:1.5">
      <b style="color:#22c55e">PyroVigil</b> — Forest Fire Protect<br>
      📞 06.51.37.86.10 • ✉️ contact@pyrovigil.fr • 🌐 pyrovigil.fr
    </div>
  </div>`;
}

// ============================================================
// DASHBOARD
// ============================================================
function buildDashboard() {
  const el = document.getElementById("dash-stats");
  const stats = [
    {
      l: "Communes",
      v: auth.level === "dept" ? COMMUNES.length : 1,
      c: "#3b82f6",
    },
    { l: "GPS actives", v: Object.keys(patrolPositions).length, c: "#22c55e" },
    {
      l: "PENA",
      v: typeof PENA_REAL !== "undefined" ? PENA_REAL.length : 0,
      c: "#22d3ee",
    },
    {
      l: "DZ Héli",
      v: typeof DZ_REAL !== "undefined" ? DZ_REAL.length : 0,
      c: "#a855f7",
    },
    {
      l: "Pistes DFCI",
      v: typeof PISTES_REAL !== "undefined" ? PISTES_REAL.length : 0,
      c: "#f97316",
    },
    { l: "Missions", v: missions.length, c: "#f59e0b" },
    { l: "Alertes SOS", v: missions.filter((m) => m.sos).length, c: "#dc2626" },
    { l: "Fiches patrouille", v: getAccessibleRecords().length, c: "#8b5cf6" },
    { l: "Véhicules", v: getAccessibleFleet().length, c: "#f59e0b" },
    { l: "Photos terrain", v: getAccessiblePhotos().length, c: "#0ea5e9" },
    { l: "Relevés feu", v: getAccessibleBurned().length, c: "#f97316" },
  ];
  el.innerHTML = stats
    .map(
      (s) =>
        `<div class="card" style="flex:1 1 140px;min-width:130"><div style="font-size:11px;color:#64748b">${s.l}</div><div style="font-size:26px;font-weight:800;color:${s.c};font-family:'Space Grotesk'">${s.v}</div></div>`,
    )
    .join("");

  // Risk overview
  document.getElementById("dash-risk").innerHTML =
    `<div style="font-size:13px;font-weight:700;color:#dc2626;font-family:'Space Grotesk';margin-bottom:10px"><span class="material-symbols-outlined" style="font-size:14px">warning</span> Risque météo — 9 massifs</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px">${MASSIFS.map(
      (m) => {
        const rl = RLVL.find((r) => r.v === zoneRisks[m.nom]) || RLVL[0];
        return `<div style="background:${rl.bg};border:1px solid ${rl.c}30;border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:#cbd5e1">${m.nom}</span><span style="padding:1px 8px;border-radius:10px;background:${rl.c}20;color:${rl.c};font-size:10px;font-weight:800;border:1px solid ${rl.c}">${rl.ls}</span></div>`;
      },
    ).join("")}</div>`;
}

// ============================================================
// COMMUNES
// ============================================================
function buildCommunes() {
  const el = document.getElementById("tab-communes");
  el.innerHTML = `<input id="com-search" placeholder="🔍 Rechercher une commune..." class="field-input" style="margin-bottom:14px" oninput="filterCommunes()"/><div id="com-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px"></div>`;
  filterCommunes();
}
function filterCommunes() {
  const q = (document.getElementById("com-search")?.value || "").toLowerCase();
  const filtered = COMMUNES.filter((c) => !q || c.toLowerCase().includes(q));
  document.getElementById("com-grid").innerHTML = filtered
    .map((c) => {
      const massif = MASSIFS.find((m) => m.communes.includes(c));
      const rl = massif
        ? RLVL.find((r) => r.v === zoneRisks[massif.nom])
        : RLVL[0];
      if (!rl) return "";
      const dfci =
        (typeof COMMUNE_DFCI !== "undefined" && COMMUNE_DFCI[c]) || "???";
      return `<div onclick="switchTab('patrouilles')" class="card" style="padding:10px 12px;cursor:pointer;border-left:3px solid ${rl.c}" onmouseenter="this.style.background='rgba(220,38,38,0.06)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)'"><div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:13px;font-weight:700;color:#f1f5f9">${c}</span><div style="display:flex;gap:4px;align-items:center"><span style="padding:1px 5px;border-radius:4px;background:rgba(249,115,22,0.1);color:#f97316;font-size:11px;font-weight:800;font-family:'Space Grotesk',monospace;border:1px solid rgba(249,115,22,0.3)">${dfci}</span><span style="padding:1px 6px;border-radius:8px;background:${rl.bg};color:${rl.c};font-size:9px;font-weight:700;border:1px solid ${rl.c}">${rl.ls}</span></div></div><div style="font-size:10px;color:#4b5563;margin-top:2px">Véhicules: ${dfci}1→${dfci}5${massif ? ` • ${massif.nom}` : ""} • ${CC[c]}</div></div>`;
    })
    .join("");
}

// ============================================================
// PATROUILLES
// ============================================================
function buildPatrouilles() {
  const el = document.getElementById("tab-patrouilles");
  el.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;align-items:center"><input id="pat-search" placeholder="🔍 Rechercher..." class="field-input" style="flex:1 1 180px" oninput="filterPatrouilles()"/><select id="pat-type" class="field-input" style="width:auto" onchange="filterPatrouilles()"><option value="all">Tous</option><option value="surveillance">🚗 Équipages</option><option value="president">👑 Présidents</option></select><span id="pat-count" style="font-size:11px;color:#64748b"></span></div><div id="pat-list" style="display:flex;flex-direction:column;gap:3px"></div>`;
  filterPatrouilles();
}
function filterPatrouilles() {
  const q = (document.getElementById("pat-search")?.value || "").toLowerCase();
  const ft = document.getElementById("pat-type")?.value || "all";
  const TC_c = {
    surveillance: { bg: "#1a0d00", b: "#f97316", t: "#fdba74", bd: "#c2410c" },
    president: { bg: "#1a0505", b: "#dc2626", t: "#fca5a5", bd: "#991b1b" },
  };
  let patrols = [];
  const comms = auth.level === "commune" ? [auth.commune] : COMMUNES;
  comms.forEach((c) => {
    const dfci =
      (typeof COMMUNE_DFCI !== "undefined" && COMMUNE_DFCI[c]) ||
      c.substring(0, 3).toUpperCase();
    // Président = 1
    patrols.push({
      code: dfci + "1",
      type: "president",
      tl: "👑 Président",
      commune: c,
      dfci: dfci,
    });
    // Équipages = 2,3,4,5
    for (let i = 2; i <= 5; i++) {
      patrols.push({
        code: dfci + i,
        type: "surveillance",
        tl: "🚗 Équipage " + i,
        commune: c,
        dfci: dfci,
      });
    }
  });
  if (q)
    patrols = patrols.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.commune.toLowerCase().includes(q) ||
        p.dfci.toLowerCase().includes(q),
    );
  if (ft !== "all") patrols = patrols.filter((p) => p.type === ft);
  document.getElementById("pat-count").textContent =
    patrols.length + " véhicules";
  document.getElementById("pat-list").innerHTML =
    patrols
      .slice(0, 60)
      .map((p) => {
        const c = TC_c[p.type] || TC_c.surveillance;
        const pos = patrolPositions[p.code];
        const massif = MASSIFS.find((m) => m.communes.includes(p.commune));
        return `<div style="background:${c.bg};border-left:3px solid ${c.b};border-radius:5px;padding:7px 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div style="flex:1 1 200px"><div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px;font-weight:800;color:${c.t};font-family:'Space Grotesk';letter-spacing:1px">${p.code}</span>${pos ? '<span style="color:#22c55e;font-size:10px">● GPS</span>' : '<span style="color:#ef4444;font-size:10px">○</span>'}</div><div style="font-size:10px;color:#4b5563">${p.commune}${massif ? " • " + massif.nom : ""}</div></div><span style="padding:1px 7px;border-radius:8px;background:${c.bd};color:#fff;font-size:9px;font-weight:700">${p.tl}</span>${pos ? `<button onclick="window.open('https://waze.com/ul?ll=${pos.lat},${pos.lon}&navigate=yes','_blank')" class="btn" style="padding:3px 8px;background:#059669;color:#fff;font-size:10px">🧭</button>` : ""}</div>`;
      })
      .join("") +
    (patrols.length > 60
      ? `<div style="text-align:center;padding:10px;color:#4b5563;font-size:11px">… ${patrols.length - 60} autres</div>`
      : "");
}

// ============================================================
// VÉHICULES — Gestion du parc
// ============================================================
const VEH_STATUS = {
  disponible: {
    l: "Disponible",
    i: "✅",
    ms: "check_circle",
    c: "#22c55e",
    bg: "rgba(34,197,94,0.08)",
    bc: "rgba(34,197,94,0.3)",
  },
  en_patrouille: {
    l: "En patrouille",
    i: "🚒",
    ms: "local_fire_department",
    c: "#f97316",
    bg: "rgba(249,115,22,0.08)",
    bc: "rgba(249,115,22,0.3)",
  },
  garage: {
    l: "Au garage",
    i: "🏠",
    ms: "garage_home",
    c: "#3b82f6",
    bg: "rgba(59,130,246,0.08)",
    bc: "rgba(59,130,246,0.3)",
  },
  maintenance: {
    l: "Maintenance",
    i: "🔧",
    ms: "build",
    c: "#eab308",
    bg: "rgba(234,179,8,0.08)",
    bc: "rgba(234,179,8,0.3)",
  },
  hors_service: {
    l: "Hors service",
    i: "⛔",
    ms: "block",
    c: "#ef4444",
    bg: "rgba(239,68,68,0.08)",
    bc: "rgba(239,68,68,0.3)",
  },
  reserve: {
    l: "Réserve",
    i: "📦",
    ms: "inventory_2",
    c: "#8b5cf6",
    bg: "rgba(139,92,246,0.08)",
    bc: "rgba(139,92,246,0.3)",
  },
};
const VEH_TYPES = [
  { v: "vl", l: "🚗 VL (Véhicule léger)", ms: "directions_car" },
  { v: "vlhr", l: "🚙 VLHR (Véhicule léger hors route)", ms: "directions_car" },
  {
    v: "ccfm",
    l: "🚒 CCFM (Camion citerne feux de forêt moyen)",
    ms: "fire_truck",
  },
  {
    v: "ccfl",
    l: "🚒 CCFL (Camion citerne feux de forêt léger)",
    ms: "fire_truck",
  },
  { v: "pickup", l: "🛻 Pick-up", ms: "local_shipping" },
  { v: "quad", l: "🏍️ Quad / SSV", ms: "sports_motorsports" },
  { v: "autre", l: "🚐 Autre", ms: "airport_shuttle" },
];

function buildVehicules() {
  const el = document.getElementById("tab-vehicules");
  const fleet = getAccessibleFleet();
  const statusCounts = {};
  Object.keys(VEH_STATUS).forEach((k) => {
    statusCounts[k] = fleet.filter((v) => v.status === k).length;
  });

  el.innerHTML = `<h2 style="font-family:'Space Grotesk';font-size:18px;font-weight:800;color:#f1f5f9;margin-bottom:4px"><span class="material-symbols-outlined" style="vertical-align:-4px">directions_car</span> Gestion du parc véhicules</h2>
  <p style="color:#94a3b8;font-size:12px;margin-bottom:12px">${auth.level === "dept" ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">account_balance</span> Département — Tous les véhicules' : '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">location_city</span> ' + auth.commune} • ${fleet.length} véhicule${fleet.length > 1 ? "s" : ""}</p>

  <!-- Résumé statuts -->
  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
    ${Object.entries(VEH_STATUS)
      .map(
        ([
          k,
          s,
        ]) => `<div class="card" style="flex:1 1 100px;min-width:90px;border-left:3px solid ${s.c};padding:8px 10px;cursor:pointer${statusCounts[k] > 0 ? "" : ";opacity:0.5"}" onclick="document.getElementById('veh-status-filter').value='${k}';filterVehicules()">
      <div style="font-size:9px;color:#64748b"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">${s.ms}</span> ${s.l}</div>
      <div style="font-size:20px;font-weight:800;color:${s.c};font-family:'Space Grotesk'">${statusCounts[k] || 0}</div>
    </div>`,
      )
      .join("")}
  </div>

  <!-- Filtres -->
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center">
    <input id="veh-search" placeholder="🔍 Immat, commune..." class="field-input" style="flex:1 1 160px" oninput="filterVehicules()"/>
    <select id="veh-status-filter" class="field-input" style="flex:0 0 140px" onchange="filterVehicules()">
      <option value="">Tous les statuts</option>
      ${Object.entries(VEH_STATUS)
        .map(([k, s]) => `<option value="${k}">${s.i} ${s.l}</option>`)
        .join("")}
    </select>
    ${
      auth.level === "dept"
        ? `<select id="veh-commune-filter" class="field-input" style="flex:0 0 160px" onchange="filterVehicules()">
      <option value="">Toutes les communes</option>
      ${[...new Set(fleet.map((v) => v.commune))]
        .sort()
        .map((c) => `<option value="${c}">${c}</option>`)
        .join("")}
    </select>`
        : ""
    }
    <button onclick="showAddVehicule()" class="btn" style="padding:8px 14px;background:rgba(34,197,94,0.1);border:1px solid #22c55e;color:#22c55e;font-size:12px;font-weight:700"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">add</span> Ajouter</button>
  </div>

  <!-- Formulaire ajout (caché) -->
  <div id="veh-add-form" style="display:none;margin-bottom:14px" class="card" >
    <div style="font-size:13px;font-weight:700;color:#22c55e;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">add_circle</span> Enregistrer un véhicule</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1 1 140px"><label style="font-size:10px;color:#94a3b8">Immatriculation</label><input id="va-immat" class="field-input" placeholder="AA-123-BB" style="text-transform:uppercase"/></div>
      <div style="flex:1 1 160px"><label style="font-size:10px;color:#94a3b8">Type</label>
        <select id="va-type" class="field-input">${VEH_TYPES.map((t) => `<option value="${t.v}">${t.l}</option>`).join("")}</select>
      </div>
      <div style="flex:1 1 60px"><label style="font-size:10px;color:#94a3b8">N° véhicule CCFF</label>
        <select id="va-num" class="field-input"><option value="1">1 — Président</option><option value="2" selected>2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="7">7</option><option value="8">8</option></select>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1 1 160px"><label style="font-size:10px;color:#94a3b8">Commune d'affectation</label>
        ${
          auth.level === "dept"
            ? `<select id="va-commune" class="field-input"><option value="">-- Sélectionner --</option>${COMMUNES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>`
            : `<input id="va-commune" class="field-input" value="${auth.commune || ""}" readonly style="color:#fca5a5"/>`
        }
      </div>
      <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Marque / Modèle</label><input id="va-modele" class="field-input" placeholder="Dacia Duster"/></div>
      <div style="flex:1 1 80px"><label style="font-size:10px;color:#94a3b8">Année</label><input id="va-annee" type="number" class="field-input" placeholder="2022"/></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <div style="flex:1 1 80px"><label style="font-size:10px;color:#94a3b8">Km compteur</label><input id="va-km" type="number" class="field-input" placeholder="45000"/></div>
      <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Prochaine CT</label><input id="va-ct" type="date" class="field-input"/></div>
      <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Assurance exp.</label><input id="va-assur" type="date" class="field-input"/></div>
    </div>
    <div style="margin-bottom:8px"><label style="font-size:10px;color:#94a3b8">Notes</label><textarea id="va-notes" class="field-input" rows="2" placeholder="Équipement spécifique, remarques..."></textarea></div>
    <div style="display:flex;gap:8px">
      <button onclick="submitVehicule()" class="btn" style="padding:8px 20px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font-size:13px;font-weight:700"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">check</span> Enregistrer</button>
      <button onclick="document.getElementById('veh-add-form').style.display='none'" class="btn" style="padding:8px 16px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-size:12px">Annuler</button>
    </div>
  </div>

  <!-- Liste véhicules -->
  <div id="veh-list" style="display:flex;flex-direction:column;gap:6px"></div>`;
  filterVehicules();
}

function getAccessibleFleet() {
  if (auth.level === "dept") return vehicleFleet;
  return vehicleFleet.filter((v) => v.commune === auth.commune);
}

function showAddVehicule() {
  const form = document.getElementById("veh-add-form");
  if (form)
    form.style.display = form.style.display === "none" ? "block" : "none";
}

function submitVehicule(editId) {
  const immat = (document.getElementById("va-immat")?.value || "")
    .toUpperCase()
    .trim();
  const commune =
    document.getElementById("va-commune")?.value || auth.commune || "";
  if (!immat) {
    alert("⚠️ Immatriculation obligatoire");
    return;
  }
  if (!commune) {
    alert("⚠️ Commune obligatoire");
    return;
  }
  const dfci =
    (typeof COMMUNE_DFCI !== "undefined" && COMMUNE_DFCI[commune]) || "";
  const num = document.getElementById("va-num")?.value || "2";
  const veh = {
    id: editId || "veh_" + Date.now(),
    immat: immat,
    type: document.getElementById("va-type")?.value || "vl",
    num: num,
    code: dfci + num,
    commune: commune,
    dfci: dfci,
    modele: document.getElementById("va-modele")?.value || "",
    annee: document.getElementById("va-annee")?.value || "",
    km: parseInt(document.getElementById("va-km")?.value || "0"),
    ctDate: document.getElementById("va-ct")?.value || "",
    assurDate: document.getElementById("va-assur")?.value || "",
    notes: document.getElementById("va-notes")?.value || "",
    status: "disponible",
    statusHistory: [
      {
        status: "disponible",
        ts: new Date().toISOString(),
        by: auth.commune || "dept",
      },
    ],
    createdAt: new Date().toISOString(),
  };
  if (editId) {
    const idx = vehicleFleet.findIndex((v) => v.id === editId);
    if (idx >= 0) {
      veh.status = vehicleFleet[idx].status;
      veh.statusHistory = vehicleFleet[idx].statusHistory;
      veh.createdAt = vehicleFleet[idx].createdAt;
      vehicleFleet[idx] = veh;
    }
  } else {
    // Check duplicate immat
    if (vehicleFleet.find((v) => v.immat === immat)) {
      alert("⚠️ Ce véhicule est déjà enregistré (" + immat + ")");
      return;
    }
    vehicleFleet.push(veh);
  }
  dbSave("fleet", vehicleFleet);
  alert(
    "Véhicule " +
      (editId ? "modifié" : "enregistré") +
      " : " +
      immat +
      " → " +
      commune +
      " (" +
      veh.code +
      ")",
  );
  buildVehicules();
}

function filterVehicules() {
  const q = (document.getElementById("veh-search")?.value || "").toLowerCase();
  const sf = document.getElementById("veh-status-filter")?.value || "";
  const cf = document.getElementById("veh-commune-filter")?.value || "";
  let fleet = getAccessibleFleet();
  if (q)
    fleet = fleet.filter(
      (v) =>
        v.immat.toLowerCase().includes(q) ||
        v.commune.toLowerCase().includes(q) ||
        v.code.toLowerCase().includes(q) ||
        v.modele.toLowerCase().includes(q),
    );
  if (sf) fleet = fleet.filter((v) => v.status === sf);
  if (cf) fleet = fleet.filter((v) => v.commune === cf);
  fleet.sort((a, b) => a.commune.localeCompare(b.commune) || a.num - b.num);
  const container = document.getElementById("veh-list");
  if (!container) return;
  if (fleet.length === 0) {
    container.innerHTML =
      '<div class="card" style="text-align:center;color:#64748b;padding:30px"><span class="material-symbols-outlined" style="font-size:48px;opacity:0.5">directions_car</span><br>Aucun véhicule enregistré<br><span style="font-size:11px">Cliquez sur "Ajouter" pour enregistrer votre premier véhicule</span></div>';
    return;
  }
  const now = new Date();
  container.innerHTML = fleet
    .map((v) => {
      const st = VEH_STATUS[v.status] || VEH_STATUS.disponible;
      const typeLbl = VEH_TYPES.find((t) => t.v === v.type);
      const pos = patrolPositions[v.code];
      const ctAlert =
        v.ctDate &&
        new Date(v.ctDate) < new Date(now.getTime() + 30 * 86400000);
      const assurAlert =
        v.assurDate &&
        new Date(v.assurDate) < new Date(now.getTime() + 30 * 86400000);
      const lastRecord = patrolRecords
        .filter(
          (r) =>
            r.immat === v.immat ||
            (r.vehicule === v.num && r.commune === v.commune),
        )
        .sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure))[0];
      return `<div class="card" style="border-left:4px solid ${st.c};background:${st.bg}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:16px;font-weight:800;color:#f1f5f9;font-family:'Space Grotesk';letter-spacing:1px">${v.immat}</span>
            <span style="font-size:12px;font-weight:800;color:#fca5a5;font-family:'Space Grotesk'">${v.code}</span>
            ${pos ? '<span style="color:#22c55e;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">my_location</span> GPS actif</span>' : ""}
          </div>
          <div style="font-size:11px;color:#94a3b8">${v.commune} ${v.dfci ? "(" + v.dfci + ")" : ""} • ${typeLbl ? typeLbl.l.split(" ")[1] : v.type} ${v.modele ? "• " + v.modele : ""} ${v.annee ? "(" + v.annee + ")" : ""}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <span style="padding:3px 10px;border-radius:8px;background:${st.bg};color:${st.c};font-size:10px;font-weight:700;border:1px solid ${st.bc}"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">${st.ms}</span> ${st.l}</span>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10px;color:#64748b;margin-bottom:6px">
        ${v.km ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">straighten</span> ' + v.km.toLocaleString() + " km</span>" : ""}
        ${v.ctDate ? `<span style="${ctAlert ? "color:#ef4444;font-weight:700" : ""}"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">build</span> CT: ${v.ctDate}${ctAlert ? ' <span class="material-symbols-outlined" style="font-size:12px">warning</span>' : ""}</span>` : ""}
        ${v.assurDate ? `<span style="${assurAlert ? "color:#ef4444;font-weight:700" : ""}"><span class=\"material-symbols-outlined\" style=\"font-size:12px;vertical-align:-2px\">shield</span> Assur: ${v.assurDate}${assurAlert ? ' <span class="material-symbols-outlined" style="font-size:12px">warning</span>' : ""}</span>` : ""}
        ${lastRecord ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">history</span> Dernière sortie: ' + formatDateFR(lastRecord.date) + "</span>" : ""}
      </div>
      ${v.notes ? '<div style="font-size:10px;color:#94a3b8;background:rgba(0,0,0,0.15);padding:4px 8px;border-radius:4px;margin-bottom:6px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">description</span> ' + v.notes + "</div>" : ""}
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        ${vehStatusButtons(v)}
        <button onclick="editVehicule('${v.id}')" class="btn" style="padding:4px 8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">edit</span> Modifier</button>
        <button onclick="vehHistory('${v.id}')" class="btn" style="padding:4px 8px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);color:#8b5cf6;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">history</span> Historique</button>
        ${pos ? `<button onclick="window.open('https://waze.com/ul?ll=${pos.lat},${pos.lon}&navigate=yes','_blank')" class="btn" style="padding:4px 8px;background:rgba(34,197,94,0.1);border:1px solid #22c55e;color:#22c55e;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">explore</span> Localiser</button>` : ""}
        <button onclick="removeVehicule('${v.id}')" class="btn" style="padding:4px 8px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.2);color:#ef4444;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">delete</span></button>
      </div>
    </div>`;
    })
    .join("");
}

function vehStatusButtons(v) {
  const transitions = {
    disponible: ["en_patrouille", "garage", "maintenance", "hors_service"],
    en_patrouille: ["disponible", "garage", "maintenance"],
    garage: ["disponible", "maintenance", "hors_service"],
    maintenance: ["disponible", "garage", "hors_service"],
    hors_service: ["disponible", "maintenance", "reserve"],
    reserve: ["disponible", "maintenance"],
  };
  const next = transitions[v.status] || ["disponible"];
  return next
    .slice(0, 3)
    .map((s) => {
      const st = VEH_STATUS[s];
      return `<button onclick="setVehStatus('${v.id}','${s}')" class="btn" style="padding:4px 8px;background:${st.bg};border:1px solid ${st.bc};color:${st.c};font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">${st.ms}</span> ${st.l}</button>`;
    })
    .join("");
}

function setVehStatus(vehId, newStatus) {
  const v = vehicleFleet.find((x) => x.id === vehId);
  if (!v) return;
  const oldSt = VEH_STATUS[v.status] || { l: v.status };
  const newSt = VEH_STATUS[newStatus] || { l: newStatus };
  v.status = newStatus;
  v.statusHistory.push({
    status: newStatus,
    from: v.status,
    ts: new Date().toISOString(),
    by: auth.commune || "dept",
  });
  dbSave("fleet", vehicleFleet);
  buildVehicules();
}

function editVehicule(vehId) {
  const v = vehicleFleet.find((x) => x.id === vehId);
  if (!v) return;
  // Populate form
  const form = document.getElementById("veh-add-form");
  if (form) form.style.display = "block";
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || "";
  };
  set("va-immat", v.immat);
  set("va-type", v.type);
  set("va-num", v.num);
  if (auth.level === "dept") set("va-commune", v.commune);
  set("va-modele", v.modele);
  set("va-annee", v.annee);
  set("va-km", v.km);
  set("va-ct", v.ctDate);
  set("va-assur", v.assurDate);
  set("va-notes", v.notes);
  // Change submit button to update
  const btn = form.querySelector('button[onclick^="submitVehicule"]');
  if (btn) {
    btn.innerHTML =
      '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">save</span> Mettre à jour';
    btn.setAttribute("onclick", `submitVehicule('${vehId}')`);
  }
  form.scrollIntoView({ behavior: "smooth" });
}

function vehHistory(vehId) {
  const v = vehicleFleet.find((x) => x.id === vehId);
  if (!v) return;
  // Get patrol records for this vehicle
  const records = patrolRecords
    .filter(
      (r) =>
        r.immat === v.immat ||
        (r.vehicule === v.num && r.commune === v.commune),
    )
    .sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure));
  let histLines = v.statusHistory
    .slice()
    .reverse()
    .map((h) => {
      const st = VEH_STATUS[h.status] || { i: "?", l: h.status };
      const d = new Date(h.ts);
      return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03)">
      <span style="font-size:10px;color:#64748b;min-width:90px">${d.toLocaleDateString("fr")} ${d.toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" })}</span>
      <span style="padding:2px 6px;border-radius:6px;background:${(VEH_STATUS[h.status] || {}).bg || "#333"};color:${(VEH_STATUS[h.status] || {}).c || "#999"};font-size:10px;font-weight:700"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">${st.ms}</span> ${st.l}</span>
    </div>`;
    })
    .join("");
  let recordLines = records
    .slice(0, 10)
    .map((r) => {
      const rl = RLVL.find((x) => x.v === r.risque) || RLVL[0];
      return `<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.03)">
      <span style="font-size:10px;color:#64748b;min-width:90px">${formatDateFR(r.date)}</span>
      <span style="font-size:10px;color:#cbd5e1">${r.heure || ""} ${r.chef ? '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">person</span> ' + r.chef : ""} ${r.observation ? "— " + r.observation.substring(0, 40) + "..." : ""}</span>
      <span style="padding:1px 4px;border-radius:4px;background:${rl.bg};color:${rl.c};font-size:9px">${rl.ls}</span>
    </div>`;
    })
    .join("");
  // Modal
  const modal = document.createElement("div");
  modal.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;padding:20px";
  modal.innerHTML = `<div style="background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;max-width:500px;width:100%;max-height:80vh;overflow-y:auto">
    <div style="font-size:16px;font-weight:800;color:#f1f5f9;font-family:'Space Grotesk';margin-bottom:4px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-2px">history</span> ${v.immat} — ${v.commune}</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">${v.code} • ${(VEH_TYPES.find((t) => t.v === v.type) || { l: "" }).l} ${v.modele ? "• " + v.modele : ""}</div>
    <div style="font-size:12px;font-weight:700;color:#8b5cf6;margin-bottom:6px">Changements de statut (${v.statusHistory.length})</div>
    <div style="margin-bottom:14px">${histLines || '<div style="color:#64748b;font-size:11px">Aucun historique</div>'}</div>
    <div style="font-size:12px;font-weight:700;color:#f97316;margin-bottom:6px">Sorties patrouille (${records.length})</div>
    <div style="margin-bottom:14px">${recordLines || '<div style="color:#64748b;font-size:11px">Aucune sortie enregistrée</div>'}</div>
    <button onclick="this.closest('div[style*=fixed]').remove()" class="btn" style="padding:8px 20px;background:rgba(255,255,255,0.1);border:1px solid #fff;color:#fff;font-size:12px;width:100%">✕ Fermer</button>
  </div>`;
  document.body.appendChild(modal);
}

function removeVehicule(vehId) {
  const v = vehicleFleet.find((x) => x.id === vehId);
  if (!v) return;
  if (
    !confirm(
      "Supprimer définitivement le véhicule " +
        v.immat +
        " (" +
        v.commune +
        ") ?",
    )
  )
    return;
  vehicleFleet = vehicleFleet.filter((x) => x.id !== vehId);
  dbSave("fleet", vehicleFleet);
  buildVehicules();
}

// ============================================================
// MISSIONS
// ============================================================
function buildMissions() {
  const el = document.getElementById("tab-missions");
  const MT = [
    { v: "inter_feu", l: "Feu", i: "local_fire_department", c: "#ef4444" },
    { v: "lever_doute", l: "Lever de doute", i: "search", c: "#f59e0b" },
    { v: "surveillance", l: "Surveillance", i: "visibility", c: "#3b82f6" },
  ];
  const comms = auth.level === "dept" ? COMMUNES : [auth.commune];
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px"><h2 style="font-family:'Space Grotesk';font-size:18px;font-weight:800;color:#f1f5f9;margin:0"><span class="material-symbols-outlined" style="vertical-align:-4px">track_changes</span> Missions (${missions.length})</h2><button onclick="document.getElementById('mf').style.display=document.getElementById('mf').style.display==='none'?'block':'none'" class="btn" style="padding:8px 16px;background:#b45309;color:#fff;font-size:12px">+ Mission</button></div>
  <div id="mf" style="display:none;background:rgba(180,83,9,0.08);border:1px solid rgba(180,83,9,0.3);border-radius:10px;padding:16px;margin-bottom:14px">
    <div style="font-size:14px;font-weight:700;color:#fcd34d;font-family:'Space Grotesk';margin-bottom:12px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">satellite_alt</span> Nouvelle mission</div>
    <div style="margin-bottom:8px"><div style="font-size:11px;color:#94a3b8;margin-bottom:4px">Type</div><div style="display:flex;gap:4px">${MT.map((t) => `<button onclick="document.getElementById('mf-type').value='${t.v}';this.parentElement.querySelectorAll('button').forEach(b=>b.style.opacity='0.35');this.style.opacity='1'" class="btn" style="padding:6px 12px;border:2px solid ${t.c};background:rgba(0,0,0,0.3);color:${t.c};font-size:11px;font-weight:700;opacity:0.35"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">${t.i}</span> ${t.l}</button>`).join("")}</div><input type="hidden" id="mf-type" value="surveillance"/></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div style="flex:1 1 180px"><label style="font-size:11px;color:#94a3b8">Commune</label><select id="mf-commune" class="field-input">${comms.map((c) => `<option value="${c}">${c}</option>`).join("")}</select></div><div style="flex:1 1 180px"><label style="font-size:11px;color:#94a3b8">Patrouille</label><input id="mf-patrol" class="field-input" placeholder="CCFF..."/></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div style="flex:1 1 150px"><label style="font-size:11px;color:#94a3b8">DFCI</label><input id="mf-dfci" class="field-input" placeholder="KL45-N7.2"/></div><div style="flex:1 1 200px"><label style="font-size:11px;color:#94a3b8">GPS cible</label><input id="mf-gps" class="field-input" placeholder="43.4534, 6.2345"/></div></div>
    <div style="margin-bottom:8px"><label style="font-size:11px;color:#94a3b8">Instructions</label><textarea id="mf-instr" class="field-input" rows="2" placeholder="Détails..."></textarea></div>
    <button onclick="submitMission()" class="btn" style="padding:9px 18px;background:#b45309;color:#fff;font-size:12px"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">send</span> Envoyer</button>
  </div>
  <div id="missions-list"></div>`;
  renderMissions();
}
function submitMission() {
  missions.unshift({
    id: Date.now(),
    ts: new Date().toISOString(),
    mtype: document.getElementById("mf-type").value,
    patrol: document.getElementById("mf-patrol").value,
    commune: document.getElementById("mf-commune").value,
    dfci: document.getElementById("mf-dfci").value,
    gps: document.getElementById("mf-gps").value,
    instr: document.getElementById("mf-instr").value,
    sos: false,
  });
  document.getElementById("mf").style.display = "none";
  renderMissions();
}
function renderMissions() {
  const MT = {
    inter_feu: { l: "🔥 Feu", c: "#ef4444" },
    lever_doute: { l: "🔎 Lever de doute", c: "#f59e0b" },
    surveillance: { l: "👁️ Surveillance", c: "#3b82f6" },
  };
  const el = document.getElementById("missions-list");
  if (!el) return;
  el.innerHTML =
    missions.length === 0
      ? '<div style="text-align:center;padding:40px;color:#4b5563"><div style="font-size:32px"><span class="material-symbols-outlined" style="font-size:48px;opacity:0.5">track_changes</span></div>Aucune mission</div>'
      : missions
          .map((m) => {
            const mt = MT[m.mtype] || MT.surveillance;
            return `<div class="card" style="margin-bottom:6px;border-left:3px solid ${m.sos ? "#dc2626" : mt.c};background:${m.sos ? "rgba(220,38,38,0.08)" : "rgba(255,255,255,0.03)"}"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:6px"><span style="font-size:13px;font-weight:700;color:${mt.c}"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">${mt.i || "visibility"}</span> ${mt.l} ${m.sos ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px;color:#ef4444">emergency_share</span> SOS' : ""}</span><span style="font-size:10px;color:#4b5563">${new Date(m.ts).toLocaleString("fr-FR")}</span></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px;font-size:11px">${m.patrol ? `<div><span style="color:#4b5563">Patrouille:</span> <span style="color:#cbd5e1">${m.patrol}</span></div>` : ""} ${m.commune ? `<div><span style="color:#4b5563">Commune:</span> <span style="color:#cbd5e1">${m.commune}</span></div>` : ""} ${m.dfci ? `<div><span style="color:#f59e0b">DFCI:</span> <span style="color:#fcd34d;font-family:monospace;font-weight:700">${m.dfci}</span></div>` : ""} ${m.gps ? `<div><span style="color:#3b82f6">GPS:</span> <span style="color:#93c5fd;font-family:monospace">${m.gps}</span></div>` : ""} ${m.instr ? `<div style="grid-column:1/-1"><span style="color:#4b5563">Instructions:</span> <span style="color:#cbd5e1">${m.instr}</span></div>` : ""}</div>${m.gps ? `<button onclick="window.open('https://waze.com/ul?ll=${m.gps}&navigate=yes','_blank')" class="btn" style="padding:4px 10px;background:#059669;color:#fff;font-size:10px;margin-top:6px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">explore</span> Waze</button>` : ""}</div>`;
          })
          .join("");
}

// ============================================================
// SAISIE
// ============================================================
function buildSaisie() {
  const el = document.getElementById("tab-saisie");
  const now = new Date().toISOString().split("T")[0];
  const nowTime = new Date().toTimeString().substring(0, 5);
  const commune = auth.commune || "";
  const dfci =
    commune && typeof COMMUNE_DFCI !== "undefined"
      ? COMMUNE_DFCI[commune] || ""
      : "";
  const isTracking = !!activeTrackId;
  el.innerHTML = `<h2 style="font-family:'Space Grotesk';font-size:18px;font-weight:800;color:#f1f5f9;margin-bottom:10px"><span class="material-symbols-outlined" style="vertical-align:-4px">edit_note</span> Saisie terrain — Fiche journalière</h2>
  <div style="max-width:700px;margin:0 auto;display:flex;flex-direction:column;gap:12px">
    <div class="card"><div style="font-size:13px;font-weight:700;color:#dc2626;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">badge</span> Identification Véhicule & Date</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 140px"><label style="font-size:10px;color:#94a3b8">Date</label><input type="date" id="sf-date" value="${now}" class="field-input"/></div>
        <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Heure début</label><input type="time" id="sf-heure" value="${nowTime}" class="field-input"/></div>
        <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Heure fin</label><input type="time" id="sf-hfin" class="field-input"/></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 180px"><label style="font-size:10px;color:#94a3b8">Commune</label>
          ${
            auth.level === "dept"
              ? `<select id="sf-commune" class="field-input" onchange="updateSaisieDFCI()"><option value="">-- Sélectionner --</option>${COMMUNES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>`
              : `<input id="sf-commune" class="field-input" value="${commune}" readonly style="color:#fca5a5;font-weight:700"/>`
          }
        </div>
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">Code DFCI</label><input id="sf-dfci" class="field-input" value="${dfci}" readonly style="color:#eab308;font-weight:700;font-family:'Space Grotesk'"/></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">N° Véhicule</label>
          <select id="sf-vehicule" class="field-input" onchange="autoFillVehicule()"><option value="1">1 — Président</option><option value="2" selected>2 — Patrouille</option><option value="3">3 — Patrouille</option><option value="4">4 — Patrouille</option><option value="5">5 — Patrouille</option></select>
        </div>
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">Immatriculation</label><input id="sf-immat" class="field-input" placeholder="AA-123-BB"/>
          ${
            getAccessibleFleet().length > 0
              ? `<select id="sf-fleet-pick" class="field-input" style="margin-top:4px;font-size:10px;color:#f97316" onchange="pickFleetVehicule()"><option value=""><span class="material-symbols-outlined" style="vertical-align:-2px">directions_car</span> Choisir dans le parc...</option>${getAccessibleFleet()
                  .filter(
                    (v) =>
                      v.status === "disponible" || v.status === "en_patrouille",
                  )
                  .map(
                    (v) =>
                      `<option value="${v.id}">${v.immat} — ${v.commune} (${VEH_STATUS[v.status].i} ${VEH_STATUS[v.status].l})</option>`,
                  )
                  .join("")}</select>`
              : ""
          }
        </div>
        <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Km début</label><input id="sf-kmdeb" type="number" class="field-input"/></div>
        <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Km fin</label><input id="sf-kmfin" type="number" class="field-input"/></div>
      </div>
    </div>
    <div class="card"><div style="font-size:13px;font-weight:700;color:#dc2626;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">group</span> Équipe</div>
      ${[
        "Chef patrouille|sf-chef|sf-tch",
        "Équipier 1|sf-eq1|sf-t1",
        "Équipier 2|sf-eq2|sf-t2",
        "Équipier 3|sf-eq3|sf-t3",
      ]
        .map((r) => {
          const [l, ni, ti] = r.split("|");
          return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px"><div style="flex:1 1 180px"><label style="font-size:10px;color:#94a3b8">${l}</label><input id="${ni}" class="field-input"/></div><div style="flex:1 1 140px"><label style="font-size:10px;color:#94a3b8"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">smartphone</span> Tél.</label><input id="${ti}" type="tel" class="field-input" placeholder="06..."/></div></div>`;
        })
        .join("")}
    </div>
    <div class="card"><div style="font-size:13px;font-weight:700;color:#dc2626;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">timeline</span> Enregistrement trajet GPS</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button onclick="toggleGPSTrack()" id="btn-gps-track" class="btn" style="padding:8px 16px;background:${isTracking ? "rgba(239,68,68,0.2)" : "rgba(34,197,94,0.1)"};border:1px solid ${isTracking ? "#ef4444" : "#22c55e"};color:${isTracking ? "#ef4444" : "#22c55e"};font-size:12px;font-weight:700">
          ${isTracking ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">stop_circle</span> Arrêter l\'enregistrement' : '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">play_circle</span> Démarrer l\'enregistrement GPS'}
        </button>
        <span id="track-status" style="font-size:11px;color:${isTracking ? "#22c55e" : "#64748b"}">${isTracking ? '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px;color:#ef4444">radio_button_checked</span> Enregistrement en cours... (' + (gpsTrackData[activeTrackId] || []).length + " pts)" : '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">radio_button_unchecked</span> Inactif'}</span>
      </div>
      <div style="font-size:10px;color:#64748b;margin-top:6px">Le trajet GPS sera enregistré et associé à cette fiche de patrouille</div>
    </div>
    <div class="card"><div style="font-size:13px;font-weight:700;color:#dc2626;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">warning</span> Risque & Observations</div>
      <div style="margin-bottom:8px"><label style="font-size:11px;color:#94a3b8;display:block;margin-bottom:4px">Risque préfectoral maxi</label><div id="sf-risk-btns" style="display:flex;gap:3px;flex-wrap:wrap"></div></div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px">
        <label style="font-size:11px;color:#94a3b8;cursor:pointer"><input type="checkbox" id="sf-inter"/> Intervention</label>
        <label style="font-size:11px;color:#94a3b8;cursor:pointer"><input type="checkbox" id="sf-piet"/> Sensib. piétons</label>
        <label style="font-size:11px;color:#94a3b8;cursor:pointer"><input type="checkbox" id="sf-pro"/> Sensib. pro</label>
        <label style="font-size:11px;color:#94a3b8;cursor:pointer"><input type="checkbox" id="sf-feu"/> Départ de feu</label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 60px"><label style="font-size:10px;color:#94a3b8">Piétons sensibilisés</label><input id="sf-nb-piet" type="number" class="field-input" value="0"/></div>
        <div style="flex:1 1 60px"><label style="font-size:10px;color:#94a3b8">Véhicules sensibilisés</label><input id="sf-nb-veh" type="number" class="field-input" value="0"/></div>
        <div style="flex:1 1 60px"><label style="font-size:10px;color:#94a3b8">Pro sensibilisés</label><input id="sf-nb-pro" type="number" class="field-input" value="0"/></div>
      </div>
      <div><label style="font-size:10px;color:#94a3b8">Observations / Compte-rendu</label><textarea id="sf-obs" class="field-input" rows="3" placeholder="Conditions météo, incidents, zones parcourues..."></textarea></div>
    </div>
    <div class="card"><div style="font-size:13px;font-weight:700;color:#dc2626;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">photo_camera</span> Photos terrain (${fieldPhotos.filter((p) => p.date === now).length} aujourd'hui)</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <label class="btn" style="padding:8px 16px;background:rgba(59,130,246,0.1);border:1px solid #3b82f6;color:#3b82f6;cursor:pointer;font-size:12px">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">photo_camera</span> Prendre une photo
          <input type="file" accept="image/*" capture="environment" onchange="handlePhotoCapture(this,'saisie')" style="display:none"/>
        </label>
        <label class="btn" style="padding:8px 16px;background:rgba(168,85,247,0.1);border:1px solid #a855f7;color:#a855f7;cursor:pointer;font-size:12px">
          <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">image</span> Galerie
          <input type="file" accept="image/*" onchange="handlePhotoCapture(this,'saisie')" style="display:none"/>
        </label>
      </div>
      <div id="saisie-photos-preview" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <div style="font-size:10px;color:#64748b;margin-top:4px">Les photos sont géolocalisées et horodatées automatiquement</div>
    </div>
    <button onclick="submitSaisie()" class="btn" style="padding:14px;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;font-size:15px;font-weight:700;font-family:'Space Grotesk';letter-spacing:1px"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:-4px">check_circle</span> Enregistrer la fiche</button>
    <div style="font-size:10px;color:#64748b;text-align:center">Les données sont sauvegardées localement sur votre appareil</div>
  </div>`;
  // Risk buttons
  const rbtns = document.getElementById("sf-risk-btns");
  if (rbtns) {
    rbtns.innerHTML =
      RLVL.map(
        (r) =>
          `<button onclick="this.parentElement.querySelectorAll('button').forEach(b=>{b.style.opacity='0.35';b.style.borderColor='transparent'});this.style.opacity='1';this.style.borderColor='${r.c}';document.getElementById('sf-risk-val').value='${r.v}'" class="risk-btn" style="background:${r.bg};color:${r.c};opacity:0.35">${r.ls}</button>`,
      ).join("") + '<input type="hidden" id="sf-risk-val" value="vert"/>';
  }
  // Show today's photos
  renderSaisiePhotos();
}

function updateSaisieDFCI() {
  const sel = document.getElementById("sf-commune");
  const dfciEl = document.getElementById("sf-dfci");
  if (sel && dfciEl && typeof COMMUNE_DFCI !== "undefined") {
    dfciEl.value = COMMUNE_DFCI[sel.value] || "";
  }
}

function pickFleetVehicule() {
  const sel = document.getElementById("sf-fleet-pick");
  if (!sel || !sel.value) return;
  const v = vehicleFleet.find((x) => x.id === sel.value);
  if (!v) return;
  const immatEl = document.getElementById("sf-immat");
  const vehEl = document.getElementById("sf-vehicule");
  const kmEl = document.getElementById("sf-kmdeb");
  if (immatEl) immatEl.value = v.immat;
  if (vehEl) vehEl.value = v.num;
  if (kmEl && v.km) kmEl.value = v.km;
  if (auth.level === "dept") {
    const comEl = document.getElementById("sf-commune");
    if (comEl) {
      comEl.value = v.commune;
      updateSaisieDFCI();
    }
  }
}

function autoFillVehicule() {
  // Try to find a fleet vehicle matching the selected number and commune
  const num = document.getElementById("sf-vehicule")?.value;
  const commune = document.getElementById("sf-commune")?.value || auth.commune;
  if (!num || !commune) return;
  const v = vehicleFleet.find((x) => x.num === num && x.commune === commune);
  if (v) {
    const immatEl = document.getElementById("sf-immat");
    const kmEl = document.getElementById("sf-kmdeb");
    if (immatEl && !immatEl.value) immatEl.value = v.immat;
    if (kmEl && !kmEl.value && v.km) kmEl.value = v.km;
  }
}

function toggleGPSTrack() {
  if (activeTrackId) {
    // Stop tracking
    if (trackWatchId) navigator.geolocation.clearWatch(trackWatchId);
    trackWatchId = null;
    const pts = gpsTrackData[activeTrackId] || [];
    activeTrackId = null;
    dbSave("gpstracks", gpsTrackData);
    buildSaisie();
  } else {
    // Start tracking
    if (!navigator.geolocation) {
      alert("GPS non disponible");
      return;
    }
    activeTrackId = "track_" + Date.now();
    gpsTrackData[activeTrackId] = [];
    trackWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const pt = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          alt: Math.round(pos.coords.altitude || 0),
          ts: new Date().toISOString(),
          spd: pos.coords.speed || 0,
        };
        if (!gpsTrackData[activeTrackId]) gpsTrackData[activeTrackId] = [];
        gpsTrackData[activeTrackId].push(pt);
        // Update status display
        const st = document.getElementById("track-status");
        if (st)
          st.textContent =
            '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px;color:#ef4444">radio_button_checked</span> Enregistrement... (' +
            gpsTrackData[activeTrackId].length +
            " pts)";
        dbSave("gpstracks", gpsTrackData);
      },
      (err) => console.warn("GPS track error", err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    buildSaisie();
  }
}

function handlePhotoCapture(input, context) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = function (e) {
    // Compress to thumbnail
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement("canvas");
      const maxW = 800,
        maxH = 600;
      let w = img.width,
        h = img.height;
      if (w > maxW) {
        h = h * (maxW / w);
        w = maxW;
      }
      if (h > maxH) {
        w = w * (maxH / h);
        h = maxH;
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const thumb = canvas.toDataURL("image/jpeg", 0.6);
      const now = new Date();
      const photo = {
        id: "ph_" + Date.now(),
        data: thumb,
        date: now.toISOString().split("T")[0],
        time: now.toTimeString().substring(0, 8),
        ts: now.toISOString(),
        lat: myPos ? myPos.lat : null,
        lon: myPos ? myPos.lon : null,
        alt: myPos ? myPos.alt : null,
        commune:
          auth.commune ||
          (document.getElementById("sf-commune")
            ? document.getElementById("sf-commune").value
            : ""),
        context: context,
        legend: "",
        type: "observation",
      };
      fieldPhotos.push(photo);
      dbSave("photos", fieldPhotos);
      if (context === "saisie") renderSaisiePhotos();
      if (context === "releve") renderRelevePhotos();
      if (context === "burned") renderBurnedPhotos();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function renderSaisiePhotos() {
  const container = document.getElementById("saisie-photos-preview");
  if (!container) return;
  const today = new Date().toISOString().split("T")[0];
  const todayPhotos = fieldPhotos.filter((p) => p.date === today);
  container.innerHTML = todayPhotos
    .map(
      (p, i) => `
    <div style="position:relative;width:90px;height:70px;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)">
      <img src="${p.data}" style="width:100%;height:100%;object-fit:cover"/>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);font-size:8px;color:#94a3b8;padding:1px 3px">${p.time} ${p.lat ? '<span class="material-symbols-outlined" style="font-size:8px;vertical-align:-1px">place</span>' : '<span class="material-symbols-outlined" style="font-size:8px;vertical-align:-1px;color:#f97316">warning</span>'}</div>
      <button onclick="deletePhoto('${p.id}')" style="position:absolute;top:2px;right:2px;background:rgba(239,68,68,0.8);border:none;color:#fff;border-radius:50%;width:16px;height:16px;font-size:9px;cursor:pointer;line-height:16px;padding:0">✕</button>
    </div>
  `,
    )
    .join("");
}

function deletePhoto(id) {
  if (!confirm("Supprimer cette photo ?")) return;
  fieldPhotos = fieldPhotos.filter((p) => p.id !== id);
  dbSave("photos", fieldPhotos);
  renderSaisiePhotos();
  renderRelevePhotos();
}

function submitSaisie() {
  const commune =
    document.getElementById("sf-commune")?.value || auth.commune || "";
  if (!commune) {
    alert("⚠️ Veuillez sélectionner une commune");
    return;
  }
  const date = document.getElementById("sf-date")?.value;
  const vehicule = document.getElementById("sf-vehicule")?.value;
  const dfci = document.getElementById("sf-dfci")?.value || "";
  const record = {
    id: "pat_" + Date.now(),
    commune: commune,
    dfci: dfci,
    date: date,
    heure: document.getElementById("sf-heure")?.value || "",
    heureFin: document.getElementById("sf-hfin")?.value || "",
    vehicule: vehicule,
    immat: document.getElementById("sf-immat")?.value || "",
    kmDebut: document.getElementById("sf-kmdeb")?.value || "",
    kmFin: document.getElementById("sf-kmfin")?.value || "",
    chef: document.getElementById("sf-chef")?.value || "",
    telChef: document.getElementById("sf-tch")?.value || "",
    eq1: document.getElementById("sf-eq1")?.value || "",
    tel1: document.getElementById("sf-t1")?.value || "",
    eq2: document.getElementById("sf-eq2")?.value || "",
    tel2: document.getElementById("sf-t2")?.value || "",
    eq3: document.getElementById("sf-eq3")?.value || "",
    tel3: document.getElementById("sf-t3")?.value || "",
    risque: document.getElementById("sf-risk-val")?.value || "vert",
    intervention: document.getElementById("sf-inter")?.checked || false,
    sensibPietons: document.getElementById("sf-piet")?.checked || false,
    sensibPro: document.getElementById("sf-pro")?.checked || false,
    departFeu: document.getElementById("sf-feu")?.checked || false,
    nbPietons: parseInt(document.getElementById("sf-nb-piet")?.value || "0"),
    nbVehicules: parseInt(document.getElementById("sf-nb-veh")?.value || "0"),
    nbPro: parseInt(document.getElementById("sf-nb-pro")?.value || "0"),
    observation: document.getElementById("sf-obs")?.value || "",
    trackId: activeTrackId || null,
    photos: fieldPhotos.filter((p) => p.date === date).map((p) => p.id),
    savedAt: new Date().toISOString(),
    savedBy: auth.level === "dept" ? "dept" : auth.commune,
  };
  // Stop GPS tracking if active
  if (activeTrackId) {
    if (trackWatchId) navigator.geolocation.clearWatch(trackWatchId);
    trackWatchId = null;
    dbSave("gpstracks", gpsTrackData);
    activeTrackId = null;
  }
  patrolRecords.push(record);
  dbSave("patrols", patrolRecords);
  // Update fleet vehicle status & km if matched
  const fleetVeh = vehicleFleet.find(
    (v) =>
      v.immat === record.immat ||
      (v.num === record.vehicule && v.commune === record.commune),
  );
  if (fleetVeh) {
    if (record.kmFin && parseInt(record.kmFin) > fleetVeh.km)
      fleetVeh.km = parseInt(record.kmFin);
    if (record.heureFin) {
      // Patrol ended → set back to disponible
      if (fleetVeh.status === "en_patrouille") {
        fleetVeh.status = "disponible";
        fleetVeh.statusHistory.push({
          status: "disponible",
          ts: new Date().toISOString(),
          by: record.commune,
        });
      }
    } else {
      // Patrol started → set to en_patrouille
      if (fleetVeh.status === "disponible") {
        fleetVeh.status = "en_patrouille";
        fleetVeh.statusHistory.push({
          status: "en_patrouille",
          ts: new Date().toISOString(),
          by: record.commune,
        });
      }
    }
    dbSave("fleet", vehicleFleet);
  }
  interventions.unshift({
    id: Date.now(),
    ts: new Date().toISOString(),
    date: record.date,
    heure: record.heure,
    chef: record.chef,
    tel_chef: record.telChef,
    commune: record.commune,
  });
  alert(
    "Fiche de patrouille enregistrée !\n" +
      record.date +
      " • Véhicule " +
      record.vehicule +
      " • " +
      record.commune,
  );
  switchTab("historique");
}

// ============================================================
// HISTORIQUE — Consultation des fiches
// ============================================================
function buildHistorique() {
  const el = document.getElementById("tab-historique");
  const records = getAccessibleRecords();
  const dates = [...new Set(records.map((r) => r.date))].sort().reverse();
  const communes = [...new Set(records.map((r) => r.commune))].sort();
  el.innerHTML = `<h2 style="font-family:'Space Grotesk';font-size:18px;font-weight:800;color:#f1f5f9;margin-bottom:4px"><span class="material-symbols-outlined" style="vertical-align:-4px">history_edu</span> Historique des patrouilles</h2>
  <p style="color:#94a3b8;font-size:12px;margin-bottom:12px">${auth.level === "dept" ? '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">account_balance</span> Vue département — Toutes les communes' : '<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">location_city</span> Commune de ' + auth.commune} • ${records.length} fiche${records.length > 1 ? "s" : ""}</p>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
    <select id="hist-date" class="field-input" style="flex:1 1 140px" onchange="filterHistorique()">
      <option value="">📅 Toutes les dates</option>
      ${dates.map((d) => `<option value="${d}">${formatDateFR(d)}</option>`).join("")}
    </select>
      ${auth.level === "dept" ? `<select id="hist-commune" class="field-input" style="flex:1 1 160px" onchange="filterHistorique()"><option value=""><span class="material-symbols-outlined" style="vertical-align:-2px">location_city</span> Toutes communes</option>${communes.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>` : ""}
    <select id="hist-vehicule" class="field-input" style="flex:1 1 100px" onchange="filterHistorique()">
      <option value="">🚒 Tous véhicules</option>
      <option value="1">1 — Président</option><option value="2">2 — Patrouille</option>
      <option value="3">3 — Patrouille</option><option value="4">4 — Patrouille</option><option value="5">5 — Patrouille</option>
    </select>
  </div>
  <div id="hist-results" style="display:flex;flex-direction:column;gap:8px"></div>`;
  filterHistorique();
}

function getAccessibleRecords() {
  if (auth.level === "dept") return patrolRecords;
  return patrolRecords.filter((r) => r.commune === auth.commune);
}

function formatDateFR(d) {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  const jours = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  const dt = new Date(d + "T00:00:00");
  return jours[dt.getDay()] + " " + day + "/" + m + "/" + y;
}

function filterHistorique() {
  const dateF = document.getElementById("hist-date")?.value || "";
  const commF = document.getElementById("hist-commune")?.value || "";
  const vehF = document.getElementById("hist-vehicule")?.value || "";
  let records = getAccessibleRecords();
  if (dateF) records = records.filter((r) => r.date === dateF);
  if (commF) records = records.filter((r) => r.commune === commF);
  if (vehF) records = records.filter((r) => r.vehicule === vehF);
  records.sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure));
  const container = document.getElementById("hist-results");
  if (!container) return;
  if (records.length === 0) {
    container.innerHTML =
      '<div class="card" style="text-align:center;color:#64748b;padding:30px"><span class="material-symbols-outlined" style="font-size:48px;opacity:0.5">inbox</span><br>Aucune fiche de patrouille trouvée</div>';
    return;
  }
  container.innerHTML = records
    .map((r) => {
      const rl = RLVL.find((x) => x.v === r.risque) || RLVL[0];
      const hasTrack =
        r.trackId &&
        gpsTrackData[r.trackId] &&
        gpsTrackData[r.trackId].length > 0;
      const trackPts = hasTrack ? gpsTrackData[r.trackId].length : 0;
      const photos = r.photos ? r.photos.length : 0;
      const kmDist =
        r.kmFin && r.kmDebut
          ? Math.max(0, parseInt(r.kmFin) - parseInt(r.kmDebut))
          : 0;
      return `<div class="card" style="border-left:4px solid ${rl.c}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:800;color:#f1f5f9;font-family:'Space Grotesk'">${formatDateFR(r.date)}</div>
          <div style="font-size:12px;color:#94a3b8">${r.commune} ${r.dfci ? "(" + r.dfci + ")" : ""}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
          <span style="padding:2px 8px;border-radius:6px;background:rgba(220,38,38,0.1);color:#fca5a5;font-size:11px;font-weight:700;font-family:'Space Grotesk'"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">fire_truck</span> V${r.vehicule}</span>
          <span style="padding:2px 8px;border-radius:8px;background:${rl.bg};color:${rl.c};font-size:10px;font-weight:700;border:1px solid ${rl.c}">${rl.ls}</span>
          ${r.intervention ? '<span style="padding:2px 6px;border-radius:6px;background:rgba(239,68,68,0.15);color:#ef4444;font-size:10px;font-weight:700"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">emergency</span> Intervention</span>' : ""}
          ${r.departFeu ? '<span style="padding:2px 6px;border-radius:6px;background:rgba(249,115,22,0.15);color:#f97316;font-size:10px;font-weight:700"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">local_fire_department</span> Feu</span>' : ""}
        </div>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:#94a3b8;margin-bottom:6px">
        <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">schedule</span> ${r.heure || "?"}${r.heureFin ? " → " + r.heureFin : ""}</span>
        ${r.immat ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">directions_car</span> ' + r.immat + "</span>" : ""}
        ${kmDist ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">straighten</span> ' + kmDist + " km</span>" : ""}
        ${r.chef ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">person</span> ' + r.chef + "</span>" : ""}
        <span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">group</span> ${[r.eq1, r.eq2, r.eq3].filter(Boolean).length + 1} pers.</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:11px;color:#94a3b8;margin-bottom:6px">
        ${r.nbPietons ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">directions_walk</span> ' + r.nbPietons + " piétons</span>" : ""}
        ${r.nbVehicules ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">directions_car</span> ' + r.nbVehicules + " véhicules</span>" : ""}
        ${r.nbPro ? '<span><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">engineering</span> ' + r.nbPro + " pros</span>" : ""}
      </div>
      ${r.observation ? '<div style="font-size:12px;color:#cbd5e1;background:rgba(0,0,0,0.2);padding:8px;border-radius:6px;margin-bottom:6px">' + r.observation.replace(/\n/g, "<br>") + "</div>" : ""}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${hasTrack ? `<button onclick="showTrackOnMap('${r.trackId}','${r.commune}','${r.date}')" class="btn" style="padding:4px 10px;background:rgba(34,197,94,0.1);border:1px solid #22c55e;color:#22c55e;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">map</span> Voir trajet (${trackPts} pts)</button>` : ""}
        ${photos ? `<button onclick="showRecordPhotos('${r.id}')" class="btn" style="padding:4px 10px;background:rgba(59,130,246,0.1);border:1px solid #3b82f6;color:#3b82f6;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">photo_camera</span> ${photos} photo${photos > 1 ? "s" : ""}</button>` : ""}
        <button onclick="exportRecord('${r.id}')" class="btn" style="padding:4px 10px;background:rgba(168,85,247,0.1);border:1px solid #a855f7;color:#a855f7;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">ios_share</span> Exporter</button>
        <button onclick="deleteRecord('${r.id}')" class="btn" style="padding:4px 10px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">delete</span></button>
      </div>
    </div>`;
    })
    .join("");
}

function showTrackOnMap(trackId, commune, date) {
  switchTab("carte");
  setTimeout(() => {
    const pts = gpsTrackData[trackId];
    if (!pts || pts.length === 0) {
      alert("Aucun point GPS enregistré");
      return;
    }
    // Remove previous track overlay
    if (window._histTrackLayer) map.removeLayer(window._histTrackLayer);
    if (window._histTrackMarkers)
      window._histTrackMarkers.forEach((m) => map.removeLayer(m));
    window._histTrackMarkers = [];
    const latlngs = pts.map((p) => [p.lat, p.lon]);
    window._histTrackLayer = L.polyline(latlngs, {
      color: "#22c55e",
      weight: 4,
      opacity: 0.9,
      dashArray: "8,4",
    }).addTo(map);
    // Start marker
    const startM = L.marker(latlngs[0], {
      icon: L.divIcon({
        html:
          '<div style="background:#22c55e;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:-1px">play_arrow</span> Départ ' +
          pts[0].ts.substring(11, 16) +
          "</div>",
        className: "",
      }),
    }).addTo(map);
    window._histTrackMarkers.push(startM);
    // End marker
    const endM = L.marker(latlngs[latlngs.length - 1], {
      icon: L.divIcon({
        html:
          '<div style="background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;white-space:nowrap"><span class="material-symbols-outlined" style="font-size:10px;vertical-align:-1px">stop</span> Fin ' +
          pts[pts.length - 1].ts.substring(11, 16) +
          "</div>",
        className: "",
      }),
    }).addTo(map);
    window._histTrackMarkers.push(endM);
    map.fitBounds(window._histTrackLayer.getBounds().pad(0.15));
    // Calculate distance
    let dist = 0;
    for (let i = 1; i < pts.length; i++)
      dist += haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
    alert(
      `Trajet ${commune} — ${formatDateFR(date)}\n${pts.length} points GPS\n${dist < 1 ? (dist * 1000).toFixed(0) + " m" : dist.toFixed(2) + " km"}\n${pts[0].ts.substring(11, 16)} → ${pts[pts.length - 1].ts.substring(11, 16)}`,
    );
  }, 300);
}

function showRecordPhotos(recordId) {
  const record = patrolRecords.find((r) => r.id === recordId);
  if (!record || !record.photos) return;
  const photos = fieldPhotos.filter((p) => record.photos.includes(p.id));
  if (photos.length === 0) {
    alert("Aucune photo trouvée");
    return;
  }
  // Show modal
  const modal = document.createElement("div");
  modal.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px";
  modal.innerHTML = `
    <div style="color:#f1f5f9;font-size:16px;font-weight:700;margin-bottom:12px;font-family:'Space Grotesk'"><span class="material-symbols-outlined" style="font-size:18px;vertical-align:-3px">photo_camera</span> Photos — ${record.commune} ${formatDateFR(record.date)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;max-height:70vh;overflow-y:auto;padding:10px">
      ${photos
        .map(
          (
            p,
          ) => `<div style="text-align:center"><img src="${p.data}" style="max-width:300px;max-height:250px;border-radius:8px;border:2px solid rgba(255,255,255,0.1)"/>
        <div style="font-size:10px;color:#94a3b8;margin-top:4px">${p.time} ${p.lat ? '<span class="material-symbols-outlined" style="font-size:10px;vertical-align:-1px;color:#94a3b8">place</span> ' + p.lat.toFixed(4) + "," + p.lon.toFixed(4) : '<span class="material-symbols-outlined" style="font-size:10px;vertical-align:-1px;color:#f97316">warning</span> Pas de GPS'}</div>
        ${p.legend ? '<div style="font-size:11px;color:#cbd5e1">' + p.legend + "</div>" : ""}
      </div>`,
        )
        .join("")}
    </div>
    <button onclick="this.parentElement.remove()" class="btn" style="margin-top:16px;padding:10px 30px;background:rgba(255,255,255,0.1);border:1px solid #fff;color:#fff;font-size:14px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">close</span> Fermer</button>
  `;
  document.body.appendChild(modal);
}

function exportRecord(recordId) {
  const r = patrolRecords.find((x) => x.id === recordId);
  if (!r) return;
  const lines = [
    "═══ FICHE DE PATROUILLE CCFF ═══",
    "Date: " + formatDateFR(r.date),
    "Commune: " + r.commune + " (" + r.dfci + ")",
    "Véhicule: " + r.vehicule + (r.immat ? " — " + r.immat : ""),
    "Horaires: " + (r.heure || "?") + " → " + (r.heureFin || "?"),
    "Km: " +
      (r.kmDebut || "?") +
      " → " +
      (r.kmFin || "?") +
      " = " +
      (r.kmFin && r.kmDebut ? Math.max(0, r.kmFin - r.kmDebut) : 0) +
      " km",
    "",
    "ÉQUIPE:",
    "  Chef: " + r.chef + " (" + r.telChef + ")",
    r.eq1 ? "  Éq.1: " + r.eq1 + " (" + r.tel1 + ")" : "",
    r.eq2 ? "  Éq.2: " + r.eq2 + " (" + r.tel2 + ")" : "",
    r.eq3 ? "  Éq.3: " + r.eq3 + " (" + r.tel3 + ")" : "",
    "",
    "RISQUE: " + r.risque,
    "Intervention: " + (r.intervention ? "OUI" : "Non"),
    "Départ de feu: " + (r.departFeu ? "OUI" : "Non"),
    "Piétons sensibilisés: " + r.nbPietons,
    "Véhicules sensibilisés: " + r.nbVehicules,
    "Pros sensibilisés: " + r.nbPro,
    "",
    "OBSERVATIONS:",
    r.observation || "(aucune)",
    "",
    r.trackId
      ? "TRAJET GPS: " +
        (gpsTrackData[r.trackId] || []).length +
        " points enregistrés"
      : "PAS DE TRAJET GPS",
    "Photos: " + (r.photos ? r.photos.length : 0),
    "",
    "═══ PyroVigil — " + new Date().toISOString() + " ═══",
  ]
    .filter((l) => l !== false)
    .join("\n");
  // Copy to clipboard
  navigator.clipboard
    .writeText(lines)
    .then(() =>
      alert(
        "Fiche copiée dans le presse-papier !\nVous pouvez la coller dans un email ou un message.",
      ),
    )
    .catch(() => {
      const ta = document.createElement("textarea");
      ta.value = lines;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      alert("Fiche copiée !");
    });
}

function deleteRecord(recordId) {
  if (!confirm("⚠️ Supprimer définitivement cette fiche de patrouille ?"))
    return;
  patrolRecords = patrolRecords.filter((r) => r.id !== recordId);
  dbSave("patrols", patrolRecords);
  buildHistorique();
}

// ============================================================
// PHOTOS & RELEVÉS TERRAIN
// ============================================================
function buildPhotos() {
  const el = document.getElementById("tab-photos");
  el.innerHTML = `<h2 style="font-family:'Space Grotesk';font-size:18px;font-weight:800;color:#f1f5f9;margin-bottom:4px"><span class="material-symbols-outlined" style="vertical-align:-4px">photo_camera</span> Relevés de terrain & Photos</h2>
  <p style="color:#94a3b8;font-size:12px;margin-bottom:14px">Photos géolocalisées, zones brûlées, points de départ de feu</p>
  <div style="max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:14px">

    <!-- ZONE BRÛLÉE -->
    <div class="card" style="border-left:4px solid #f97316">
      <div style="font-size:13px;font-weight:700;color:#f97316;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">local_fire_department</span> Déclarer une zone brûlée / Départ de feu</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 140px"><label style="font-size:10px;color:#94a3b8">Date</label><input type="date" id="bz-date" value="${new Date().toISOString().split("T")[0]}" class="field-input"/></div>
        <div style="flex:1 1 100px"><label style="font-size:10px;color:#94a3b8">Heure détection</label><input type="time" id="bz-time" value="${new Date().toTimeString().substring(0, 5)}" class="field-input"/></div>
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">Type</label>
          <select id="bz-type" class="field-input">
            <option value="depart_feu">🔥 Départ de feu</option>
            <option value="zone_brulee">⬛ Zone brûlée constatée</option>
            <option value="reprise_feu">🔴 Reprise de feu</option>
            <option value="feu_eteint">✅ Feu éteint</option>
          </select>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 180px"><label style="font-size:10px;color:#94a3b8">Commune</label>
          ${
            auth.level === "dept"
              ? `<select id="bz-commune" class="field-input"><option value="">-- Sélectionner --</option>${COMMUNES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>`
              : `<input id="bz-commune" class="field-input" value="${auth.commune || ""}" readonly style="color:#fca5a5"/>`
          }
        </div>
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">Lieu-dit</label><input id="bz-lieu" class="field-input" placeholder="Nom du lieu"/></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1"><label style="font-size:10px;color:#94a3b8">Latitude point départ</label><input id="bz-lat" class="field-input" placeholder="43.xxx"/></div>
        <div style="flex:1"><label style="font-size:10px;color:#94a3b8">Longitude point départ</label><input id="bz-lon" class="field-input" placeholder="6.xxx"/></div>
        <div style="flex:0 0 auto;align-self:flex-end">
          ${
            myPos && geoOn
              ? `<button onclick="document.getElementById('bz-lat').value='${myPos.lat.toFixed(6)}';document.getElementById('bz-lon').value='${myPos.lon.toFixed(6)}'" class="btn" style="padding:6px 10px;background:rgba(34,197,94,0.1);border:1px solid #22c55e;color:#22c55e;font-size:11px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">my_location</span> Ma position</button>`
              : `<span style="font-size:10px;color:#64748b">GPS inactif</span>`
          }
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">Surface estimée</label>
          <div style="display:flex;gap:4px"><input id="bz-surface" type="number" class="field-input" style="flex:1" placeholder="0"/><select id="bz-unit" class="field-input" style="flex:0 0 60px"><option value="m2">m²</option><option value="ha">ha</option></select></div>
        </div>
        <div style="flex:1 1 120px"><label style="font-size:10px;color:#94a3b8">Végétation</label>
          <select id="bz-veg" class="field-input">
            <option value="">-- Type --</option>
            <option value="garrigue">Garrigue</option>
            <option value="foret_pins">Forêt de pins</option>
            <option value="foret_chenes">Forêt de chênes</option>
            <option value="maquis">Maquis</option>
            <option value="herbes">Herbes sèches</option>
            <option value="mixte">Mixte</option>
          </select>
        </div>
      </div>
      <div style="margin-bottom:8px"><label style="font-size:10px;color:#94a3b8">Description / Observations</label><textarea id="bz-desc" class="field-input" rows="2" placeholder="Cause probable, direction du vent, moyens engagés..."></textarea></div>
      <div style="margin-bottom:8px">
        <label style="font-size:10px;color:#94a3b8;display:block;margin-bottom:4px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">photo_camera</span> Photos du relevé</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <label class="btn" style="padding:6px 14px;background:rgba(249,115,22,0.1);border:1px solid #f97316;color:#f97316;cursor:pointer;font-size:11px">
            <span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">photo_camera</span> Photo terrain
            <input type="file" accept="image/*" capture="environment" onchange="handlePhotoCapture(this,'burned')" style="display:none"/>
          </label>
          <label class="btn" style="padding:6px 14px;background:rgba(168,85,247,0.1);border:1px solid #a855f7;color:#a855f7;cursor:pointer;font-size:11px">
            <span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">image</span> Galerie
            <input type="file" accept="image/*" onchange="handlePhotoCapture(this,'burned')" style="display:none"/>
          </label>
        </div>
        <div id="burned-photos-preview" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>
      <button onclick="submitBurnedZone()" class="btn" style="padding:10px;width:100%;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;font-size:13px;font-weight:700;font-family:'Space Grotesk'"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">local_fire_department</span> Enregistrer le relevé</button>
    </div>

    <!-- HISTORIQUE DES RELEVÉS -->
    <div class="card">
      <div style="font-size:13px;font-weight:700;color:#22d3ee;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">list_alt</span> Relevés enregistrés (${getAccessibleBurned().length})</div>
      <div id="burned-list" style="display:flex;flex-direction:column;gap:6px"></div>
    </div>

    <!-- TOUTES LES PHOTOS -->
    <div class="card">
      <div style="font-size:13px;font-weight:700;color:#3b82f6;font-family:'Space Grotesk';margin-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.06);padding-bottom:6px"><span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">collections</span> Galerie photos (${getAccessiblePhotos().length})</div>
      <div id="all-photos-grid" style="display:flex;flex-wrap:wrap;gap:8px"></div>
    </div>
  </div>`;
  renderBurnedPhotos();
  renderBurnedList();
  renderAllPhotos();
}

function renderBurnedPhotos() {
  const container = document.getElementById("burned-photos-preview");
  if (!container) return;
  const today = new Date().toISOString().split("T")[0];
  const bPhotos = fieldPhotos.filter(
    (p) => p.context === "burned" && p.date === today,
  );
  container.innerHTML = bPhotos
    .map(
      (p) => `
    <div style="position:relative;width:80px;height:60px;border-radius:6px;overflow:hidden;border:1px solid rgba(249,115,22,0.3)">
      <img src="${p.data}" style="width:100%;height:100%;object-fit:cover"/>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);font-size:8px;color:#94a3b8;padding:1px 3px">${p.time}</div>
    </div>
  `,
    )
    .join("");
}

function renderRelevePhotos() {
  // Alias for burned photos render since both share the same section
  renderBurnedPhotos();
}

function getAccessibleBurned() {
  if (auth.level === "dept") return burnedZones;
  return burnedZones.filter((b) => b.commune === auth.commune);
}

function getAccessiblePhotos() {
  if (auth.level === "dept") return fieldPhotos;
  return fieldPhotos.filter((p) => p.commune === auth.commune);
}

function submitBurnedZone() {
  const commune =
    document.getElementById("bz-commune")?.value || auth.commune || "";
  if (!commune) {
    alert("⚠️ Veuillez sélectionner une commune");
    return;
  }
  const lat = parseFloat(document.getElementById("bz-lat")?.value);
  const lon = parseFloat(document.getElementById("bz-lon")?.value);
  if (isNaN(lat) || isNaN(lon)) {
    alert("Veuillez renseigner les coordonnées GPS");
    return;
  }
  const today = new Date().toISOString().split("T")[0];
  const record = {
    id: "bz_" + Date.now(),
    type: document.getElementById("bz-type")?.value || "depart_feu",
    date: document.getElementById("bz-date")?.value || today,
    time: document.getElementById("bz-time")?.value || "",
    commune: commune,
    lieu: document.getElementById("bz-lieu")?.value || "",
    lat: lat,
    lon: lon,
    surface: parseFloat(document.getElementById("bz-surface")?.value || "0"),
    surfaceUnit: document.getElementById("bz-unit")?.value || "m2",
    vegetation: document.getElementById("bz-veg")?.value || "",
    description: document.getElementById("bz-desc")?.value || "",
    photos: fieldPhotos
      .filter((p) => p.context === "burned" && p.date === today)
      .map((p) => p.id),
    savedAt: new Date().toISOString(),
    savedBy: auth.level === "dept" ? "dept" : auth.commune,
  };
  burnedZones.push(record);
  dbSave("burned", burnedZones);
  const typeLabels = {
    depart_feu: "🔥 Départ de feu",
    zone_brulee: "⬛ Zone brûlée",
    reprise_feu: "🔴 Reprise",
    feu_eteint: "✅ Feu éteint",
  };
  alert(
    "Relevé enregistré !\n" +
      (typeLabels[record.type] || record.type) +
      "\n📅 " +
      formatDateFR(record.date) +
      " " +
      record.time +
      "\n📍 " +
      record.commune +
      " — " +
      record.lieu,
  );
  buildPhotos();
}

function renderBurnedList() {
  const container = document.getElementById("burned-list");
  if (!container) return;
  const records = getAccessibleBurned().sort((a, b) =>
    (b.date + b.time).localeCompare(a.date + a.time),
  );
  if (records.length === 0) {
    container.innerHTML =
      '<div style="text-align:center;color:#64748b;font-size:12px;padding:16px">Aucun relevé enregistré</div>';
    return;
  }
  const typeIcons = {
    depart_feu:
      '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#f97316">local_fire_department</span>',
    zone_brulee:
      '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#64748b">square</span>',
    reprise_feu:
      '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#dc2626">radio_button_checked</span>',
    feu_eteint:
      '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px;color:#22c55e">check_circle</span>',
  };
  const typeLabels = {
    depart_feu: "Départ de feu",
    zone_brulee: "Zone brûlée",
    reprise_feu: "Reprise feu",
    feu_eteint: "Feu éteint",
  };
  container.innerHTML = records
    .map(
      (r) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;border-left:3px solid ${r.type === "depart_feu" || r.type === "reprise_feu" ? "#f97316" : r.type === "feu_eteint" ? "#22c55e" : "#64748b"}">
      <div>
        <div style="font-size:12px;font-weight:700;color:#f1f5f9">${typeIcons[r.type] || '<span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px">place</span>'} ${typeLabels[r.type] || r.type}</div>
        <div style="font-size:10px;color:#94a3b8">${formatDateFR(r.date)} ${r.time} • ${r.commune} ${r.lieu ? "— " + r.lieu : ""}</div>
        <div style="font-size:10px;color:#64748b">${r.surface ? r.surface + " " + r.surfaceUnit : ""} ${r.vegetation ? "• " + r.vegetation : ""} ${r.photos ? '• <span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">photo_camera</span>' + r.photos.length : ""}</div>
      </div>
      <div style="display:flex;gap:4px">
        <button onclick="showBurnedOnMap('${r.id}')" class="btn" style="padding:4px 8px;background:rgba(249,115,22,0.1);border:1px solid #f97316;color:#f97316;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">map</span></button>
        <button onclick="deleteBurned('${r.id}')" class="btn" style="padding:4px 8px;background:rgba(239,68,68,0.05);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:10px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">delete</span></button>
      </div>
    </div>
  `,
    )
    .join("");
}

function showBurnedOnMap(id) {
  const record = burnedZones.find((b) => b.id === id);
  if (!record) return;
  switchTab("carte");
  setTimeout(() => {
    if (window._burnedMarker) map.removeLayer(window._burnedMarker);
    const icon =
      record.type === "depart_feu" || record.type === "reprise_feu"
        ? '<span class="material-symbols-outlined" style="font-size:28px;color:#f97316">local_fire_department</span>'
        : record.type === "feu_eteint"
          ? '<span class="material-symbols-outlined" style="font-size:28px;color:#22c55e">check_circle</span>'
          : '<span class="material-symbols-outlined" style="font-size:28px;color:#64748b">square</span>';
    const typeLabels = {
      depart_feu: "Départ de feu",
      zone_brulee: "Zone brûlée",
      reprise_feu: "Reprise feu",
      feu_eteint: "Feu éteint",
    };
    window._burnedMarker = L.marker([record.lat, record.lon], {
      icon: L.divIcon({
        html: `<div style="text-align:center"><div style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">${icon}</div><div style="background:rgba(249,115,22,0.9);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;margin-top:-4px">${typeLabels[record.type] || ""}<br>${formatDateFR(record.date)} ${record.time}<br>${record.commune}${record.lieu ? " — " + record.lieu : ""}</div></div>`,
        className: "",
        iconAnchor: [20, 15],
      }),
    }).addTo(map);
    map.setView([record.lat, record.lon], 15);
  }, 300);
}

function deleteBurned(id) {
  if (!confirm("Supprimer ce relevé ?")) return;
  burnedZones = burnedZones.filter((b) => b.id !== id);
  dbSave("burned", burnedZones);
  buildPhotos();
}

function renderAllPhotos() {
  const container = document.getElementById("all-photos-grid");
  if (!container) return;
  const photos = getAccessiblePhotos().sort((a, b) => b.ts.localeCompare(a.ts));
  if (photos.length === 0) {
    container.innerHTML =
      '<div style="text-align:center;color:#64748b;font-size:12px;padding:16px">Aucune photo</div>';
    return;
  }
  container.innerHTML = photos
    .slice(0, 50)
    .map(
      (p) => `
    <div style="position:relative;cursor:pointer" onclick="showPhotoModal('${p.id}')">
      <img src="${p.data}" style="width:110px;height:85px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,0.1)"/>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);font-size:8px;color:#94a3b8;padding:2px 4px;border-radius:0 0 6px 6px">
        ${formatDateFR(p.date)} ${p.time}<br>
        ${p.commune || ""} ${p.lat ? '<span class="material-symbols-outlined" style="font-size:8px;vertical-align:-1px">place</span>' : ""}
      </div>
    </div>
  `,
    )
    .join("");
}

function showPhotoModal(photoId) {
  const p = fieldPhotos.find((x) => x.id === photoId);
  if (!p) return;
  const modal = document.createElement("div");
  modal.style.cssText =
    "position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px";
  modal.innerHTML = `
    <img src="${p.data}" style="max-width:90vw;max-height:65vh;border-radius:8px;border:2px solid rgba(255,255,255,0.1)"/>
    <div style="margin-top:12px;text-align:center;color:#f1f5f9">
      <div style="font-size:14px;font-weight:700;font-family:'Space Grotesk'">${formatDateFR(p.date)} à ${p.time}</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">${p.commune || "Commune inconnue"}</div>
      ${p.lat ? `<div style="font-size:11px;color:#22c55e;margin-top:2px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-1px">place</span> ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)} ${p.alt ? "• Alt. " + p.alt + "m" : ""}</div>` : '<div style="font-size:11px;color:#f97316;margin-top:2px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-1px">warning</span> Pas de coordonnées GPS</div>'}
    </div>
    <div style="display:flex;gap:8px;margin-top:12px">
      ${p.lat ? `<button onclick="showPhotoOnMap(${p.lat},${p.lon},'${p.date}','${p.time}');this.closest('div[style]').remove()" class="btn" style="padding:8px 16px;background:rgba(34,197,94,0.1);border:1px solid #22c55e;color:#22c55e;font-size:12px"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">map</span> Voir sur la carte</button>` : ""}
      <button onclick="this.closest('div[style*=fixed]').remove()" class="btn" style="padding:8px 20px;background:rgba(255,255,255,0.1);border:1px solid #fff;color:#fff;font-size:12px"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">close</span> Fermer</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function showPhotoOnMap(lat, lon, date, time) {
  switchTab("carte");
  setTimeout(() => {
    if (window._photoMarker) map.removeLayer(window._photoMarker);
    window._photoMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        html: `<div style="text-align:center"><div style="font-size:24px"><span class="material-symbols-outlined" style="font-size:32px;color:#3b82f6;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">photo_camera</span></div><div style="background:rgba(59,130,246,0.9);color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;margin-top:-4px">Photo ${formatDateFR(date)} ${time}</div></div>`,
        className: "",
        iconAnchor: [12, 12],
      }),
    }).addTo(map);
    map.setView([lat, lon], 16);
  }, 300);
}

// ============================================================
// CODES
// ============================================================
function buildCodes() {
  const el = document.getElementById("tab-codes");
  const comms = auth.level === "dept" ? COMMUNES : [auth.commune];
  el.innerHTML = `<h2 style="font-family:'Space Grotesk';font-size:18px;font-weight:800;color:#f1f5f9;margin-bottom:4px"><span class="material-symbols-outlined" style="vertical-align:-4px">key</span> Codes d'accès</h2>
  <p style="color:#94a3b8;font-size:12px;margin-bottom:14px">${auth.level === "dept" ? "Tous les codes" : "Code de " + auth.commune}</p>
  <div class="card" style="margin-bottom:14px;border-left:4px solid #dc2626"><div style="font-size:11px;color:#f87171;font-weight:600">Code département</div><div style="font-size:18px;font-weight:800;font-family:'Space Grotesk';color:#fca5a5;letter-spacing:2px">${DC}</div></div>
  <input placeholder="Rechercher..." class="field-input" style="margin-bottom:10px" oninput="filterCodes(this.value)"/>
  <div id="codes-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px"></div>`;
  filterCodes("");
}
function filterCodes(q) {
  q = q.toLowerCase();
  const comms =
    auth.level === "dept"
      ? COMMUNES.filter((c) => !q || c.toLowerCase().includes(q))
      : [auth.commune];
  document.getElementById("codes-grid").innerHTML = comms
    .map((c) => {
      const dfci =
        (typeof COMMUNE_DFCI !== "undefined" && COMMUNE_DFCI[c]) || "???";
      return `<div class="card" style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center"><div><span style="font-size:12px;color:#e2e8f0">${c}</span></div><div style="display:flex;gap:6px;align-items:center"><span style="padding:1px 5px;border-radius:4px;background:rgba(249,115,22,0.1);color:#f97316;font-size:11px;font-weight:800;font-family:'Space Grotesk',monospace;border:1px solid rgba(249,115,22,0.3)">${dfci}</span><code style="color:#93c5fd;background:rgba(59,130,246,0.1);padding:1px 7px;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:1px">${CC[c]}</code></div></div>`;
    })
    .join("");
}

// ============================================================
// SOS PHONE CONFIG
// ============================================================
function buildSOSConfig() {
  const el = document.getElementById("tab-sos-config");
  const comms = auth.level === "dept" ? COMMUNES : [auth.commune];

  el.innerHTML = `
    <h2 style="font-family:'Space Grotesk';font-size:20px;font-weight:800;color:#f1f5f9;margin-bottom:4px"><span class="material-symbols-outlined" style="vertical-align:-4px">phonelink_ring</span> Téléphones SOS par commune</h2>
    <p style="color:#94a3b8;font-size:12px;margin-bottom:6px">Configurez 1 à 3 numéros de téléphone qui recevront l'alerte SOS pour chaque commune.</p>

    <div style="background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.2);border-radius:10px;padding:14px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="material-symbols-outlined" style="font-size:24px;color:#ef4444">emergency</span>
        <div>
          <div style="font-size:14px;font-weight:700;color:#fca5a5;font-family:'Space Grotesk'">Fonctionnement SOS</div>
        </div>
      </div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.8">
        1. L'utilisateur appuie sur le bouton <b style="color:#ef4444"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px">emergency_share</span> SOS</b><br>
        2. Un <b style="color:#fcd34d">compte à rebours de 10 secondes</b> démarre<br>
        3. L'utilisateur peut <b style="color:#22c55e">annuler</b> pendant ces 10 secondes (fausse manœuvre)<br>
        4. Après 10s : l'alerte est envoyée avec la <b style="color:#93c5fd">position GPS</b> aux téléphones configurés<br>
        5. Le <b style="color:#fca5a5">1er numéro</b> est appelé automatiquement sur mobile
      </div>
    </div>

    <div style="margin-bottom:14px">
      <input id="sos-search" placeholder="Rechercher une commune..." class="field-input" oninput="filterSOSConfig()"/>
    </div>

    <div id="sos-config-list" style="display:flex;flex-direction:column;gap:8px"></div>

    <div style="margin-top:20px;text-align:center">
      <div style="font-size:12px;color:#4b5563">
        ${
          auth.level === "dept"
            ? `📊 <b style="color:#94a3b8">${comms.filter((c) => sosPhones[c] && sosPhones[c].length > 0).length}</b> / ${comms.length} communes configurées`
            : ""
        }
      </div>
    </div>
  `;
  filterSOSConfig();
}

function filterSOSConfig() {
  const q = (document.getElementById("sos-search")?.value || "").toLowerCase();
  const comms =
    auth.level === "dept"
      ? COMMUNES.filter((c) => !q || c.toLowerCase().includes(q))
      : [auth.commune];
  const el = document.getElementById("sos-config-list");

  el.innerHTML = comms
    .map((c) => {
      const phones = sosPhones[c] || [];
      const configured = phones.length > 0;
      const massif = MASSIFS.find((m) => m.communes.includes(c));

      return `<div class="card" style="border-left:3px solid ${configured ? "#22c55e" : "#ef4444"}">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px">
        <div>
          <div style="font-size:14px;font-weight:700;color:#f1f5f9;font-family:'Space Grotesk'">${c}</div>
          <div style="font-size:10px;color:#64748b">${massif ? massif.nom : ""} • ${configured ? `${phones.length} tél. configuré${phones.length > 1 ? "s" : ""}` : '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px;color:#ef4444">warning</span> Aucun téléphone'}</div>
        </div>
        <span style="padding:3px 10px;border-radius:10px;background:${configured ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"};color:${configured ? "#22c55e" : "#ef4444"};font-size:10px;font-weight:700;border:1px solid ${configured ? "#22c55e" : "#ef4444"}">${configured ? '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">check_circle</span> OK' : '<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">cancel</span> Non configuré'}</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${[0, 1, 2]
          .map(
            (i) => `
          <div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:10px;color:#64748b;min-width:60px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">smartphone</span> Tél. ${i + 1}${i === 0 ? " *" : ""}</span>
            <input id="sos-phone-${c.replace(/[^a-zA-Z0-9]/g, "_")}-${i}"
              value="${phones[i] || ""}"
              placeholder="${i === 0 ? "06 XX XX XX XX (obligatoire)" : "06 XX XX XX XX (optionnel)"}"
              onchange="updateSOSPhone('${c.replace(/'/g, "\\'")}', ${i}, this.value)"
              class="field-input" type="tel" style="flex:1;font-size:13px;${i === 0 ? "border-color:rgba(220,38,38,0.3)" : ""}"/>
            ${phones[i] ? `<a href="tel:${phones[i].replace(/\\s/g, "")}" style="font-size:10px;color:#22c55e;text-decoration:none"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">call</span></a>` : ""}
          </div>
        `,
          )
          .join("")}
      </div>
      ${!configured ? '<div style="font-size:10px;color:#ef4444;margin-top:6px"><span class="material-symbols-outlined" style="font-size:12px;vertical-align:-1px">warning</span> Configurez au moins le téléphone 1 pour activer le SOS</div>' : ""}
    </div>`;
    })
    .join("");
}

function updateSOSPhone(commune, index, value) {
  if (!sosPhones[commune]) sosPhones[commune] = [];
  // Clean up phone number
  const clean = value.trim();
  if (clean) {
    // Ensure array is long enough
    while (sosPhones[commune].length <= index) sosPhones[commune].push("");
    sosPhones[commune][index] = clean;
  } else {
    if (index < sosPhones[commune].length) {
      sosPhones[commune][index] = "";
    }
  }
  // Remove trailing empty strings
  while (
    sosPhones[commune].length > 0 &&
    !sosPhones[commune][sosPhones[commune].length - 1]
  ) {
    sosPhones[commune].pop();
  }
  // Refresh the display to update status indicators
  setTimeout(() => filterSOSConfig(), 100);
}

// ============================================================
// EXPOSE GLOBAL FUNCTIONS (Fix Module Scope Issues)
// ============================================================
window.doLogin = doLogin;
window.logout = logout;
window.switchTab = switchTab;
window.toggleLayer = toggleLayer;
window.setRisk = setRisk;
window.toggleGeo = toggleGeo;
window.triggerSOS = triggerSOS;
window.cancelSOS = cancelSOS;
window.navigateTarget = navigateTarget;
window.launchNav = launchNav;
window.showRouteOnMap = showRouteOnMap;
window.toggleNavPanel = toggleNavPanel;
window.setNavMode = setNavMode;
window.updateSOSPhone = updateSOSPhone;
window.filterSOSConfig = filterSOSConfig;

// Communes
window.filterCommunes = filterCommunes;

// Patrouilles
window.filterPatrouilles = filterPatrouilles;

// Véhicules
window.filterVehicules = filterVehicules;
window.showAddVehicule = showAddVehicule;
window.submitVehicule = submitVehicule;
window.editVehicule = editVehicule;
window.vehHistory = vehHistory;
window.removeVehicule = removeVehicule;
window.setVehStatus = setVehStatus;

// Missions
window.submitMission = submitMission;

// Saisie
window.updateSaisieDFCI = updateSaisieDFCI;
window.pickFleetVehicule = pickFleetVehicule;
window.autoFillVehicule = autoFillVehicule;
window.toggleGPSTrack = toggleGPSTrack;
window.handlePhotoCapture = handlePhotoCapture;
window.deletePhoto = deletePhoto;
window.submitSaisie = submitSaisie;

// Historique
window.filterHistorique = filterHistorique;
window.showTrackOnMap = showTrackOnMap;
window.showRecordPhotos = showRecordPhotos;
window.exportRecord = exportRecord;
window.deleteRecord = deleteRecord;

// Photos & Burned Zones
window.submitBurnedZone = submitBurnedZone;
window.showBurnedOnMap = showBurnedOnMap;
window.deleteBurned = deleteBurned;
window.showPhotoModal = showPhotoModal;
window.showPhotoOnMap = showPhotoOnMap;

// Codes
window.filterCodes = filterCodes;
