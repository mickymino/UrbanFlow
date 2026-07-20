// UrbanFlow v0.4 — orquestador (interfaz MapLibre sobre el pipeline OSM real).
// Flujo: 1 Proyecto → Ubicación (Nominatim) → Área de estudio → 2 Datos (Overpass
// con caché + grafo caminable) → 3 Escenario (atractores con rol/peso/radio,
// barreras, correcciones de red) → 4 Simulación (proxy OD) → 5 Resultados
// (KPIs honestos, comparación de 2 escenarios, diferencia en el mapa).
// Modelo de nivel EXPLORATORIO — siempre visible.

import { crearProyector, bboxDesdeCentro, centroDeBbox } from "./geo.js";
import { buscarCiudad } from "./geocode.js";
import { descargarCapas } from "./osm.js";
import { construirGrafo, aristaMasCercana } from "./graph.js";
import { correrModelo, accesibilidad, ultimaDistMin, VEL_PEATON } from "./model.js";
import { proponerAtractores } from "./attractors.js";
import { DEMO_GYE } from "./presets.js";
import { MapaUF, rampaCss, ROL_COLOR } from "./mapa.js";
import { iniciarPanel, calcularPanel, pintarPanel, numES } from "./panel.js";
import { iniciarLamina, lamAbrir } from "./lamina.js";

const $ = (id) => document.getElementById(id);
const CLAVE_PROYECTO = "urbanflow-proyecto-v3";

/* ==================== catálogos del atractor ==================== */
const TIPOS = [
  ["parque_pequeno", "Parque pequeño", 4],
  ["plaza", "Plaza", 6],
  ["parque_urbano", "Parque urbano", 7],
  ["espacio_publico", "Espacio público", 7],
  ["hito", "Hito / museo", 6],
  ["institucion", "Institución", 6],
  ["universidad", "Universidad", 8],
  ["mercado", "Mercado", 9],
  ["centro_comercial", "Centro comercial", 9],
  ["terminal", "Terminal / estación", 10],
  ["malecon", "Malecón", 10],
  ["edificio", "Edificio", 5],
  ["otro", "Otro", 5],
];
const PESO_TIPO = Object.fromEntries(TIPOS.map((t) => [t[0], t[2]]));
const ETIQ_TIPO = Object.fromEntries(TIPOS.map((t) => [t[0], t[1]]));
const JERARQUIAS = [
  ["barrial", "Barrial", 400],
  ["sectorial", "Sectorial", 800],
  ["distrital", "Distrital", 1500],
  ["cantonal", "Cantonal", 3000],
  ["metropolitano", "Metropolitano", 6000],
];
const RADIO_JER = Object.fromEntries(JERARQUIAS.map((j) => [j[0], j[2]]));
const ETIQ_JER = Object.fromEntries(JERARQUIAS.map((j) => [j[0], j[1]]));
const ROL_ETIQ = { origen: "Origen", destino: "Destino", ambos: "Origen y destino" };
const descPeso = (p) => (p <= 2 ? "Muy baja atracción" : p <= 4 ? "Baja" : p <= 6 ? "Media" : p <= 8 ? "Alta" : "Muy alta");

function normalizarAtr(a) {
  let tipo = a.tipo;
  if (tipo === "parque") tipo = "parque_urbano";
  if (tipo === "espacio público" || tipo === "espacio_publico") tipo = "espacio_publico";
  if (tipo === "estacion") tipo = "terminal";
  if (tipo === "comercio") tipo = "centro_comercial";
  if (!PESO_TIPO[tipo]) tipo = "otro";
  const jer = a.jerarquia || (a.peso >= 9 ? "distrital" : "sectorial");
  return { jerarquia: jer, radio: a.radio || RADIO_JER[jer], horario: a.horario || "", ...a, tipo };
}

/* ==================== estado ==================== */
const estado = {
  ciudad: null, esDemo: false, bbox: null, lado: 2000,
  capas: null, proyector: null, grafo: null, fechaOSM: null,
  redQuitada: new Set(),           // índices de arista eliminados del proyecto
  escenarios: [], activo: 0,
  modoClic: null, tab: "atractores", vistaDiff: false, selAtr: null,
  estilo: "lienzo", claro: false,
};
const escActivo = () => estado.escenarios[estado.activo];
function nuevoEscenario(nombre, base, atractores = []) {
  return {
    nombre,
    atractores: base ? base.atractores.map((a) => ({ ...a })) : atractores,
    barreras: base ? new Set(base.barreras) : new Set(),
    resultado: null,
  };
}
// clave estable de una arista (por extremos redondeados): sobrevive a re-descargas
function claveArista(e) {
  const g = estado.grafo, [ax, ay] = g.nodos[g.aristas[e].a], [bx, by] = g.nodos[g.aristas[e].b];
  const k1 = Math.round(ax) + "," + Math.round(ay), k2 = Math.round(bx) + "," + Math.round(by);
  return k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1;
}

