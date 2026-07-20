// Modo lámina: composición e impresión de láminas cartográficas.
//
// Vista previa a escala real de la hoja (A4/A3, horizontal y vertical) con
// leyenda e indicadores elegibles y editables. Dos salidas:
//  - Imprimir / PDF: usa el diálogo del navegador con @page al tamaño exacto.
//  - Descargar PNG: DIBUJA la lámina elemento a elemento en un canvas a 2x.
//    (No se serializa el DOM a SVG: los navegadores bloquean foreignObject con
//    imágenes o fuentes externas y el canvas sale en blanco.)
//
// Notas de impresión aprendidas a base de fallos, no tocar sin motivo:
//  - La hoja NO debe forzarse a width:100%/100vh al imprimir: toma medidas del
//    viewport y deforma el mapa.
//  - Los navegadores omiten los fondos CSS al imprimir. Las muestras de la
//    leyenda se dibujan en SVG y la rampa como franjas sólidas, no degradado.
//
// Este módulo recibe su contexto (mapa, estado, escenario activo, utilidades)
// mediante iniciarLamina(), para no depender de variables globales.


import { ESCALAS, calcularEscala, metrosPorPixelDestino, rotuloEscala } from "./escala-metrica.js";

/* Contexto inyectado desde app.js */
let ctxLam=null;
/* Se obtiene el mapa bajo demanda: en el arranque, iniciarLamina() se llama
   antes de que MapLibre haya creado la instancia. */
const lamMapa=()=>ctxLam.mapa();
const $=(id)=>document.getElementById(id);
/**
 * @param {object} o - { mapa: ()=>Map, escActivo, leerParams, log, numES, rampaCss,
 *                       estadoProyecto } donde estadoProyecto expone
 *                       { ciudad, fechaOSM }
 */
export function iniciarLamina(o){
  ctxLam=o;
  enlazarInterfaz();
}
const lamEsc=()=>ctxLam.escActivo();
const lamParams=()=>ctxLam.leerParams();
const lamLog=(m,e)=>ctxLam.log(m,e);
const lamNum=(v,d)=>ctxLam.numES(v,d);
const lamRampa=(t)=>ctxLam.rampaCss(t);
const lamEstado=()=>ctxLam.estadoProyecto();

const FORMATOS={            // milímetros → píxeles a 96 ppp (1 mm = 3.7795 px)
  a4h:{w:297,h:210,vert:false}, a4v:{w:210,h:297,vert:true},
  a3h:{w:420,h:297,vert:false}, a3v:{w:297,h:420,vert:true},
};
const MM=3.7795275591;
/* Factor de tamaño del papel, referido al A4 (misma diagonal en horizontal y
   vertical). A4 → 1 · A3 → ≈1,414 */
const lamFactor=(f)=>Math.hypot(f.w,f.h)/Math.hypot(FORMATOS.a4h.w,FORMATOS.a4h.h);
const lam={
  fmt:"a3h",
  items:[   // leyenda: cada elemento es elegible y su texto editable
    {id:"flujo",  on:true, txt:"Intensidad de paso peatonal", tipo:"rampa"},
    {id:"origen", on:true, txt:"Origen",            tipo:"punto", color:"#5fbf6f"},
    {id:"destino",on:true, txt:"Destino",           tipo:"punto", color:"#e05252"},
    {id:"ambos",  on:true, txt:"Origen y destino",  tipo:"punto", color:"#d4a530"},
    {id:"barrera",on:true, txt:"Barrera",           tipo:"linea", color:"#e05252", guion:true},
    {id:"red",    on:true, txt:"Red peatonal",      tipo:"linea", color:"#8a8578"},
  ],
  kpis:[],  // se rellena con los indicadores disponibles tras simular
};

export function lamAbrir(){
  const esc=lamEsc(), res=esc&&esc.resultado;
  if(!res){lamLog("Corre la simulación antes de componer la lámina.",true);return;}
  // valores por defecto tomados del proyecto
  if(!$("lam-titulo").value) $("lam-titulo").value=$("proyecto-nombre").value||"Simulación de flujos peatonales";
  if(!$("lam-sub").value){
    const ciudad=lamEstado().ciudad?lamEstado().ciudad.nombre.split(",")[0]:"";
    $("lam-sub").value=[ciudad,esc.nombre].filter(Boolean).join(" · ");
  }
  if(!$("lam-nota-txt").value)
    $("lam-nota-txt").value="Modelo proxy origen-destino sobre grafo caminable. Nivel exploratorio: "+
      "los valores expresan pasos simulados por tramo, no conteos reales de personas. "+
      "Resultado reproducible con el valor de reproducibilidad indicado.";
  if(!$("lam-cred-txt").value)
    $("lam-cred-txt").value="UrbanFlow · Datos: OpenStreetMap"+(lamEstado().fechaOSM?" ("+lamEstado().fechaOSM+")":"")+
      "\nParámetros: "+lamParams().agentes.toLocaleString("es-EC")+" viajes · reproducibilidad "+lamParams().semilla;
  lamKpisDisponibles(res);
  lamPintarItems();
  lamPintarKpiItems();
  $("modo-lamina").classList.add("abierto");
  lamAplicarFormato();
  lamActualizar();
  requestAnimationFrame(lamEscalaYNorte);
}
function lamCerrar(){ $("modo-lamina").classList.remove("abierto"); }

