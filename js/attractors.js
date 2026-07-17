// Propuesta automática de atractores desde los POIs de OSM, con pesos por tipo.
// Los pesos son SIEMPRE editables: el conocimiento local lo pone el usuario.

const REGLAS = [
  { cond: (t) => t.amenity === "marketplace", tipo: "mercado", peso: 9 },
  { cond: (t) => t.railway === "station" || t.amenity === "bus_station", tipo: "estacion", peso: 9 },
  { cond: (t) => t.place === "square", tipo: "plaza", peso: 8 },
  { cond: (t) => t.leisure === "park", tipo: "parque", peso: 7 },
  { cond: (t) => t.shop === "mall", tipo: "comercio", peso: 7 },
  { cond: (t) => t.amenity === "university", tipo: "universidad", peso: 7 },
  { cond: (t) => t.tourism === "museum" || t.tourism === "attraction", tipo: "hito", peso: 6 },
  { cond: (t) => t.amenity === "townhall", tipo: "institucion", peso: 6 },
];

export function proponerAtractores(pois, maximo = 14) {
  const candidatos = [];
  for (const poi of pois) {
    const t = poi.tags || {};
    for (const regla of REGLAS) {
      if (regla.cond(t)) {
        candidatos.push({
          nombre: t.name || `(${regla.tipo} sin nombre)`,
          tipo: regla.tipo,
          peso: regla.peso,
          lon: poi.lon,
          lat: poi.lat,
          activo: true,
        });
        break;
      }
    }
  }

  // dedupe por nombre+proximidad (~80 m) y priorizar por peso
  candidatos.sort((a, b) => b.peso - a.peso);
  const elegidos = [];
  for (const c of candidatos) {
    const dup = elegidos.some(
      (e) =>
        (e.nombre === c.nombre && c.nombre !== "") ||
        (Math.abs(e.lat - c.lat) < 0.0007 && Math.abs(e.lon - c.lon) < 0.0007)
    );
    if (!dup) elegidos.push(c);
    if (elegidos.length >= maximo) break;
  }
  return elegidos;
}
