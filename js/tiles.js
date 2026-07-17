// Teselas de mapa base (Web Mercator, esquema slippy z/x/y).
// Basemap oscuro de CARTO sobre datos OSM — atribución obligatoria en pantalla.

export const ATRIB_TILES = "© OpenStreetMap contributors · © CARTO";

export function urlTesela(z, x, y) {
  return `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
}

export function lonLatATesela(lon, lat, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * n,
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  ];
}

export function teselaALonLat(tx, ty, z) {
  const n = 2 ** z;
  const lon = (tx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lon, lat];
}

export function metrosPorPixel(lat, z) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}