/* ==================== utilidades ==================== */
function log(msg, err = false) {
  const d = document.createElement("div");
  if (err) d.className = "err";
  d.textContent = "› " + msg;
  $("log-zona").prepend(d);
}
function marcarPaso(n, hecho) {
  const p = document.querySelector(`.paso[data-paso="${n}"]`);
  p.classList.remove("bloqueado"); p.classList.toggle("hecho", hecho);
  p.querySelector(".num").textContent = hecho ? "✓" : n;
}
function bloquearPaso(n) {
  const p = document.querySelector(`.paso[data-paso="${n}"]`);
  p.classList.add("bloqueado"); p.classList.remove("hecho");
  p.querySelector(".num").textContent = n;
}
const fc = (features) => ({ type: "FeatureCollection", features });
const lineaLL = (a, b) => {
  const P = estado.proyector;
  return { type: "LineString", coordinates: [P.aLonLat(a[0], a[1]), P.aLonLat(b[0], b[1])] };
};
function circleLL(cx, cy, r, n = 48) {
  const P = estado.proyector, c = [];
  for (let i = 0; i <= n; i++) { const a = (2 * Math.PI * i) / n; c.push(P.aLonLat(cx + r * Math.cos(a), cy + r * Math.sin(a))); }
  return { type: "Polygon", coordinates: [c] };
}

/* ==================== mapa ==================== */
const mapa = new MapaUF({
  contenedor: "mapa", idMinimapa: "minimapa",
  idEscalaRegla: "escala-regla", idEscalaRotulos: "escala-rotulos", idNorte: "norte",
  onClickSuelo: (lon, lat) => clicEnMapa(lon, lat),
  onHover: (lon, lat, punto) => tooltipMapa(lon, lat, punto),
  onListo: () => refrescarTodo(),
});

/* ==================== GeoJSON de la simulación ==================== */
function gjRed() {
  const g = estado.grafo; if (!g) return fc([]);
  const f = [];
  for (let e = 0; e < g.m; e++) {
    if (estado.redQuitada.has(e)) continue;
    f.push({ type: "Feature", properties: { nombre: g.aristas[e].nombre },
      geometry: lineaLL(g.nodos[g.aristas[e].a], g.nodos[g.aristas[e].b]) });
  }
  return fc(f);
}
function gjQuitada() {
  const g = estado.grafo; if (!g) return fc([]);
  const f = [];
  for (const e of estado.redQuitada)
    f.push({ type: "Feature", properties: {}, geometry: lineaLL(g.nodos[g.aristas[e].a], g.nodos[g.aristas[e].b]) });
  return fc(f);
}
function gjFlujo() {
  const g = estado.grafo; if (!g) return fc([]);
  const esc = escActivo(), res = esc && esc.resultado, f = [];
  if (res && !estado.vistaDiff) {
    const p95 = res.stats.p95 || 1;
    for (let e = 0; e < g.m; e++) {
      const c = res.conteo[e]; if (!c) continue;
      const t = Math.min(1, c / p95);
      f.push({ type: "Feature", properties: { t, c, nombre: g.aristas[e].nombre || "", color: rampaCss(t) },
        geometry: lineaLL(g.nodos[g.aristas[e].a], g.nodos[g.aristas[e].b]) });
    }
  }
  if (res && estado.vistaDiff && estado.escenarios.length > 1 &&
      estado.escenarios[0].resultado && estado.escenarios[1].resultado) {
    const c0 = estado.escenarios[0].resultado.conteo, c1 = estado.escenarios[1].resultado.conteo;
    const deltas = [];
    for (let e = 0; e < g.m; e++) { const d = Math.abs((c1[e] || 0) - (c0[e] || 0)); if (d > 0) deltas.push(d); }
    deltas.sort((a, b) => a - b);
    const p95 = deltas.length ? deltas[Math.floor(deltas.length * 0.95)] : 1;
    for (let e = 0; e < g.m; e++) {
      const d = (c1[e] || 0) - (c0[e] || 0); if (!d) continue;
      const t = Math.min(1, Math.abs(d) / p95);
      const color = d > 0 ? rampaCss(0.4 + 0.6 * t) : "rgb(90,150,210)";
      f.push({ type: "Feature", properties: { t, c: d, nombre: g.aristas[e].nombre || "", color },
        geometry: lineaLL(g.nodos[g.aristas[e].a], g.nodos[g.aristas[e].b]) });
    }
  }
  return fc(f);
}
function gjBarreras() {
  const g = estado.grafo; if (!g) return fc([]);
  const f = [];
  for (const e of escActivo().barreras) {
    if (e >= g.m) continue;
    f.push({ type: "Feature", properties: {}, geometry: lineaLL(g.nodos[g.aristas[e].a], g.nodos[g.aristas[e].b]) });
  }
  return fc(f);
}
function gjRadio() {
  const a = estado.selAtr;
  if (!a || !a.activo || !estado.proyector) return fc([]);
  return fc([{ type: "Feature", properties: {}, geometry: circleLL(a.x, a.y, a.radio || 800) }]);
}

function actualizarFuentes() {
  pintarMarcadores(); // los marcadores son DOM: independientes del estilo del mapa
  if (!estado.grafo) return;
  mapa.set("red", gjRed()); mapa.set("quitada", gjQuitada());
  mapa.set("flujo", gjFlujo()); mapa.set("barreras", gjBarreras());
  mapa.set("radio", gjRadio());
}
function pintarMarcadores() {
  if (!mapa.map || !estado.proyector || !estado.escenarios.length) return;
  const P = estado.proyector;
  const lista = escActivo().atractores.filter((a) => a.activo).map((a) => ({
    ref: a, lonlat: P.aLonLat(a.x, a.y), color: ROL_COLOR[a.rol], nombre: a.nombre, sel: a === estado.selAtr,
  }));
  mapa.setMarcadores(lista, {
    onClick: (a) => seleccionarAtr(a),
    onDragEnd: (a, lon, lat) => {
      [a.x, a.y] = P.aXY(lon, lat);
      escActivo().resultado = null;
      log(`"${a.nombre}" reubicado — vuelve a correr la simulación.`);
      guardarProyecto(); refrescarTodo();
    },
  });
}