/* indicadores ofrecidos para la lámina, con su valor ya formateado */
function lamKpisDisponibles(res){
  const p=res.panel;
  const previos=new Map(lam.kpis.map(k=>[k.id,k.on]));
  lam.kpis=[
    {id:"acc", k:"Accesibilidad (10 min)", v:lamNum(res.acc10)+" %"},
    {id:"con", k:"Conectividad",           v:lamNum(p.conect.pctMayor)+" %"},
    {id:"tie", k:"Tiempo promedio",        v:lamNum(res.stats.tiempoMedioMin)+" min"},
    {id:"dis", k:"Distancia promedio",     v:lamNum(res.stats.distMediaM)+" m"},
    {id:"max", k:"Flujo máximo",           v:lamNum(res.stats.max)+" pasos/tramo"},
    {id:"prom",k:"Flujo promedio",         v:lamNum(res.stats.flujoProm)+" pasos/tramo"},
    {id:"conc",k:"Concentración",          v:lamNum(p.conc.gini,2)},
    {id:"cor", k:"Corredor más transitado",v:res.stats.tramoTop?res.stats.tramoTop.nombre:"—"},
    {id:"int", k:"Intersección principal", v:p.inter?p.inter.ubicacion:"—"},
    {id:"rut", k:"Rutas simuladas",        v:lamNum(res.stats.rutasOk)},
  ].map(x=>({...x,on:previos.has(x.id)?previos.get(x.id):["acc","con","tie","dis","max"].includes(x.id)}));
}

function lamPintarItems(){
  $("lam-items").innerHTML="";
  lam.items.forEach((it,i)=>{
    const d=document.createElement("div"); d.className="lam-item";
    d.innerHTML=`<input type="checkbox" ${it.on?"checked":""}>
      <span class="mues">${lamMuestra(it)}</span>
      <input type="text" value="${it.txt.replace(/"/g,"&quot;")}">`;
    d.querySelector('input[type=checkbox]').onchange=(e)=>{lam.items[i].on=e.target.checked;lamActualizar();};
    d.querySelector('input[type=text]').oninput=(e)=>{lam.items[i].txt=e.target.value;lamActualizar();};
    $("lam-items").appendChild(d);
  });
}
function lamPintarKpiItems(){
  $("lam-kpi-items").innerHTML="";
  lam.kpis.forEach((k,i)=>{
    const d=document.createElement("div"); d.className="lam-item";
    d.innerHTML=`<input type="checkbox" ${k.on?"checked":""}>
      <input type="text" value="${k.k.replace(/"/g,"&quot;")}">`;
    d.querySelector('input[type=checkbox]').onchange=(e)=>{lam.kpis[i].on=e.target.checked;lamActualizar();};
    d.querySelector('input[type=text]').oninput=(e)=>{lam.kpis[i].k=e.target.value;lamActualizar();};
    $("lam-kpi-items").appendChild(d);
  });
}
/* La rampa se dibuja como franjas sólidas contiguas, no como degradado CSS:
   los motores de impresión descartan los linear-gradient con frecuencia y la
   barra salía en blanco en el PDF. Con franjas sólidas siempre se imprime. */
function lamFranjasRampa(n=48){
  let franjas="";
  for(let i=0;i<n;i++)
    franjas+=`<rect x="${(i*100/n).toFixed(3)}%" y="0" width="${(100/n+0.4).toFixed(3)}%" height="100%" fill="${lamRampa(i/(n-1))}"/>`;
  return `<svg width="100%" height="100%" preserveAspectRatio="none"
    style="display:block">${franjas}</svg>`;
}
/* Muestras de la leyenda dibujadas en SVG en lugar de con fondos CSS: el
   contenido SVG se imprime siempre, mientras que background-color y
   linear-gradient dependen de que el navegador tenga activada la impresión de
   fondos (por defecto está desactivada, y era la causa de que en el PDF
   salieran en blanco la rampa y los puntos de origen/destino). */
