// UrbanFlow v0.2 — orquestador.
// Flujo: 1 Proyecto (objetivo+ciudad) → 2 Datos (área+OSM) → 3 Escenario (atractores con
// rol, barreras por clic) → 4 Simulación → 5 Resultados (KPIs, comparación de escenarios,
// exportación). Modelo proxy OD — nivel EXPLORATORIO, siempre visible.

import { crearProyector, bboxDesdeCentro, centroDeBbox, ladoDeBbox } from "./geo.js";
import { buscarCiudad } from "./geocode.js";
import { descargarCapas } from "./osm.js";
import { construirGrafo, aristaMasCercana } from "./graph.js";
import { correrModelo, accesibilidad } from "./model.js";
import { proponerAtractores } from "./attractors.js";
import { Renderizador } from "./render.js";
import { DEMO_GYE } from "./presets.js";

const $ = (id) => document.getElementById(id);
const CLAVE_PROYECTO = "urbanflow-proyecto-v2";

const estado = {
  ciudad: null, esDemo: false, bbox: null, objetivo: "flujos",
  capas: null, proyector: null, grafo: null,
  escenarios: [], activo: 0,
  modoClic: null,           // null | 'atractor'  (barreras: pestaña Barreras activa)
  tab: "atractores",
  vistaDiff: null,          // {a, b} índices comparados, o null = flujo del activo
};
const render = new Renderizador($("map"));
render.onMovimiento = () => actualizarBbox();
render.onClickMapa = (x, y) => clicEnMapa(x, y);

// ---------- utilidades UI ----------
function log(msg, esError = false) {
  const div = document.createElement("div");
  if (esError) div.className = "err";
  div.textContent = "› " + msg;
  $("log").prepend(div);
}
function progreso(idBarra, frac) {
  const barra = $(idBarra);
  barra.classList.toggle("oculto", frac == null);
  if (frac != null) barra.firstElementChild.style.width = Math.round(frac * 100) + "%";
}
function marcarPaso(n, opts = {}) {
  const p = $("paso-" + n);
  p.classList.remove("bloqueado");
  p.classList.toggle("hecho", !!opts.hecho);
  p.querySelector(".check").classList.toggle("oculto", !opts.hecho);
  document.querySelectorAll(".paso").forEach((el) => el.classList.remove("activo"));
  p.classList.add("activo");
}
function escenarioActivo() { return estado.escenarios[estado.activo]; }

// ---------- paso 1: proyecto y ciudad ----------
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
  estado.capas = null; estado.grafo = null;
  estado.escenarios = []; estado.activo = 0; estado.vistaDiff = null;
  $("resultados").innerHTML = "";
  const pill = $("ciudad-actual");
  pill.textContent = "📍 " + ciudad.nombre;
  pill.classList.remove("oculto");
  $("hint").classList.add("oculto");
  $("titulo-mapa").classList.add("oculto");
  $("metabox").classList.add("oculto");
  $("legend").classList.add("oculto");
  $("panel-escenario").classList.add("oculto");
  $("barra-resultados").classList.add("oculto");
  $("chip-proyecto").classList.remove("oculto");
  $("chip-proyecto-nombre").textContent = $("proyecto-nombre").value || "Mi estudio urbano";

  if (esDemo) {
    estado.bbox = DEMO_GYE.bbox;
    const lado = ladoDeBbox(DEMO_GYE.bbox);
    $("lado").value = lado;
    const c = centroDeBbox(DEMO_GYE.bbox);
    render.modoMapa(c.lat, c.lon, lado, { lat: c.lat, lon: c.lon });
  } else {
    render.modoMapa(ciudad.lat, ciudad.lon, parseInt($("lado").value, 10));
  }
  actualizarBbox();
  marcarPaso(1, { hecho: true });
  marcarPaso(2);
  log("Ciudad: " + ciudad.nombre + " — mueve el mapa para centrar tu área y descarga los datos.");
}

