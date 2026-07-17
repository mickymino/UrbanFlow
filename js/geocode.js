// Búsqueda de ciudades vía Nominatim (OpenStreetMap). Uso ligero conforme a su política.

export async function buscarCiudad(texto) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=" +
    encodeURIComponent(texto);
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("Nominatim respondió " + r.status);
  const datos = await r.json();
  return datos.map((d) => ({
    nombre: d.display_name,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
    tipo: d.type,
  }));
}
