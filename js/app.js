// Orquestador: ciudad → área → datos OSM → atractores → motor → lámina.
// Las etapas se habilitan en orden y el usuario aprueba cada una avanzando manualmente
// (la regla de compuertas del CUF, hecha interfaz).

import { crearProyector, bboxDesdeCentro, centroDeBbox, ladoDeBbox } from "./geo.js";
import { buscarCiudad } from "./geocode.js";
import { descargarCapas } from "./osm.js";
import { construirGrafo } from "./graph.js";
import { correrModelo } from "./model.js";
import { proponerAtractores } from "./attractors.js";
import { Renderizador } from "./render.js";
import { DEMO_GYE } from "./presets.js";

const $ = (id) => document.getElementById(id);
const estado = {
  ciudad: null, bbox: null, esDemo: false,
  capas: null, proyector: null, grafo: null,
  atractores: [], resultado: null,
};
const render = new Renderizador($("map"));

function log(msg, esError = false) {
  const div = document.createElement("div");
  if (esError) div.className = "err";
  div.textContent = "› " + msg;
  $("log").prepend(div);
}

function habilitar(...ids) {
  for (const id of ids) $(id).classList.remove("deshabilitado");
}

function progreso(idBarra, frac) {
  const barra = $(idBarra);
  barra.classList.toggle("oculto", frac == null);
  if (frac != null) barra.firstElementChild.style.width = Math.round(frac * 100) + "%";
}

// ---------- 1. ciudad ----------
async function buscar() {
  const q = $("busqueda").value.trim();
  if (!q) return;
  $("resultados").innerHTML = "<li>Buscando…</li>";
  try {
    const res = await buscarCiudad(q);
    $("resultados").innerHTML = "";
    if (!res.length) { $("resultados").innerHTML = "<li>Sin resultados</li>"; return; }
    for (const r of res) {
      const li = document.createElement("li");
      li.textContent = r.nombre;
      li.onclick = () => elegirCiudad({ nombre: r.nombre, lat: r.lat, lon: r.lon }, false);
      $("resultados").appendChild(li);
    }
  } catch (e) {
    log("Error en la búsqueda: " + e.message, true);
    $("resultados").innerHTML = "";
  }
}

function elegirCiudad(ciudad, esDemo) {
  estado.ciudad = ciudad;
  estado.esDemo = esDemo;
  $("resultados").innerHTML = "";
  const pill = $("ciudad-actual");
  pill.textContent = "📍 " + ciudad.nombre;
  pill.classList.remove("oculto");
  if (esDemo) {
    estado.bbox = DEMO_GYE.bbox;
    $("lado").value = ladoDeBbox(DEMO_GYE.bbox);
  }
  actualizarBbox();
  habilitar("step-area");
  log("Ciudad seleccionada: " + ciudad.nombre);
}

function actualizarBbox() {
  if (!estado.ciudad) return;
  const lado = parseInt($("lado").value, 10);
  $("lado-val").textContent = lado;
  if (!estado.esDemo) estado.bbox = bboxDesdeCentro(estado.ciudad.lat, estado.ciudad.lon, lado);
  const b = estado.bbox;
  $("bbox-info").textContent =
    `bbox: ${b.s.toFixed(4)}, ${b.w.toFixed(4)}, ${b.n.toFixed(4)}, ${b.e.toFixed(4)}`;
}

// ---------- 2. datos ----------
async function cargarDatos() {
  $("btn-datos").disabled = true;
  try {
    const capas = await descargarCapas(estado.bbox, (msg, frac) => {
      log(msg); if (frac != null) progreso("prog-datos", frac);
    });
    estado.capas = capas;
    estado.grafo = null;
    estado.resultado = null;
    const c = centroDeBbox(estado.bbox);
    estado.proyector = crearProyector(c.lat, c.lon);
    render.fijarCapas(capas, estado.proyector, estado.bbox);
    render.flujo = null;

    estado.atractores = estado.esDemo
      ? DEMO_GYE.atractores.map((a) => ({ ...a }))
      : proponerAtractores(capas.pois);
    if (estado.esDemo) {
      const p = DEMO_GYE.params;
      $("p-semilla").value = p.semilla; $("p-agentes").value = p.agentes;
      $("p-ruido").value = p.ruido; $("p-cohortes").value = p.cohortes;
      log("Atractores del caso validado GYE cargados (pesos de Miguel).");
    } else {
      log(`${estado.atractores.length} atractores propuestos desde OSM — revisa los pesos.`);
    }
    pintarTabla();
    render.fijarAtractores(estado.atractores, estado.proyector);
    render.dibujar();

    $("hint").classList.add("oculto");
    $("titulo-mapa").classList.remove("oculto");
    $("subtitulo-mapa").textContent = estado.ciudad.nombre;
    habilitar("step-atractores", "step-motor");
  } catch (e) {
    log("Error descargando OSM: " + e.message, true);
  } finally {
    $("btn-datos").disabled = false;
    progreso("prog-datos", null);
  }
}

// ---------- 3. atractores ----------
function pintarTabla() {
  const tbody = $("tabla-atractores").querySelector("tbody");
  tbody.innerHTML = "";
  estado.atractores.forEach((a, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><input type="checkbox" ${a.activo ? "checked" : ""}></td>` +
      `<td><input type="text" value="${a.nombre.replace(/"/g, "&quot;")}"></td>` +
      `<td class="tipo">${a.tipo}</td>` +
      `<td><input type="number" min="1" max="10" value="${a.peso}"></td>`;
    const [chk, nom, peso] = tr.querySelectorAll("input");
    chk.onchange = () => { a.activo = chk.checked; refrescarAtractores(); };
    nom.onchange = () => { a.nombre = nom.value; refrescarAtractores(); };
    peso.onchange = () => { a.peso = Math.max(1, Math.min(10, parseInt(peso.value, 10) || 1)); };
    tbody.appendChild(tr);
  });
}

