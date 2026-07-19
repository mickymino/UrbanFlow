// Escalas de clasificación e interpretación de los indicadores.
// Dos naturalezas, deliberadamente separadas:
//  (A) DESEMPEÑO — accesibilidad, conectividad, tiempo y distancia: miden si la
//      red funciona bien para caminar, así que admiten juicio de valor.
//  (B) DESCRIPTIVOS — flujo máximo, flujo promedio, concentración y las dos
//      tarjetas de localización: describen el patrón espacial de la ciudad y
//      NO se juzgan. Una concentración alta puede ser una centralidad
//      consolidada o un eje comercial vivo, no un defecto.
// La jerarquía de corredor/intersección/flujo máximo usa un índice RELATIVO a
// la propia simulación (máximo / P95), por lo que es escalable a cualquier
// tamaño de área. Los umbrales absolutos no servirían: dependen del número de
// tramos del área analizada.

/* Cinco niveles de desempeño, con las etiquetas exactas de las escalas:
   Excelente · Alta · Moderada · Baja · Deficiente */
export const NIVELES={
  exc:["Excelente","n-exc","c-ok"], alta:["Alta","n-alt","c-ok"],
  mod:["Moderada","n-mod","c-med"], baja:["Baja","n-baj","c-med"],
  def:["Deficiente","n-def","c-alt"],
};

/* --- escalas de interpretación definidas por Miguel (una frase por rango) --- */

/* (A) DESEMPEÑO — con semáforo */
export function nivelAccesibilidad(v){          // % de red alcanzable en 10 min
  if(v>=90)return NIVELES.exc; if(v>=75)return NIVELES.alta;
  if(v>=60)return NIVELES.mod; if(v>=40)return NIVELES.baja; return NIVELES.def;
}
export function interpAccesibilidad(v){
  if(v>=90)return "La mayor parte de la red puede alcanzarse caminando en un tiempo reducido.";
  if(v>=75)return "La red presenta una buena cobertura peatonal con pocas zonas de baja accesibilidad.";
  if(v>=60)return "La accesibilidad es adecuada, aunque existen sectores con cobertura limitada.";
  if(v>=40)return "Una parte importante de la red requiere recorridos prolongados para ser alcanzada.";
  return "La cobertura peatonal es reducida y limita la accesibilidad del sistema.";
}
export function nivelConectividad(v){           // % de nodos en el componente principal
  if(v>=95)return NIVELES.exc; if(v>=80)return NIVELES.alta;
  if(v>=60)return NIVELES.mod; if(v>=40)return NIVELES.baja; return NIVELES.def;
}
export function interpConectividad(v){
  if(v>=95)return "La red presenta una estructura prácticamente continua.";
  if(v>=80)return "La mayor parte de la red se encuentra conectada.";
  if(v>=60)return "Existen sectores desconectados que reducen la continuidad.";
  if(v>=40)return "La conectividad es limitada debido a múltiples fragmentaciones.";
  return "La red presenta una alta fragmentación y baja continuidad.";
}
export function nivelTiempo(m){                 // min por recorrido — menor es mejor
  if(m<=8)return NIVELES.exc; if(m<=12)return NIVELES.alta;
  if(m<=16)return NIVELES.mod; if(m<=20)return NIVELES.baja; return NIVELES.def;
}
export function interpTiempo(m){
  if(m<=8)return "Recorridos muy eficientes.";
  if(m<=12)return "Recorridos eficientes para desplazamientos cotidianos.";
  if(m<=16)return "Recorridos aceptables.";
  if(m<=20)return "Recorridos prolongados.";
  return "Recorridos largos que reducen la accesibilidad peatonal.";
}
export function nivelDistancia(d){              // m por recorrido — menor es mejor
  if(d<=600)return NIVELES.exc; if(d<=1000)return NIVELES.alta;
  if(d<=1500)return NIVELES.mod; if(d<=2000)return NIVELES.baja; return NIVELES.def;
}
export function interpDistancia(d){
  if(d<=600)return "Escala peatonal muy compacta.";
  if(d<=1000)return "Distancias cómodas para caminar.";
  if(d<=1500)return "Distancias moderadas.";
  if(d<=2000)return "Recorridos largos.";
  return "Distancias elevadas para desplazamientos peatonales.";
}

/* (B) DESCRIPTIVOS — etiqueta sin color, sin juicio de valor.
   La intensidad se expresa en cinco grados: Muy bajo → Muy alto. */
export const GRADOS=["Muy bajo","Bajo","Moderado","Alto","Muy alto"];
export const GRADOS_F=["Muy baja","Baja","Moderada","Alta","Muy alta"];

