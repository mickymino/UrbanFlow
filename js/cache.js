// Caché local de descargas OSM (IndexedDB): el mismo bbox no se vuelve a pedir a
// Overpass durante 7 días. Falla en silencio (si no hay IndexedDB, simplemente no cachea).

const DB = "urbanflow", STORE = "osm";
export const TTL_MS = 7 * 24 * 3600 * 1000;

function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function cacheGet(clave) {
  try {
    const db = await abrir();
    return await new Promise((res) => {
      const t = db.transaction(STORE).objectStore(STORE).get(clave);
      t.onsuccess = () => res(t.result || null);
      t.onerror = () => res(null);
    });
  } catch { return null; }
}

export async function cacheSet(clave, valor) {
  try {
    const db = await abrir();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(valor, clave);
  } catch { /* sin caché, sin drama */ }
}
