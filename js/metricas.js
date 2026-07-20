// Métricas del panel de resultados de UrbanFlow.
// Todas se derivan del modelo. Ninguna inventa precisión que el modelo no tiene:
// el nivel sigue siendo EXPLORATORIO y las unidades, pasos por tramo.

/* ==================== MÉTRICAS DEL PANEL ==================== */
// Métricas del panel de resultados (Power BI style).
// Todas se derivan del modelo actual. Ninguna inventa precisión que el modelo
// no tiene: el nivel sigue siendo EXPLORATORIO y las unidades, pasos por tramo.

/* Itera los vecinos de un nodo en cualquiera de las dos formas de grafo:
   CSR (offset/destino/idArista, usado en el repo) o lista de adyacencia
   (vecinos, usada en la vista previa). */
function paraCadaVecino(grafo, u, fn) {
  if (grafo.vecinos) { for (const [v, e] of grafo.vecinos[u]) fn(v, e); return; }
  for (let k = grafo.offset[u]; k < grafo.offset[u + 1]; k++) fn(grafo.destino[k], grafo.idArista[k]);
}

/* ---------- 1. Cobertura peatonal por SUPERFICIE ----------
   No es "% de la red alcanzable" (que es un conteo de nodos), sino el área
   urbana efectivamente cubierta: se rasteriza el área de estudio en celdas y
   se marca cada celda que quede a menos de RADIO_CELDA de un nodo alcanzable
   dentro del tiempo dado. Es la lectura urbanística correcta de "cobertura". */
const RADIO_COBERTURA = 100;  // m: distancia máxima de una celda a la red alcanzada
const LADO_CELDA = 40;        // m: resolución del ráster

export function coberturaSuperficie(grafo, distMin, minutos, vel, extent) {
  const limite = minutos * 60 * vel;
  const { x0, y0, x1, y1 } = extent;
  const nx = Math.max(1, Math.ceil((x1 - x0) / LADO_CELDA));
  const ny = Math.max(1, Math.ceil((y1 - y0) / LADO_CELDA));
  // Referencia: la superficie servible es la que está a menos de RADIO_COBERTURA
  // de CUALQUIER punto de la red (no todo el rectángulo, que incluye vacíos).
  const cubierta = new Uint8Array(nx * ny);
  const r = Math.ceil(RADIO_COBERTURA / LADO_CELDA);
  for (let i = 0; i < grafo.n; i++) {
    if (!(distMin[i] <= limite)) continue;
    const [px, py] = grafo.nodos[i];
    const cx = Math.floor((px - x0) / LADO_CELDA), cy = Math.floor((py - y0) / LADO_CELDA);
    for (let dy = -r; dy <= r; dy++) {
      const gy = cy + dy; if (gy < 0 || gy >= ny) continue;
      for (let dx = -r; dx <= r; dx++) {
        const gx = cx + dx; if (gx < 0 || gx >= nx) continue;
        if (dx * dx + dy * dy > r * r) continue;
        cubierta[gy * nx + gx] = 1;
      }
    }
  }
  // denominador: celdas servibles por la red completa (sin límite de tiempo)
  const servible = new Uint8Array(nx * ny);
  for (let i = 0; i < grafo.n; i++) {
    const [px, py] = grafo.nodos[i];
    const cx = Math.floor((px - x0) / LADO_CELDA), cy = Math.floor((py - y0) / LADO_CELDA);
    for (let dy = -r; dy <= r; dy++) {
      const gy = cy + dy; if (gy < 0 || gy >= ny) continue;
      for (let dx = -r; dx <= r; dx++) {
        const gx = cx + dx; if (gx < 0 || gx >= nx) continue;
        if (dx * dx + dy * dy > r * r) continue;
        servible[gy * nx + gx] = 1;
      }
    }
  }
  let n = 0, tot = 0;
  for (let i = 0; i < cubierta.length; i++) { n += cubierta[i]; tot += servible[i]; }
  return tot ? (100 * n) / tot : 0;
}

/* ---------- 2. Conectividad de la red ----------
   Componentes conexos por búsqueda en anchura sobre el CSR. Detecta el caso
   silencioso más peligroso: una red OSM fragmentada da resultados falsos. */
export function conectividad(grafo, bloqueadas) {
  const n = grafo.n;
  const bloq = bloqueadas || new Set();
  const comp = new Int32Array(n).fill(-1);
  let nComp = 0, mayor = 0;
  const cola = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    let ini = 0, fin = 0;
    cola[fin++] = s; comp[s] = nComp; let tam = 1;
    while (ini < fin) {
      const u = cola[ini++];
      paraCadaVecino(grafo, u, (v, e) => {
        if (bloq.has(e) || comp[v] !== -1) return;
        comp[v] = nComp; cola[fin++] = v; tam++;
      });
    }
    if (tam > mayor) mayor = tam;
    nComp++;
  }
  return {
    componentes: nComp,
    mayor,
    pctMayor: n ? (100 * mayor) / n : 0,   // % de la red en el componente principal
    aislados: n - mayor,
  };
}