/* ==================== ubicación y área de estudio ==================== */
async function ejecutarBusqueda() {
  const q = $("input-ciudad").value.trim(); if (!q) return;
  const cont = $("res-ciudades");
  cont.innerHTML = '<span class="nota">Buscando…</span>';
  try {
    const res = await buscarCiudad(q);
    cont.innerHTML = "";
    if (!res.length) { cont.innerHTML = '<span class="nota">Sin resultados para «' + q + '».</span>'; return; }
    for (const c of res.slice(0, 5)) {
      const b = document.createElement("button");
      const [n, ...resto] = c.nombre.split(",");
      b.innerHTML = `<b>${n}</b><div class="sub">${resto.join(",").trim() || "&nbsp;"}</div>`;
      b.onclick = () => elegirCiudad(c, false);
      cont.appendChild(b);
    }
  } catch (e) {
    cont.innerHTML = "";
    log("Error en la búsqueda (Nominatim): " + e.message, true);
  }
}
function elegirCiudad(c, esDemo) {
  estado.ciudad = c; estado.esDemo = esDemo;
  $("res-ciudades").innerHTML = "";
  $("input-ciudad").value = c.nombre.split(",")[0];
  $("ubicacion-actual").textContent = "Ubicación: " + c.nombre.split(",").slice(0, 2).join(",");
  mapa.minimapaA(c.lon, c.lat);
  mapa.volarA(c.lon, c.lat, 13.5);
  $("btn-descargar").disabled = false;
  $("estado-datos").textContent = "Ajusta el lado del área y descarga los datos OSM de la zona.";
  log(`Ubicación fijada: ${c.nombre.split(",")[0]}. Define el área y descarga sus datos.`);
}

async function descargarDatos() {
  if (!estado.ciudad) return;
  const btn = $("btn-descargar");
  btn.disabled = true; btn.textContent = "Descargando…";
  const prog = $("prog-datos"); prog.classList.remove("oculto");
  const onStatus = (msg, f) => {
    $("estado-datos").textContent = msg;
    if (f != null) prog.firstElementChild.style.width = Math.round(f * 100) + "%";
  };
  try {
    estado.bbox = estado.esDemo ? DEMO_GYE.bbox
      : bboxDesdeCentro(estado.ciudad.lat, estado.ciudad.lon, estado.lado);
    const centro = centroDeBbox(estado.bbox);
    estado.proyector = crearProyector(centro.lat, centro.lon);
    marcarPaso(2, false);

    const capasParciales = {};
    const capas = await descargarCapas(estado.bbox, onStatus, (parte) => {
      Object.assign(capasParciales, parte);
      mapa.setContexto(capasParciales);       // el contexto se pinta progresivamente
    });
    estado.capas = capas; estado.fechaOSM = capas.fechaOSM;
    mapa.setContexto(capas);

    onStatus("Construyendo el grafo caminable…", 0.95);
    estado.grafo = construirGrafo([capas.roads, capas.pednet], estado.proyector);
    if (!estado.grafo.m) throw new Error("La zona no tiene red caminable en OSM. Prueba un área mayor u otra ubicación.");
    estado.redQuitada.clear();
    remapearGuardado();

    if (!estado.escenarios.length) {
      const base = estado.esDemo
        ? DEMO_GYE.atractores.map((a) => aAtractorXY(a))
        : proponerAtractores(capas.pois).map((a) => aAtractorXY(a));
      estado.escenarios = [nuevoEscenario("Escenario 01 — actual", null, base)];
      estado.activo = 0;
      if (estado.esDemo) {
        const p = DEMO_GYE.params;
        $("p-agentes").value = p.agentes; $("p-ruido").value = p.ruido;
        $("v-ruido").textContent = p.ruido.toFixed(2);
        $("p-cohortes").value = p.cohortes; $("p-semilla").value = p.semilla;
      }
    } else {
      for (const esc of estado.escenarios) esc.resultado = null;
    }

    mapa.encuadrarBbox(estado.bbox);
    marcarPaso(2, true); marcarPaso(3, false); marcarPaso(4, false);
    $("btn-correr").disabled = false;
    pintarLista(); pintarBarreras(); pintarRed(); refrescarTodo(); guardarProyecto();
    log(`Datos reales cargados (OSM ${estado.fechaOSM}): ${estado.grafo.m} tramos y ${estado.grafo.n} nodos caminables. La simulación correrá sobre las calles reales.`);
  } catch (e) {
    log("No se pudieron descargar los datos: " + e.message, true);
    $("estado-datos").textContent = "";
  }
  prog.classList.add("oculto");
  btn.textContent = "⤓ Descargar datos de esta zona"; btn.disabled = !estado.ciudad;
}
function aAtractorXY(a) {
  const [x, y] = estado.proyector.aXY(a.lon, a.lat);
  return normalizarAtr({ ...a, x, y, activo: a.activo !== false });
}
function cargarDemo() {
  const centro = centroDeBbox(DEMO_GYE.bbox);
  estado.escenarios = []; estado.activo = 0; estado.selAtr = null;
  elegirCiudad({ nombre: DEMO_GYE.nombre, lat: centro.lat, lon: centro.lon }, true);
  descargarDatos();
}

