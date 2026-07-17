// Descarga OSM vía Overpass API — traducción a JS del fetch_osm.py del CUF.
// Con caché local (IndexedDB, 7 días) por bbox+capa y entrega PROGRESIVA:
// onParcial(capas) se llama en cuanto cada grupo de capas está listo, para que el
// mapa se pinte sin esperar la descarga completa.

import { cacheGet, cacheSet, TTL_MS } from "./cache.js";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const PED = new Set(["pedestrian", "footway", "path", "living_street"]);
const EXCL = new Set([
  "pedestrian", "footway", "path", "living_street",
  "steps", "corridor", "elevator", "construction", "proposed", "raceway",
]);

let epPreferido = 0; // recuerda el último espejo que funcionó y empieza por ahí

async function overpass(consulta, onStatus) {
  let ultimo = null;
  for (let intento = 0; intento < 6; intento++) {
    const idx = (epPreferido + intento) % ENDPOINTS.length;
    const ep = ENDPOINTS[idx];
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(consulta),
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const datos = (await r.json()).elements;
      epPreferido = idx;
      return datos;
    } catch (e) {
      ultimo = e;
      onStatus && onStatus(`Espejo Overpass ${idx + 1}/${ENDPOINTS.length} falló (${e.message}) — probando otro…`);
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  throw ultimo;
}

// overpass con caché por bbox+capa; devuelve {els, fecha}
async function overpassCacheado(capa, bbox, consulta, onStatus) {
  const clave = capa + ":" + [bbox.s, bbox.w, bbox.n, bbox.e].map((v) => v.toFixed(4)).join(",");
  const c = await cacheGet(clave);
  if (c && Date.now() - c.t < TTL_MS) {
    onStatus(`${capa}: usando caché local (descargado ${new Date(c.t).toLocaleDateString("es")})`);
    return { els: c.els, fecha: new Date(c.t).toISOString().slice(0, 10) };
  }
  const els = await overpass(consulta, onStatus);
  await cacheSet(clave, { t: Date.now(), els });
  return { els, fecha: new Date().toISOString().slice(0, 10) };
}

function lineas(els, filtro) {
  const salida = [];
  for (const el of els) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    if (filtro && !filtro(el.tags || {})) continue;
    salida.push({
      coords: el.geometry.map((p) => [p.lon, p.lat]),
      tags: el.tags || {},
    });
  }
  return salida;
}

function poligonos(els) {
  const salida = [];
  for (const el of els) {
    const tags = el.tags || {};
    if (el.type === "way" && el.geometry) {
      const c = el.geometry.map((p) => [p.lon, p.lat]);
      if (c.length > 3) salida.push({ anillos: [c], tags });
    } else if (el.type === "relation" && el.members) {
      const anillos = [];
      for (const m of el.members) {
        if (m.type !== "way" || !m.geometry) continue;
        if (m.role && m.role !== "outer") continue;
        const c = m.geometry.map((p) => [p.lon, p.lat]);
        if (c.length > 3) anillos.push(c);
      }
      if (anillos.length) salida.push({ anillos, tags });
    }
  }
  return salida;
}

function centroide(poli) {
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of poli.anillos[0]) { sx += x; sy += y; n++; }
  return [sx / n, sy / n];
}

export async function descargarCapas(bbox, onStatus, onParcial) {
  const B = `(${bbox.s},${bbox.w},${bbox.n},${bbox.e})`;
  const cab = "[out:json][timeout:90];";
  const fechas = [];

  async function opcional(nombre, consulta) {
    try {
      const r = await overpassCacheado(nombre, bbox, consulta, onStatus);
      fechas.push(r.fecha);
      return r.els;
    } catch (e) {
      onStatus(`⚠ Capa "${nombre}" no disponible (${e.message}) — se continúa sin ella.`);
      return [];
    }
  }

  // 1) red vial y peatonal — esencial y lo primero que se pinta
  onStatus("Descargando red vial y peatonal…", 0.1);
  const rVias = await overpassCacheado("vias", bbox, `${cab}(way["highway"]${B};);out geom;`, onStatus);
  fechas.push(rVias.fecha);
  const roads = lineas(rVias.els, (t) => t.highway && !EXCL.has(t.highway));
  const pednet = lineas(rVias.els, (t) => PED.has(t.highway));
  onParcial && onParcial({ roads, pednet });

  // 2) edificios
  onStatus("Descargando edificios…", 0.35);
  const edif = await opcional("edificios",
    `${cab}(way["building"]${B};relation["building"]${B};);out geom;`);
  const buildings = poligonos(edif);
  onParcial && onParcial({ buildings });

  // 3) parques, agua y plazas (agua solo por ways: las relaciones de ríos grandes
  //    revientan el timeout de Overpass)
  onStatus("Descargando parques, agua y plazas…", 0.65);
  const verde = await opcional("verde",
    `${cab}(way["leisure"="park"]${B};relation["leisure"="park"]${B};` +
    `way["natural"="water"]${B};way["waterway"="riverbank"]${B};` +
    `way["waterway"~"^(river|stream|canal)$"]${B};` +
    `way["place"="square"]${B};way["highway"="pedestrian"]["area"="yes"]${B};);out geom;`);

  const parks = [], water = [], squares = [], waterways = [];
  for (const p of poligonos(verde)) {
    const t = p.tags;
    if (t.leisure === "park") parks.push(p);
    else if (t.natural === "water" || t.waterway === "riverbank") water.push(p);
    else squares.push(p);
  }
  for (const l of lineas(verde, (t) => t.waterway && t.waterway !== "riverbank")) waterways.push(l);
  onParcial && onParcial({ parks, water, squares, waterways });

  // 4) puntos de interés (candidatos a atractores)
  onStatus("Descargando puntos de interés (atractores)…", 0.85);
  const pois = await opcional("pois",
    `${cab}(node["amenity"~"^(marketplace|bus_station|university|townhall)$"]${B};` +
    `way["amenity"~"^(marketplace|bus_station|university)$"]${B};` +
    `node["railway"="station"]${B};node["shop"="mall"]${B};way["shop"="mall"]${B};` +
    `node["tourism"~"^(attraction|museum)$"]${B};way["tourism"="museum"]${B};);out center;`);

  const poisSalida = [];
  for (const el of pois) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    poisSalida.push({ lon, lat, tags: t });
  }
  for (const p of parks) poisSalida.push({ pos: centroide(p), tags: { leisure: "park", name: p.tags.name } });
  for (const p of squares) poisSalida.push({ pos: centroide(p), tags: { place: "square", name: p.tags.name } });
  for (const poi of poisSalida) if (poi.pos) { poi.lon = poi.pos[0]; poi.lat = poi.pos[1]; }

  onStatus(
    `OSM listo: ${roads.length} calles, ${pednet.length} tramos peatonales, ` +
    `${buildings.length} edificios, ${parks.length} parques.`, 1);

  return {
    buildings, roads, pednet, parks, water, waterways, squares,
    pois: poisSalida,
    fechaOSM: fechas.sort()[0] || new Date().toISOString().slice(0, 10),
  };
}
