// Renderizador Canvas 2D de UrbanFlow, con tres vistas:
//  - 'mapa': mapa base interactivo (teselas oscuras) con rectángulo de área de estudio.
//  - 'lamina' + flujo 'abs': la lámina computational urbanism (flujos incandescentes).
//  - 'lamina' + flujo 'diff': comparación de escenarios (aumenta=cálido, disminuye=azul).
// Interacción: arrastrar = pan, rueda = zoom, clic corto = onClickMapa(x,y en metros).

import { urlTesela, lonLatATesela, teselaALonLat, metrosPorPixel, ATRIB_TILES } from "./tiles.js";

const COLORES = {
  fondo: "#191715",
  agua: "#1a2126",
  aguaLinea: "#243038",
  parque: "#252a1e",
  plaza: "#2b2620",
  edificio: "#2d2620",
  edificioBorde: "rgba(240,232,216,0.09)",
  calle: "rgba(214,197,171,0.14)",
  peatonal: "rgba(214,197,171,0.22)",
  atractor: "#f0e8d8",
  oro: "#d4a530",
  barrera: "#e05252",
  bajaFlujo: [90, 150, 210], // azul para "disminuye" en modo diferencia
};

export function colorFlujo(t) {
  const stops = [
    [0.0, [240, 232, 216]],
    [0.45, [212, 165, 48]],
    [0.75, [194, 94, 53]],
    [1.0, [158, 43, 37]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
    }
  }
  return stops[stops.length - 1][1];
}

const ROL_COLOR = { origen: "#5fbf6f", destino: "#e05252", ambos: "#d4a530" };

