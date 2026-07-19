// Motor de flujos Ruta A: proxy origen-destino con ruido por cohortes.
// Traducción fiel de flow_model.py (PyQGIS) a JS, extendida con:
//  - roles por atractor (origen | destino | ambos)
//  - barreras (aristas bloqueadas por el usuario → costo infinito)
//  - radio de influencia por atractor (limita el alcance de los pares OD)
//  - estadísticas por agente (distancia y tiempo de recorrido a 1.4 m/s)
//  - indicador de accesibilidad (% de la red alcanzable a X min desde los orígenes)
// Reproducible: misma semilla → mismo resultado. NIVEL DEL MODELO: EXPLORATORIO.

import { dijkstra, nodoMasCercano } from "./graph.js";

export const VEL_PEATON = 1.4; // m/s, velocidad peatonal estándar

export function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function muestreador(indices, pesos) {
  const acum = []; let total = 0;
  for (const i of indices) { total += pesos[i]; acum.push(total); }
  return (rng) => {
    const r = rng() * total;
    let lo = 0, hi = acum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (acum[mid] < r) lo = mid + 1; else hi = mid; }
    return indices[lo];
  };
}

export async function correrModelo({ grafo, atractores, params, barreras, onProgreso }) {
  const { semilla, agentes, ruido, cohortes } = params;
  const bloqueadas = barreras || new Set();
  const rng = mulberry32(semilla);

  // 1) amarrar atractores al grafo
  const amarres = atractores.map((a) => {
    const cerca = nodoMasCercano(grafo, a.x, a.y);
    return { ...a, nodo: cerca.id };
  });
  const pesos = amarres.map((a) => Math.max(1, a.peso | 0));
  const idxOrigenes = amarres.map((a, i) => i).filter((i) => amarres[i].rol !== "destino");
  const idxDestinos = amarres.map((a, i) => i).filter((i) => amarres[i].rol !== "origen");
  if (idxOrigenes.length < 1 || idxDestinos.length < 1 || amarres.length < 2)
    throw new Error("Se necesitan al menos 2 puntos activos (con algún origen y algún destino).");
  const elegirO = muestreador(idxOrigenes, pesos);
  const elegirD = muestreador(idxDestinos, pesos);

  // 2) pares OD por agente (reproducible con la semilla).
  //    El radio de influencia limita el alcance: pares más largos que la suma de
  //    radios de origen y destino se vuelven improbables (con tope de reintentos,
  //    para no dejar agentes sin viaje cuando hay un único destino posible).
  const cabeRadio = (o, d) => {
    const A = amarres[o], B = amarres[d];
    const alcance = (A.radio || 1e9) + (B.radio || 1e9);
    return Math.hypot(A.x - B.x, A.y - B.y) <= alcance;
  };
  const od = [];
  for (let i = 0; i < agentes; i++) {
    let o = elegirO(rng), d = elegirD(rng), intentos = 0;
    while ((d === o || !cabeRadio(o, d)) && intentos++ < 40) { o = elegirO(rng); d = elegirD(rng); }
    if (d === o) continue;
    od.push([o, d]);
  }

  // 3) por cohorte: costos perturbados (+ barreras a infinito) + dijkstra por origen
  const conteo = new Int32Array(grafo.m);
  let sinRuta = 0, sumaDist = 0, rutasOk = 0;

  for (let k = 0; k < cohortes; k++) {
    const rk = mulberry32(semilla * 1000 + k);
    const costos = new Float64Array(grafo.m);
    for (let e = 0; e < grafo.m; e++)
      costos[e] = bloqueadas.has(e) ? Infinity : grafo.longitud[e] * (1 + rk() * ruido);

    const agentesK = [];
    for (let i = k; i < od.length; i += cohortes) agentesK.push(od[i]);
    const origenes = [...new Set(agentesK.map(([o]) => o))];

    const arboles = new Map();
    for (const o of origenes) {
      arboles.set(o, dijkstra(grafo, amarres[o].nodo, costos));
      onProgreso((k + (origenes.indexOf(o) + 1) / origenes.length) / cohortes,
        `cohorte ${k + 1}/${cohortes}`);
      await new Promise((r) => setTimeout(r, 0));
    }

    for (const [o, d] of agentesK) {
      const arbol = arboles.get(o);
      let v = amarres[d].nodo;
      const origenNodo = amarres[o].nodo;
      if (!isFinite(arbol.dist[v])) { sinRuta++; continue; }
      let largo = 0, guardia = 0;
      while (v !== origenNodo && arbol.aristaPrevia[v] !== -1 && guardia++ < 200000) {
        const e = arbol.aristaPrevia[v];
        conteo[e]++;
        largo += grafo.longitud[e];
        v = arbol.nodoPrevio[v];
      }
      sumaDist += largo; rutasOk++;
    }
  }

  // 4) estadísticas e indicadores
  const valores = [];
  let sumaFlujo = 0, eTop = -1, maxFlujo = 0;
  for (let e = 0; e < grafo.m; e++) {
    if (conteo[e] > 0) {
      valores.push(conteo[e]); sumaFlujo += conteo[e];
      if (conteo[e] > maxFlujo) { maxFlujo = conteo[e]; eTop = e; }
    }
  }
  valores.sort((a, b) => a - b);
  const pct = (p) => (valores.length ? valores[Math.min(valores.length - 1, Math.floor(valores.length * p))] : 0);
  const distMedia = rutasOk ? sumaDist / rutasOk : 0;

  return {
    conteo,
    stats: {
      aristasConFlujo: valores.length,
      max: maxFlujo,
      p95: pct(0.95),
      p90: pct(0.9),
      mediana: pct(0.5),
      flujoProm: valores.length ? sumaFlujo / valores.length : 0,
      distMediaM: distMedia,
      tiempoMedioMin: distMedia / VEL_PEATON / 60,
      tramoTop: eTop >= 0
        ? { nombre: grafo.aristas[eTop].nombre || "(tramo sin nombre)", flujo: maxFlujo }
        : null,
      sinRuta,
      rutasOk,
    },
    amarres,
  };
}

// Accesibilidad: % de nodos de la red alcanzables a <= minutos desde los orígenes
// activos, caminando a 1.4 m/s por la red real (con barreras aplicadas).
export function accesibilidad(grafo, nodosOrigen, barreras, minutos = 10) {
  const limite = minutos * 60 * VEL_PEATON;
  const bloqueadas = barreras || new Set();
  const costos = new Float64Array(grafo.m);
  for (let e = 0; e < grafo.m; e++)
    costos[e] = bloqueadas.has(e) ? Infinity : grafo.longitud[e];
  const minDist = new Float64Array(grafo.n).fill(Infinity);
  for (const nodo of nodosOrigen) {
    const { dist } = dijkstra(grafo, nodo, costos);
    for (let i = 0; i < grafo.n; i++) if (dist[i] < minDist[i]) minDist[i] = dist[i];
  }
  let alcanzables = 0;
  for (let i = 0; i < grafo.n; i++) if (minDist[i] <= limite) alcanzables++;
  return grafo.n ? (100 * alcanzables) / grafo.n : 0;
}