/* ==================== interacción sobre el mapa ==================== */
const aristaCerca = (x, y, umbral) => {
  const r = aristaMasCercana(estado.grafo, x, y);
  return r.dist <= umbral ? r.e : -1;
};
function puntoEnAnillo(lon, lat, anillo) {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}
function centroideAnillo(anillo) {
  let sx = 0, sy = 0;
  for (const [x, y] of anillo) { sx += x; sy += y; }
  return [sx / anillo.length, sy / anillo.length];
}
// Reconocimiento del lugar bajo el clic (parque / plaza / edificio de OSM).
// Solo aporta nombre, tipo y peso sugerido: el atractor queda como PUNTO.
function geometriaEnPunto(lon, lat) {
  const capas = estado.capas; if (!capas) return null;
  const P = estado.proyector;
  const busca = (lista, clasifica) => {
    for (const p of lista || []) {
      if (!puntoEnAnillo(lon, lat, p.anillos[0])) continue;
      const [clon, clat] = centroideAnillo(p.anillos[0]);
      return { ...clasifica(p), lon: clon, lat: clat };
    }
    return null;
  };
  const areaM2 = (p) => {
    const pts = p.anillos[0].map(([lo, la]) => P.aXY(lo, la));
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
      a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return Math.abs(a / 2);
  };
  return (
    busca(capas.parks, (p) => ({
      nombre: p.tags.name || "Parque",
      tipo: areaM2(p) < 20000 ? "parque_pequeno" : "parque_urbano" })) ||
    busca(capas.squares, (p) => ({ nombre: p.tags.name || "Plaza", tipo: "plaza" })) ||
    busca(capas.buildings, (p) => ({ nombre: p.tags.name || "Edificio", tipo: "edificio" }))
  );
}

function clicEnMapa(lon, lat) {
  if (!estado.grafo) return;
  const P = estado.proyector, esc = escActivo();
  const [x, y] = P.aXY(lon, lat);
  if (estado.modoClic === "atractor") {
    const geo = geometriaEnPunto(lon, lat);
    const tipo = geo ? geo.tipo : "otro";
    const [gx, gy] = geo ? P.aXY(geo.lon, geo.lat) : [x, y];
    const nuevo = normalizarAtr({
      nombre: geo ? geo.nombre : "Nuevo atractor",
      tipo, rol: "ambos", peso: PESO_TIPO[tipo], x: gx, y: gy, activo: true });
    esc.atractores.push(nuevo);
    esc.resultado = null; fijarModo(null); pintarLista();
    seleccionarAtr(nuevo);
    refrescarTodo(); guardarProyecto();
    log(geo
      ? `Atractor creado: ${nuevo.nombre} — lugar reconocido (${ETIQ_TIPO[tipo]}, peso sugerido ${nuevo.peso}).`
      : `Atractor creado (peso sugerido ${nuevo.peso}). Descríbelo en el panel.`);
    return;
  }
  if (estado.tab === "atractores" && !estado.modoClic && estado.selAtr) { seleccionarAtr(null); return; }
  if (estado.tab === "barreras") {
    const e = aristaCerca(x, y, 28); if (e < 0) return;
    if (esc.barreras.has(e)) esc.barreras.delete(e); else esc.barreras.add(e);
    esc.resultado = null; pintarBarreras(); refrescarTodo(); guardarProyecto();
    return;
  }
  if (estado.tab === "red") {
    const e = aristaCerca(x, y, 28); if (e < 0) return;
    if (estado.redQuitada.has(e)) estado.redQuitada.delete(e); else estado.redQuitada.add(e);
    for (const s of estado.escenarios) s.resultado = null;
    pintarRed(); pintarBarreras(); refrescarTodo(); guardarProyecto();
    log("Red peatonal corregida — vuelve a correr la simulación en cada escenario.");
  }
}
function tooltipMapa(lon, lat, punto) {
  const tip = $("tooltip-mapa");
  const res = estado.grafo && escActivo() && escActivo().resultado;
  if (!res || estado.vistaDiff) { tip.classList.add("oculto"); return; }
  const [x, y] = estado.proyector.aXY(lon, lat);
  const e = aristaCerca(x, y, 20);
  if (e >= 0 && res.conteo[e] > 0) {
    tip.classList.remove("oculto");
    tip.style.left = punto.x + 14 + "px"; tip.style.top = punto.y + 14 + "px";
    tip.textContent = `${estado.grafo.aristas[e].nombre || "(sin nombre)"} · ${res.conteo[e]} pasos`;
  } else tip.classList.add("oculto");
}

