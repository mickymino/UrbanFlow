// Panel de resultados (estilo dashboard): cálculo y pintado.
//
// Separación deliberada por naturaleza del indicador:
//  - DESEMPEÑO (accesibilidad, conectividad, tiempo, distancia): semáforo.
//  - DESCRIPTIVOS (flujo máximo, flujo promedio, concentración, corredor e
//    intersección): etiqueta sin color, porque describen el patrón urbano y no
//    admiten juicio de valor.
// La jerarquía de corredor/intersección/flujo máximo usa el índice relativo
// máximo/P95, escalable a cualquier tamaño de red. El P95 y el índice son
// internos: nunca se muestran al usuario.
//
// Recibe su contexto por iniciarPanel() para no depender de globales.

import { coberturaSuperficie, conectividad, concentracion, interseccionTop,
         distribucionDestinos, indiceEstado, diagnostico, madurez } from "./metricas.js";
import { NIVELES, GRADOS, GRADOS_F, ETIQ_NODO, ETIQ_CORREDOR,
         nivelAccesibilidad, interpAccesibilidad, nivelConectividad, interpConectividad,
         nivelTiempo, interpTiempo, nivelDistancia, interpDistancia,
         gradoJerarquia, interpFlujoMax, gradoFlujoProm, interpFlujoProm,
         gradoConcentracion, interpConcentracion, interpInterseccion, interpCorredor } from "./escalas.js";

/* Formato numérico local: separador de miles y decimales controlados. */
export const numES = (v, d = 0) =>
  v == null || !isFinite(v) ? "—" : Number(v).toLocaleString("es-EC", { maximumFractionDigits: d });

const $ = (id) => document.getElementById(id);
let ctxPanel = null;
/**
 * @param {object} o - { estado, escActivo, leerParams, marcarPaso, bloquearPaso,
 *                       accesibilidad, VEL }
 */
export function iniciarPanel(o){ ctxPanel = o; }

/* ==================== PANEL DE RESULTADOS (Power BI) ==================== */
const IC={
  flujo:'<path d="M2 12c2.5 0 2.5-8 5-8s2.5 8 5 8 2.5-4 2-6"/>',
  prom:'<path d="M2 8h3l2-4 2 8 2-4h3"/>',
  reloj:'<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.3 1.4"/>',
  regla:'<path d="M2 6.5h12v3H2zM5 6.5v1.6M8 6.5v2.2M11 6.5v1.6"/>',
  nodo:'<circle cx="8" cy="8" r="2"/><path d="M8 2v4M8 10v4M2 8h4M10 8h4"/>',
  alerta:'<path d="M8 2.2l6 10.6H2z"/><path d="M8 6.6v2.6M8 11h.01"/>',
  acc:'<circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/>',
  red:'<circle cx="4" cy="4" r="1.6"/><circle cx="12" cy="5" r="1.6"/><circle cx="7" cy="12" r="1.6"/><path d="M5.4 4.6L10.6 5M5 5.6l1.4 5"/>',
  conc:'<path d="M2 13c3-1 4-4 6-4s3 3 6 4"/><path d="M8 3v6"/>',
};
const icono=(k)=>`<svg class="ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${IC[k]||""}</svg>`;

/* ==================== clasificación e interpretación ====================
   DOS naturalezas de indicador, deliberadamente separadas:
   (A) DESEMPEÑO — accesibilidad, conectividad, tiempo y distancia: miden si la
       red funciona bien para caminar, así que admiten juicio (Excelente→Deficiente).
   (B) DESCRIPTIVOS — flujo máximo, flujo promedio y concentración: describen el
       patrón espacial de la ciudad. NO se juzgan: una concentración alta puede
       ser una centralidad consolidada, un eje comercial o un corredor cívico
       vivo, no un defecto. Su interpretación nombra el fenómeno, no lo valora. */
/* --- escalas de interpretación definidas por Miguel (una frase por rango) --- */

/* (A) DESEMPEÑO — con semáforo */
function extentGrafo(g){
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
  for(let i=0;i<g.n;i++){const [x,y]=g.nodos[i];
    if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y;}
  return {x0,y0,x1,y1};
}
/* calcula, tras cada simulación, todo lo que el panel necesita */
export function calcularPanel(res,esc){
  const g=ctxPanel.estado.grafo;
  const bloq=esc.barreras;
  const nodosO=res.amarres.filter(a=>a.rol!=="destino").map(a=>a.nodo);
  const cob={};
  for(const min of [5,10,15]){
    ctxPanel.accesibilidad(g,nodosO,bloq,min);              // deja ultimaDistMin listo
    cob[min]=coberturaSuperficie(g,ctxPanel.ultimaDistMin(),min,ctxPanel.VEL,extentGrafo(g));
    if(min===10)res.acc10=(()=>{let a=0;const lim=10*60*ctxPanel.VEL;
      const dm=ctxPanel.ultimaDistMin();for(let i=0;i<g.n;i++)if(dm[i]<=lim)a++;return g.n?100*a/g.n:0;})();
  }
  const conect=conectividad(g,bloq);
  const conc=concentracion(res.conteo,g.m);
  const inter=interseccionTop(g,res.conteo);
  const dist=distribucionDestinos(res.porDestino,res.amarres);
  const ind=indiceEstado({acc10:res.acc10,conect});   // la concentración es descriptiva: no puntúa
  const diag=diagnostico({ind,acc10:res.acc10,conect,conc,stats:res.stats});
  const mad=madurez({conect,atractores:esc.atractores,stats:res.stats,params:ctxPanel.leerParams(),calibrado:false});
  res.panel={cob,conect,conc,inter,dist,ind,diag,mad};
  return res.panel;
}