function lamMuestra(it){
  if(it.tipo==="rampa"){
    const n=24;
    let franjas="";
    for(let i=0;i<n;i++)
      franjas+=`<rect x="${(i*16/n).toFixed(2)}" y="0" width="${(16/n+0.15).toFixed(2)}" height="6" fill="${lamRampa(i/(n-1))}"/>`;
    return `<svg width="16" height="6" viewBox="0 0 16 6" style="display:inline-block;vertical-align:middle">
      ${franjas}<rect x="0" y="0" width="16" height="6" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="0.6"/></svg>`;
  }
  if(it.tipo==="punto")
    return `<svg width="9" height="9" viewBox="0 0 9 9" style="display:inline-block;vertical-align:middle">
      <circle cx="4.5" cy="4.5" r="4" fill="${it.color}"/></svg>`;
  return `<svg width="16" height="4" viewBox="0 0 16 4" style="display:inline-block;vertical-align:middle">
    <line x1="0" y1="2" x2="16" y2="2" stroke="${it.color}" stroke-width="2"
      ${it.guion?'stroke-dasharray="3,2.4"':''}/></svg>`;
}

function lamAplicarFormato(){
  const f=FORMATOS[lam.fmt], hoja=$("lam-hoja");
  hoja.style.width=Math.round(f.w*MM)+"px";
  hoja.style.height=Math.round(f.h*MM)+"px";
  // Factor de escala del papel medido por la DIAGONAL, no por el ancho: así un
  // A4 vertical y uno horizontal comparten factor (mismo papel girado), y el A3
  // crece ~1,41 respecto al A4. Tipografía, márgenes y elementos cartográficos
  // escalan con el tamaño real de la hoja.
  hoja.style.setProperty("--k",(lamFactor(f)).toFixed(3));
  hoja.classList.toggle("vertical",f.vert);
  // encajar la hoja en el espacio disponible
  const cont=$("lam-escenario");
  const escala=Math.min(1,(cont.clientWidth-52)/(f.w*MM),(cont.clientHeight-52)/(f.h*MM));
  hoja.style.transform="scale("+escala.toFixed(3)+")";
  hoja.style.marginBottom=((escala-1)*f.h*MM)+"px";
  document.querySelectorAll("#lam-formatos button").forEach(b=>
    b.classList.toggle("sel",b.dataset.fmt===lam.fmt));
  $("lam-medidas").textContent=f.w+" × "+f.h+" mm · escala "+Math.round(escala*100)+" %";
}

function lamActualizar(){
  const esc=lamEsc(), res=esc&&esc.resultado;
  if(!res)return;
  $("lam-hoja").classList.toggle("oscura",$("lam-op-oscura").checked);
  $("lam-titulo-t").textContent=$("lam-titulo").value||"—";
  $("lam-sub-t").textContent=$("lam-sub").value||"";
  const img=lamCapturaMapa();
  if(img) $("lam-mapa-img").src=img;

  const lat=$("lam-lateral"); lat.innerHTML="";
  // --- leyenda ---
  if($("lam-op-leyenda").checked){
    const act=lam.items.filter(i=>i.on);
    if(act.length){
      const d=document.createElement("div"); d.className="lam-bloque lam-leyenda";
      let h='<div class="t">Leyenda</div>';
      for(const it of act){
        if(it.tipo==="rampa"){
          h+=`<div style="margin-bottom:calc(5px*var(--k))"><div style="font-size:calc(10px*var(--k));margin-bottom:2px">${it.txt}</div>
            <div class="lam-rampa">${lamFranjasRampa()}</div>
            <div class="lam-rampa-r"><span>0</span><span>${lamNum(res.stats.p95)} (p95)</span></div></div>`;
        }else{
          h+=`<div class="fila"><span class="mk">${lamMuestra(it)}</span>${it.txt}</div>`;
        }
      }
      d.innerHTML=h; lat.appendChild(d);
    }
  }
  // --- indicadores ---
  if($("lam-op-kpis").checked){
    const act=lam.kpis.filter(k=>k.on);
    if(act.length){
      const d=document.createElement("div"); d.className="lam-bloque";
      d.innerHTML='<div class="t">Indicadores</div>'+act.map(k=>{
        const numerico=/^[\d.,]+( (%|min|m|pasos\/tramo))?$/.test(k.v);
        return `<div class="lam-kpi"><span class="k">${k.k}</span>`+
               `<span class="v${numerico?" num":""}">${k.v}</span></div>`;}).join("");
      lat.appendChild(d);
    }
  }
  // --- diagnóstico ---
  if($("lam-op-diag").checked&&res.panel){
    const d=document.createElement("div"); d.className="lam-bloque";
    const ET={optimo:"Óptimo",moderado:"Moderado",critico:"Crítico"}[res.panel.ind.estado];
    d.innerHTML=`<div class="t">Diagnóstico</div>
      <div style="font-size:calc(11px*var(--k));font-weight:700;margin-bottom:calc(3px*var(--k))">${ET} · ${Math.round(res.panel.ind.valor*100)}/100</div>
      <div style="font-size:calc(9.5px*var(--k));line-height:1.45;opacity:.85">${res.panel.diag}</div>`;
    lat.appendChild(d);
  }
  // --- escala y norte: van SOBRE el mapa, no en el lateral ---
  lamEscalaYNorte();
  // --- pie ---
  $("lam-nota").textContent=$("lam-op-nota").checked?$("lam-nota-txt").value:"";
  $("lam-creditos").innerHTML=$("lam-op-creditos").checked
    ?$("lam-cred-txt").value.replace(/\n/g,"<br>"):"";
  $("lam-pie").style.display=($("lam-op-nota").checked||$("lam-op-creditos").checked)?"flex":"none";
}



