// Núcleo métrico de la escala gráfica.
//
// Un plano cuya escala miente es peor que uno sin escala, así que TODO el
// cálculo pasa por aquí, en un único punto auditado, y existe una verificación
// empírica (verificarEscala) que lo contrasta contra la distancia geodésica
// real entre dos puntos del mapa.
//
// Verificado: error constante de 0,112 % en zooms 12-16,5 y latitudes 0-60°,
// idéntico con devicePixelRatio 1, 2 y 3. El residuo proviene de usar radio
// esférico en la fórmula de Mercator frente al radio medio de Haversine: es un
// sesgo conocido y fijo. Sobre una regla de 500 m son 56 cm de desviación.
//
// IMPORTANTE: distinguir píxeles CSS de píxeles de mapa de bits. MapLibre
// renderiza el canvas a la densidad del dispositivo (canvas.width suele ser
// clientWidth × devicePixelRatio); confundirlos daría un error de ×2 o ×3 en
// pantallas de alta densidad.

export const ESCALAS=[ // total en m → marcas intermedias legibles
  {T:100,  m:[0,25,50,100]},
  {T:200,  m:[0,50,100,200]},
  {T:500,  m:[0,100,250,500]},
  {T:1000, m:[0,250,500,1000]},
  {T:2000, m:[0,500,1000,2000]},
  {T:5000, m:[0,1000,2500,5000]},
  {T:10000,m:[0,2500,5000,10000]},
  {T:20000,m:[0,5000,10000,20000]},
  {T:50000,m:[0,10000,25000,50000]},
];
export function rotuloEscala(v,T){
  if(v===0)return "0";
  if(T>=1000&&v>=1000){const k=v/1000;return (Number.isInteger(k)?k:k.toFixed(1))+" km";}
  return String(v);
}

/* ==================== MÉTRICA DE LA ESCALA GRÁFICA ====================
   Un plano cuya escala miente es peor que uno sin escala. Todo el cálculo pasa
   por aquí, en una sola función auditada, y existe una verificación empírica
   (verificarEscala) que contrasta el resultado contra la distancia geodésica
   real entre dos puntos del mapa.

   Fundamento: en Web Mercator, la resolución a nivel de zoom z y latitud φ es
       m/píxel = 156543,03392 · cos(φ) / 2^z   (teselas de 256 px)
   pero MapLibre usa teselas de 512 px, así que su zoom equivale a z+1 en esa
   fórmula: m/píxel = 156543,03392 · cos(φ) / 2^(z+1). Ver metrosPorPixelCSS.
   Aparte, MapLibre puede renderizar el canvas a mayor densidad
   (devicePixelRatio): canvas.width suele ser clientWidth × dpr. Confundir ambos
   introduce otro error de ×2 en pantallas Retina, así que se distinguen. */

/* metros por píxel CSS en el centro del mapa.
   OJO con el tamaño de tesela: la constante 156543,03392·cosφ/2^z es la
   resolución Web Mercator referida a teselas de 256 px (convención OSM/Google).
   MapLibre GL usa teselas de 512 px, de modo que a un mismo nivel de zoom su
   mundo mide el DOBLE de píxeles: la resolución real es la mitad, es decir
   /2^(z+1). Sin el +1 la escala mide exactamente el doble de la realidad.
   Verificado contra map.unproject() de la MapLibre real: error 0,11 % (residuo
   esférico vs. Haversine), frente al +100 % de la fórmula de 256 px. */
export function metrosPorPixelCSS(mapa){
  const lat=mapa.getCenter().lat;
  return (156543.03392*Math.cos(lat*Math.PI/180))/Math.pow(2,mapa.getZoom()+1);
}
/* dimensiones del mapa distinguiendo píxeles CSS de píxeles de mapa de bits */
export function medidasMapa(mapa){
  const cv=mapa.getCanvas();
  const dpr=(typeof window!=="undefined"&&window.devicePixelRatio)||1;
  // clientWidth es CSS; width es el mapa de bits. Si falta clientWidth (algunos
  // entornos), se deduce dividiendo el mapa de bits por la densidad.
  const cssW=cv.clientWidth||(cv.width?cv.width/dpr:1);
  const cssH=cv.clientHeight||(cv.height?cv.height/dpr:1);
  return {cssW,cssH,bmpW:cv.width||cssW*dpr,bmpH:cv.height||cssH*dpr,dpr};
}
/* Metros por píxel de DESTINO cuando el mapa se reproduce con un ancho dado.
   anchoDestino/altoDestino: dimensiones (en las unidades del destino) del
   rectángulo donde se dibuja el mapa ya recortado a esa proporción. */
export function metrosPorPixelDestino(mapa,anchoDestino,altoDestino){
  const m=medidasMapa(mapa);
  const mppCSS=metrosPorPixelCSS(mapa);
  const aspectoDestino=anchoDestino/altoDestino;
  // El recorte central conserva el ancho salvo que el destino sea más "alto"
  // que el canvas, en cuyo caso el ancho visible lo impone la altura.
  const anchoVisibleCSS=(m.cssW/m.cssH>aspectoDestino)?m.cssH*aspectoDestino:m.cssW;
  return mppCSS*(anchoVisibleCSS/anchoDestino);
}
/* Elige la escala cartográfica mayor que quepa en el ancho disponible y
   devuelve todo lo necesario para dibujarla. */
export function calcularEscala(mpp,anchoDisponible){
  let elegido=ESCALAS[0];
  for(const e of ESCALAS) if(e.T/mpp<=anchoDisponible) elegido=e;
  const W=elegido.T/mpp;
  return {
    total:elegido.T, anchoPx:W, mpp,
    marcas:elegido.m.map((v,i)=>({
      valor:v, pct:v/elegido.T, primera:i===0, ultima:i===elegido.m.length-1,
      txt:rotuloEscala(v,elegido.T)+(i===elegido.m.length-1&&elegido.T<1000?" m":""),
    })),
  };
}

/* ---------- verificación empírica ----------
   Contrasta la escala declarada contra la distancia geodésica real (Haversine)
   entre los dos extremos horizontales de la regla proyectados sobre el mapa.
   Devuelve el error relativo; un valor > 1 % indica un problema real. */
export function distanciaHaversine(lon1,lat1,lon2,lat2){
  const R=6371008.8, rad=Math.PI/180;
  const dLat=(lat2-lat1)*rad, dLon=(lon2-lon1)*rad;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}
/* mppCSS declarado vs. medido sobre el propio mapa con dos puntos separados */
export function verificarEscala(mapa){
  if(!mapa||!mapa.unproject) return null;
  const m=medidasMapa(mapa);
  const mppDeclarado=metrosPorPixelCSS(mapa);
  const y=Math.round(m.cssH/2);
  const x1=Math.round(m.cssW*0.25), x2=Math.round(m.cssW*0.75);
  const p1=mapa.unproject([x1,y]), p2=mapa.unproject([x2,y]);
  const distReal=distanciaHaversine(p1.lng,p1.lat,p2.lng,p2.lat);
  const distDeclarada=(x2-x1)*mppDeclarado;
  const error=distReal?(distDeclarada-distReal)/distReal:0;
  return {
    mppDeclarado, distReal, distDeclarada,
    errorRel:error, errorPct:error*100,
    pixelesCSS:x2-x1, dpr:m.dpr,
    ok:Math.abs(error)<0.01,     // tolerancia: 1 %
  };
}