function actualizarBbox() {
  if (!estado.ciudad) return;
  const lado = parseInt($("lado").value, 10);
  $("lado-val").textContent = lado;
  render.fijarLado(lado);
  if (!estado.esDemo && render.modo === "mapa") {
    const c = render.centroMapa();
    estado.bbox = bboxDesdeCentro(c.lat, c.lon, lado);
  }
  const b = estado.bbox;
  if (b) $("bbox-info").textContent =
    `bbox: ${b.s.toFixed(4)}, ${b.w.toFixed(4)}, ${b.n.toFixed(4)}, ${b.e.toFixed(4)}`;
}

// ---------- paso 2: datos ----------
async function cargarDatos() {
  $("btn-datos").disabled = true;
  actualizarBbox();
  try {
    const c = centroDeBbox(estado.bbox);
    estado.proyector = crearProyector(c.lat, c.lon);
    estado.grafo = null;
    estado.vistaDiff = null;
    render.flujo = null; render.atractores = []; render.fijarBarreras([]);

    const acumulado = {};
    const capas = await descargarCapas(
      estado.bbox,
      (msg, frac) => { log(msg); if (frac != null) progreso("prog-datos", frac); },
      (parcial) => {
        Object.assign(acumulado, parcial);
        render.fijarCapas(acumulado, estado.proyector, estado.bbox);
      }
    );
    estado.capas = capas;

    const atractores = estado.esDemo
      ? DEMO_GYE.atractores.map((a) => ({ ...a }))
      : proponerAtractores(capas.pois);
    if (estado.esDemo) {
      const p = DEMO_GYE.params;
      $("p-semilla").value = p.semilla; $("p-agentes").value = p.agentes;
      $("p-ruido").value = p.ruido; $("p-cohortes").value = p.cohortes;
    }
    if (!estado.escenarios.length) {
      estado.escenarios = [{ id: 1, nombre: "Escenario actual 01", atractores, barreras: [], resultado: null }];
      estado.activo = 0;
    }

    $("resumen-datos").classList.remove("oculto");
    $("resumen-datos").innerHTML =
      `<b>${capas.roads.length + capas.pednet.length}</b> segmentos de red · ` +
      `<b>${capas.buildings.length}</b> edificios · <b>${capas.parks.length}</b> parques · ` +
      `OSM ${capas.fechaOSM}`;
    $("leg-meta").textContent =
      `Fuente: OpenStreetMap (${capas.fechaOSM}) · Modelo proxy OD — exploratorio`;

    $("titulo-mapa").classList.remove("oculto");
    $("subtitulo-mapa").textContent = estado.ciudad.nombre;
    $("panel-escenario").classList.remove("oculto");
    $("legend").classList.remove("oculto");
    marcarPaso(2, { hecho: true });
    marcarPaso(3);
    aplicarObjetivo();
    pintarEscenarios();
    pintarTabla();
    pintarBarreras();
    refrescarAtractores();
    log(`Datos listos. Revisa atractores y roles${estado.esDemo ? " (pesos validados de GYE)" : ""}, luego corre la simulación.`);
  } catch (e) {
    log("Error descargando OSM: " + e.message, true);
  } finally {
    $("btn-datos").disabled = false;
    progreso("prog-datos", null);
  }
}

function aplicarObjetivo() {
  estado.objetivo = $("objetivo").value;
  const guias = {
    flujos: "Configura atractores y roles; el resultado clave es el mapa de intensidad.",
    accesibilidad: "Marca tus orígenes (rol origen) y mira el KPI de accesibilidad 10 min.",
    congestion: "Corre la simulación y revisa el tramo más cargado y el flujo máximo.",
    propuesta: "Corre el escenario actual, luego pulsa ⧉ Proponer, añade barreras (clic en calles) y compara.",
  };
  $("estado-escenario").textContent = guias[estado.objetivo] || guias.flujos;
}

