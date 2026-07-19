// Mapa UrbanFlow sobre MapLibre GL — reemplaza a render.js (canvas) y tiles.js.
// Responsabilidades: mapa base intercambiable (Lienzo propio / OSM / CARTO),
// capas GeoJSON de la simulación (contexto, red, flujo, barreras, radio),
// marcadores DOM de atractores (arrastrables, seleccionables), escala gráfica
// única, norte giratorio, y tema claro/oscuro.
//
// NOTA CRÍTICA (bug conocido de MapLibre): setStyle() usa "diff" por defecto y
// en ese modo NO dispara style.load, con lo que las capas propias jamás se
// re-añadirían. SIEMPRE se intercambian estilos con {diff:false}.

import { ESCALAS, calcularEscala, metrosPorPixelCSS, rotuloEscala } from "./escala-metrica.js";

const ATRIB_OSM = "© OpenStreetMap contributors";
const ATRIB_CARTO = "© OpenStreetMap contributors · © CARTO";

function estiloRaster(nombre, tiles, atrib) {
  return {
    version: 8, name: nombre,
    sources: { base: { type: "raster", tiles: [tiles], tileSize: 256, attribution: atrib } },
    layers: [
      { id: "fondo", type: "background", paint: { "background-color": "#0c0e10" } },
      { id: "base", type: "raster", source: "base" },
    ],
  };
}

const PALETA = {
  oscuro: {
    fondo: "#101214", agua: "#18222a", parque: "#242a1e", plaza: "#2a2a20",
    edif: "#22252a", bordeEdif: "rgba(240,232,216,0.07)",
    calle: "rgba(214,197,171,0.20)", ped: "rgba(214,197,171,0.42)", rio: "#1c2b36",
  },
  claro: {
    fondo: "#edeae2", agua: "#c6d9e3", parque: "#d0dabd", plaza: "#e0dcc8",
    edif: "#dcd8cf", bordeEdif: "rgba(60,55,45,0.18)",
    calle: "rgba(80,72,55,0.28)", ped: "rgba(80,72,55,0.55)", rio: "#b3cbd8",
  },
};