/* Captura del mapa recortada a la relación de aspecto de la caja de la lámina.
   Se recorta desde el centro, de modo que la vista previa y el PDF muestren
   exactamente el mismo encuadre (antes la imagen llegaba con la proporción de
   la pantalla y el navegador la recortaba de nuevo al imprimir: de ahí que
   saliera "medio mapa"). */
function lamCapturaMapa(){
  if(!lamMapa()) return "";
  const cv=lamMapa().getCanvas();
  const caja=$("lam-mapa-caja");
  const aspectoCaja=(caja.clientWidth||1)/(caja.clientHeight||1);
  const W=cv.width, H=cv.height, aspectoCv=W/H;
  if(!isFinite(aspectoCaja)||aspectoCaja<=0) return cv.toDataURL("image/png");
  let sw=W, sh=H;
  if(aspectoCv>aspectoCaja) sw=Math.round(H*aspectoCaja);   // sobra ancho
  else                      sh=Math.round(W/aspectoCaja);   // sobra alto
  const sx=Math.round((W-sw)/2), sy=Math.round((H-sh)/2);
  try{
    const dest=document.createElement("canvas");
    dest.width=sw; dest.height=sh;
    const cx=dest.getContext("2d");
    if(!cx) throw new Error("sin contexto 2d");
    cx.drawImage(cv,sx,sy,sw,sh,0,0,sw,sh);
    return dest.toDataURL("image/png");
  }catch(e){
    return cv.toDataURL("image/png");   // respaldo: captura sin recortar
  }
}

/* Escala gráfica y norte de la lámina, dibujados sobre el mapa.
   Reutiliza EXACTAMENTE la misma tabla ESCALAS y el mismo criterio que la
   escala del mapa central, ajustada al ancho que ocupa el mapa en la hoja. */
function lamEscalaYNorte(){
  if(!lamMapa()) return;
  const ver=$("lam-op-escala").checked;
  $("lam-norte-caja").style.display=ver?"":"none";
  $("lam-escala-map").style.display=ver?"":"none";
  if(!ver)return;

  // Todo lo que va sobre el mapa se dimensiona respecto al ancho de la hoja,
  // tomando el A4 horizontal como referencia (factor 1). En A3 el factor es ~1,41,
  // de modo que norte, escala y tipografía crecen con el papel.
  const k=lamFactor(FORMATOS[lam.fmt]);
  $("lam-norte").style.width=Math.round(44*k)+"px";
  $("lam-norte-caja").style.padding=Math.round(6*k)+"px "+Math.round(7*k)+"px";
  $("lam-norte-caja").style.top=$("lam-norte-caja").style.right=Math.round(12*k)+"px";
  const cajaEsc=$("lam-escala-map");
  cajaEsc.style.padding=Math.round(5*k)+"px "+Math.round(8*k)+"px";
  cajaEsc.style.bottom=cajaEsc.style.right=Math.round(12*k)+"px";
  cajaEsc.style.fontSize=(9.5*k).toFixed(1)+"px";
  $("lam-esc-regla").style.height=Math.round(6*k)+"px";

  // el norte gira con el bearing del mapa (la N acompaña a la rosa)
  $("lam-norte").style.transform="rotate("+(-lamMapa().getBearing())+"deg)";

  // Metros por píxel referidos al rectángulo donde se dibuja el mapa en la hoja.
  const caja=$("lam-mapa-caja");
  const anchoHoja=caja.clientWidth||Math.round(FORMATOS[lam.fmt].w*MM*0.7);
  const altoHoja=caja.clientHeight||Math.round(FORMATOS[lam.fmt].h*MM*0.5);
  const mpp=metrosPorPixelDestino(lamMapa(),anchoHoja,altoHoja);

  // La regla se dimensiona en PROPORCIÓN al ancho de la hoja, no en píxeles fijos:
  // así una lámina A3 lleva una escala proporcionalmente igual de presente que
  // una A4, en vez de verse encogida al reducir la hoja en pantalla.
  const esc=calcularEscala(mpp,anchoHoja*0.30);
  const regla=$("lam-esc-regla"), rot=$("lam-esc-rot");
  regla.style.width=Math.round(esc.anchoPx)+"px"; rot.style.width=Math.round(esc.anchoPx)+"px";
  rot.style.height=Math.round(13*k)+"px";
  regla.innerHTML=""; rot.innerHTML="";
  esc.marcas.forEach((mk)=>{
    const tick=document.createElement("span");
    tick.style.left="calc("+(mk.pct*100)+"% - 0.5px)";
    tick.style.height=((mk.primera||mk.ultima?6*k:4*k)).toFixed(1)+"px";
    regla.appendChild(tick);
    const et=document.createElement("span");
    et.textContent=mk.txt; et.style.left=(mk.pct*100)+"%";
    if(mk.primera) et.style.transform="translateX(0)";
    if(mk.ultima) et.style.transform="translateX(-100%)";
    rot.appendChild(et);
  });
}