/* Flujo máximo: intensidad relativa del tramo más cargado respecto al resto (máx/p95) */
/* Flujo máximo comparte el mismo índice relativo (máximo / P95) que el corredor
   y la intersección: son lecturas del mismo fenómeno, así que deben usar los
   mismos cortes para no contradecirse entre tarjetas. */
export const gradoFlujoMax=gradoJerarquia;
export function interpFlujoMax(razon){
  return ["El flujo peatonal se distribuye de forma homogénea entre los recorridos.",
          "No existe un corredor claramente dominante.",
          "Se identifica un corredor principal con una intensidad superior al resto de la red.",
          "Uno o varios corredores concentran gran parte del movimiento peatonal.",
          "Existe un eje dominante que estructura la movilidad peatonal del sector."][gradoFlujoMax(razon)];
}
/* Flujo promedio: nivel general de actividad, relativo al máximo de la red */
export function gradoFlujoProm(prom,max){
  const r=max?prom/max:0;
  if(r>=0.40)return 4; if(r>=0.28)return 3;
  if(r>=0.18)return 2; if(r>=0.10)return 1; return 0;
}
export function interpFlujoProm(prom,max){
  return ["Actividad peatonal reducida.",
          "Actividad peatonal limitada.",
          "Actividad peatonal constante.",
          "Actividad peatonal elevada.",
          "Actividad peatonal intensa en la mayor parte de la red."][gradoFlujoProm(prom,max)];
}
/* Concentración espacial del flujo (Gini) */
export function gradoConcentracion(g){
  if(g>=0.68)return 4; if(g>=0.55)return 3;
  if(g>=0.42)return 2; if(g>=0.30)return 1; return 0;
}
export function interpConcentracion(g){
  return ["El flujo se distribuye de forma homogénea entre los corredores.",
          "Predomina una distribución relativamente equilibrada.",
          "Se distinguen corredores principales sin perder diversidad de recorridos.",
          "La actividad peatonal se concentra principalmente en ejes estructurantes.",
          "La movilidad depende fuertemente de pocos corredores principales."][gradoConcentracion(g)];
}


/* ---------- jerarquía RELATIVA a la propia red ----------
   Índice = flujo máximo / P95 de la distribución. Mide cuánto sobresale el
   elemento principal sobre los que ya presentan flujos elevados DENTRO DE LA
   MISMA simulación. Es escalable: funciona igual en un área de 1 km que en una
   de 5 km, porque no compara contra una escala absoluta sino contra el reparto
   observado. El índice y el P95 son internos: nunca se muestran al usuario. */
export const CORTES_JERARQUIA=[2.00,1.50,1.25,1.10];   // dominante · estratégico · relevante · local
export function gradoJerarquia(indice){
  if(indice>CORTES_JERARQUIA[0])return 4;
  if(indice>=CORTES_JERARQUIA[1])return 3;
  if(indice>=CORTES_JERARQUIA[2])return 2;
  if(indice>=CORTES_JERARQUIA[3])return 1;
  return 0;
}
export const gradoInterseccion=gradoJerarquia;
export const ETIQ_NODO=["Nodo secundario","Nodo local","Nodo relevante","Nodo estratégico","Nodo principal"];
export function interpInterseccion(razon){
  return ["No existe una intersección claramente dominante.",
          "Punto de conexión de importancia local.",
          "Intersección con actividad superior al promedio.",
          "Punto clave de convergencia peatonal.",
          "Principal punto de articulación de la movilidad peatonal."][gradoInterseccion(razon)];
}

/* Corredor más transitado: jerarquía RELATIVA — índice = flujo máximo / P95 de
   los tramos con actividad. El porcentaje del flujo total se sigue mostrando,
   pero solo como dato informativo: no clasifica, porque depende del número de
   tramos del área analizada (en una red de miles, ningún tramo llega al 6 %).
   Mide un fenómeno distinto al de la tarjeta Concentración (que describe el
   reparto global): aquí interesa QUÉ vía concreta estructura el flujo. */
export const gradoCorredor=gradoJerarquia;
export const ETIQ_CORREDOR=["Corredor secundario","Corredor local","Corredor relevante",
                     "Corredor estratégico","Corredor dominante"];
export function interpCorredor(indice){
  return ["Actividad peatonal limitada.",
          "Corredor con actividad estable.",
          "Eje con intensidad superior al promedio.",
          "Corredor clave para la movilidad peatonal.",
          "Principal eje estructurante del flujo peatonal."][gradoCorredor(indice)];
}