// ---------- paso 3: escenarios ----------
function pintarEscenarios() {
  const sel = $("sel-escenario");
  sel.innerHTML = "";
  estado.escenarios.forEach((esc, i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = esc.nombre + (esc.resultado ? " ✓" : "");
    sel.appendChild(o);
  });
  sel.value = estado.activo;
  // selectores de comparación
  const conRes = estado.escenarios.map((e, i) => ({ e, i })).filter((x) => x.e.resultado);
  for (const id of ["comp-a", "comp-b"]) {
    const s = $(id);
    s.innerHTML = "";
    for (const { e, i } of conRes) {
      const o = document.createElement("option");
      o.value = i; o.textContent = e.nombre;
      s.appendChild(o);
    }
  }
  if (conRes.length >= 2) { $("comp-a").value = conRes[0].i; $("comp-b").value = conRes[conRes.length - 1].i; }
  $("btn-comparar").disabled = conRes.length < 2;
}

function cambiarEscenario(i) {
  estado.activo = i;
  estado.vistaDiff = null;
  $("btn-ver-flujo").classList.add("oculto");
  pintarTabla();
  pintarBarreras();
  refrescarAtractores();
  const esc = escenarioActivo();
  if (esc.resultado) {
    render.fijarFlujo(estado.grafo, esc.resultado.conteo, esc.resultado.stats.p95);
    pintarKPIs(esc);
    actualizarMetabox();
  } else {
    render.flujo = null;
    $("metabox").classList.add("oculto");
  }
  render.dibujar();
  log("Editando: " + esc.nombre);
}

function duplicarEscenario() {
  const base = escenarioActivo();
  const n = estado.escenarios.length + 1;
  estado.escenarios.push({
    id: n,
    nombre: `Escenario propuesto 0${n}`,
    atractores: base.atractores.map((a) => ({ ...a })),
    barreras: base.barreras.map((b) => ({ ...b })),
    resultado: null,
  });
  pintarEscenarios();
  $("sel-escenario").value = estado.escenarios.length - 1;
  cambiarEscenario(estado.escenarios.length - 1);
  cambiarTab("barreras");
  log("Escenario propuesto creado: haz clic en calles del mapa para bloquear tramos, o ajusta pesos.");
}

function cambiarTab(tab) {
  estado.tab = tab;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("activo", t.dataset.tab === tab));
  $("tab-atractores").classList.toggle("oculto", tab !== "atractores");
  $("tab-barreras").classList.toggle("oculto", tab !== "barreras");
  estado.modoClic = null;
  $("btn-agregar-atractor").classList.remove("activo-modo");
  $("map").classList.toggle("modo-clic", tab === "barreras");
}

function pintarTabla() {
  const tbody = $("tabla-atractores").querySelector("tbody");
  tbody.innerHTML = "";
  escenarioActivo().atractores.forEach((a) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><input type="checkbox" ${a.activo ? "checked" : ""} title="Incluir en la simulación"></td>` +
      `<td><input type="text" value="${a.nombre.replace(/"/g, "&quot;")}"></td>` +
      `<td><select><option value="ambos">O+D</option><option value="origen">Origen</option><option value="destino">Destino</option></select></td>` +
      `<td><input type="number" min="1" max="10" value="${a.peso}"></td>`;
    const [chk, nom, peso] = tr.querySelectorAll("input");
    const rol = tr.querySelector("select");
    rol.value = a.rol || "ambos";
    chk.onchange = () => { a.activo = chk.checked; refrescarAtractores(); };
    nom.onchange = () => { a.nombre = nom.value; refrescarAtractores(); };
    rol.onchange = () => { a.rol = rol.value; refrescarAtractores(); };
    peso.onchange = () => { a.peso = Math.max(1, Math.min(10, parseInt(peso.value, 10) || 1)); };
    tbody.appendChild(tr);
  });
}

function refrescarAtractores() {
  if (!estado.proyector) return;
  render.fijarAtractores(escenarioActivo().atractores, estado.proyector);
  render.dibujar();
}