export function pintarPanel(){
  const esc=ctxPanel.escActivo(),res=esc&&esc.resultado;
  const vacio=!res||!res.panel;
  $("pb-resumen-vacio").classList.toggle("oculto",!vacio);
  $("pb-resumen").classList.toggle("oculto",vacio);
  $("pb-cobertura-vacio").classList.toggle("oculto",!vacio);
  $("pb-cobertura").classList.toggle("oculto",vacio);
  $("pb-dist-vacio").classList.toggle("oculto",!vacio);
  $("pb-dist").classList.toggle("oculto",vacio);
  if(vacio){$("pb-kpis").innerHTML=tarjetasVacias();return;}
  const p=res.panel;

  /* --- 1. resumen --- */
  const ET={optimo:["Óptimo","est-optimo","var(--verde)"],
            moderado:["Moderado","est-moderado","var(--ambar)"],
            critico:["Crítico","est-critico","var(--rojo)"]}[p.ind.estado];
  $("pb-estado").textContent=ET[0];
  $("pb-estado").className="e "+ET[1];
  $("pb-anillo-val").textContent=Math.round(p.ind.valor*100);
  const arco=$("pb-anillo-arco");
  arco.style.stroke=ET[2];
  arco.style.strokeDashoffset=String(132*(1-p.ind.valor));
  $("pb-diag").textContent=p.diag;
  $("pb-mad-pct").textContent=`${p.mad.cumplidos}/${p.mad.total}`;
  $("pb-mad-barra").style.width=p.mad.pct+"%";
  $("pb-mad-lista").innerHTML=p.mad.items.map(i=>
    `<div class="pb-mad-item ${i.ok?"ok":"no"}"><span class="mk">${i.ok?"✓":"○"}</span>${i.k}</div>`).join("");

  /* --- 2. indicadores --- */
  /* (A) desempeño: escalas con semáforo */
  const nAcc=nivelAccesibilidad(res.acc10);
  const nCon=nivelConectividad(p.conect.pctMayor);
  const nTie=nivelTiempo(res.stats.tiempoMedioMin);
  const nDis=nivelDistancia(res.stats.distMediaM);
  /* (B) descriptivos: grado sin color */
  const razonPico=res.stats.p95?res.stats.max/res.stats.p95:1;
  // Índice de jerarquía del corredor: flujo máximo sobre el P95 de los tramos
  // con actividad. Relativo a la propia red, por tanto escalable.
  const indiceCorredor=razonPico;
  // % del flujo total: dato informativo en la tarjeta, no clasifica
  const pctCorredor=res.stats.flujoTotal?100*res.stats.max/res.stats.flujoTotal:0;

  const kpis=[
    // --- descriptivos ---
    {ic:"flujo",cab:"Flujo máximo",v:numES(res.stats.max),un:"pasos/tramo",
     etiq:GRADOS[gradoJerarquia(razonPico)],interp:interpFlujoMax(razonPico),chispa:histogramaFlujo(res)},
    {ic:"prom",cab:"Flujo promedio",v:numES(res.stats.flujoProm),un:"pasos/tramo",
     etiq:GRADOS[gradoFlujoProm(res.stats.flujoProm,res.stats.max)],
     interp:interpFlujoProm(res.stats.flujoProm,res.stats.max)},
    // --- desempeño ---
    {ic:"reloj",cab:"Tiempo promedio",v:numES(res.stats.tiempoMedioMin),un:"min",niv:nTie,
     interp:interpTiempo(res.stats.tiempoMedioMin)},
    {ic:"regla",cab:"Distancia promedio",v:numES(res.stats.distMediaM),un:"m",niv:nDis,
     interp:interpDistancia(res.stats.distMediaM)},
    {ic:"acc",cab:"Accesibilidad",v:numES(res.acc10),un:"%",niv:nAcc,
     interp:interpAccesibilidad(res.acc10)},
    {ic:"red",cab:"Conectividad",v:numES(p.conect.pctMayor),un:"%",niv:nCon,
     interp:interpConectividad(p.conect.pctMayor)},
    // --- localizaciones (ancho completo) ---
    {ic:"nodo",cab:"Intersección más transitada",ancha:true,
     ubic:p.inter?p.inter.ubicacion:"—",
     v:p.inter?numES(p.inter.pasos):"—",un:"pasos",
     etiq:p.inter?ETIQ_NODO[gradoJerarquia(p.inter.razon)]:"",
     interp:p.inter?interpInterseccion(p.inter.razon):""},
    {ic:"alerta",cab:"Corredor más transitado",ancha:true,
     ubic:res.stats.tramoTop?res.stats.tramoTop.nombre:"—",
     v:res.stats.tramoTop?numES(res.stats.max):"—",un:"pasos",
     extra:res.stats.tramoTop?`${numES(pctCorredor,1)} % del flujo`:"",
     etiq:res.stats.tramoTop?ETIQ_CORREDOR[gradoJerarquia(indiceCorredor)]:"",
     interp:res.stats.tramoTop?interpCorredor(indiceCorredor):""},
    // --- descriptivo, cierra la rejilla a doble ancho para que quede simétrica ---
    {ic:"conc",cab:"Concentración",ancha:true,v:numES(p.conc.gini,2),un:"",
     etiq:GRADOS_F[gradoConcentracion(p.conc.gini)],interp:interpConcentracion(p.conc.gini)},
  ];
  $("pb-kpis").innerHTML=kpis.map(k=>`
    <div class="pb-kpi ${k.niv?k.niv[2]:"c-neu"}${k.ancha?" ancha":""}">
      <div class="cab">${icono(k.ic)}${k.cab}</div>
      ${k.ubic?`<div class="ubic">${k.ubic}</div>`:""}
      <div class="fila-v"><span class="v">${k.v}</span>${k.un?`<span class="un">${k.un}</span>`:""}${k.extra?`<span class="extra">· ${k.extra}</span>`:""}</div>
      ${k.niv?`<div class="cual ${k.niv[1]}"><span class="dot"></span>${k.niv[0]}</div>`
             :(k.etiq?`<div class="etiq">${k.etiq}</div>`:"")}
      ${k.interp?`<div class="interp">${k.interp}</div>`:""}
      ${k.chispa||""}
    </div>`).join("");

  /* --- 3. cobertura --- */
  const colCob=(v)=>v>=60?"var(--verde)":v>=35?"var(--ambar)":"var(--rojo)";
  $("pb-cobertura").innerHTML=[5,10,15].map(min=>{
    const v=p.cob[min];
    return `<div class="pb-barra">
      <div class="cab"><span class="t">${min} minutos caminando</span><span class="p">${numES(v)} %</span></div>
      <div class="pb-pista"><i style="width:${Math.min(100,v)}%;background:${colCob(v)}"></i></div>
    </div>`;}).join("")+
    `<div class="nota" style="margin-top:9px">Superficie del área de estudio a menos de 100 m de la red alcanzable.</div>`;

  /* --- 4. distribución --- */
  const top=p.dist.slice(0,6);
  const resto=p.dist.slice(6).reduce((a,d)=>a+d.pct,0);
  $("pb-dist").innerHTML=top.map(d=>`
    <div class="pb-dest">
      <div class="cab"><span class="n">${d.nombre}</span><span class="p">${numES(d.pct)} %</span></div>
      <div class="pista"><i style="width:${d.pct}%"></i></div>
    </div>`).join("")+
    (resto>0.5?`<div class="pb-dest otros">
      <div class="cab"><span class="n">Otros destinos</span><span class="p">${numES(resto)} %</span></div>
      <div class="pista"><i style="width:${resto}%"></i></div></div>`:"")+
    `<div class="nota" style="margin-top:9px">${numES(res.stats.rutasOk)} viajes simulados repartidos por destino.</div>`;
}
function tarjetasVacias(){
  const c=[["flujo","Flujo máximo"],["prom","Flujo promedio"],["reloj","Tiempo promedio"],
           ["regla","Distancia promedio"],["acc","Accesibilidad"],["red","Conectividad"]];
  return c.map(([ic,cab])=>`<div class="pb-kpi c-neu">
    <div class="cab">${icono(ic)}${cab}</div>
    <div class="fila-v"><span class="v">—</span></div>
    <div class="interp">Sin datos aún.</div></div>`).join("");
}
/* mini histograma de la distribución de carga por tramo (chispa del KPI de flujo) */
function histogramaFlujo(res){
  const g=ctxPanel.estado.grafo,cubos=new Array(12).fill(0);
  const max=res.stats.max||1;
  for(let e=0;e<g.m;e++){const c=res.conteo[e];if(!c)continue;
    cubos[Math.min(11,Math.floor((c/max)*12))]++;}
  const mx=Math.max(...cubos)||1;
  return `<div class="chispa">${cubos.map(v=>`<i style="height:${Math.round(100*v/mx)}%"></i>`).join("")}</div>`;
}
$("pb-log-tit").onclick=()=>$("panel-res").classList.toggle("log-cerrado");

