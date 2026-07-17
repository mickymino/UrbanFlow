# UrbanFlow

Motor de análisis urbano computacional en el navegador: simulación de flujos
peatonales de cualquier ciudad del mundo. Parte del **Computational Urbanism
Framework (CUF)** de Miguel — extensión del ecosistema de skills de
[Abhinav BWJ](https://github.com/Amanbh997).

**Demo pública:** https://mickymino.github.io/UrbanFlow/

## Qué hace

Simula flujos peatonales de cualquier ciudad del mundo, 100 % en el navegador
(sin servidor de cálculo):

1. **Ciudad** — buscador mundial (Nominatim) o el caso validado: Centro Histórico
   de Guayaquil.
2. **Área** — rectángulo de 500–3400 m de lado.
3. **Datos** — descarga OSM en vivo (Overpass API): calles, red peatonal, edificios,
   parques, agua, plazas y puntos de interés.
4. **Atractores** — orígenes/destinos propuestos automáticamente desde OSM, con pesos
   1–10 **editables** (el conocimiento local lo pone el usuario).
5. **Motor** — proxy origen-destino: rutas mínimas con ruido por cohortes sobre el
   grafo caminable real. Reproducible: misma semilla → mismo resultado.
6. **Lámina** — render estilo *computational urbanism* (trazos incandescentes
   crema→oro→rojo sobre fondo oscuro) con caja de metadatos, exportable a PNG +
   hoja de parámetros JSON.

## Honestidad del modelo

No es un ABM con colisiones: es un modelo de **asignación proxy OD**, defendible vía
space syntax (*Choice* correlaciona r=0.7–0.9 con conteos peatonales reales). Muestra
flujo simulado potencial, nunca conteos observados.

## Correr en local

Los módulos ES requieren un servidor (no funciona con doble clic en `index.html`):

```
python -m http.server 8801
# abrir http://localhost:8801
```

## Stack

Vanilla JS + Canvas 2D. Cero dependencias, cero build. APIs externas: Nominatim
(geocodificación) y Overpass (datos OSM).

## Datos y licencias

Datos: © OpenStreetMap contributors (ODbL). Geocodificación: Nominatim.