const RAMPA = [[0, [240, 232, 216]], [0.45, [212, 165, 48]], [0.75, [194, 94, 53]], [1, [158, 43, 37]]];
export function colorFlujo(t) {
  for (let i = 1; i < RAMPA.length; i++) {
    if (t <= RAMPA[i][0]) {
      const [t0, c0] = RAMPA[i - 1], [t1, c1] = RAMPA[i], f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return RAMPA[3][1];
}
export const rampaCss = (t) => { const [r, g, b] = colorFlujo(Math.max(0, Math.min(1, t))); return `rgb(${r},${g},${b})`; };
export const ROL_COLOR = { origen: "#5fbf6f", destino: "#e05252", ambos: "#d4a530" };

export class MapaUF {
  /**
   * opts: { contenedor, idMinimapa, idEscalaRegla, idEscalaRotulos, idNorte,
   *         onClickSuelo(lon,lat), onClickTramo? (se resuelve en app),
   *         onHover(lon,lat,punto), onListo() }
   */
  constructor(opts) {
    this.o = opts;
    this.estilo = "lienzo";
    this.claro = false;
    this.listo = false;
    this._datos = {};          // id de fuente -> FeatureCollection (último estado)
    this._marcadores = [];
    this.map = null;
    this.minimapa = null;
  }

  get paleta() { return this.claro ? PALETA.claro : PALETA.oscuro; }

  estilos() {
    const p = this.paleta;
    return {
      lienzo: {
        version: 8, name: "Lienzo UrbanFlow", sources: {},
        layers: [{ id: "fondo", type: "background", paint: { "background-color": p.fondo } }],
      },
      osm: estiloRaster("OSM estándar", "https://tile.openstreetmap.org/{z}/{x}/{y}.png", ATRIB_OSM),
      cartoDark: estiloRaster("Oscuro", "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png", ATRIB_CARTO),
      cartoLight: estiloRaster("Claro", "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png", ATRIB_CARTO),
      voyager: estiloRaster("Voyager", "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", ATRIB_CARTO),
    };
  }

  iniciar(centro = [-79.8891, -2.1894], zoom = 13.5) {
    this.map = new maplibregl.Map({
      container: this.o.contenedor,
      style: this.estilos().lienzo,
      center: centro, zoom,
      attributionControl: { compact: true },
      preserveDrawingBuffer: true,   // exportación PNG
      dragRotate: true, pitchWithRotate: false, // Ctrl+arrastrar rota
    });
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    this.map.keyboard.enable();

    this.map.on("style.load", () => { this._añadirCapas(); this.listo = true; this.o.onListo && this.o.onListo(); });
    this.map.on("click", (ev) => this.o.onClickSuelo && this.o.onClickSuelo(ev.lngLat.lng, ev.lngLat.lat));
    this.map.on("mousemove", (ev) => this.o.onHover && this.o.onHover(ev.lngLat.lng, ev.lngLat.lat, ev.point));
    this.map.on("move", () => this._actualizarEscala());
    this.map.on("rotate", () => this._actualizarNorte());

    const norte = document.getElementById(this.o.idNorte);
    if (norte) norte.onclick = () => this.map.easeTo({ bearing: 0, duration: 450 });
    this._actualizarEscala(); this._actualizarNorte();
    return this;
  }

  iniciarMinimapa(centro = [-79.8891, -2.1894]) {
    this.minimapa = new maplibregl.Map({
      container: this.o.idMinimapa,
      style: this.estilos().voyager,   // minimapa a color
      center: centro, zoom: 10.3, interactive: false, attributionControl: false,
    });
    this._marcaMini = new maplibregl.Marker({ color: "#d4a530" }).setLngLat(centro).addTo(this.minimapa);
  }

  minimapaA(lon, lat) {
    if (!this.minimapa) return;
    this.minimapa.jumpTo({ center: [lon, lat], zoom: 10.3 });
    this._marcaMini.setLngLat([lon, lat]);
  }

  setEstilo(id) {
    this.estilo = id;
    this.listo = false;
    this.map.setStyle(this.estilos()[id], { diff: false }); // ← NUNCA con diff (ver nota arriba)
  }

  setTema(claro) {
    this.claro = claro;
    // el contexto del lienzo depende de la paleta: regenerarlo si existe
    if (this._capas) this._datos["contexto"] = this._fcContexto(this._capas);
    this.setEstilo(this.estilo); // recarga con la paleta nueva (diff:false)
  }

  // ---------- capas ----------
  _addSrc(id) {
    if (!this.map.getSource(id))
      this.map.addSource(id, { type: "geojson", data: this._datos[id] || { type: "FeatureCollection", features: [] } });
  }
  _addLyr(l) { if (!this.map.getLayer(l.id)) this.map.addLayer(l); }

  _añadirCapas() {
    const p = this.paleta;
    for (const id of ["contexto", "pednet", "red", "quitada", "flujo", "barreras", "radio"]) this._addSrc(id);

    if (this.estilo === "lienzo") { // sobre teselas, el mapa base ya trae parques/agua/edificios
      this._addLyr({ id: "ctx-fill", type: "fill", source: "contexto",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": ["get", "c"], "fill-outline-color": p.bordeEdif } });
      this._addLyr({ id: "ctx-rios", type: "line", source: "contexto",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": p.rio, "line-width": 2.2 } });
    }
    this._addLyr({ id: "pednet", type: "line", source: "pednet",
      paint: { "line-color": p.ped, "line-width": 1.1 } });
    this._addLyr({ id: "red", type: "line", source: "red",
      paint: { "line-color": p.calle, "line-width": 1.3 } });
    this._addLyr({ id: "quitada", type: "line", source: "quitada",
      paint: { "line-color": "rgba(150,150,150,0.55)", "line-width": 1.3, "line-dasharray": [2, 2] } });
    this._addLyr({ id: "flujo-brillo", type: "line", source: "flujo", layout: { "line-cap": "round" },
      paint: { "line-color": ["get", "color"], "line-blur": 4,
        "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 3, 1, 11],
        "line-opacity": ["interpolate", ["linear"], ["get", "t"], 0, 0.15, 1, 0.35] } });
    this._addLyr({ id: "flujo", type: "line", source: "flujo", layout: { "line-cap": "round" },
      paint: { "line-color": ["get", "color"],
        "line-width": ["interpolate", ["linear"], ["get", "t"], 0, 0.9, 1, 4.2],
        "line-opacity": ["interpolate", ["linear"], ["get", "t"], 0, 0.6, 1, 1] } });
    this._addLyr({ id: "barreras", type: "line", source: "barreras",
      paint: { "line-color": "#e05252", "line-width": 3, "line-dasharray": [2, 1.6] } });
    this._addLyr({ id: "radio-relleno", type: "fill", source: "radio",
      paint: { "fill-color": "#d4a530", "fill-opacity": 0.06 } });
    this._addLyr({ id: "radio", type: "line", source: "radio",
      paint: { "line-color": "#d4a530", "line-width": 1.6, "line-dasharray": [3, 2.4] } });
  }

  /** Actualiza (y recuerda) los datos de una fuente. */
  set(id, fc) {
    this._datos[id] = fc;
    if (!this.listo) return;
    const s = this.map.getSource(id);
    if (s) s.setData(fc);
  }

  /** Contexto del Lienzo a partir de las capas OSM reales descargadas. */
  setContexto(capas) {
    this._capas = capas;
    this.set("contexto", this._fcContexto(capas));
    const ped = (capas.pednet || []).map((l) => ({
      type: "Feature", properties: {},
      geometry: { type: "LineString", coordinates: l.coords },
    }));
    this.set("pednet", { type: "FeatureCollection", features: ped });
  }

  _fcContexto(capas) {
    const p = this.paleta, f = [];
    const poli = (obj, c) => f.push({ type: "Feature", properties: { c },
      geometry: { type: "Polygon", coordinates: obj.anillos } });
    for (const w of capas.water || []) poli(w, p.agua);
    for (const q of capas.parks || []) poli(q, p.parque);
    for (const q of capas.squares || []) poli(q, p.plaza);
    for (const b of capas.buildings || []) poli(b, p.edif);
    for (const l of capas.waterways || [])
      f.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l.coords } });
    return { type: "FeatureCollection", features: f };
  }

  // ---------- marcadores de atractores (DOM: independientes del estilo) ----------
  /** lista: [{ref, lonlat:[lon,lat], color, nombre, sel}] */
  setMarcadores(lista, { onClick, onDragEnd } = {}) {
    for (const m of this._marcadores) m.remove();
    this._marcadores = [];
    for (const item of lista) {
      const el = document.createElement("div");
      el.className = "marc-atr" + (item.sel ? " sel" : "");
      el.innerHTML = `<span class="pt" style="background:${item.color}"></span><span class="et">${item.nombre}</span>`;
      el.addEventListener("click", (ev) => { ev.stopPropagation(); onClick && onClick(item.ref); });
      const m = new maplibregl.Marker({ element: el, anchor: "left", draggable: true })
        .setLngLat(item.lonlat).addTo(this.map);
      m.on("dragend", () => { const p = m.getLngLat(); onDragEnd && onDragEnd(item.ref, p.lng, p.lat); });
      this._marcadores.push(m);
    }
  }

  // ---------- cámara / exportación ----------
  volarA(lon, lat, zoom = 13.5) { this.map.flyTo({ center: [lon, lat], zoom, duration: 1600 }); }
  encuadrarBbox(b) {
    this.map.fitBounds([[b.w, b.s], [b.e, b.n]], { padding: 40, duration: 800 });
  }
  cursor(c) { this.map.getCanvas().style.cursor = c || ""; }
  pngDataUrl() { return this.map.getCanvas().toDataURL("image/png"); }

  // ---------- escala gráfica única + norte ----------
  _actualizarEscala() {
    const regla = document.getElementById(this.o.idEscalaRegla);
    const rot = document.getElementById(this.o.idEscalaRotulos);
    if (!regla || !rot || !this.map) return;
    // El mapa se ve a tamaño natural: metros por píxel CSS directos.
    const esc = calcularEscala(metrosPorPixelCSS(this.map), 240);
    const W = Math.round(esc.anchoPx);
    regla.style.width = W + "px"; rot.style.width = W + "px";
    regla.innerHTML = ""; rot.innerHTML = "";
    esc.marcas.forEach((mk) => {
      const tick = document.createElement("span");
      tick.className = mk.primera || mk.ultima ? "mayor" : "menor";
      tick.style.left = "calc(" + (mk.pct * 100) + "% - 0.75px)";
      regla.appendChild(tick);
      const et = document.createElement("span");
      et.textContent = mk.txt; et.style.left = (mk.pct * 100) + "%";
      if (mk.primera) et.style.transform = "translateX(0)";
      if (mk.ultima) et.style.transform = "translateX(-100%)";
      rot.appendChild(et);
    });
  }
  _actualizarNorte() {
    const svg = document.querySelector("#" + this.o.idNorte + " svg");
    if (svg && this.map) svg.style.transform = "rotate(" + -this.map.getBearing() + "deg)";
  }
}