/* ==================== panel del atractor ==================== */
function seleccionarAtr(a, abrir = true) {
  estado.selAtr = a;
  actualizarFuentes();
  if (a && abrir) abrirPanelAtr(a);
  if (!a) $("panel-atr").classList.add("oculto");
}
function abrirPanelAtr(a) {
  $("pa-titulo").textContent = a.nombre || "Atractor";
  $("pa-nombre").value = a.nombre;
  $("pa-tipo").value = a.tipo;
  $("pa-jer").value = a.jerarquia;
  $("pa-peso").value = a.peso;
  $("pa-peso-desc").textContent = a.peso + " — " + descPeso(a.peso);
  $("pa-radio").value = a.radio;
  $("pa-horario").value = a.horario || "";
  $("pa-rol").value = a.rol;
  $("panel-atr").classList.remove("oculto");
}
function cambioAtr() { escActivo().resultado = null; pintarLista(); refrescarTodo(); guardarProyecto(); }
function iniciarPanelAtr() {
  $("pa-tipo").innerHTML = TIPOS.map(([v, e]) => `<option value="${v}">${e}</option>`).join("");
  $("pa-jer").innerHTML = JERARQUIAS.map(([v, e, r]) =>
    `<option value="${v}">${e} (~${r >= 1000 ? r / 1000 + " km" : r + " m"})</option>`).join("");
  const conSel = (fn) => (ev) => { const a = estado.selAtr; if (a) fn(a, ev); };
  $("pa-nombre").addEventListener("change", conSel((a, ev) => {
    a.nombre = ev.target.value.trim() || a.nombre; $("pa-titulo").textContent = a.nombre; cambioAtr(); }));
  $("pa-tipo").addEventListener("change", conSel((a, ev) => {  // el tipo propone el peso
    a.tipo = ev.target.value; a.peso = PESO_TIPO[a.tipo];
    $("pa-peso").value = a.peso; $("pa-peso-desc").textContent = a.peso + " — " + descPeso(a.peso);
    cambioAtr(); }));
  $("pa-jer").addEventListener("change", conSel((a, ev) => {   // la jerarquía propone el radio
    a.jerarquia = ev.target.value; a.radio = RADIO_JER[a.jerarquia];
    $("pa-radio").value = a.radio; cambioAtr(); }));
  $("pa-peso").addEventListener("input", conSel((a, ev) => {
    a.peso = +ev.target.value; $("pa-peso-desc").textContent = a.peso + " — " + descPeso(a.peso); }));
  $("pa-peso").addEventListener("change", conSel(() => cambioAtr()));
  $("pa-radio").addEventListener("change", conSel((a, ev) => {
    a.radio = Math.max(100, Math.min(10000, +ev.target.value || a.radio));
    ev.target.value = a.radio; cambioAtr(); }));
  $("pa-horario").addEventListener("change", conSel((a, ev) => { a.horario = ev.target.value.trim(); guardarProyecto(); }));
  $("pa-rol").addEventListener("change", conSel((a, ev) => { a.rol = ev.target.value; cambioAtr(); }));
  $("pa-cerrar").onclick = () => seleccionarAtr(null);   // el marcador permanece
  $("pa-listo").onclick = () => seleccionarAtr(null);
  $("pa-eliminar").onclick = () => { const a = estado.selAtr; if (a) eliminarAtr(a); };
  document.addEventListener("keydown", (ev) => {          // Supr elimina el seleccionado
    if (ev.key !== "Delete" && ev.key !== "Backspace") return;
    const t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (estado.selAtr) { ev.preventDefault(); eliminarAtr(estado.selAtr); }
  });
}
function eliminarAtr(a) {
  const esc = escActivo();
  esc.atractores = esc.atractores.filter((x) => x !== a);
  if (estado.selAtr === a) estado.selAtr = null;
  $("panel-atr").classList.add("oculto");
  esc.resultado = null; pintarLista(); refrescarTodo(); guardarProyecto();
  log(`Atractor "${a.nombre}" eliminado.`);
}

/* ==================== listas laterales ==================== */
function pintarLista() {
  const cont = $("lista-atr"); cont.innerHTML = "";
  if (!estado.escenarios.length) return;
  escActivo().atractores.forEach((a) => {
    const div = document.createElement("div"); div.className = "item-atr";
    div.style.cursor = "pointer";
    div.innerHTML = `<span class="punto" style="background:${ROL_COLOR[a.rol]}"></span>
      <div class="info"><div class="n">${a.nombre}</div>
      <div class="m">${ETIQ_TIPO[a.tipo] || a.tipo} · ${ETIQ_JER[a.jerarquia] || ""} · peso ${a.peso} (${descPeso(a.peso)}) · ${ROL_ETIQ[a.rol]}</div></div>
      <button class="icono" title="Eliminar">✕</button>`;
    div.onclick = () => {   // como en Google Maps: centra, resalta y abre el formulario
      const [lon, lat] = estado.proyector.aLonLat(a.x, a.y);
      mapa.map.easeTo({ center: [lon, lat], duration: 500 });
      seleccionarAtr(a);
    };
    div.querySelector(".icono").onclick = (ev) => { ev.stopPropagation(); eliminarAtr(a); };
    cont.appendChild(div);
  });
}
function pintarOD() {
  if (!estado.escenarios.length) return;
  const esc = escActivo(), t = $("tabla-od");
  const O = esc.atractores.filter((a) => a.activo && a.rol !== "destino");
  const D = esc.atractores.filter((a) => a.activo && a.rol !== "origen");
  const pares = [];
  for (const o of O) for (const d of D) { if (o === d) continue; pares.push({ o, d, v: o.peso * d.peso }); }
  pares.sort((a, b) => b.v - a.v);
  const max = pares[0]?.v || 1;
  t.innerHTML = "<tr><th>Origen</th><th>Destino</th><th style='text-align:right'>Intensidad</th></tr>" +
    pares.slice(0, 10).map((p) => {
      const r = p.v / max, cls = r > 0.7 ? "alta" : r > 0.4 ? "media" : "baja", et = r > 0.7 ? "Alta" : r > 0.4 ? "Media" : "Baja";
      return `<tr><td>${p.o.nombre}</td><td>${p.d.nombre}</td><td style="text-align:right"><span class="badge ${cls}">${et}</span></td></tr>`;
    }).join("");
}
function pintarBarreras() {
  const el = $("lista-barr");
  if (!estado.grafo || !estado.escenarios.length) { el.textContent = "Sin barreras."; return; }
  const esc = escActivo(), g = estado.grafo;
  if (!esc.barreras.size) { el.textContent = "Sin barreras."; return; }
  el.innerHTML = [...esc.barreras].map((e) => (e < g.m ? `• ${g.aristas[e].nombre || "(sin nombre)"} — bloqueado` : "")).join("<br>");
}
function pintarRed() {
  $("lista-red").textContent = estado.redQuitada.size
    ? `${estado.redQuitada.size} tramo(s) eliminados del proyecto.` : "Sin correcciones.";
}

