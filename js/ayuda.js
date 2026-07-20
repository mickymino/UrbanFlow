// Tooltips de ayuda de la interfaz.
//
// Se dibujan en una capa fija sobre <body> en lugar de con ::after, porque los
// paneles laterales tienen overflow-y:auto y recortarían un tooltip alto.
// Solo afecta a la presentación: no toca parámetros ni motor de simulación.

const CAPA_ID = "tip-flotante";
let capa = null;
let anclaActual = null;

function capaTip() {
  if (!capa) {
    capa = document.createElement("div");
    capa.id = CAPA_ID;
    capa.setAttribute("role", "tooltip");
    document.body.appendChild(capa);
  }
  return capa;
}

/* El texto llega en data-tip con saltos de línea reales (&#10; en el HTML).
   Las líneas que empiezan por "• " o "N = " se pintan como lista. */
function pintar(texto) {
  const c = capaTip();
  c.textContent = "";
  for (const linea of String(texto).split("\n")) {
    const t = linea.trim();
    if (!t) continue;   // la separación la dan los márgenes de cada párrafo
    const p = document.createElement("p");
    p.className = /^(•|\d)/.test(t) ? "tip-item" : "tip-parrafo";
    if (/^Importante:/i.test(t)) p.className = "tip-aviso";
    p.textContent = t;
    c.appendChild(p);
  }
}

function colocar(ancla) {
  const c = capaTip();
  const r = ancla.getBoundingClientRect();
  c.style.visibility = "hidden";
  c.classList.add("visible");
  const cw = c.offsetWidth, ch = c.offsetHeight;
  const margen = 10;

  // preferencia: encima del icono; si no cabe, debajo; y nunca fuera de la ventana
  let top = r.top - ch - 8;
  if (top < margen) top = r.bottom + 8;
  top = Math.max(margen, Math.min(top, window.innerHeight - ch - margen));

  // centrado horizontal, sujeto a los bordes de la ventana
  let left = r.left + r.width / 2 - cw / 2;
  left = Math.max(margen, Math.min(left, window.innerWidth - cw - margen));

  c.style.top = Math.round(top) + "px";
  c.style.left = Math.round(left) + "px";
  c.style.visibility = "";
}

function mostrar(ancla) {
  const texto = ancla.getAttribute("data-tip");
  if (!texto) return;
  anclaActual = ancla;
  pintar(texto);
  colocar(ancla);
}

function ocultar() {
  anclaActual = null;
  if (capa) capa.classList.remove("visible");
}

/* Delegación: funciona también con los iconos que se creen más adelante. */
document.addEventListener("mouseover", (ev) => {
  const a = ev.target.closest?.(".ayuda[data-tip]");
  if (a && a !== anclaActual) mostrar(a);
});
document.addEventListener("mouseout", (ev) => {
  const a = ev.target.closest?.(".ayuda[data-tip]");
  if (a && a === anclaActual && !a.contains(ev.relatedTarget)) ocultar();
});
// accesible por teclado
document.addEventListener("focusin", (ev) => {
  const a = ev.target.closest?.(".ayuda[data-tip]");
  if (a) mostrar(a);
});
document.addEventListener("focusout", () => ocultar());
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") ocultar(); });

/* Al desplazar el panel el tooltip debe seguir a su icono, no cerrarse: al llegar
   con Tab el navegador desplaza el icono a la vista, y cerrar aquí haría
   desaparecer la ayuda en el mismo momento de abrirla. Solo se cierra si el
   icono ha dejado de estar visible. */
function reubicar() {
  if (!anclaActual) return;
  const r = anclaActual.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { ocultar(); return; }
  colocar(anclaActual);
}
window.addEventListener("scroll", reubicar, true);
window.addEventListener("resize", reubicar);

/* Los iconos de ayuda son alcanzables con Tab y se anuncian como tales. */
for (const a of document.querySelectorAll(".ayuda[data-tip]")) {
  a.setAttribute("tabindex", "0");
  a.setAttribute("aria-label", "Ayuda");
}