/* ---------- 3. Concentración del flujo (Gini) ----------
   0 = flujo repartido por igual entre tramos; 1 = todo el flujo en un tramo.
   En urbanismo: cuán canalizada está la demanda peatonal. */
export function concentracion(conteo, m) {
  const v = [];
  for (let e = 0; e < m; e++) if (conteo[e] > 0) v.push(conteo[e]);
  if (v.length < 2) return { gini: 0, tramosConFlujo: v.length, pct20: 0 };
  v.sort((a, b) => a - b);
  let suma = 0, acum = 0;
  for (const x of v) suma += x;
  for (let i = 0; i < v.length; i++) acum += (i + 1) * v[i];
  const gini = (2 * acum) / (v.length * suma) - (v.length + 1) / v.length;
  // % del flujo que pasa por el 20 % de tramos más cargados
  const corte = Math.max(1, Math.floor(v.length * 0.2));
  let top = 0;
  for (let i = v.length - corte; i < v.length; i++) top += v[i];
  return { gini: Math.max(0, gini), tramosConFlujo: v.length, pct20: (100 * top) / suma };
}

/* ---------- 4. Intersección de mayor paso ----------
   El modelo cuenta pasos por TRAMO (arista). El "nodo más transitado" honesto
   es la intersección cuyos tramos incidentes suman más paso. */
export function interseccionTop(grafo, conteo) {
  // Suma de paso por nodo (solo intersecciones reales: grado >= 3).
  // El índice de jerarquía es RELATIVO a la propia red: cuánto sobresale la
  // intersección principal sobre las que YA tienen paso elevado (P95). Un umbral
  // absoluto no sirve, porque el valor depende del tamaño del área analizada.
  const sumas = [];
  let mejor = -1, mejorV = 0;
  for (let i = 0; i < grafo.n; i++) {
    let s = 0, grado = 0;
    paraCadaVecino(grafo, i, (v, e) => { s += conteo[e]; grado++; });
    if (grado < 3) continue;
    if (s > 0) sumas.push(s);          // solo intersecciones con actividad
    if (s > mejorV) { mejorV = s; mejor = i; }
  }
  if (mejor < 0) return null;
  sumas.sort((a, b) => a - b);
  const p95 = sumas.length ? sumas[Math.min(sumas.length - 1, Math.floor(sumas.length * 0.95))] : 0;
  const razon = p95 > 0 ? mejorV / p95 : 1;

  // Ubicación: 1) nombre de ambas calles; 2) si no hay nombres, el nodo.
  const nombres = new Set();
  paraCadaVecino(grafo, mejor, (v, e) => { const nm = grafo.aristas[e].nombre; if (nm) nombres.add(nm); });
  const calles = [...nombres].slice(0, 2);
  const ubicacion = calles.length >= 2 ? calles.join(" × ")
    : calles.length === 1 ? calles[0]
    : "Nodo " + mejor;
  return { nodo: mejor, pasos: mejorV, calles, ubicacion, razon };
}

/* ---------- 5. Distribución del flujo por destino ----------
   Reparte las rutas realmente trazadas entre los destinos que las recibieron. */
export function distribucionDestinos(porDestino, amarres) {
  const total = porDestino.reduce((a, b) => a + b, 0);
  if (!total) return [];
  // Array.from: porDestino es un Int32Array y su .map devolvería otro Int32Array,
  // truncando los objetos a ceros.
  return Array.from(porDestino, (v, i) =>
      ({ nombre: amarres[i].nombre, rol: amarres[i].rol, viajes: v, pct: (100 * v) / total }))
    .filter((d) => d.viajes > 0)
    .sort((a, b) => b.pct - a.pct);
}

/* ---------- 6. Índice de estado del escenario ----------
   Combina (a) accesibilidad y conectividad, y (b) concentración del flujo.
   Deliberadamente simple y explicable: cada componente aporta 0-1 y el
   diagnóstico dice cuál es el factor determinante. NO es una medida de
   exactitud del modelo, sino de la situación que describe el escenario. */