/* ==================== simulación ==================== */
function leerParams() {
  return {
    agentes: Math.max(100, +$("p-agentes").value || 2048),
    ruido: +$("p-ruido").value,
    cohortes: Math.max(1, +$("p-cohortes").value || 8),
    semilla: Math.max(1, +$("p-semilla").value || 42),
  };
}
let corriendo = false;
async function correrSimulacion() {
  if (corriendo || !estado.grafo) return;
  corriendo = true;
  const btn = $("btn-correr"); btn.disabled = true; btn.textContent = "Simulando…";
  const esc = escActivo();
  const prog = $("prog-sim"); prog.classList.remove("oculto");
  const t0 = performance.now();
  try {
    const bloqueadas = new Set([...esc.barreras, ...estado.redQuitada]); // barreras + red corregida
    const res = await correrModelo({
      grafo: estado.grafo, atractores: esc.atractores, params: leerParams(), barreras: bloqueadas,
      onProgreso: (f, txt) => {
        prog.firstElementChild.style.width = Math.round(f * 100) + "%";
        $("estado-sim").textContent = `Calculando rutas — ${txt} (${Math.round(f * 100)} %)`;
      },
    });
    calcularPanel(res, esc);   // acc10, cobertura, conectividad, concentración, índice
    esc.resultado = res; estado.vistaDiff = false;
    const seg = ((performance.now() - t0) / 1000).toFixed(1);
    $("estado-sim").textContent = "";
    log(`Simulación de "${esc.nombre}" completada en ${seg} s — ${res.stats.rutasOk.toLocaleString("es-EC")} rutas trazadas` +
      (res.stats.sinRuta ? `, ${res.stats.sinRuta} sin ruta posible (revisa barreras o conectividad).` : "."));
    marcarPaso(4, true);
  } catch (e) { log(e.message, true); $("estado-sim").textContent = ""; }
  prog.classList.add("oculto");
  btn.disabled = false; btn.textContent = "Correr simulación ▶"; corriendo = false;
  refrescarTodo();
}

/* ==================== cabecera, KPIs, comparación ==================== */
function refrescarCabecera() {
  const esc = estado.escenarios.length ? escActivo() : null, g = estado.grafo;
  $("nombre-escenario").textContent = esc ? esc.nombre : "Sin datos";
  if (g && estado.bbox) {
    const km2 = ((estado.lado * estado.lado) / 1e6).toFixed(1);
    $("meta-escenario").textContent = `Área: ~${km2} km² · Red: ${g.m} tramos · Nodos: ${g.n}`;
    $("resumen-datos").textContent =
      `${g.m} tramos, ${g.n} nodos, ${estado.capas.buildings.length} edificios · OSM ${estado.fechaOSM}`;
  } else {
    $("meta-escenario").textContent = "Busca una ciudad y descarga sus datos, o carga el caso validado.";
    $("resumen-datos").textContent = "—";
  }
  $("btn-ver-diff").classList.toggle("oculto",
    !(estado.escenarios.length > 1 && estado.escenarios[0].resultado && estado.escenarios[1].resultado));
  $("btn-ver-diff").textContent = estado.vistaDiff ? "Ver flujo del escenario" : "Ver diferencia en el mapa";
}
function refrescarKPIs() {
  const res = estado.escenarios.length && escActivo().resultado;
  pintarPanel();
  if (!res) bloquearPaso(5); else marcarPaso(5, true);
}

function refrescarComparacion() {
  const zona = $("comparacion"), fila = $("comp-fila");
  const listos = estado.escenarios.filter((e) => e.resultado);
  if (estado.escenarios.length < 2 || listos.length < 2) { zona.classList.add("oculto"); return; }
  zona.classList.remove("oculto"); fila.innerHTML = "";
  const [a, b] = estado.escenarios;
  for (const [i, e] of [[0, a], [1, b]]) {
    const div = document.createElement("button");
    div.className = "comp-esc" + (estado.activo === i ? " sel" : "");
    div.innerHTML = `<b>${e.nombre}</b><div class="s">${i === 0 ? "base" : "vs base"}</div>`;
    div.onclick = () => { estado.activo = i; estado.vistaDiff = false; pintarLista(); pintarBarreras(); refrescarTodo(); };
    fila.appendChild(div);
  }
  const delta = (et, va, vb, unidad, mejorSube) => {
    const d = va ? ((vb - va) / va) * 100 : 0;
    const cls = Math.abs(d) < 1 ? "neu" : (d > 0) === mejorSube ? "pos" : "neg";
    const div = document.createElement("div"); div.className = "delta";
    div.innerHTML = `<div class="e">${et}</div><div class="v">${va.toLocaleString("es-EC", { maximumFractionDigits: 1 })} → ${vb.toLocaleString("es-EC", { maximumFractionDigits: 1 })} ${unidad}</div><div class="d ${cls}">${d > 0 ? "+" : ""}${d.toFixed(0)} %</div>`;
    fila.appendChild(div);
  };
  delta("Flujo promedio", a.resultado.stats.flujoProm, b.resultado.stats.flujoProm, "pasos", true);
  delta("Tiempo medio", a.resultado.stats.tiempoMedioMin, b.resultado.stats.tiempoMedioMin, "min", false);
  delta("Accesibilidad 10 min", a.resultado.acc10, b.resultado.acc10, "%", true);
}
function refrescarTodo() { refrescarCabecera(); refrescarKPIs(); refrescarComparacion(); actualizarFuentes(); }

