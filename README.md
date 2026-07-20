# UrbanFlow

Motor de análisis urbano computacional en el navegador: simulación de flujos
peatonales de cualquier ciudad del mundo. Parte del **Computational Urbanism
Framework (CUF)** de Miguel.

**Demo pública:** https://mickymino.github.io/UrbanFlow/

## Qué hace

Simula flujos peatonales de cualquier ciudad del mundo, 100 % en el navegador
(sin servidor de cálculo):

1. **Ciudad** — buscador mundial (Nominatim) con minimapa, o el caso validado:
   Centro Histórico de Guayaquil.
2. **Área** — rectángulo de 600–3400 m de lado.
3. **Datos** — descarga OSM en vivo (Overpass API, 4 espejos, caché local de 7 días):
   calles, red peatonal, edificios, parques, agua, plazas y puntos de interés.
4. **Atractores** — orígenes/destinos propuestos automáticamente desde OSM, con tipo,
   jerarquía, peso, **radio de influencia** y rol **editables** (el conocimiento local
   lo pone el usuario). Se añaden por clic sobre el mapa, reconociendo el lugar de OSM.
5. **Escenario** — barreras por clic y correcciones de la red peatonal.
6. **Motor** — proxy origen-destino: rutas mínimas con ruido por cohortes sobre el
   grafo caminable real. Reproducible: misma semilla → mismo resultado.
7. **Resultados** — panel de nueve indicadores interpretados, comparación de dos
   escenarios y vista de diferencia, sobre un mapa con 5 estilos base (incluido el
   *Lienzo UrbanFlow*: trazos incandescentes crema→oro→rojo sobre fondo oscuro).
8. **Lámina** — composición cartográfica en A4 y A3 (horizontal y vertical),
   exportable a PNG y a PDF, con leyenda, escala gráfica, norte y nota metodológica.

El proyecto se guarda solo en `localStorage` y se restaura al recargar.

## Los nueve indicadores

Son de dos naturalezas distintas, y la diferencia es deliberada:

- **De desempeño**, con semáforo: accesibilidad (% de red alcanzable en 10 min),
  conectividad (% de nodos en el componente principal), tiempo y distancia promedio.
- **Descriptivos**, con etiqueta sin color: flujo máximo, flujo promedio,
  concentración (Gini), corredor e intersección más transitados. Nombran el patrón
  urbano sin valorarlo — una concentración alta puede ser una centralidad
  consolidada, no un defecto.

Corredor, intersección y flujo máximo se clasifican por jerarquía **relativa a la
propia red** (índice máximo/P95), no por umbrales absolutos: en una red de miles de
tramos ningún corredor alcanza porcentajes altos del flujo total. En la prueba sobre
Guayaquil (2 km, 4.748 tramos) el corredor dominante concentra apenas el 0,6 % del
flujo y aun así el índice lo identifica correctamente.

En lugar de un "nivel de confianza" —que sin calibración de campo sería inventado—
se muestra la **madurez del análisis**: cuántas condiciones de un análisis sólido
se cumplen.

## Honestidad del modelo

No es un ABM con colisiones: es un modelo de **asignación proxy OD**, defendible vía
space syntax (*Choice* correlaciona r=0.7–0.9 con conteos peatonales reales). Muestra
flujo simulado potencial, nunca conteos observados.

Los valores son **pasos simulados, no personas**. El modelo está en nivel
**exploratorio**: pasaría a validado solo con conteos peatonales de campo que
permitan calibrarlo.

## Correr en local

Los módulos ES requieren un servidor (no funciona con doble clic en `index.html`):

```
python -m http.server 8801
# abrir http://localhost:8801
```

## Stack

Vanilla JS (módulos ES) + MapLibre GL 4.7.1 desde CDN. Cero build. APIs externas:
Nominatim (geocodificación), Overpass (datos OSM) y teselas OSM/CARTO.

## Datos y licencias

Datos: © OpenStreetMap contributors (ODbL). Geocodificación: Nominatim.