/* --- exportación PNG: se recompone la hoja en un canvas a 2x --- */
/* --- exportación PNG ---
   La lámina se DIBUJA en un canvas elemento a elemento. El método anterior
   (serializar el DOM en un SVG con foreignObject) fallaba en la práctica: los
   navegadores bloquean imágenes externas y fuentes dentro de foreignObject, y
   el canvas quedaba en blanco o la carga era rechazada. Dibujar directamente
   es más código, pero funciona en todos los navegadores y sin dependencias. */
async function lamExportarPNG(){
  const btn=$("lam-png"), txt=btn.textContent;
  btn.textContent="Componiendo…"; btn.disabled=true;
  try{
    const url=await lamComponerCanvas(2);   // 2x → ~200 ppp
    const a=document.createElement("a");
    a.download="urbanflow-lamina-"+lam.fmt+".png";
    a.href=url; a.click();
    const f=FORMATOS[lam.fmt];
    lamLog("Lámina exportada en PNG ("+lam.fmt.toUpperCase()+", "+
        Math.round(f.w*MM*2)+"×"+Math.round(f.h*MM*2)+" px).");
  }catch(e){
    lamLog("No se pudo componer el PNG: "+e.message+". Usa «Imprimir / PDF».",true);
  }
  btn.textContent=txt; btn.disabled=false;
}