function pintarBarreras() {
  const esc = escenarioActivo();
  const ul = $("lista-barreras");
  ul.innerHTML = "";
  if (!esc.barreras.length) {
    ul.innerHTML = '<li class="dim">Sin barreras en este escenario.</li>';
  } else {
    esc.barreras.forEach((b, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>⛔ <b>${b.nombre || "tramo sin nombre"}</b></span>`;
      const btn = document.createElement("button");
      btn.textContent = "✕"; btn.title = "Quitar barrera";
      btn.onclick = () => { esc.barreras.splice(i, 1); pintarBarreras(); };
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }
  if (estado.grafo) {
    render.fijarBarreras(esc.barreras.map((b) => {
      const { a: na, b: nb } = estado.grafo.aristas[b.e];
      const [x1, y1] = estado.grafo.nodos[na], [x2, y2] = estado.grafo.nodos[nb];
      return { x1, y1, x2, y2 };
    }));
    render.dibujar();
  }
}

function asegurarGrafo() {
  if (!estado.grafo) {
    estado.grafo = construirGrafo([estado.capas.pednet, estado.capas.roads], estado.proyector);
    log(`Grafo caminable: ${estado.grafo.n} nodos, ${estado.grafo.m} aristas.`);
  }
  return estado.grafo;
}

function clicEnMapa(x, y) {
  if (!estado.capas) return;
  if (estado.modoClic === "atractor") {
    const [lon, lat] = estado.proyector.aLonLat(x, y);
    escenarioActivo().atractores.push({
      nombre: "Nuevo punto", tipo: "manual", rol: "ambos", peso: 5, lon, lat, activo: true,
    });
    estado.modoClic = null;
    $("btn-agregar-atractor").classList.remove("activo-modo");
    $("map").classList.remove("modo-clic");
    pintarTabla(); refrescarAtractores();
    log("Punto añadido — edita su nombre, rol y atracción en la tabla.");
    return;
  }
  if (estado.tab === "barreras") {
    const grafo = asegurarGrafo();
    const { e, dist } = aristaMasCercana(grafo, x, y);
    if (e < 0 || dist > 20) return;
    const esc = escenarioActivo();
    const ya = esc.barreras.findIndex((b) => b.e === e);
    if (ya >= 0) { esc.barreras.splice(ya, 1); log("Barrera quitada."); }
    else {
      esc.barreras.push({ e, nombre: grafo.aristas[e].nombre });
      log(`Tramo bloqueado: ${grafo.aristas[e].nombre || "(sin nombre)"}.`);
    }
    pintarBarreras();
  }
}

// ---------- paso 4: simulación ----------
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
  const esc = escenarioActivo();
  try {
    const grafo = asegurarGrafo();
    const params = leerParams();
    const barreras = new Set(esc.barreras.map((b) => b.e));
    const activos = esc.atractores
      .filter((a) => a.activo)
      .map((a) => {
        const [x, y] = estado.proyector.aXY(a.lon, a.lat);
        return { ...a, x, y };
      });
    log(`Simulando "${esc.nombre}": ${params.agentes} peatones, semilla ${params.semilla}…`);
    const t0 = performance.now();
    const res = await correrModelo({
      grafo, atractores: activos, params, barreras,
      onProgreso: (f) => progreso("prog-sim", f),
    });
    // accesibilidad 10 min desde los orígenes
    const nodosOrigen = res.amarres.filter((a) => a.rol !== "destino").map((a) => a.nodo);
    const acc = accesibilidad(grafo, nodosOrigen, barreras, 10);
    esc.resultado = { conteo: res.conteo, stats: res.stats, acc, params,
      fecha: new Date().toISOString().slice(0, 10) };
    const seg = ((performance.now() - t0) / 1000).toFixed(1);

    estado.vistaDiff = null;
    $("btn-ver-flujo").classList.add("oculto");
    render.fijarFlujo(grafo, res.conteo, res.stats.p95);
    refrescarAtractores();
    render.dibujar();

    const s = res.stats;
    $("stats").textContent =
      `${s.aristasConFlujo} tramos con flujo · ${s.sinRuta ? s.sinRuta + " peatones sin ruta · " : ""}${seg}s`;
    $("estado-simulacion").textContent =
      `Última corrida: ${esc.nombre} (${seg}s, semilla ${params.semilla}).`;
    log(`Simulación de "${esc.nombre}" lista en ${seg}s.`);
    marcarPaso(3, { hecho: true });
    marcarPaso(4, { hecho: true });
    marcarPaso(5);
    pintarKPIs(esc);
    pintarEscenarios();
    actualizarMetabox();
    $("barra-resultados").classList.remove("oculto");
  } catch (e) {
    log("Error en la simulación: " + e.message, true);
  } finally {
    $("btn-simular").disabled = false;
    progreso("prog-sim", null);
  }
}

// ---------- paso 5: resultados ----------
function pintarKPIs(esc) {
  const s = esc.resultado.stats;
  $("kpi-max").textContent = s.max;
  $("kpi-prom").textContent = s.flujoProm.toFixed(1);
  $("kpi-tiempo").textContent = s.tiempoMedioMin.toFixed(1);
  $("kpi-dist").textContent = Math.round(s.distMediaM);
  $("kpi-tramo").textContent = s.tramoTop ? s.tramoTop.nombre : "—";
  $("kpi-tramo-flujo").textContent = s.tramoTop ? s.tramoTop.flujo + " pasadas" : "";
  $("kpi-acc").textContent = esc.resultado.acc.toFixed(0) + "%";
}

function compararEscenarios() {
  const ia = parseInt($("comp-a").value, 10), ib = parseInt($("comp-b").value, 10);
  if (ia === ib) { log("Elige dos escenarios distintos para comparar.", true); return; }
  const A = estado.escenarios[ia], B = estado.escenarios[ib];
  estado.vistaDiff = { a: ia, b: ib };
  render.fijarDiff(estado.grafo, A.resultado.conteo, B.resultado.conteo);
  render.dibujar();
  $("btn-ver-flujo").classList.remove("oculto");
  const d = (va, vb, unidad, invertido = false) => {
    const delta = vb - va;
    const pct = va ? Math.round((delta / va) * 100) : 0;
    const clase = delta === 0 ? "neutro" : (delta > 0) !== invertido ? "sube" : "baja";
    const signo = delta > 0 ? "+" : "";
    return `<span class="delta ${clase}">${unidad}<b>${signo}${pct}%</b></span>`;
  };
  const sa = A.resultado.stats, sb = B.resultado.stats;
  $("comp-deltas").innerHTML =
    d(sa.flujoProm, sb.flujoProm, "flujo prom. ") +
    d(sa.tiempoMedioMin, sb.tiempoMedioMin, "tiempo ") +
    d(A.resultado.acc, B.resultado.acc, "accesibilidad ", true) +
    `<span class="delta neutro">cálido = gana flujo · azul = pierde</span>`;
  log(`Comparando: ${A.nombre} → ${B.nombre} (misma semilla = diferencia atribuible a tu propuesta).`);
}

function verFlujoActivo() {
  estado.vistaDiff = null;
  $("btn-ver-flujo").classList.add("oculto");
  const esc = escenarioActivo();
  if (esc.resultado) render.fijarFlujo(estado.grafo, esc.resultado.conteo, esc.resultado.stats.p95);
  render.dibujar();
}

function lineasMetadatos() {
  const esc = escenarioActivo();
  const p = esc.resultado.params, s = esc.resultado.stats;
  return [
    `${esc.nombre.toUpperCase()} — ${(estado.ciudad?.nombre || "").split(",")[0].toUpperCase()}`,
    `SEMILLA: ${p.semilla}  PEATONES: ${p.agentes}  VARIABILIDAD: ${Math.round(p.ruido * 100)}%  GRUPOS: ${p.cohortes}`,
    `MODELO: PROXY OD (EXPLORATORIO)  OSM: ${estado.capas.fechaOSM}  BARRERAS: ${esc.barreras.length}`,
    `FLUJO MAX: ${s.max}  TIEMPO MEDIO: ${s.tiempoMedioMin.toFixed(1)} MIN  ACCESIBILIDAD 10': ${esc.resultado.acc.toFixed(0)}%`,
  ];
}

function actualizarMetabox() {
  $("metabox").textContent = lineasMetadatos().join("\n");
  $("metabox").classList.remove("oculto");
}

// ---------- exportación ----------
function descargarArchivo(contenido, nombre, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportarPNG() {
  const esc = escenarioActivo();
  if (!esc.resultado) { log("Corre la simulación antes de exportar.", true); return; }
  render.exportarPNG(lineasMetadatos(), `urbanflow_${esc.id}_${esc.resultado.fecha}.png`);
  log("Lámina exportada.");
}

function exportarGeoJSON() {
  const esc = escenarioActivo();
  if (!esc.resultado) { log("Corre la simulación antes de exportar.", true); return; }
  const feats = [];
  for (let e = 0; e < estado.grafo.m; e++) {
    if (esc.resultado.conteo[e] <= 0) continue;
    const { a, b, nombre } = estado.grafo.aristas[e];
    const c1 = estado.proyector.aLonLat(...estado.grafo.nodos[a]);
    const c2 = estado.proyector.aLonLat(...estado.grafo.nodos[b]);
    feats.push({
      type: "Feature",
      properties: { flujo: esc.resultado.conteo[e], nombre },
      geometry: { type: "LineString", coordinates: [c1, c2] },
    });
  }
  descargarArchivo(JSON.stringify({ type: "FeatureCollection",
    name: "FlowDensity", features: feats }),
    `urbanflow_flowdensity_${esc.id}.geojson`, "application/geo+json");
  log(`GeoJSON exportado: ${feats.length} tramos con flujo (WGS84, listo para QGIS).`);
}

function exportarCSV() {
  const filas = [["escenario", "semilla", "peatones", "variabilidad", "barreras",
    "flujo_max", "flujo_prom", "tiempo_medio_min", "distancia_media_m",
    "tramo_mas_cargado", "accesibilidad_10min_pct", "peatones_sin_ruta"]];
  for (const esc of estado.escenarios) {
    if (!esc.resultado) continue;
    const s = esc.resultado.stats, p = esc.resultado.params;
    filas.push([esc.nombre, p.semilla, p.agentes, p.ruido, esc.barreras.length,
      s.max, s.flujoProm.toFixed(2), s.tiempoMedioMin.toFixed(2), Math.round(s.distMediaM),
      (s.tramoTop?.nombre || "").replace(/[,;]/g, " "), esc.resultado.acc.toFixed(1), s.sinRuta]);
  }
  descargarArchivo(filas.map((f) => f.join(";")).join("\n"),
    "urbanflow_indicadores.csv", "text/csv");
  log("CSV de indicadores exportado (" + (filas.length - 1) + " escenarios).");
}

function exportarJSON() {
  const esc = escenarioActivo();
  const objeto = {
    proyecto: $("proyecto-nombre").value,
    objetivo: estado.objetivo,
    ciudad: estado.ciudad.nombre,
    bbox_SWNE: [estado.bbox.s, estado.bbox.w, estado.bbox.n, estado.bbox.e],
    fecha_osm: estado.capas?.fechaOSM,
    atribucion: "© OpenStreetMap contributors (ODbL)",
    nivel_modelo: "exploratorio (proxy OD, sin calibrar con conteos)",
    escenario: esc.nombre,
    atractores: esc.atractores.filter((a) => a.activo)
      .map(({ nombre, tipo, rol, peso, lon, lat }) => ({ nombre, tipo, rol, peso, lon, lat })),
    barreras: esc.barreras.map((b) => b.nombre || "tramo sin nombre"),
    motor: { ruta: "A (proxy OD, shortest+noise)", ...leerParams() },
    resultados: esc.resultado ? { ...esc.resultado.stats, accesibilidad_10min: esc.resultado.acc } : null,
    generado: new Date().toISOString(),
    herramienta: "UrbanFlow v0.2",
  };
  descargarArchivo(JSON.stringify(objeto, null, 2),
    `urbanflow_parametros_${esc.id}.json`, "application/json");
  log("Hoja de parámetros exportada (reproducible).");
}

// ---------- guardar / reabrir proyecto ----------
function guardarProyecto() {
  if (!estado.ciudad) { log("Nada que guardar todavía: elige una ciudad primero.", true); return; }
  const datos = {
    nombre: $("proyecto-nombre").value,
    objetivo: $("objetivo").value,
    ciudad: estado.ciudad, esDemo: estado.esDemo, bbox: estado.bbox,
    lado: $("lado").value,
    params: leerParams(),
    escenarios: estado.escenarios.map((e) => ({
      id: e.id, nombre: e.nombre, atractores: e.atractores, barreras: e.barreras,
    })),
    guardado: new Date().toISOString(),
  };
  localStorage.setItem(CLAVE_PROYECTO, JSON.stringify(datos));
  log(`Proyecto "${datos.nombre}" guardado en este navegador.`);
}

async function reabrirProyecto() {
  const datos = JSON.parse(localStorage.getItem(CLAVE_PROYECTO) || "null");
  if (!datos) return;
  $("proyecto-nombre").value = datos.nombre;
  $("objetivo").value = datos.objetivo;
  $("lado").value = datos.lado;
  const p = datos.params;
  $("p-semilla").value = p.semilla; $("p-agentes").value = p.agentes;
  $("p-ruido").value = p.ruido; $("p-cohortes").value = p.cohortes;
  elegirCiudad(datos.ciudad, datos.esDemo);
  estado.bbox = datos.bbox;
  estado.escenarios = datos.escenarios.map((e) => ({ ...e, resultado: null }));
  estado.activo = 0;
  log("Proyecto reabierto — descargando datos (de la caché si están frescos)…");
  await cargarDatos();
}

// ---------- eventos ----------
$("btn-buscar").onclick = buscar;
$("busqueda").addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });
$("btn-demo").onclick = () =>
  elegirCiudad({ nombre: DEMO_GYE.nombre, lat: -2.1935, lon: -79.884 }, true);
$("lado").oninput = actualizarBbox;
$("objetivo").onchange = aplicarObjetivo;
$("btn-datos").onclick = cargarDatos;
$("sel-escenario").onchange = (e) => cambiarEscenario(parseInt(e.target.value, 10));
$("btn-duplicar").onclick = duplicarEscenario;
document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => cambiarTab(t.dataset.tab)));
$("btn-agregar-atractor").onclick = () => {
  estado.modoClic = estado.modoClic === "atractor" ? null : "atractor";
  $("btn-agregar-atractor").classList.toggle("activo-modo", estado.modoClic === "atractor");
  $("map").classList.toggle("modo-clic", estado.modoClic === "atractor");
  if (estado.modoClic) log("Haz clic en el mapa donde quieras el nuevo punto.");
};
$("btn-proponer").onclick = () => {
  escenarioActivo().atractores = proponerAtractores(estado.capas.pois);
  pintarTabla(); refrescarAtractores();
  log("Atractores propuestos de nuevo desde OSM — revisa roles y pesos.");
};
$("btn-simular").onclick = simular;
$("btn-comparar").onclick = compararEscenarios;
$("btn-ver-flujo").onclick = verFlujoActivo;
$("btn-png").onclick = exportarPNG;
$("btn-geojson").onclick = exportarGeoJSON;
$("btn-csv").onclick = exportarCSV;
$("btn-json").onclick = exportarJSON;
$("btn-guardar").onclick = guardarProyecto;
$("btn-reabrir").onclick = reabrirProyecto;
$("btn-ayuda").onclick = () => $("dlg-ayuda").showModal();
$("btn-zoom-mas").onclick = () => render.zoom(1);
$("btn-zoom-menos").onclick = () => render.zoom(-1);
$("btn-encuadrar").onclick = () => { if (render.modo === "lamina") render.encuadrar(); };
$("proyecto-nombre").onchange = () =>
  ($("chip-proyecto-nombre").textContent = $("proyecto-nombre").value);

if (localStorage.getItem(CLAVE_PROYECTO)) $("btn-reabrir").classList.remove("oculto");