/* ==================== pestañas y modos ==================== */
document.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => {
  estado.tab = b.dataset.tab; fijarModo(null);
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("activo", x === b));
  for (const t of ["atractores", "od", "barreras", "red"]) $("tab-" + t).classList.toggle("oculto", t !== estado.tab);
  if (estado.tab === "od") pintarOD();
  avisoModo();
}));
function avisoModo() {
  const av = $("aviso-modo");
  mapa.cursor(estado.modoClic === "atractor" || estado.tab === "barreras" || estado.tab === "red" ? "crosshair" : "");
  if (estado.modoClic === "atractor") { av.textContent = "Haz clic en el mapa para colocar el atractor"; av.classList.remove("oculto"); }
  else if (estado.tab === "barreras") { av.textContent = "Clic en un tramo: bloquear / desbloquear (este escenario)"; av.classList.remove("oculto"); }
  else if (estado.tab === "red") { av.textContent = "Clic en un tramo: eliminar / restaurar de la red (todo el proyecto)"; av.classList.remove("oculto"); }
  else av.classList.add("oculto");
}
function fijarModo(m) { estado.modoClic = m; avisoModo(); }
$("btn-add-atr").onclick = () => {
  if (!estado.grafo) { log("Primero descarga los datos de una zona (o carga el caso validado).", true); return; }
  fijarModo(estado.modoClic === "atractor" ? null : "atractor");
};

/* ==================== escenarios / vistas ==================== */
$("btn-duplicar").onclick = () => {
  if (!estado.escenarios.length) return;
  if (estado.escenarios.length >= 2) { log("Se manejan 2 escenarios (base y propuesto).", true); return; }
  estado.escenarios.push(nuevoEscenario("Escenario 02 — propuesto", escActivo()));
  estado.activo = 1; pintarLista(); pintarBarreras(); refrescarTodo(); guardarProyecto();
  log("Escenario 02 creado como copia. Modifícalo (p. ej. bloquea una calle en Barreras) y corre la simulación para comparar.");
};
$("btn-cambiar-esc").onclick = () => {
  if (estado.escenarios.length < 2) { log("Solo existe un escenario. Usa «Duplicar como propuesto»."); return; }
  estado.activo = 1 - estado.activo; estado.vistaDiff = false;
  pintarLista(); pintarBarreras(); refrescarTodo();
};
$("btn-ver-diff").onclick = () => { estado.vistaDiff = !estado.vistaDiff; refrescarTodo(); };

/* ==================== estilo de base y tema ==================== */
$("estilo-base").onchange = (ev) => { estado.estilo = ev.target.value; mapa.setEstilo(estado.estilo); guardarProyecto(); };
$("btn-tema").onclick = () => {
  estado.claro = !estado.claro;
  document.body.classList.toggle("claro", estado.claro);
  $("btn-tema").textContent = estado.claro ? "☾ Oscuro" : "☀ Claro";
  mapa.setTema(estado.claro);
  guardarProyecto();
  log(estado.claro ? "Tema claro activado." : "Tema oscuro activado.");
};

/* ==================== exportación / ayuda ==================== */
$("btn-export-png").onclick = () => {
  const a = document.createElement("a");
  a.download = "urbanflow-" + (estado.escenarios.length ? escActivo().nombre.replace(/\s+/g, "-") : "mapa") + ".png";
  a.href = mapa.pngDataUrl(); a.click();
  log("Lámina PNG exportada (los rótulos de atractores, por ser HTML, no se incluyen en el PNG).");
};
$("btn-export-json").onclick = () => {
  if (!estado.escenarios.length) return;
  const esc = escActivo();
  const datos = {
    proyecto: $("proyecto-nombre").value, objetivo: $("objetivo").value,
    ciudad: estado.ciudad, bbox: estado.bbox, lado: estado.lado, fechaOSM: estado.fechaOSM,
    escenario: esc.nombre, params: leerParams(),
    atractores: esc.atractores, barreras: [...esc.barreras].map((e) => claveArista(e)),
    redQuitada: [...estado.redQuitada].map((e) => claveArista(e)),
    estiloBase: estado.estilo, nivelModelo: "exploratorio", fecha: new Date().toISOString(),
  };
  const a = document.createElement("a");
  a.download = "urbanflow-escenario.json";
  a.href = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(datos, null, 2));
  a.click(); log("Hoja de parámetros JSON exportada.");
};
$("btn-ayuda-nav").onclick = () => log(
  "Flujo: busca una ciudad → define el área y descarga sus datos OSM → revisa los atractores propuestos o añade los tuyos → corre la simulación → duplica el escenario, añade barreras y compara. Rotación: Ctrl+arrastrar; el norte vuelve con un clic en la brújula.");