export function indiceEstado({ acc10, conect, conc }) {
  // El índice usa EXACTAMENTE los mismos umbrales que las tarjetas de indicador,
  // para que nunca se contradigan: un 5 en la escala de la tarjeta = 1.0 aquí.
  // Escalas de desempeño (Excelente=1 · Alta=0,8 · Moderada=0,6 · Baja=0,35 · Deficiente=0,1)
  const puntua=(v,cortes)=>{               // cortes de mayor a menor, como en las tarjetas
    const [c1,c2,c3,c4]=cortes;
    return v>=c1?1:v>=c2?0.8:v>=c3?0.6:v>=c4?0.35:0.1;
  };
  const puntuaInv=(v,cortes)=>{            // menor es mejor (tiempo, distancia)
    const [c1,c2,c3,c4]=cortes;
    return v<=c1?1:v<=c2?0.8:v<=c3?0.6:v<=c4?0.35:0.1;
  };
  const sAcc = puntua(acc10, [90, 75, 60, 40]);              // = escala de Accesibilidad
  const sCon = puntua(conect.pctMayor, [95, 80, 60, 40]);    // = escala de Conectividad

  // La concentración es DESCRIPTIVA: no se juzga (una centralidad consolidada no
  // es un defecto). Por eso ya no entra en el índice; este mide solo desempeño.
  const valor = 0.5 * sAcc + 0.5 * sCon;

  // Cortes alineados con las etiquetas: dos indicadores en "Alta" (0,8) es Óptimo;
  // en "Moderada" (0,6) es Moderado; por debajo, Crítico.
  let estado = valor >= 0.75 ? "optimo" : valor >= 0.5 ? "moderado" : "critico";
  // El resumen nunca puede ser mejor que el peor de sus indicadores: si una
  // tarjeta está en ámbar o peor, el escenario no se reporta como óptimo.
  const peorPunt = Math.min(sAcc, sCon);
  if (peorPunt <= 0.6 && estado === "optimo") estado = "moderado";
  if (peorPunt <= 0.35 && estado !== "critico") estado = "critico";

  const peor = sAcc <= sCon ? "accesibilidad" : "conectividad";
  return { valor, estado, peor, sAcc, sCon };
}

export function diagnostico({ ind, acc10, conect, conc, stats }) {
  // Usa los mismos cortes que las tarjetas; primero lo que limita el escenario.
  const criticos = [], notas = [];
  if (conect.pctMayor < 60)
    criticos.push(`la red está muy fragmentada (${conect.pctMayor.toFixed(0)} % en el componente principal)`);
  else if (conect.pctMayor < 80)
    criticos.push(`hay sectores desconectados que reducen la continuidad (${conect.aislados} nodos aislados)`);
  if (stats.sinRuta > 0)
    criticos.push(`${stats.sinRuta} viajes no encontraron ruta`);
  if (acc10 < 40)
    criticos.push(`la cobertura peatonal es reducida (${acc10.toFixed(0)} % de la red a 10 min)`);
  else if (acc10 < 60)
    criticos.push(`parte de la red exige recorridos prolongados (${acc10.toFixed(0)} % alcanzable a 10 min)`);

  if (acc10 >= 90) notas.push(`la red se alcanza casi por completo caminando (${acc10.toFixed(0)} %)`);
  else if (acc10 >= 75) notas.push(`buena cobertura peatonal (${acc10.toFixed(0)} % a 10 min)`);
  if (conect.pctMayor >= 95) notas.push("estructura prácticamente continua");
  else if (conect.pctMayor >= 80) notas.push("la mayor parte de la red está conectada");
  // La concentración se menciona como descripción del patrón, nunca como defecto.
  if (conc.gini >= 0.68) notas.push(`la movilidad depende de pocos corredores (20 % de tramos = ${conc.pct20.toFixed(0)} % del flujo)`);
  else if (conc.gini >= 0.55) notas.push("la actividad se concentra en ejes estructurantes");

  const partes = criticos.length ? criticos.slice(0, 2) : notas.slice(0, 2);
  const cab = { optimo: "Escenario equilibrado", moderado: "Escenario con tensiones", critico: "Escenario crítico" }[ind.estado];
  return cab + ": " + (partes.join("; ") || "sin anomalías destacables") + ".";
}

/* ---------- 7. Madurez del análisis ----------
   Sustituye al "nivel de confianza" pedido: el modelo NO está calibrado, así que
   un porcentaje de confianza sería inventado. Esto mide, con honestidad, cuántas
   condiciones de un análisis sólido se cumplen. */
export function madurez({ conect, atractores, stats, params, calibrado }) {
  const items = [
    { k: "Red conectada (≥95 % en un componente)", ok: conect.pctMayor >= 95 },
    { k: "Al menos 2 destinos activos", ok: atractores.filter((a) => a.activo && a.rol !== "origen").length >= 2 },
    { k: "Todos los viajes con ruta", ok: stats.sinRuta === 0 },
    { k: "Muestra suficiente (≥1000 viajes)", ok: params.agentes >= 1000 },
    { k: "Variabilidad de rutas activada", ok: params.ruido > 0 && params.cohortes > 1 },
    { k: "Calibrado con conteos observados", ok: !!calibrado },
  ];
  const n = items.filter((i) => i.ok).length;
  return { items, cumplidos: n, total: items.length, pct: (100 * n) / items.length };
}

