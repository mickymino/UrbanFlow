// Descarga OSM vía Overpass API — traducción a JS del fetch_osm.py del CUF.
// Devuelve capas GeoJSON-like: buildings, roads, pednet, parks, water, waterways, squares, pois.

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const PED = new Set(["pedestrian", "footway", "path", "living_street"]);
const EXCL = new Set([
  "pedestrian", "footway", "path", "living_street",
  "steps", "corridor", "elevator", "construction", "proposed", "raceway",
]);

async function overpass(consulta, onStatus) {
  let ultimo = null;
  for (let intento = 0; intento < 4; intento++) {
    const ep = ENDPOINTS[intento % ENDPOINTS.length];
    try {
      const r = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(consulta),
        signal: AbortSignal.timeout(90000),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return (await r.json()).elements;
    } catch (e) {
      ultimo = e;
      onStatus && onStatus(`Overpass reintento ${intento + 1} (${e.message})…`);
      await new Promise((res) => setTimeout(res, 2500 * (intento + 1)));
    }
  }
  throw ultimo;
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

export async function descargarCapas(bbox, onStatus) {
  const B = `(${bbox.s},${bbox.w},${bbox.n},${bbox.e})`;
  const cab = "[out:json][timeout:90];";

  // capa opcional: si Overpass la niega tras los reintentos, se sigue sin ella
  async function opcional(nombre, consulta) {
    try {
      return await overpass(consulta, onStatus);
    } catch (e) {
      onStatus(`⚠ Capa "${nombre}" no disponible (${e.message}) — se continúa sin ella.`);
      return [];
    }
  }

  onStatus("Descargando red vial y peatonal…", 0.1);
  const vias = await overpass(`${cab}(way["highway"]${B};);out geom;`, onStatus);

  onStatus("Descargando edificios…", 0.35);
  const edif = await opcional("edificios",
    `${cab}(way["building"]${B};relation["building"]${B};);out geom;`);

  onStatus("Descargando parques, agua y plazas…", 0.65);
  // agua solo por ways: las relaciones de ríos grandes (p.ej. el Guayas) revientan el timeout
  const verde = await opcional("parques/agua/plazas",
    `${cab}(way["leisure"="park"]${B};relation["leisure"="park"]${B};` +
    `way["natural"="water"]${B};way["waterway"="riverbank"]${B};` +
    `way["waterway"~"^(river|stream|canal)$"]${B};` +
    `way["place"="square"]${B};way["highway"="pedestrian"]["area"="yes"]${B};);out geom;`);

  onStatus("Descargando puntos de interés (atractores)…", 0.85);
  const pois = await opcional("puntos de interés",
    `${cab}(node["amenity"~"^(marketplace|bus_station|university|townhall)$"]${B};` +
    `way["amenity"~"^(marketplace|bus_station|university)$"]${B};` +
    `node["railway"="station"]${B};node["shop"="mall"]${B};way["shop"="mall"]${B};` +
    `node["tourism"~"^(attraction|museum)$"]${B};way["tourism"="museum"]${B};);out center;`);

  const roads = lineas(vias, (t) => t.highway && !EXCL.has(t.highway));
  const pednet = lineas(vias, (t) => PED.has(t.highway));

  const parks = [], water = [], squares = [], waterways = [];
  for (const p of poligonos(verde)) {
    const t = p.tags;
    if (t.leisure === "park") parks.push(p);
    else if (t.natural === "water" || t.waterway === "riverbank") water.push(p);
    else squares.push(p);
  }
  for (const l of lineas(verde, (t) => t.waterway && t.waterway !== "riverbank")) waterways.push(l);

  const poisSalida = [];
  for (const el of pois) {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null) continue;
    poisSalida.push({ lon, lat, tags: t });
  }
  // parques y plazas grandes también son candidatos a atractor (por centroide)
  for (const p of parks) poisSalida.push({ pos: centroide(p), tags: { leisure: "park", name: p.tags.name } });
  for (const p of squares) poisSalida.push({ pos: centroide(p), tags: { place: "square", name: p.tags.name } });
  for (const poi of poisSalida) if (poi.pos) { poi.lon = poi.pos[0]; poi.lat = poi.pos[1]; }

  onStatus(
    `OSM listo: ${roads.length} calles, ${pednet.length} tramos peatonales, ` +
    `${poligonos(edif).length} edificios, ${parks.length} parques.`, 1);

  return {
    buildings: poligonos(edif),
    roads, pednet, parks, water, waterways, squares,
    pois: poisSalida,
    fechaOSM: new Date().toISOString().slice(0, 10),
  };
}