async function lamComponerCanvas(escala){
  const f=FORMATOS[lam.fmt];
  const W=Math.round(f.w*MM*escala), H=Math.round(f.h*MM*escala);
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const cx=cv.getContext("2d");
  if(!cx) throw new Error("el navegador no permite dibujar en canvas");

  const oscura=$("lam-op-oscura").checked;
  const tinta=oscura?"#f0e8d8":"#1a1a1a";
  const fondo=oscura?"#101214":"#ffffff";
  const k=lamFactor(f)*escala;              // factor papel × resolución
  const FUENTE='"Segoe UI",system-ui,-apple-system,Helvetica,Arial,sans-serif';
  const px=(v)=>v*k;
  cx.fillStyle=fondo; cx.fillRect(0,0,W,H);
  cx.textBaseline="top";

  const esc=lamEsc(), res=esc.resultado, p=res.panel;
  const M=px(20);                            // margen lateral
  let y=px(16);

  /* ---------- cabecera ---------- */
  cx.fillStyle=tinta;
  cx.font="700 "+px(19)+"px "+FUENTE;
  y=lamTexto(cx,$("lam-titulo").value||"",M,y,W-2*M,px(23));
  cx.font=px(12)+"px "+FUENTE;
  cx.globalAlpha=.72;
  y=lamTexto(cx,$("lam-sub").value||"",M,y+px(3),W-2*M,px(15));
  cx.globalAlpha=1;
  y+=px(12);
  cx.fillStyle=tinta; cx.fillRect(M,y,W-2*M,Math.max(1,px(1.5)));
  y+=px(14);

  /* ---------- geometría del cuerpo ---------- */
  const vertical=f.vert;
  const anchoLat=px(190);
  const pieAlto=($("lam-op-nota").checked||$("lam-op-creditos").checked)?px(52):px(10);
  const cuerpoAlto=H-y-pieAlto-px(14);
  const mapaW=vertical?(W-2*M):(W-2*M-anchoLat-px(14));
  const mapaH=vertical?cuerpoAlto*0.66:cuerpoAlto;
  const mapaX=M, mapaY=y;

  /* ---------- mapa ---------- */
  const img=new Image();
  img.src=$("lam-mapa-img").src;
  if(!img.complete) await new Promise((ok,err)=>{img.onload=ok;
    img.onerror=()=>err(new Error("no se pudo leer la imagen del mapa"));});
  cx.save();
  cx.beginPath(); cx.rect(mapaX,mapaY,mapaW,mapaH); cx.clip();
  cx.drawImage(img,mapaX,mapaY,mapaW,mapaH);
  cx.restore();
  cx.strokeStyle=oscura?"rgba(255,255,255,.28)":"rgba(0,0,0,.28)";
  cx.lineWidth=Math.max(1,px(1));
  cx.strokeRect(mapaX,mapaY,mapaW,mapaH);

  /* ---------- norte y escala sobre el mapa ---------- */
  if($("lam-op-escala").checked){
    lamDibujarNorte(cx,mapaX+mapaW-px(12),mapaY+px(12),px(44),tinta,fondo,oscura,k);
    lamDibujarEscala(cx,mapaX+mapaW-px(12),mapaY+mapaH-px(12),tinta,fondo,oscura,k,escala,mapaW,mapaH);
  }

  /* ---------- columna lateral ---------- */
  const latX=vertical?M:(mapaX+mapaW+px(14));
  let latY=vertical?(mapaY+mapaH+px(14)):mapaY;
  const latW=vertical?(W-2*M):anchoLat;
  const cols=vertical?3:1;                  // en vertical, los bloques van en fila
  const colW=vertical?(latW-px(14)*(cols-1))/cols:latW;
  let col=0;
  const nuevoBloque=()=>{
    if(!vertical)return {x:latX,y:latY};
    const x=latX+col*(colW+px(14));
    return {x,y:latY};
  };
  const cerrarBloque=(alto)=>{
    if(vertical){ col++; if(col>=cols){col=0;latY+=alto+px(10);} }
    else latY+=alto+px(11);
  };

  // leyenda
  if($("lam-op-leyenda").checked){
    const act=lam.items.filter(i=>i.on);
    if(act.length){
      const b=nuevoBloque(); let yy=b.y;
      yy=lamTitBloque(cx,"Leyenda",b.x,yy,tinta,k);
      for(const it of act){
        if(it.tipo==="rampa"){
          cx.fillStyle=tinta; cx.font=px(10)+"px "+FUENTE;
          cx.fillText(it.txt,b.x,yy); yy+=px(12);
          const g=cx.createLinearGradient(b.x,0,b.x+colW*0.9,0);
          g.addColorStop(0,"#f0e8d8");g.addColorStop(.45,"#d4a530");
          g.addColorStop(.75,"#c25e35");g.addColorStop(1,"#9e2b25");
          cx.fillStyle=g; cx.fillRect(b.x,yy,colW*0.9,px(7)); yy+=px(9);
          cx.fillStyle=tinta; cx.globalAlpha=.7; cx.font=px(9)+"px "+FUENTE;
          cx.fillText("0",b.x,yy);
          const rot=lamNum(res.stats.p95)+" (p95)";
          cx.fillText(rot,b.x+colW*0.9-cx.measureText(rot).width,yy);
          cx.globalAlpha=1; yy+=px(13);
        }else{
          if(it.tipo==="punto"){
            cx.fillStyle=it.color; cx.beginPath();
            cx.arc(b.x+px(4),yy+px(5),px(3.5),0,6.284); cx.fill();
          }else{
            cx.strokeStyle=it.color; cx.lineWidth=px(2);
            cx.setLineDash(it.guion?[px(3),px(2.4)]:[]);
            cx.beginPath(); cx.moveTo(b.x,yy+px(5)); cx.lineTo(b.x+px(14),yy+px(5)); cx.stroke();
            cx.setLineDash([]);
          }
          cx.fillStyle=tinta; cx.font=px(10)+"px "+FUENTE;
          cx.fillText(it.txt,b.x+px(20),yy); yy+=px(13);
        }
      }
      cerrarBloque(yy-b.y);
    }
  }
  // indicadores
  if($("lam-op-kpis").checked){
    const act=lam.kpis.filter(x=>x.on);
    if(act.length){
      const b=nuevoBloque(); let yy=b.y;
      yy=lamTitBloque(cx,"Indicadores",b.x,yy,tinta,k);
      for(const it of act){
        cx.font=px(10)+"px "+FUENTE; cx.fillStyle=tinta;
        cx.globalAlpha=.7; cx.fillText(it.k,b.x,yy); cx.globalAlpha=1;
        cx.font="700 "+px(10)+"px "+FUENTE;
        const anchoV=cx.measureText(it.v).width;
        if(anchoV<colW*0.55) cx.fillText(it.v,b.x+colW-anchoV,yy);
        else { yy+=px(12); cx.fillText(it.v,b.x,yy); }   // valor largo, línea propia
        yy+=px(13);
        cx.strokeStyle=oscura?"rgba(255,255,255,.16)":"rgba(0,0,0,.14)";
        cx.lineWidth=1; cx.beginPath();
        cx.moveTo(b.x,yy-px(4)); cx.lineTo(b.x+colW,yy-px(4)); cx.stroke();
      }
      cerrarBloque(yy-b.y);
    }
  }
  // diagnóstico
  if($("lam-op-diag").checked&&p){
    const b=nuevoBloque(); let yy=b.y;
    yy=lamTitBloque(cx,"Diagnóstico",b.x,yy,tinta,k);
    const ET={optimo:"Óptimo",moderado:"Moderado",critico:"Crítico"}[p.ind.estado];
    cx.fillStyle=tinta; cx.font="700 "+px(11)+"px "+FUENTE;
    cx.fillText(ET+" · "+Math.round(p.ind.valor*100)+"/100",b.x,yy); yy+=px(15);
    cx.font=px(9.5)+"px "+FUENTE; cx.globalAlpha=.85;
    yy=lamTexto(cx,p.diag,b.x,yy,colW,px(12));
    cx.globalAlpha=1;
    cerrarBloque(yy-b.y);
  }

  /* ---------- pie ---------- */
  if($("lam-op-nota").checked||$("lam-op-creditos").checked){
    const pieY=H-pieAlto-px(6);
    cx.strokeStyle=oscura?"rgba(255,255,255,.3)":"rgba(0,0,0,.3)";
    cx.lineWidth=1; cx.beginPath(); cx.moveTo(M,pieY); cx.lineTo(W-M,pieY); cx.stroke();
    cx.fillStyle=tinta; cx.globalAlpha=.68; cx.font=px(8.5)+"px "+FUENTE;
    const anchoCred=$("lam-op-creditos").checked?(W-2*M)*0.32:0;
    if($("lam-op-nota").checked)
      lamTexto(cx,$("lam-nota-txt").value,M,pieY+px(7),W-2*M-anchoCred-px(16),px(11));
    if($("lam-op-creditos").checked){
      let cy=pieY+px(7);
      for(const linea of $("lam-cred-txt").value.split("\n")){
        const an=cx.measureText(linea).width;
        cx.fillText(linea,W-M-Math.min(an,anchoCred),cy); cy+=px(11);
      }
    }
    cx.globalAlpha=1;
  }
  return cv.toDataURL("image/png");
}