/* ==================== proyecto persistente (localStorage) ==================== */
let restaurando = false;
function guardarProyecto() {
  if (restaurando) return;
  try {
    const datos = {
      nombre: $("proyecto-nombre").value, objetivo: $("objetivo").value,
      ciudad: estado.ciudad, esDemo: estado.esDemo, lado: estado.lado,
      estilo: estado.estilo, claro: estado.claro, params: leerParams(),
      escenarios: estado.escenarios.map((e) => ({
        nombre: e.nombre,
        atractores: e.atractores.map(({ ...a }) => a),
        barreras: estado.grafo ? [...e.barreras].map((i) => claveArista(i)) : [],
      })),
      redQuitada: estado.grafo ? [...estado.redQuitada].map((i) => claveArista(i)) : [],
      activo: estado.activo,
    };
    localStorage.setItem(CLAVE_PROYECTO, JSON.stringify(datos));
  } catch { /* sin almacenamiento, sin drama */ }
}
let clavesPendientes = null; // {barrerasPorEsc:[[k...]], red:[k...]} a re-mapear tras construir el grafo
function remapearGuardado() {
  if (!clavesPendientes || !estado.grafo) return;
  const porClave = new Map();
  for (let e = 0; e < estado.grafo.m; e++) porClave.set(claveArista(e), e);
  estado.redQuitada = new Set(clavesPendientes.red.map((k) => porClave.get(k)).filter((e) => e !== undefined));
  clavesPendientes.barrerasPorEsc.forEach((claves, i) => {
    if (estado.escenarios[i])
      estado.escenarios[i].barreras = new Set(claves.map((k) => porClave.get(k)).filter((e) => e !== undefined));
  });
  clavesPendientes = null;
}
function cargarProyecto() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CLAVE_PROYECTO)); } catch { }
  if (!d || !d.ciudad) return false;
  restaurando = true;
  $("proyecto-nombre").value = d.nombre || "Proyecto UrbanFlow";
  $("objetivo").value = d.objetivo || "flujos";
  estado.lado = d.lado || 2000;
  $("p-lado").value = estado.lado; $("v-lado").textContent = estado.lado;
  if (d.params) {
    $("p-agentes").value = d.params.agentes; $("p-ruido").value = d.params.ruido;
    $("v-ruido").textContent = (+d.params.ruido).toFixed(2);
    $("p-cohortes").value = d.params.cohortes; $("p-semilla").value = d.params.semilla;
  }
  if (d.claro) { estado.claro = true; document.body.classList.add("claro"); $("btn-tema").textContent = "☾ Oscuro"; }
  if (d.estilo) { estado.estilo = d.estilo; $("estilo-base").value = d.estilo; }
  estado.escenarios = (d.escenarios || []).map((e) =>
    ({ nombre: e.nombre, atractores: e.atractores.map((a) => normalizarAtr(a)), barreras: new Set(), resultado: null }));
  estado.activo = Math.min(d.activo || 0, Math.max(0, estado.escenarios.length - 1));
  clavesPendientes = { red: d.redQuitada || [], barrerasPorEsc: (d.escenarios || []).map((e) => e.barreras || []) };
  elegirCiudad(d.ciudad, !!d.esDemo);
  restaurando = false;
  log("Proyecto anterior restaurado. Descargando sus datos (la caché local lo hace rápido)…");
  descargarDatos();
  return true;
}

/* ==================== arranque ==================== */
$("p-ruido").oninput = (ev) => ($("v-ruido").textContent = (+ev.target.value).toFixed(2));
$("p-lado").oninput = (ev) => { estado.lado = +ev.target.value; $("v-lado").textContent = estado.lado; };
$("btn-buscar").onclick = ejecutarBusqueda;
$("input-ciudad").addEventListener("keydown", (ev) => { if (ev.key === "Enter") ejecutarBusqueda(); });
$("btn-descargar").onclick = descargarDatos;
$("btn-demo").onclick = cargarDemo;
$("btn-correr").onclick = correrSimulacion;
$("proyecto-nombre").addEventListener("change", guardarProyecto);
$("objetivo").addEventListener("change", guardarProyecto);

// contexto de los módulos de presentación
iniciarPanel({
  estado, escActivo, leerParams, VEL: VEL_PEATON,
  accesibilidad: (g, n, b, m) => accesibilidad(g, n, b, m),
  ultimaDistMin: () => ultimaDistMin(),   // devuelve el array, no la función
});
iniciarLamina({
  mapa: () => mapa.map, escActivo, leerParams, log, numES, rampaCss,
  estadoProyecto: () => ({ ciudad: estado.ciudad, fechaOSM: estado.fechaOSM }),
});

iniciarPanelAtr();
pintarLista(); pintarBarreras(); pintarRed();
bloquearPaso(3); bloquearPaso(4); bloquearPaso(5);
$("btn-correr").disabled = true;

if (typeof maplibregl === "undefined") {
  log("No se pudo cargar MapLibre desde el CDN. Revisa la conexión.", true);
} else {
  mapa.iniciar(); mapa.iniciarMinimapa();
  refrescarTodo();
  if (!cargarProyecto())
    log("Bienvenido. Busca una ciudad (o carga el caso validado del Centro Histórico) para descargar sus calles reales de OSM.");
}
