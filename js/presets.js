// Caso validado de referencia: Centro Histórico de Guayaquil.
// Datos del parametros.md del sitio CentroHistorico_GYE (CUF, corrida 2026-07-12):
// bbox de descarga y los 7 atractores con pesos revisados (conocimiento local de Miguel).
// rol: origen | destino | ambos (el proxy OD histórico usaba todos como ambos).

export const DEMO_GYE = {
  nombre: "Guayaquil, Ecuador — Centro Histórico (caso validado CUF)",
  bbox: { s: -2.208, w: -79.901, n: -2.179, e: -79.867 },
  atractores: [
    { nombre: "Espacio publico",                    tipo: "espacio_publico", rol: "ambos", peso: 7, lon: -79.875862, lat: -2.184069, activo: true },
    { nombre: "Plaza de la Administracion",         tipo: "espacio_publico", rol: "ambos", peso: 8, lon: -79.881135, lat: -2.194787, activo: true },
    { nombre: "Parque Centenario",                  tipo: "parque",          rol: "ambos", peso: 8, lon: -79.887675, lat: -2.190014, activo: true },
    { nombre: "Parque Seminario",                   tipo: "parque",          rol: "ambos", peso: 6, lon: -79.883185, lat: -2.194694, activo: true },
    { nombre: "Areas verdes Malecon Simon Bolivar", tipo: "parque",          rol: "ambos", peso: 7, lon: -79.878683, lat: -2.190448, activo: true },
    { nombre: "Jardines del Malecon",               tipo: "parque",          rol: "ambos", peso: 8, lon: -79.877425, lat: -2.187678, activo: true },
    { nombre: "La Bahia",                           tipo: "mercado",         rol: "ambos", peso: 9, lon: -79.8838,   lat: -2.1986,   activo: true },
  ],
  params: { semilla: 42, agentes: 2048, ruido: 0.25, cohortes: 8 },
};