export class Renderizador {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.modo = null;
    this.vista = { cx: 0, cy: 0, escala: 1 };
    this.mapa = { tx: 0, ty: 0, z: 14, ladoM: 1500, rectGeo: null };
    this.teselas = new Map();
    this.capas = null;
    this.flujo = null;          // {tipo:'abs'|'diff', segmentos, p95}
    this.atractores = [];
    this.barreras = [];         // segmentos [{x1,y1,x2,y2}]
    this.onMovimiento = null;
    this.onClickMapa = null;    // (x, y) en metros, solo modo lámina
    this._eventos();
    new ResizeObserver(() => this.dibujar()).observe(canvas);
  }

  // ---------- modo mapa ----------
  modoMapa(lat, lon, ladoM, rectGeo = null) {
    this.modo = "mapa";
    this.mapa.ladoM = ladoM;
    this.mapa.rectGeo = rectGeo;
    const lado = Math.min(this.canvas.clientWidth || 800, this.canvas.clientHeight || 600);
    const mppObjetivo = ladoM / (0.45 * lado);
    let z = Math.round(Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / mppObjetivo));
    this.mapa.z = Math.max(3, Math.min(18, z));
    [this.mapa.tx, this.mapa.ty] = lonLatATesela(lon, lat, this.mapa.z);
    this.dibujar();
  }

  centroMapa() {
    const [lon, lat] = teselaALonLat(this.mapa.tx, this.mapa.ty, this.mapa.z);
    return { lon, lat };
  }

  fijarLado(ladoM) { this.mapa.ladoM = ladoM; if (this.modo === "mapa") this.dibujar(); }

  zoom(direccion) {
    if (this.modo === "mapa") {
      const nuevoZ = Math.max(3, Math.min(18, this.mapa.z + direccion));
      if (nuevoZ !== this.mapa.z) {
        const f = 2 ** (nuevoZ - this.mapa.z);
        this.mapa.tx *= f; this.mapa.ty *= f; this.mapa.z = nuevoZ;
        this.onMovimiento && this.onMovimiento();
      }
    } else if (this.modo === "lamina") {
      this.vista.escala *= direccion > 0 ? 1.3 : 1 / 1.3;
    } else return;
    this.dibujar();
  }

  _tesela(z, x, y) {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    x = ((x % n) + n) % n;
    const clave = `${z}/${x}/${y}`;
    let img = this.teselas.get(clave);
    if (!img) {
      if (this.teselas.size > 400) this.teselas.clear();
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => this.dibujar();
      img.src = urlTesela(z, x, y);
      this.teselas.set(clave, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  _dibujarMapa(ctx, w, h) {
    const { tx, ty, z, ladoM, rectGeo } = this.mapa;
    const x0 = Math.floor(tx - w / 512), x1 = Math.ceil(tx + w / 512);
    const y0 = Math.floor(ty - h / 512), y1 = Math.ceil(ty + h / 512);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const img = this._tesela(z, x, y);
        const px = w / 2 + (x - tx) * 256, py = h / 2 + (y - ty) * 256;
        if (img) ctx.drawImage(img, px, py, 256.5, 256.5);
      }
    }
    const [, latC] = teselaALonLat(tx, ty, z);
    const mpp = metrosPorPixel(rectGeo ? rectGeo.lat : latC, z);
    const lado = ladoM / mpp;
    let cx = w / 2, cy = h / 2;
    if (rectGeo) {
      const [rtx, rty] = lonLatATesela(rectGeo.lon, rectGeo.lat, z);
      cx = w / 2 + (rtx - tx) * 256;
      cy = h / 2 + (rty - ty) * 256;
    }
    ctx.save();
    ctx.strokeStyle = COLORES.oro;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.shadowColor = COLORES.oro; ctx.shadowBlur = 10;
    ctx.strokeRect(cx - lado / 2, cy - lado / 2, lado, lado);
    ctx.restore();
    ctx.font = "11px Consolas, monospace";
    ctx.fillStyle = COLORES.oro;
    ctx.textAlign = "center";
    ctx.fillText(`ÁREA DE ESTUDIO · ${ladoM} m`, cx, cy - lado / 2 - 8);
    if (!rectGeo) {
      ctx.fillStyle = "rgba(240,232,216,0.6)";
      ctx.fillText("arrastra el mapa para centrar tu área · rueda o botones ± para zoom", w / 2, 24);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(240,232,216,0.45)";
    ctx.fillText(ATRIB_TILES, w - 10, h - 10);
    ctx.textAlign = "left";
    this._brujula(ctx, w);
  }

  // ---------- modo lámina ----------
  fijarCapas(capas, proyector, bbox) {
    const P = (anillos) => anillos.map((an) => an.map(([lon, lat]) => proyector.aXY(lon, lat)));
    const L = (lineas) => lineas.map((l) => l.coords.map(([lon, lat]) => proyector.aXY(lon, lat)));
    this.capas = {
      buildings: (capas.buildings || []).map((b) => P(b.anillos)),
      parks: (capas.parks || []).map((b) => P(b.anillos)),
      water: (capas.water || []).map((b) => P(b.anillos)),
      squares: (capas.squares || []).map((b) => P(b.anillos)),
      roads: L(capas.roads || []),
      pednet: L(capas.pednet || []),
      waterways: L(capas.waterways || []),
    };
    const [x1, y1] = proyector.aXY(bbox.w, bbox.s);
    const [x2, y2] = proyector.aXY(bbox.e, bbox.n);
    this.limites = { x1, y1, x2, y2 };
    if (this.modo !== "lamina") { this.modo = "lamina"; this.encuadrar(); }
    else this.dibujar();
  }

  fijarFlujo(grafo, conteo, p95) {
    const segmentos = [];
    for (let e = 0; e < grafo.m; e++) {
      if (conteo[e] <= 0) continue;
      const { a, b } = grafo.aristas[e];
      segmentos.push({
        x1: grafo.nodos[a][0], y1: grafo.nodos[a][1],
        x2: grafo.nodos[b][0], y2: grafo.nodos[b][1],
        v: conteo[e],
      });
    }
    segmentos.sort((s, t) => s.v - t.v);
    this.flujo = { tipo: "abs", segmentos, p95: Math.max(1, p95) };
  }

  // diferencia entre dos corridas: v = conteoB - conteoA (propuesto - actual)
  fijarDiff(grafo, conteoA, conteoB) {
    const segmentos = [];
    let maxAbs = 1;
    for (let e = 0; e < grafo.m; e++) {
      const d = (conteoB[e] || 0) - (conteoA[e] || 0);
      if (d === 0) continue;
      const { a, b } = grafo.aristas[e];
      segmentos.push({
        x1: grafo.nodos[a][0], y1: grafo.nodos[a][1],
        x2: grafo.nodos[b][0], y2: grafo.nodos[b][1],
        v: d,
      });
      if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    }
    segmentos.sort((s, t) => Math.abs(s.v) - Math.abs(t.v));
    // p95 de |delta| para saturar la rampa sin que un outlier apague el resto
    const abs = segmentos.map((s) => Math.abs(s.v)).sort((a, b) => a - b);
    const p95 = abs.length ? abs[Math.floor(abs.length * 0.95)] : 1;
    this.flujo = { tipo: "diff", segmentos, p95: Math.max(1, p95) };
  }

  fijarAtractores(lista, proyector) {
    this.atractores = lista.filter((a) => a.activo).map((a) => {
      const [x, y] = proyector.aXY(a.lon, a.lat);
      return { ...a, x, y };
    });
  }

  fijarBarreras(segmentos) { this.barreras = segmentos || []; }

  encuadrar() {
    if (!this.limites) return;
    const { x1, y1, x2, y2 } = this.limites;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.vista.cx = (x1 + x2) / 2;
    this.vista.cy = (y1 + y2) / 2;
    this.vista.escala = 0.92 * Math.min(w / Math.abs(x2 - x1), h / Math.abs(y2 - y1));
    this.dibujar();
  }

  _aPantalla(x, y) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [
      (x - this.vista.cx) * this.vista.escala + w / 2,
      h / 2 - (y - this.vista.cy) * this.vista.escala,
    ];
  }

  aMundo(px, py) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [
      (px - w / 2) / this.vista.escala + this.vista.cx,
      this.vista.cy - (py - h / 2) / this.vista.escala,
    ];
  }

  _eventos() {
    let arrastrando = false, px = 0, py = 0, movio = 0, inicioX = 0, inicioY = 0;
    this.canvas.addEventListener("mousedown", (e) => {
      arrastrando = true; movio = 0;
      px = inicioX = e.clientX; py = inicioY = e.clientY;
    });
    window.addEventListener("mouseup", (e) => {
      if (arrastrando && movio < 5 && this.modo === "lamina" && this.onClickMapa) {
        const r = this.canvas.getBoundingClientRect();
        const [x, y] = this.aMundo(e.clientX - r.left, e.clientY - r.top);
        this.onClickMapa(x, y);
      }
      arrastrando = false;
    });
    window.addEventListener("mousemove", (e) => {
      if (!arrastrando) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      movio = Math.max(movio, Math.abs(e.clientX - inicioX) + Math.abs(e.clientY - inicioY));
      px = e.clientX; py = e.clientY;
      if (this.modo === "mapa") {
        this.mapa.tx -= dx / 256;
        this.mapa.ty -= dy / 256;
        this.onMovimiento && this.onMovimiento();
      } else if (this.modo === "lamina") {
        this.vista.cx -= dx / this.vista.escala;
        this.vista.cy += dy / this.vista.escala;
      } else return;
      this.dibujar();
    });
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  _poligonos(ctx, polis, relleno, borde) {
    ctx.fillStyle = relleno;
    if (borde) ctx.strokeStyle = borde;
    ctx.lineWidth = 0.6;
    for (const anillos of polis) {
      ctx.beginPath();
      for (const an of anillos) {
        an.forEach(([x, y], i) => {
          const [sx, sy] = this._aPantalla(x, y);
          i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
        });
        ctx.closePath();
      }
      ctx.fill();
      if (borde) ctx.stroke();
    }
  }

  _lineas(ctx, lineas, color, ancho) {
    ctx.strokeStyle = color;
    ctx.lineWidth = ancho;
    ctx.beginPath();
    for (const l of lineas) {
      l.forEach(([x, y], i) => {
        const [sx, sy] = this._aPantalla(x, y);
        i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
      });
    }
    ctx.stroke();
  }

  dibujar() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORES.fondo;
    ctx.fillRect(0, 0, w, h);

    if (this.modo === "mapa") { this._dibujarMapa(ctx, w, h); return; }
    if (!this.capas) return;

    ctx.lineJoin = "round"; ctx.lineCap = "round";
    this._poligonos(ctx, this.capas.water, COLORES.agua);
    this._lineas(ctx, this.capas.waterways, COLORES.aguaLinea, 2);
    this._poligonos(ctx, this.capas.parks, COLORES.parque);
    this._poligonos(ctx, this.capas.squares, COLORES.plaza);
    this._poligonos(ctx, this.capas.buildings, COLORES.edificio, COLORES.edificioBorde);
    this._lineas(ctx, this.capas.roads, COLORES.calle, 1);
    this._lineas(ctx, this.capas.pednet, COLORES.peatonal, 0.8);

    if (this.flujo) this._dibujarFlujo(ctx);
    this._dibujarBarreras(ctx);
    this._dibujarAtractores(ctx);
    this._escalaGrafica(ctx, w, h);
    this._brujula(ctx, w);
  }

  _dibujarFlujo(ctx) {
    const { tipo, segmentos, p95 } = this.flujo;
    ctx.globalCompositeOperation = "lighter";
    const pasadas = [
      { k: 3.4, alfa: 0.10 },
      { k: 1.7, alfa: 0.30 },
      { k: 0.8, alfa: 0.85 },
    ];
    for (const p of pasadas) {
      for (const s of segmentos) {
        const t = Math.min(1, Math.abs(s.v) / p95);
        let r, g, b;
        if (tipo === "diff" && s.v < 0) [r, g, b] = COLORES.bajaFlujo;
        else [r, g, b] = colorFlujo(t);
        ctx.strokeStyle = `rgba(${r},${g},${b},${p.alfa * (0.35 + 0.65 * t)})`;
        ctx.lineWidth = (0.7 + 2.6 * t) * p.k;
        const [x1, y1] = this._aPantalla(s.x1, s.y1);
        const [x2, y2] = this._aPantalla(s.x2, s.y2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  _dibujarBarreras(ctx) {
    if (!this.barreras.length) return;
    ctx.save();
    ctx.strokeStyle = COLORES.barrera;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 5]);
    for (const s of this.barreras) {
      const [x1, y1] = this._aPantalla(s.x1, s.y1);
      const [x2, y2] = this._aPantalla(s.x2, s.y2);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      // aspas en el punto medio
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(mx - 4, my - 4); ctx.lineTo(mx + 4, my + 4);
      ctx.moveTo(mx - 4, my + 4); ctx.lineTo(mx + 4, my - 4);
      ctx.stroke();
      ctx.setLineDash([6, 5]);
    }
    ctx.restore();
  }

  _dibujarAtractores(ctx) {
    ctx.font = "10px Consolas, monospace";
    const ocupados = [];
    for (const a of this.atractores) {
      const [x, y] = this._aPantalla(a.x, a.y);
      ctx.fillStyle = ROL_COLOR[a.rol] || COLORES.atractor;
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(240,232,216,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke();

      const texto = a.nombre.toUpperCase();
      const ancho = ctx.measureText(texto).width;
      let ty = y + 3;
      const choca = () => ocupados.some((r) =>
        x + 11 < r.x + r.w && x + 11 + ancho > r.x && ty - 9 < r.y + 12 && ty + 3 > r.y);
      let intentos = 0;
      while (choca() && intentos++ < 8) ty += 13;
      ocupados.push({ x: x + 11, y: ty - 9, w: ancho });
      ctx.fillStyle = "rgba(240,232,216,0.88)";
      if (ty !== y + 3) {
        ctx.strokeStyle = "rgba(240,232,216,0.25)";
        ctx.beginPath(); ctx.moveTo(x + 7, y + 3); ctx.lineTo(x + 10, ty - 3); ctx.stroke();
      }
      ctx.fillText(texto, x + 11, ty);
    }
  }

  _escalaGrafica(ctx, w, h) {
    if (this.modo !== "lamina") return;
    const objetivoPx = 110;
    const metros = objetivoPx / this.vista.escala;
    const bonitos = [25, 50, 100, 250, 500, 1000, 2000, 5000];
    const m = bonitos.reduce((mej, b) => (Math.abs(b - metros) < Math.abs(mej - metros) ? b : mej), bonitos[0]);
    const px = m * this.vista.escala;
    const x0 = 20, y0 = h - 20;
    ctx.strokeStyle = "rgba(240,232,216,0.7)";
    ctx.fillStyle = "rgba(240,232,216,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 4);
    ctx.stroke();
    ctx.font = "10px Consolas, monospace";
    ctx.fillText(m >= 1000 ? (m / 1000) + " km" : m + " m", x0 + px / 2 - 12, y0 - 8);
  }

  _brujula(ctx, w) {
    ctx.font = "12px Consolas, monospace";
    ctx.fillStyle = "rgba(240,232,216,0.7)";
    ctx.fillText("N", w - 26, 30);
    ctx.strokeStyle = "rgba(240,232,216,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w - 21, 34); ctx.lineTo(w - 21, 18);
    ctx.moveTo(w - 25, 24); ctx.lineTo(w - 21, 18); ctx.lineTo(w - 17, 24);
    ctx.stroke();
  }

  exportarPNG(lineasMeta, nombreArchivo) {
    const src = this.canvas;
    const off = document.createElement("canvas");
    off.width = src.width; off.height = src.height;
    const ctx = off.getContext("2d");
    ctx.drawImage(src, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const h = src.clientHeight;
    ctx.font = "10px Consolas, monospace";
    ctx.fillStyle = "rgba(240,232,216,0.75)";
    lineasMeta.forEach((linea, i) => ctx.fillText(linea, 16, h - 34 - (lineasMeta.length - 1 - i) * 14));
    ctx.textAlign = "right";
    ctx.fillText("© OpenStreetMap contributors (ODbL) · UrbanFlow · modelo exploratorio", src.clientWidth - 16, h - 14);
    off.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nombreArchivo;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }
}
