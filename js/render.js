// Renderizador Canvas 2D con la estética de lámina "computational urbanism":
// fondo oscuro, base cartográfica tenue, flujos incandescentes crema→oro→naranja→rojo
// con glow por composición aditiva, atractores anotados.

const COLORES = {
  fondo: "#241c18",
  agua: "#1a2126",
  aguaLinea: "#243038",
  parque: "#2b2a1f",
  plaza: "#2e2620",
  edificio: "#33291f",
  edificioBorde: "rgba(240,232,216,0.10)",
  calle: "rgba(214,197,171,0.14)",
  peatonal: "rgba(214,197,171,0.22)",
  atractor: "#f0e8d8",
};

// rampa crema -> oro -> naranja -> rojo (t en [0,1])
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
      const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return c;
    }
  }
  return stops[stops.length - 1][1];
}

export class Renderizador {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.vista = { cx: 0, cy: 0, escala: 1 };
    this.capas = null;      // geometrías ya proyectadas a metros
    this.flujo = null;      // {segmentos:[{x1,y1,x2,y2,v}], p95}
    this.atractores = [];
    this._eventos();
    new ResizeObserver(() => this.dibujar()).observe(canvas);
  }

  fijarCapas(capas, proyector, bbox) {
    const P = (anillos) => anillos.map((an) => an.map(([lon, lat]) => proyector.aXY(lon, lat)));
    const L = (lineas) => lineas.map((l) => l.coords.map(([lon, lat]) => proyector.aXY(lon, lat)));
    this.capas = {
      buildings: capas.buildings.map((b) => P(b.anillos)),
      parks: capas.parks.map((b) => P(b.anillos)),
      water: capas.water.map((b) => P(b.anillos)),
      squares: capas.squares.map((b) => P(b.anillos)),
      roads: L(capas.roads),
      pednet: L(capas.pednet),
      waterways: L(capas.waterways),
    };
    const [x1, y1] = proyector.aXY(bbox.w, bbox.s);
    const [x2, y2] = proyector.aXY(bbox.e, bbox.n);
    this.limites = { x1, y1, x2, y2 };
    this.encuadrar();
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
    segmentos.sort((s, t) => s.v - t.v); // los intensos se dibujan encima
    this.flujo = { segmentos, p95: Math.max(1, p95) };
  }

  fijarAtractores(lista, proyector) {
    this.atractores = lista.filter((a) => a.activo).map((a) => {
      const [x, y] = proyector.aXY(a.lon, a.lat);
      return { ...a, x, y };
    });
  }

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

  _eventos() {
    let arrastrando = false, px = 0, py = 0;
    this.canvas.addEventListener("mousedown", (e) => { arrastrando = true; px = e.clientX; py = e.clientY; });
    window.addEventListener("mouseup", () => (arrastrando = false));
    window.addEventListener("mousemove", (e) => {
      if (!arrastrando) return;
      this.vista.cx -= (e.clientX - px) / this.vista.escala;
      this.vista.cy += (e.clientY - py) / this.vista.escala;
      px = e.clientX; py = e.clientY;
      this.dibujar();
    });
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.vista.escala *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this.dibujar();
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
    this._dibujarAtractores(ctx);
  }

  _dibujarFlujo(ctx) {
    const { segmentos, p95 } = this.flujo;
    ctx.globalCompositeOperation = "lighter";
    // tres pasadas: halo ancho tenue, cuerpo, núcleo brillante
    const pasadas = [
      { k: 3.4, alfa: 0.10 },
      { k: 1.7, alfa: 0.30 },
      { k: 0.8, alfa: 0.85 },
    ];
    for (const p of pasadas) {
      for (const s of segmentos) {
        const t = Math.min(1, s.v / p95);
        const [r, g, b] = colorFlujo(t);
        ctx.strokeStyle = `rgba(${r},${g},${b},${p.alfa * (0.35 + 0.65 * t)})`;
        ctx.lineWidth = (0.7 + 2.6 * t) * p.k;
        const [x1, y1] = this._aPantalla(s.x1, s.y1);
        const [x2, y2] = this._aPantalla(s.x2, s.y2);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  _dibujarAtractores(ctx) {
    ctx.font = "10px Consolas, monospace";
    const ocupados = []; // rectángulos de etiquetas ya puestas (anti-colisión simple)
    for (const a of this.atractores) {
      const [x, y] = this._aPantalla(a.x, a.y);
      ctx.fillStyle = COLORES.atractor;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(240,232,216,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 7); ctx.stroke();

      const texto = a.nombre.toUpperCase();
      const ancho = ctx.measureText(texto).width;
      let ty = y + 3;
      const choca = () => ocupados.some((r) =>
        x + 10 < r.x + r.w && x + 10 + ancho > r.x && ty - 9 < r.y + 12 && ty + 3 > r.y);
      let intentos = 0;
      while (choca() && intentos++ < 8) ty += 13;
      ocupados.push({ x: x + 10, y: ty - 9, w: ancho });
      ctx.fillStyle = "rgba(240,232,216,0.85)";
      if (ty !== y + 3) { // línea guía cuando la etiqueta se desplaza
        ctx.strokeStyle = "rgba(240,232,216,0.25)";
        ctx.beginPath(); ctx.moveTo(x + 6, y + 3); ctx.lineTo(x + 9, ty - 3); ctx.stroke();
      }
      ctx.fillText(texto, x + 10, ty);
    }
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
    lineasMeta.forEach((linea, i) => ctx.fillText(linea, 16, h - 14 - (lineasMeta.length - 1 - i) * 14));
    ctx.textAlign = "right";
    ctx.fillText("© OpenStreetMap contributors (ODbL) · CUF proxy OD", src.clientWidth - 16, h - 14);
    off.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = nombreArchivo;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  }
}
