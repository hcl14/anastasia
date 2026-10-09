// Small DOM and formatting helpers.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** h('div.cls#id', {attrs}, children...) */
export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const e = document.createElement(m[1] || 'div');
  for (const t of (m[2].match(/[.#][\w-]+/g) || [])) t[0] === '.' ? e.classList.add(t.slice(1)) : (e.id = t.slice(1));
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}

/** Verbatim text with the given substrings wrapped in <mark>. The text itself is never altered. */
export function highlightHTML(text, subs) {
  text = String(text ?? '');
  const ranges = [];
  for (const s of (subs || [])) {
    if (!s) continue;
    let i = 0;
    while ((i = text.indexOf(s, i)) >= 0) { ranges.push([i, i + s.length]); i += s.length; }
  }
  // also mark bare numbers with units when nothing was given
  if (!ranges.length) {
    const re = /\d+(?:[.,]\d+)?(?:\s*[xх×*]\s*\d+(?:[.,]\d+)?){0,2}\s*(?:mm|cm|мм|см|mL|ml|мл)?/g;
    let m; while ((m = re.exec(text))) if (/\d/.test(m[0]) && m[0].trim().length > 1) ranges.push([m.index, m.index + m[0].trimEnd().length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of ranges) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1]) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
  let out = '', p = 0;
  for (const [a, b] of merged) { out += esc(text.slice(p, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; p = b; }
  return out + esc(text.slice(p));
}

export function fmtVol(v) {
  if (v == null || !isFinite(v)) return '—';
  if (v >= 100) return Math.round(v) + ' mL';
  if (v >= 10) return v.toFixed(1) + ' mL';
  return v.toFixed(2) + ' mL';
}
export function fmtNum(v, d = 0) { return v == null || !isFinite(v) ? '—' : (+v).toFixed(d); }
export function fmtPct(p, d = 0) {
  if (p == null || !isFinite(p)) return '—';
  const s = Math.abs(p) < 0.5 && d === 0 ? '0' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p).toFixed(d);
  return s + ' %';
}
export function pctChange(a, b) { return a > 0 && b != null ? 100 * (b - a) / a : null; }
export function fmtDims(arr, unit = 'mm') {
  if (!arr) return '—';
  const v = arr.filter(x => x != null && isFinite(x));
  if (!v.length) return '—';
  return v.map(x => (Math.round(x * 10) / 10).toString()).join(' × ') + ' ' + unit;
}
export function fmtMB(b) { return (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + ' MB'; }
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** parse 'Sg2/3', 'S8', 'S4a', 'V-VIII', 'II/III', 'segment I', 'S5-8' -> sorted unique segment numbers 1..8 */
export function parseSegments(s) {
  if (!s) return [];
  const ROM = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  const toks = [];
  const re = /(?<![A-Za-z])(VIII|VII|VI|IV|V|III|II|I)(?![A-Za-z])|([1-8])/g;
  const str = String(s).replace(/segments?|sg|seg|сегмент\w*|s(?=\d)/gi, ' ');
  let m;
  while ((m = re.exec(str))) toks.push({ n: m[1] ? ROM[m[1]] : +m[2], i: m.index, end: re.lastIndex });
  const out = new Set();
  for (let k = 0; k < toks.length; k++) {
    out.add(toks[k].n);
    const between = k + 1 < toks.length ? str.slice(toks[k].end, toks[k + 1].i) : '';
    if (/^\s*[-–—]\s*$/.test(between)) for (let j = toks[k].n; j <= toks[k + 1].n; j++) out.add(j);
  }
  return [...out].filter(n => n >= 1 && n <= 8).sort((a, b) => a - b);
}
