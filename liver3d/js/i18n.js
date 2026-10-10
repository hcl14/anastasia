// Interface language (EN | УКР). The page is written in English; in Ukrainian mode every text node and the attributes title /
// aria-label / placeholder / label are translated from a dictionary (exact strings, then regex patterns, then piece by piece across
// the separators " · ", " — ", " → ", "; "). A MutationObserver translates whatever the viewer renders later, so render code stays
// English. Never translated: anything inside [translate="no"] (doctors' verbatim quotes and their glosses, lesion ID chips).
// window.__i18nMissing collects strings that had no translation (for the test).
import { UK, UK_PATTERNS } from './i18n_uk.js';
export { UK };

export const UI_LANGS = ['en', 'uk'];
let lang = 'en';
const extra = {};                       // scene-specific pairs (data/scene_ua.json), merged at load
const ORIG = new WeakMap();             // text node / element -> { text | attrs } in English
const ATTRS = ['title', 'aria-label', 'placeholder', 'label'];
const missing = new Set(); window.__i18nMissing = missing;
let observer = null, busy = false;

export function uiLang() { return lang; }
export function addStrings(map) { Object.assign(extra, map); missing.clear(); if (lang === 'uk') walk(document.body); }

const LATIN = /[A-Za-z]{3,}/;
const KEEP = /^(?:[\s\d.,:;+\-−–—×x%()/<>=≥≤~±°|·→↔↗▶■▬━…'"“”⚠]|mm|mL|cm|SUV(?:max)?|HU|PET|CT|FDG|Dice|p95|RAS|IVC|LHV|MHV|RHV|[RLAPSI]|[A-Z]\d+\w*|S\d\w*|II?I?|IV|VI{0,3}|IX|X)*$/;
function lookup(s) {
  if (s in extra) return extra[s];
  if (s in UK) return UK[s];
  for (const [re, rep] of UK_PATTERNS) { const m = s.match(re); if (m) { const r = typeof rep === 'function' ? rep(m, tr) : s.replace(re, rep); if (r != null) return r; } }
  return null;
}
/** translate one string (English -> Ukrainian); returns the input when nothing matches */
export function tr(s) {
  if (lang !== 'uk' || s == null) return s;
  const str = String(s), lead = str.match(/^\s*/)[0], trail = str.match(/\s*$/)[0], core = str.trim();
  if (!core || !LATIN.test(core) || KEEP.test(core)) return str;
  let out = lookup(core);
  if (out == null) {
    // piece by piece across separators (keeps numbers, IDs and units)
    const parts = core.split(/( · | — | → | ↔ |; |: (?=[A-Z]))/);
    if (parts.length > 1) {
      let any = false;
      const t = parts.map((p, i) => { if (i % 2) return p; const x = lookup(p.trim()); if (x != null) { any = true; return p.replace(p.trim(), x); } return p; });
      if (any) out = t.join('');
    }
  }
  if (out == null) return str;
  return lead + out + trail;
}
/** template helper for code: T('Loading meshes {a}/{b}', {a, b}) */
export function T(s, vars) {
  let o = tr(s);
  if (vars) for (const [k, v] of Object.entries(vars)) o = o.split('{' + k + '}').join(v);
  return o;
}

/** record an untranslated string (only whole, top-level texts that look like English words) */
function note(s) { const c = String(s).trim(); if (lang === 'uk' && c && LATIN.test(c) && !KEEP.test(c) && !/[А-Яа-яІіЇїЄєҐґ]/.test(c) && !/^[\w./-]+\.\w+$/.test(c) && UK[c] !== c) missing.add(c); }
const skip = n => { const e = n.nodeType === 1 ? n : n.parentElement; return !e || !!e.closest('[translate="no"],[data-lang=en],script,style,#orient'); };
function doText(n) {
  if (skip(n)) return;
  const cur = n.nodeValue;
  const rec = ORIG.get(n);
  if (rec && rec.out === cur) return;                // already ours
  const t = tr(cur);
  if (t !== cur) { busy = true; n.nodeValue = t; busy = false; ORIG.set(n, { src: cur, out: t }); }
  else note(cur);
}
function doAttrs(e) {
  if (skip(e)) return;
  let rec = ORIG.get(e); if (!rec) ORIG.set(e, rec = {});
  for (const a of ATTRS) {
    if (!e.hasAttribute(a)) continue;
    const cur = e.getAttribute(a);
    if (rec[a] && rec[a].out === cur) continue;
    const t = tr(cur);
    if (t !== cur) { busy = true; e.setAttribute(a, t); busy = false; rec[a] = { src: cur, out: t }; }
    else note(cur);
  }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
}
function restore(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = root; n; n = it.nextNode()) {
    const rec = ORIG.get(n); if (!rec) continue;
    if (n.nodeType === 3) { if (rec.out === n.nodeValue) n.nodeValue = rec.src; ORIG.delete(n); }
    else { for (const a of ATTRS) if (rec[a] && n.getAttribute(a) === rec[a].out) n.setAttribute(a, rec[a].src); ORIG.delete(n); }
  }
}
export function setUiLang(l) {
  l = UI_LANGS.includes(l) ? l : 'en';
  if (l === lang && observer) return;
  lang = l;
  document.documentElement.lang = l;
  if (observer) { observer.disconnect(); observer = null; }
  if (l === 'uk') {
    walk(document.body);
    observer = new MutationObserver(ms => {
      if (busy) return;
      for (const m of ms) {
        if (m.type === 'childList') m.addedNodes.forEach(walk);
        else if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  } else restore(document.body);
}
/** initial language: hash ui=, then localStorage, then the browser language */
export function initialUiLang() {
  const m = location.hash.match(/[#&]ui=(en|uk)\b/); if (m) return m[1];
  try { const s = localStorage.getItem('liver3d-ui'); if (UI_LANGS.includes(s)) return s; } catch (e) { }
  return /^uk\b/i.test(navigator.language || '') ? 'uk' : 'en';
}
export function rememberUiLang(l) { try { localStorage.setItem('liver3d-ui', l); } catch (e) { } }