/* texto con ajuste de línea; devuelve la y final */
function lamTexto(cx,txt,x,y,ancho,alto){
  if(!txt)return y;
  for(const parrafo of String(txt).split("\n")){
    let linea="";
    for(const palabra of parrafo.split(/\s+/)){
      const prueba=linea?linea+" "+palabra:palabra;
      if(cx.measureText(prueba).width>ancho&&linea){
        cx.fillText(linea,x,y); y+=alto; linea=palabra;
      }else linea=prueba;
    }
    if(linea){cx.fillText(linea,x,y); y+=alto;}
  }
  return y;
}
function lamTitBloque(cx,txt,x,y,tinta,k){
  cx.fillStyle=tinta; cx.globalAlpha=.6;
  cx.font="700 "+(9*k)+"px system-ui,sans-serif";
  cx.fillText(txt.toUpperCase(),x,y);
  cx.globalAlpha=1;
  return y+11*k;
}
/* rosa de los vientos, misma composición que en pantalla */
function lamDibujarNorte(cx,derecha,arriba,ancho,tinta,fondo,oscura,k){
  const pad=6*k, w=ancho, h=ancho*1.32;
  const x=derecha-(w+pad*2), y=arriba;
  cx.fillStyle=oscura?"rgba(16,18,20,.82)":"rgba(255,255,255,.82)";
  cx.fillRect(x,y,w+pad*2,h+pad*2);
  cx.strokeStyle=oscura?"rgba(255,255,255,.18)":"rgba(0,0,0,.14)";
  cx.lineWidth=1; cx.strokeRect(x,y,w+pad*2,h+pad*2);
  const cxx=x+pad+w/2, u=w/100;             // unidad del viewBox (100 de ancho)
  const cy=y+pad+82*u;
  cx.fillStyle=tinta; cx.textAlign="center";
  cx.font="700 "+(30*u)+"px system-ui,sans-serif";
  cx.textBaseline="top";
  cx.fillText("N",cxx,y+pad+2*u);
  cx.textAlign="left";
  cx.strokeStyle=tinta; cx.lineWidth=Math.max(1,1.6*u);
  cx.beginPath(); cx.arc(cxx,cy,34*u,0,6.284); cx.stroke();
  cx.beginPath(); cx.arc(cxx,cy,27*u,0,6.284); cx.stroke();
  cx.beginPath(); cx.moveTo(cxx,y+pad+34*u); cx.lineTo(cxx,y+pad+130*u); cx.stroke();
  cx.beginPath(); cx.moveTo(cxx-48*u,cy); cx.lineTo(cxx+48*u,cy); cx.stroke();
  cx.fillRect(cxx-7*u,y+pad+46*u,14*u,36*u);
}
/* escala gráfica, con los mismos valores que la de pantalla */
function lamDibujarEscala(cx,derecha,abajo,tinta,fondo,oscura,k,escalaPNG,mapaWpx,mapaHpx){
  // Se recalcula la escala para el ancho real del mapa DENTRO DEL CANVAS: el
  // ancho medido en pantalla no sirve (la hoja se muestra reducida y en algunos
  // navegadores la caja aún no tiene medidas cuando se compone la imagen).
  // Mismo núcleo métrico que en pantalla, referido al rectángulo del mapa
  // dentro del canvas del PNG.
  const mpp=metrosPorPixelDestino(lamMapa(),mapaWpx,mapaHpx);
  const esc=calcularEscala(mpp,mapaWpx*0.30);
  const w=Math.round(esc.anchoPx);
  if(!w||!isFinite(w))return;
  const rotulos=esc.marcas.map((mk,i)=>({txt:mk.txt,pct:mk.pct,i}));
  const pad=6*k, alto=6*k;
  const fuente=9.5*k;
  const x=derecha-w-pad*2, y=abajo-(alto+fuente+6*k)-pad*2;
  cx.fillStyle=oscura?"rgba(16,18,20,.82)":"rgba(255,255,255,.82)";
  cx.fillRect(x,y,w+pad*2,alto+fuente+6*k+pad*2);
  cx.strokeStyle=oscura?"rgba(255,255,255,.18)":"rgba(0,0,0,.14)";
  cx.lineWidth=1; cx.strokeRect(x,y,w+pad*2,alto+fuente+6*k+pad*2);
  const bx=x+pad, by=y+pad;
  cx.strokeStyle=tinta; cx.lineWidth=Math.max(1,1*k);
  cx.beginPath();                            // regla en U
  cx.moveTo(bx,by); cx.lineTo(bx,by+alto); cx.lineTo(bx+w,by+alto); cx.lineTo(bx+w,by);
  cx.stroke();
  cx.fillStyle=tinta; cx.font=fuente+"px system-ui,sans-serif";
  rotulos.forEach((r,i)=>{
    const rx=bx+w*r.pct;
    if(i>0&&i<rotulos.length-1){              // marcas intermedias
      cx.beginPath(); cx.moveTo(rx,by+alto*0.35); cx.lineTo(rx,by+alto); cx.stroke();
    }
    const an=cx.measureText(r.txt).width;
    const tx=i===0?rx:(i===rotulos.length-1?rx-an:rx-an/2);
    cx.fillText(r.txt,tx,by+alto+4*k);
  });
}

