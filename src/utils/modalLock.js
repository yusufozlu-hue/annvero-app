/**
 * Modal açıkken arka planı kilitler: viewport scroll'u durur, arka içerik `inert` olur.
 *
 * Scroll kökü viewport'tur (`html`). globals.css'teki `html { overflow-x: clip }`
 * nedeniyle `body { overflow: hidden }` viewport'a aktarılmaz; kilit `html` üzerine
 * konmalıdır. Ref-count sayesinde iç içe modallar ve StrictMode çift effect'i
 * kilidi takılı bırakmaz; son kilit kalkınca inline stiller ve scroll konumu geri gelir.
 */

let lockCount = 0;
let savedState = null;

function supportsScrollbarGutter() {
  return typeof CSS !== "undefined" && CSS.supports?.("scrollbar-gutter: stable") === true;
}

function applyScrollLock() {
  const html = document.documentElement;
  const { body } = document;
  const scrollbarWidth = window.innerWidth - html.clientWidth;
  const state = {
    x: window.scrollX,
    y: window.scrollY,
    htmlOverflow: html.style.overflow,
    htmlScrollbarGutter: html.style.scrollbarGutter,
    bodyPaddingRight: body.style.paddingRight,
  };

  if (scrollbarWidth > 0) {
    if (supportsScrollbarGutter()) {
      html.style.scrollbarGutter = "stable";
    } else {
      const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbarWidth}px`;
    }
  }
  html.style.overflow = "hidden";
  return state;
}

function releaseScrollLock(state) {
  const html = document.documentElement;
  html.style.overflow = state.htmlOverflow;
  html.style.scrollbarGutter = state.htmlScrollbarGutter;
  document.body.style.paddingRight = state.bodyPaddingRight;
  if (window.scrollX !== state.x || window.scrollY !== state.y) {
    window.scrollTo({ left: state.x, top: state.y, behavior: "instant" });
  }
}

function applyInert(keepElement) {
  const touched = [];
  for (const child of Array.from(document.body.children)) {
    if (child === keepElement || child.contains(keepElement)) continue;
    if (child.inert || child.tagName === "SCRIPT" || child.tagName === "STYLE") continue;
    child.inert = true;
    touched.push(child);
  }
  return touched;
}

/**
 * @param {Element | null} keepElement Etkileşimli kalacak modal kökü (body'nin doğrudan çocuğu).
 * @returns {() => void} Kilidi bırakan fonksiyon; birden çok çağrı güvenlidir.
 */
export function acquireModalLock(keepElement) {
  if (typeof document === "undefined") return () => {};

  lockCount += 1;
  if (lockCount === 1) savedState = applyScrollLock();
  const inerted = applyInert(keepElement);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const element of inerted) element.inert = false;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0 && savedState) {
      const state = savedState;
      savedState = null;
      releaseScrollLock(state);
    }
  };
}
