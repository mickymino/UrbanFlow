// Grafo caminable: calles + red peatonal fusionadas (equivalente al paso 1 de flow_model.py).
// Nodos por redondeo a 0.5 m; aristas = pares de vértices consecutivos; CSR + dijkstra con heap.

export function construirGrafo(capasLineas, proyector) {
  const nodos = [];            // [x, y] en metros
  const indice = new Map();    // clave redondeada -> id de nodo
  const aristas = [];          // {a, b, len}

  function nodo(x, y) {
    const clave = (Math.round(x * 2)) + "," + (Math.round(y * 2));
    let id = indice.get(clave);
    if (id === undefined) {
      id = nodos.length;
      nodos.push([x, y]);
      indice.set(clave, id);
    }
    return id;
  }

  for (const capa of capasLineas) {
    for (const linea of capa) {
      let prev = null;
      for (const [lon, lat] of linea.coords) {
        const [x, y] = proyector.aXY(lon, lat);
        const id = nodo(x, y);
        if (prev !== null && prev !== id) {
          const [x1, y1] = nodos[prev];
          const len = Math.hypot(x - x1, y - y1);
          if (len > 0.01) aristas.push({ a: prev, b: id, len });
        }
        prev = id;
      }
    }
  }

  // CSR bidireccional
  const n = nodos.length, m = aristas.length;
  const grado = new Int32Array(n);
  for (const e of aristas) { grado[e.a]++; grado[e.b]++; }
  const offset = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) offset[i + 1] = offset[i] + grado[i];
  const destino = new Int32Array(2 * m);
  const idArista = new Int32Array(2 * m);
  const cursor = offset.slice(0, n);
  for (let e = 0; e < m; e++) {
    const { a, b } = aristas[e];
    destino[cursor[a]] = b; idArista[cursor[a]++] = e;
    destino[cursor[b]] = a; idArista[cursor[b]++] = e;
  }
  const longitud = new Float64Array(m);
  for (let e = 0; e < m; e++) longitud[e] = aristas[e].len;

  return { nodos, aristas, longitud, offset, destino, idArista, n, m };
}

export function nodoMasCercano(grafo, x, y) {
  let mejor = -1, mejorD = Infinity;
  for (let i = 0; i < grafo.n; i++) {
    const dx = grafo.nodos[i][0] - x, dy = grafo.nodos[i][1] - y;
    const d = dx * dx + dy * dy;
    if (d < mejorD) { mejorD = d; mejor = i; }
  }
  return { id: mejor, dist: Math.sqrt(mejorD) };
}

// Dijkstra con heap binario y costos por arista dados (Float64Array de tamaño m).
// Devuelve {aristaPrevia, nodoPrevio} para reconstruir rutas.
export function dijkstra(grafo, origen, costos) {
  const { n, offset, destino, idArista } = grafo;
  const dist = new Float64Array(n).fill(Infinity);
  const aristaPrevia = new Int32Array(n).fill(-1);
  const nodoPrevio = new Int32Array(n).fill(-1);
  dist[origen] = 0;

  // heap binario: arrays paralelos (distancia, nodo), con entradas obsoletas descartadas
  const hd = [0], hn = [origen];
  const sube = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= hd[i]) break;
      [hd[p], hd[i]] = [hd[i], hd[p]]; [hn[p], hn[i]] = [hn[i], hn[p]]; i = p;
    }
  };
  const baja = () => {
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let mn = i;
      if (l < hd.length && hd[l] < hd[mn]) mn = l;
      if (r < hd.length && hd[r] < hd[mn]) mn = r;
      if (mn === i) break;
      [hd[mn], hd[i]] = [hd[i], hd[mn]]; [hn[mn], hn[i]] = [hn[i], hn[mn]]; i = mn;
    }
  };

  while (hd.length) {
    const d = hd[0], u = hn[0];
    const ud = hd.pop(), un = hn.pop();
    if (hd.length) { hd[0] = ud; hn[0] = un; baja(); }
    if (d > dist[u]) continue;
    for (let k = offset[u]; k < offset[u + 1]; k++) {
      const v = destino[k], e = idArista[k];
      const nd = d + costos[e];
      if (nd < dist[v]) {
        dist[v] = nd;
        aristaPrevia[v] = e;
        nodoPrevio[v] = u;
        hd.push(nd); hn.push(v); sube(hd.length - 1);
      }
    }
  }
  return { dist, aristaPrevia, nodoPrevio };
}
