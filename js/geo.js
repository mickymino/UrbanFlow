// Proyección local equirectangular en metros (suficiente para áreas de 1-4 km).
// x crece al este, y crece al norte, origen en el centro del área de estudio.

export function crearProyector(lat0, lon0) {
  const mLat = 110574;
  const mLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    lat0, lon0, mLat, mLon,
    aXY(lon, lat) { return [(lon - lon0) * mLon, (lat - lat0) * mLat]; },
    aLonLat(x, y) { return [lon0 + x / mLon, lat0 + y / mLat]; },
  };
}

// bbox {s,w,n,e} en grados WGS84 a partir de centro + lado en metros
export function bboxDesdeCentro(lat, lon, ladoM) {
  const mLat = 110574;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const dLat = ladoM / 2 / mLat;
  const dLon = ladoM / 2 / mLon;
  return { s: lat - dLat, w: lon - dLon, n: lat + dLat, e: lon + dLon };
}

export function centroDeBbox(b) {
  return { lat: (b.s + b.n) / 2, lon: (b.w + b.e) / 2 };
}

export function ladoDeBbox(b) {
  const mLat = 110574;
  return Math.round((b.n - b.s) * mLat);
}