/* --- enlaces de la interfaz --- */
function enlazarInterfaz(){

$("btn-lamina").onclick=lamAbrir;
$("lam-cerrar").onclick=lamCerrar;
$("lam-png").onclick=lamExportarPNG;
/* Antes de imprimir se fija el tamaño de página al formato de la lámina, para
   que el navegador no reescale ni recorte el mapa. */
function lamPrepararImpresion(){
  const f=FORMATOS[lam.fmt];
  let est=document.getElementById("lam-page-style");
  if(!est){est=document.createElement("style");est.id="lam-page-style";document.head.appendChild(est);}
  est.textContent="@page{size:"+f.w+"mm "+f.h+"mm;margin:0}";
  // la hoja se imprime a su medida exacta en milímetros
  const hoja=$("lam-hoja");
  hoja.dataset.wPx=hoja.style.width; hoja.dataset.hPx=hoja.style.height;
  hoja.style.width=f.w+"mm"; hoja.style.height=f.h+"mm";
}
function lamRestaurarPantalla(){
  const hoja=$("lam-hoja");
  if(hoja.dataset.wPx){hoja.style.width=hoja.dataset.wPx;hoja.style.height=hoja.dataset.hPx;}
  requestAnimationFrame(lamEscalaYNorte);
}
$("lam-imprimir").onclick=()=>{
  lamPrepararImpresion();
  requestAnimationFrame(()=>window.print());   // deja aplicar el tamaño antes del diálogo
};
window.addEventListener("beforeprint",lamPrepararImpresion);
window.addEventListener("afterprint",lamRestaurarPantalla);
document.querySelectorAll("#lam-formatos button").forEach(b=>b.onclick=()=>{
  lam.fmt=b.dataset.fmt; lamAplicarFormato(); lamActualizar();
  requestAnimationFrame(lamEscalaYNorte);   // el ancho del mapa cambió
});
["lam-titulo","lam-sub","lam-nota-txt","lam-cred-txt"].forEach(id=>$(id).oninput=lamActualizar);
["lam-op-leyenda","lam-op-kpis","lam-op-diag","lam-op-escala","lam-op-nota","lam-op-creditos","lam-op-oscura"]
  .forEach(id=>$(id).onchange=lamActualizar);
window.addEventListener("resize",()=>{
  if($("modo-lamina").classList.contains("abierto")){ lamAplicarFormato(); lamEscalaYNorte(); }});
document.addEventListener("keydown",(ev)=>{
  if(ev.key==="Escape"&&$("modo-lamina").classList.contains("abierto")) lamCerrar();});


}
