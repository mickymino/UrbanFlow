// Motor de flujos Ruta A: proxy origen-destino con ruido por cohortes.
// Traducción fiel de flow_model.py (PyQGIS) a JS: N agentes con OD muestreado por peso,
// K cohortes con costos perturbados (len * (1 + U(0, ruido))), dijkstra por origen,
// conteo de pasadas por arista. Reproducible: misma semilla -> mismo resultado.

import { dijkstra, nodoMasCercano } from "./graph.js";

export function mulberry32(semilla) {
  let a = semilla >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function eleccionPonderada(rng, acumulados, total) {
  const r = rng() * total;
  let lo = 0, hi = acumulados.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (acumulados[mid] < r) lo = mid + 1; else hi = mid;
  }
  return lo;
}

export async function correrModelo({ grafo, atractores, params, onProgreso }) {
  const { semilla, agentes, ruido, cohortes } = params;
  const rng = mulberry32(semilla);

  // 1) amarrar atractores al grafo
  const amarres = atractores.map((a) => {
    const cerca = nodoMasCercano(grafo, a.x, a.y);
    return { ...a, nodo: cerca.id, distAmarre: cerca.dist };
  });
  if (amarres.length < 4) throw new Error("Se necesitan al menos 4 atractores activos.");

  const pesos = amarres.map((a) => Math.max(1, a.peso | 0));
  const acumulados = [];
  let total = 0;
  for (const p of pesos) { total += p; acumulados.push(total); }

  // 2) pares OD por agente (reproducible con la semilla)
  const od = [];
  for (let i = 0; i < agentes; i++) {
    const o = eleccionPonderada(rng, acumulados, total);
    let d = o;
    while (d === o) d = eleccionPonderada(rng, acumulados, total);
    od.push([o, d]);
  }

  // 3) por cohorte: costos perturbados + dijkstra por origen usado
  const conteo = new Int32Array(grafo.m);
  let sinRuta = 0;

  for (let k = 0; k < cohortes; k++) {
    const rk = mulberry32(semilla * 1000 + k);
    const costos = new Float64Array(grafo.m);
    for (let e = 0; e < grafo.m; e++) costos[e] = grafo.longitud[e] * (1 + rk() * ruido);

    const agentesK = [];
    for (let i = k; i < od.length; i += cohortes) agentesK.push(od[i]);
    const origenes = [...new Set(agentesK.map(([o]) => o))];

    const arboles = new Map();
    for (const o of origenes) {
      arboles.set(o, dijkstra(grafo, amarres[o].nodo, costos));
      onProgreso((k + origenes.indexOf(o) / origenes.length) / cohortes,
        `cohorte ${k + 1}/${cohortes}`);
      await new Promise((r) => setTimeout(r, 0)); // ceder al UI
    }

    for (const [o, d] of agentesK) {
      const arbol = arboles.get(o);
      let v = amarres[d].nodo;
      const origenNodo = amarres[o].nodo;
      if (!isFinite(arbol.dist[v])) { sinRuta++; continue; }
      let guardia = 0;
      while (v !== origenNodo && arbol.aristaPrevia[v] !== -1 && guardia++ < 200000) {
        conteo[arbol.aristaPrevia[v]]++;
        v = arbol.nodoPrevio[v];
      }
    }
  }

  // 4) estadísticas
  const valores = [];
  for (let e = 0; e < grafo.m; e++) if (conteo[e] > 0) valores.push(conteo[e]);
  valores.sort((a, b) => a - b);
  const pct = (p) => (valores.length ? valores[Math.min(valores.length - 1, Math.floor(valores.length * p))] : 0);

  return {
    conteo,
    stats: {
      aristasConFlujo: valores.length,
      max: valores.length ? valores[valores.length - 1] : 0,
      p95: pct(0.95),
      p90: pct(0.9),
      mediana: pct(0.5),
      sinRuta,
    },
    amarres,
  };
}