function refrescarAtractores() {
  render.fijarAtractores(estado.atractores, estado.proyector);
  render.dibujar();
}

// ---------- 4. motor ----------
function leerParams() {
  return {
    semilla: parseInt($("p-semilla").value, 10) || 42,
    agentes: parseInt($("p-agentes").value, 10) || 2048,
    ruido: parseFloat($("p-ruido").value) || 0.25,
    cohortes: parseInt($("p-cohortes").value, 10) || 8,
  };
}

async function simular() {
  $("btn-simular").disabled = true;
  try {
    if (!estado.grafo) {
      log("Construyendo grafo caminable (calles + red peatonal)…");
      await new Promise((r) => setTimeout(r, 30));
      estado.grafo = construirGrafo([estado.capas.pednet, estado.capas.roads], estado.proyector);
      log(`Grafo: ${estado.grafo.n} nodos, ${estado.grafo.m} aristas.`);
    }
    const params = leerParams();
    const activos = estado.atractores
      .filter((a) => a.activo)
      .map((a) => {
        const [x, y] = estado.proyector.aXY(a.lon, a.lat);
        return { ...a, x, y };
      });
    log(`Corriendo proxy OD: ${params.agentes} agentes, semilla ${params.semilla}…`);
    const t0 = performance.now();
    const res = await correrModelo({
      grafo: estado.grafo, atractores: activos, params,
      onProgreso: (f, msg) => progreso("prog-sim", f),
    });
    estado.resultado = { ...res, params, fecha: new Date().toISOString().slice(0, 10) };
    const seg = ((performance.now() - t0) / 1000).toFixed(1);

    render.fijarFlujo(estado.grafo, res.conteo, res.stats.p95);
    render.fijarAtractores(estado.atractores, estado.proyector);
    render.dibujar();

    const s = res.stats;
    $("stats").textContent =
      `${s.aristasConFlujo} aristas con flujo · máx ${s.max} · p90 ${s.p90} · mediana ${s.mediana}` +
      (s.sinRuta ? ` · ${s.sinRuta} agentes sin ruta` : "") + ` · ${seg}s`;
    log(`Simulación lista en ${seg}s.`);
    actualizarMetabox();
    $("legend").classList.remove("oculto");
    habilitar("step-export");
  } catch (e) {
    log("Error en la simulación: " + e.message, true);
  } finally {
    $("btn-simular").disabled = false;
    progreso("prog-sim", null);
  }
}

function lineasMetadatos() {
  const p = estado.resultado.params, s = estado.resultado.stats;
  return [
    `SEMILLA: ${p.semilla}   AGENTES: ${p.agentes}   RUIDO: ${Math.round(p.ruido * 100)}%   COHORTES: ${p.cohortes}`,
    `RUTA: SHORTEST + NOISE (PROXY OD)   OSM: ${estado.capas.fechaOSM}`,
    `FLUJO — MAX: ${s.max}   P90: ${s.p90}   MEDIANA: ${s.mediana}`,
  ];
}

function actualizarMetabox() {
  $("metabox").textContent = lineasMetadatos().join("\n");
  $("metabox").classList.remove("oculto");
}

// ---------- 5. exportar ----------
function exportarPNG() {
  const nombre = "flujos_" + (estado.esDemo ? "GYE" : "sitio") + "_" + estado.resultado.fecha + ".png";
  render.exportarPNG(lineasMetadatos(), nombre);
  log("Lámina exportada: " + nombre);
}

function exportarJSON() {
  const r = estado.resultado;
  const objeto = {
    ciudad: estado.ciudad.nombre,
    bbox_SWNE: [estado.bbox.s, estado.bbox.w, estado.bbox.n, estado.bbox.e],
    crs: "proyección local equirectangular en metros (centro del área)",
    fecha_osm: estado.capas.fechaOSM,
    atribucion: "© OpenStreetMap contributors (ODbL)",
    atractores: estado.atractores.filter((a) => a.activo)
      .map(({ nombre, tipo, peso, lon, lat }) => ({ nombre, tipo, peso, lon, lat })),
    motor: { ruta: "A (proxy OD, shortest+noise)", ...r.params },
    resultados: r.stats,
    generado: new Date().toISOString(),
    herramienta: "CUF · Flujos Peatonales (webapp)",
  };
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "parametros_" + (estado.esDemo ? "GYE" : "sitio") + "_" + r.fecha + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  log("Hoja de parámetros exportada (reproducible).");
}

// ---------- eventos ----------
$("btn-buscar").onclick = buscar;
$("busqueda").addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });
$("btn-demo").onclick = () =>
  elegirCiudad({ nombre: DEMO_GYE.nombre, lat: -2.1935, lon: -79.884 }, true);
$("lado").oninput = actualizarBbox;
$("btn-datos").onclick = cargarDatos;
$("btn-proponer").onclick = () => {
  estado.esDemo = false;
  estado.atractores = proponerAtractores(estado.capas.pois);
  pintarTabla(); refrescarAtractores();
  log("Atractores propuestos de nuevo desde OSM.");
};
$("btn-simular").onclick = simular;
$("btn-png").onclick = exportarPNG;
$("btn-json").onclick = exportarJSON;
