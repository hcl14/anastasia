// Reports panel: the radiologists' own words next to the model. Quotes are shown verbatim (quote_orig);
// the English gloss is labelled as a gloss. Nothing here rewrites a quote.
import { $, $$, h, esc, highlightHTML, fmtPct } from './util.js';

const KIND_LABEL = { size: 'size', size_change: 'size change', activity: 'activity', location: 'location', vessel_relation: 'vessel', other: 'other' };

export function verdictClass(v) {
  const s = String(v || '').toLowerCase();
  if (s.startsWith('agree')) return 'agrees';
  if (s.includes('larger') || s.includes('more growth')) return 'larger';
  if (s.includes('smaller') || s.includes('less growth')) return 'smaller';
  return 'nc';
}
/** verdict on the CHANGE of a size_change claim (data builder: change_verdict, model_change_pct), or null */
export function changeVerdict(c) {
  if (c?.kind !== 'size_change' || !c.change_verdict) return null;
  const rep = c.change?.percent, mod = c.model_change_pct;
  const nums = mod != null ? ` (model ${fmtPct(mod)}${rep != null ? ` vs report ${fmtPct(rep)}` : ''})` : '';
  const core = c.change_verdict.replace(/\s*\(within 15 percentage points\)/, '') + nums;
  return { cls: verdictClass(c.change_verdict), text: 'change: ' + core, core, title: c.model_change_definition || '' };
}
export function verdictText(viz) {
  if (!viz) return null;
  const v = String(viz.verdict || 'not comparable');
  const ds = (viz.delta_pct || []).filter(x => x != null && isFinite(x));
  if (!ds.length || verdictClass(v) === 'nc') return v.replace(/\s*\(<=?\s*15\s*%\)/, '');
  const big = ds.reduce((a, b) => Math.abs(b) > Math.abs(a) ? b : a, 0);
  const base = v.replace(/\s*\(<=?\s*15\s*%\)/, '');
  return `${base} (${fmtPct(big)})`;
}
export function linkURL(src, path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const base = src?.site_base || '';
  return base ? base.replace(/\/?$/, '/') + path.replace(/^\//, '') : path;
}

export class Reports {
  constructor(app, host) {
    this.app = app; this.host = host; this.data = null; this.file = null; this.err = null;
    this.view = 'claims'; this.allDates = false; this.hiddenReaders = new Set(); this.onlySel = false; this.lang = 'en'; this.gloss = { en: {}, uk: {} };
  }
  async load(base, name) {
    const tryFiles = [...new Set([name || 'report_claims.json', 'report_claims.json', 'report_claims_raw.json'])];
    for (const f of tryFiles) {
      try {
        const r = await fetch(new URL(f, base).href, { cache: 'no-cache' });
        if (!r.ok) continue;
        this.data = await r.json(); this.file = f; break;
      } catch (e) { this.err = e.message; }
    }
    // statement glosses (side files keyed by claim id; the verbatim fields are never changed)
    for (const [k, f] of [['en', 'report_claims_en.json'], ['uk', 'report_claims_ua.json']]) {
      try { const r = await fetch(new URL(f, base).href, { cache: 'no-cache' }); if (r.ok) this.gloss[k] = (await r.json()).glosses || {}; } catch (e) { }
    }
    const cl = this.data?.claims || [];
    this.byIdMap = new Map(cl.map(c => [c.id, c]));
    this.enriched = cl.some(c => c.viz || c.viz_to || c.viz_from);
    this.readers = [...new Map(cl.map(c => [c.reader, c.reader_rank ?? 9])).entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
    this.render();
  }
  byId(id) { return this.byIdMap?.get(id); }
  /**
   * doctors' statements about one object (hover tooltip): type = 'lesion' | part kind (calcifications, walls, cores, nodules, active) |
   * layer type (liver, portal, hepatic_veins, ivc, gallbladder, bile_ducts, segment ...), lesionId or null. Uses claims[].tags
   * (tools/tag_report_claims.py). Returns { list: [{c, general}], date, otherDate } with the best 1-3 claims of `date`, ordered by match
   * then reader authority; when `date` has none, the nearest other date that has some (otherDate = true).
   */
  claimsFor(type, lesionId, date) {
    const cl = (this.data?.claims || []).filter(c => c.tags);
    const score = c => {
      const t = c.tags, st = new Set(t.structures || []), specific = !!lesionId && t.lesions.includes(lesionId);
      if (type === 'lesion') return specific ? 3 + (st.has('size') ? 2 : 0) + (st.has('lesion') ? 1 : 0) : -1;
      if (lesionId) { if (!st.has(type)) return -1; return specific ? 3 : (t.general ? 1 : -1); }
      if (type === 'liver') return t.general && (st.has('liver') || st.has('lesion')) ? 2 + (st.has('liver') ? 1 : 0) : -1;
      return st.has(type) ? (t.general ? 2 : 1) : -1;
    };
    const FIELD = { lesion: ['rmass', 'llesion', 'lesions_other'] };   // the claims engineer's own structure field agrees: small bonus
    const bonus = c => ((FIELD[type] || [type]).includes(c.structure) ? 0.5 : 0);
    const best = d => {
      const ranked = cl.filter(c => this.claimDates(c).has(d)).map(c => ({ c, s: score(c) })).filter(x => x.s >= 0).map(x => ({ ...x, s: x.s + bonus(x.c) }))
        .sort((a, b) => b.s - a.s || (a.c.reader_rank ?? 9) - (b.c.reader_rank ?? 9));
      const out = [];
      for (const x of ranked) {   // the same sentence split into two claims: keep the better-matching one only
        const q = x.c.quote_orig || '';
        if (out.some(o => o.c.reader === x.c.reader && (o.c.quote_orig.includes(q) || q.includes(o.c.quote_orig)))) continue;
        out.push(x); if (out.length === 3) break;
      }
      return out.map(x => ({ c: x.c, general: !!lesionId && !x.c.tags.lesions.includes(lesionId) }));
    };
    let list = best(date);
    if (list.length) return { list, date, otherDate: false };
    const ds = this.app.dates, i = ds.indexOf(date);
    for (const d of [...ds].filter(k => k !== date).sort((a, b) => Math.abs(ds.indexOf(a) - i) - Math.abs(ds.indexOf(b) - i) || ds.indexOf(b) - ds.indexOf(a))) {
      list = best(d); if (list.length) return { list, date: d, otherDate: true };
    }
    return { list: [], date, otherDate: false };
  }
  /** short verbatim snippet (<= max chars) of a claim around its key phrase, as highlighted HTML */
  snippetHTML(c, max = 160, x = this.stmt(c)) {
    const t = String(x.text || '');
    if (t.length <= max) return highlightHTML(t, x.hl);
    const hl = (x.hl || []).find(y => y && t.includes(y));
    const at = hl ? t.indexOf(hl) : 0;
    let a = Math.max(0, Math.min(at - Math.round((max - (hl?.length || 0)) / 2), t.length - max)), b = Math.min(t.length, a + max);
    return (a > 0 ? '…' : '') + highlightHTML(t.slice(a, b), x.hl) + (b < t.length ? '…' : '');
  }
  /** show a claim in the Reports tab (card highlighted and scrolled into view) and on the model (claim box, fly-to) */
  async open(id) {
    const c = this.byId(id); if (!c) return;
    this.app.setTab('reports');
    await this.app.claimViz.show(c);
    // the card must be listed: claims view, its reader not filtered out, all dates / no lesion filter if still missing
    if (this.view !== 'claims' || this.hiddenReaders.has(c.reader)) { this.view = 'claims'; this.hiddenReaders.delete(c.reader); this.render(); }
    if (!$(`#p-reports .claim[data-id="${CSS.escape(id)}"]`)) { this.allDates = true; this.onlySel = false; this.render(); }
    // panels re-render while the date switch settles: mark and scroll once it has
    await new Promise(r => setTimeout(r, 250));
    const el = $(`#p-reports .claim[data-id="${CSS.escape(id)}"]`);
    if (el) { this.markActive(id); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }
  outsideLabel(k) { const o = this.data?.conventions?.date_keys_outside_model?.[k]; return o ? `${o.replace(/,.*$/, '')} (not in the 3D model)` : null; }
  setLang(l) { this.lang = l; this.render(); }
  /**
   * the statement in the chosen language: { text, hl, lang, verbatim, label }. 'orig' = verbatim original; 'en' = English gloss
   * (report_claims_en.json, else quote_en); 'uk' = the original when it is Ukrainian, else the Ukrainian gloss (report_claims_ua.json).
   */
  stmt(c, lang = this.lang) {
    const orig = { text: c.quote_orig || '', hl: c.highlight, lang: c.lang || 'und', verbatim: true, label: 'original (verbatim)' };
    if (lang === 'orig' || c.lang === lang) return orig;
    const g = this.gloss[lang]?.[c.id];
    if (lang === 'en' && (g?.text || c.quote_en)) return { text: g?.text || c.quote_en, hl: g?.highlight?.length ? g.highlight : c.highlight, lang: 'en', verbatim: false, label: 'English gloss - not verbatim', source: g?.gloss_source || 'provided' };
    if (lang === 'uk' && g?.text) return { text: g.text, hl: g.highlight, lang: 'uk', verbatim: false, label: 'український переклад - не дослівно', source: g.gloss_source };
    return orig;
  }
  /** statement blocks: the chosen language first; when that is a gloss, the verbatim original underneath (small) */
  quoteEls(c, opts = {}) {
    const p = this.stmt(c), out = [];
    const block = (x, cls) => { const q = h('blockquote.q' + (cls || ''), { lang: x.lang, translate: 'no' }); q.innerHTML = opts.snippet ? this.snippetHTML(c, opts.snippet, x) : highlightHTML(x.text, x.hl); return q; };
    if (!p.verbatim) out.push(h('div.gloss-note', { translate: 'no' }, p.label));
    out.push(block(p));
    if (!p.verbatim) { const o = this.stmt(c, 'orig'); out.push(h('div.gloss-note.orig', null, 'original (verbatim)'), block(o, '.orig')); }
    return out;
  }
  onDate() { this.render(); }
  onSelectLesion() { this.render(); }
  markActive(id) {
    for (const el of $$('.claim', document)) el.classList.toggle('active', el.dataset.id === id);
  }
  claimDates(c) { return new Set([c.date_key, c.change?.from?.date_key, c.change?.to?.date_key, c.viz?.date_key].filter(Boolean)); }
  visibleClaims() {
    const st = this.app.state, d = this.app.shown;
    return (this.data?.claims || []).filter(c =>
      (this.allDates || this.claimDates(c).has(d)) && !this.hiddenReaders.has(c.reader) && (!this.onlySel || !st.sel || c.lesion_id === st.sel));
  }

  render() {
    const host = this.host; host.innerHTML = '';
    const tab = $('#tab-reports');
    if (!this.data) {
      tab.textContent = 'Reports';
      host.append(h('p.empty', null, 'No report claims file next to the scene (looked for report_claims.json and report_claims_raw.json).'));
      return;
    }
    const app = this.app, st = app.state;
    const nDate = (this.data.claims || []).filter(c => this.claimDates(c).has(app.shown)).length;
    tab.innerHTML = `Reports <span class="count">${nDate}</span>`;

    const seg = h('div.seg', { role: 'group', 'aria-label': 'Reports view' },
      h('button', { 'aria-pressed': String(this.view === 'claims'), onclick: () => { this.view = 'claims'; this.render(); } }, 'Claims'),
      h('button', { 'aria-pressed': String(this.view === 'contra'), onclick: () => { this.view = 'contra'; this.render(); } }, `Disagreements (${(this.data.contradictions || []).length})`));
    const all = h('button', { 'aria-pressed': String(this.allDates), title: 'Show the claims of every date, not only the current one', onclick: () => { this.allDates = !this.allDates; this.render(); } }, 'All dates');
    const setL = l => { this.lang = l; st.lang = l; st.langExplicit = true; app.writeHash(); this.render(); app.claimViz.renderBar(); };
    const langSeg = h('div.seg.stmt-lang', { role: 'group', 'aria-label': 'Language of the doctors\' statements', title: 'Language of the doctors\' statements' },
      ...[['orig', 'Original'], ['en', 'English'], ['uk', 'Українська']].map(([k, t]) => h('button', { 'aria-pressed': String(this.lang === k), 'data-stmt': k, onclick: () => setL(k) }, t)));
    host.append(h('div.rep-controls', null, seg, all, langSeg));
    if (this.file !== 'report_claims.json' || !this.enriched) {
      host.append(h('p.small.muted', null, `Claims from ${this.file}${this.enriched ? '' : ' (model measurements not filled in yet: reported sizes are drawn axis-aligned at the lesion centre, without a model box)'}.`));
    }
    // reader filter
    const chips = h('div.chips', { role: 'group', 'aria-label': 'Filter by reader' });
    for (const [r, rank] of this.readers) {
      chips.append(h('button.chip', {
        'aria-pressed': String(!this.hiddenReaders.has(r)), title: `rank ${rank}`,
        onclick: () => { this.hiddenReaders.has(r) ? this.hiddenReaders.delete(r) : this.hiddenReaders.add(r); this.render(); },
      }, h('span', { class: 'rank r' + Math.min(4, rank) }, rank), ' ', h('span', { translate: 'no' }, shortReader(r))));
    }
    if (st.sel) chips.append(h('button.chip', { 'aria-pressed': String(this.onlySel), onclick: () => { this.onlySel = !this.onlySel; this.render(); } }, `only ${st.sel}`));
    host.append(chips);

    if (this.view === 'contra') return this.renderContra(host);

    const list = this.visibleClaims();
    if (!list.length) {
      host.append(h('p.empty', null, this.allDates ? 'No claims match the filters.' : `No claims about the ${app.dateLabel(app.shown)} scan match the filters. Try “All dates”.`));
      return;
    }
    host.append(h('p.small.muted', null, `${list.length} claim${list.length > 1 ? 's' : ''}${this.allDates ? '' : ' about the ' + app.dateLabel(app.shown) + ' scan'}. Click a card to show it on the model. Readers are ordered by authority (1 = highest).`));
    const byReader = new Map();
    for (const c of list) { if (!byReader.has(c.reader)) byReader.set(c.reader, []); byReader.get(c.reader).push(c); }
    const readers = [...byReader.keys()].sort((a, b) => (byReader.get(a)[0].reader_rank ?? 9) - (byReader.get(b)[0].reader_rank ?? 9) || String(a).localeCompare(String(b)));
    for (const r of readers) {
      const cs = byReader.get(r);
      host.append(h('div.reader-h', null, h('span', { class: 'rank r' + Math.min(4, cs[0].reader_rank ?? 4) }, cs[0].reader_rank ?? '?'), h('span', { translate: 'no' }, r || 'Unknown reader')));
      const byLes = new Map();
      for (const c of cs) { const k = c.lesion_id || ''; if (!byLes.has(k)) byLes.set(k, []); byLes.get(k).push(c); }
      const keys = [...byLes.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b));
      for (const k of keys) {
        const les = k && app.lesionById(k);
        host.append(h('div.les-h', null, les ? h('span.lchip', { style: { background: les.color } }, k) : h('span.kind', null, k || 'general'), les ? les.name || '' : (k ? 'lesion not in the 3D scene' : 'liver / general')));
        for (const c of byLes.get(k)) host.append(this.card(c));
      }
    }
    this.markActive(st.claim);
  }

  renderContra(host) {
    const cs = this.data.contradictions || [];
    if (!cs.length) { host.append(h('p.empty', null, 'The claims file lists no contradictions.')); return; }
    for (const k of cs) {
      const claims = (k.claims || []).map(id => this.byId(id)).filter(Boolean)
        .sort((a, b) => (a.reader_rank ?? 9) - (b.reader_rank ?? 9));
      const missing = (k.claims || []).filter(id => !this.byId(id));
      host.append(h('div.contra', null,
        h('h3', { translate: 'no' }, k.topic || k.id),
        k.summary ? h('div.small', { translate: 'no' }, k.summary) : null,
        h('div.sides', null, ...claims.map(c => this.card(c, { compact: true }))),
        missing.length ? h('div.small.muted', null, 'Claims not found in the file: ' + missing.join(', ')) : null,
        h('div.model', null, h('b', null, 'Model: '), k.model_verdict ? h('span', { translate: 'no' }, k.model_verdict) : h('span.muted', null, 'verdict not computed yet (the data builder fills this in from the consensus measurements).'))));
    }
  }

  quotesForLesion(id) {
    const cl = (this.data?.claims || []).filter(c => c.lesion_id === id);
    const box = h('div');
    if (!cl.length) { box.append(h('p.empty', null, this.data ? `No report claim is mapped to ${id}.` : 'No report claims loaded.')); return box; }
    const dates = this.app.dates;
    cl.sort((a, b) => dates.indexOf(a.date_key) - dates.indexOf(b.date_key) || (a.reader_rank ?? 9) - (b.reader_rank ?? 9));
    for (const c of cl) box.append(this.card(c, { compact: true, showDate: true }));
    return box;
  }

  card(c, opts = {}) {
    const app = this.app;
    const les = c.lesion_id && app.lesionById(c.lesion_id);
    const viz = c.kind === 'size_change' ? (c.viz_to || c.viz) : c.viz;
    const cv = changeVerdict(c);
    // for a size change the per-date size verdict is not the verdict on the change: say which date it is about
    let vt = cv ? null : verdictText(viz);
    if (vt && c.kind === 'size_change' && c.viz_to && verdictClass(viz.verdict) !== 'nc') vt = `${app.dateShort(c.viz_to.date_key)} size: ${vt}`;
    const meta = h('div.meta', null,
      h('span.kind', null, KIND_LABEL[c.kind] || c.kind || 'claim'),
      les ? h('span.lchip', { style: { background: les.color } }, c.lesion_id) : (c.lesion_id ? h('span.kind', null, c.lesion_id) : null),
      h('span', null, `${app.dateLabel(c.date_key)} scan`),
      opts.compact || opts.showDate ? h('span', { translate: 'no' }, '· ' + shortReader(c.reader)) : null,
      cv ? h('span', { class: 'verdict ' + cv.cls, title: cv.title }, cv.text) : null,
      vt ? h('span', { class: 'verdict ' + verdictClass(viz.verdict), title: viz.how_measured || '' }, vt) : null,
      c.confidence === 'ambiguous' ? h('span.verdict.nc', { title: 'The claims engineer marked this mapping or reading as ambiguous' }, 'ambiguous') : null);
    const qs = this.quoteEls(c);
    const src = c.source || {};
    const links = [];
    const rp = linkURL(src, src.report_page), op = linkURL(src, src.original_page);
    if (rp) links.push(h('a', { href: rp, target: '_blank', rel: 'noopener noreferrer' }, 'report page ↗'));
    if (op) links.push(h('a', { href: op, target: '_blank', rel: 'noopener noreferrer' }, 'original scan ↗'));
    else if (src.original_file) links.push(h('a', { href: linkURL(src, src.original_file), target: '_blank', rel: 'noopener noreferrer', title: 'the original document (no transcribed original page exists)' }, 'original document ↗'));
    if (src.drive) links.push(h('a', { href: src.drive, target: '_blank', rel: 'noopener noreferrer' }, 'Drive ↗'));
    for (const a of links) a.addEventListener('click', e => e.stopPropagation());
    const el = h('article.claim', { 'data-id': c.id, tabindex: 0, role: 'button', 'aria-label': `Show on the model: ${c.kind} claim by ${c.reader}` },
      meta,
      ...qs,
      opts.compact ? null : h('div.src', { translate: 'no' }, h('span', null, c.reader || ''), src.title ? h('span', null, src.title) : null, src.document_ref ? h('span', null, 'doc ' + src.document_ref) : null, ...links),
      opts.compact && links.length ? h('div.src', null, ...links) : null,
      c.typo_note ? h('div.note', null, h('span', null, 'Typo note'), ': ', h('span', { translate: 'no' }, c.typo_note)) : null,
      !opts.compact && c.notes ? h('div.note.n', { translate: 'no' }, c.notes) : null);
    const go = () => { app.claimViz.show(c); };
    el.addEventListener('click', go);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    if (app.state.claim === c.id) el.classList.add('active');
    return el;
  }
}

export function shortReader(r) {
  r = String(r || '');
  return r.length > 42 ? r.slice(0, 40) + '…' : r;
}
