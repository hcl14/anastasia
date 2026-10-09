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
    this.view = 'claims'; this.allDates = false; this.hiddenReaders = new Set(); this.onlySel = false; this.lang = 'orig';
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
    const cl = this.data?.claims || [];
    this.byIdMap = new Map(cl.map(c => [c.id, c]));
    this.enriched = cl.some(c => c.viz || c.viz_to || c.viz_from);
    this.readers = [...new Map(cl.map(c => [c.reader, c.reader_rank ?? 9])).entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
    this.render();
  }
  byId(id) { return this.byIdMap?.get(id); }
  outsideLabel(k) { const o = this.data?.conventions?.date_keys_outside_model?.[k]; return o ? `${o.replace(/,.*$/, '')} (not in the 3D model)` : null; }
  setLang(l) { this.lang = l; this.render(); }
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
    const en = h('button', { 'aria-pressed': String(this.lang === 'en'), title: 'Show the English gloss instead of the original wording', onclick: () => { this.lang = this.lang === 'en' ? 'orig' : 'en'; st.lang = this.lang; app.writeHash(); this.render(); app.claimViz.renderBar(); } }, 'English');
    host.append(h('div.rep-controls', null, seg, all, en));
    if (this.file !== 'report_claims.json' || !this.enriched) {
      host.append(h('p.small.muted', null, `Claims from ${this.file}${this.enriched ? '' : ' (model measurements not filled in yet: reported sizes are drawn axis-aligned at the lesion centre, without a model box)'}.`));
    }
    // reader filter
    const chips = h('div.chips', { role: 'group', 'aria-label': 'Filter by reader' });
    for (const [r, rank] of this.readers) {
      chips.append(h('button.chip', {
        'aria-pressed': String(!this.hiddenReaders.has(r)), title: `rank ${rank}`,
        onclick: () => { this.hiddenReaders.has(r) ? this.hiddenReaders.delete(r) : this.hiddenReaders.add(r); this.render(); },
      }, h('span', { class: 'rank r' + Math.min(4, rank) }, rank), ' ', shortReader(r)));
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
      host.append(h('div.reader-h', null, h('span', { class: 'rank r' + Math.min(4, cs[0].reader_rank ?? 4) }, cs[0].reader_rank ?? '?'), r || 'Unknown reader'));
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
        h('h3', null, k.topic || k.id),
        k.summary ? h('div.small', null, k.summary) : null,
        h('div.sides', null, ...claims.map(c => this.card(c, { compact: true }))),
        missing.length ? h('div.small.muted', null, 'Claims not found in the file: ' + missing.join(', ')) : null,
        h('div.model', null, h('b', null, 'Model: '), k.model_verdict ? k.model_verdict : h('span.muted', null, 'verdict not computed yet (the data builder fills this in from the consensus measurements).'))));
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
      opts.compact || opts.showDate ? h('span', null, '· ' + shortReader(c.reader)) : null,
      cv ? h('span', { class: 'verdict ' + cv.cls, title: cv.title }, cv.text) : null,
      vt ? h('span', { class: 'verdict ' + verdictClass(viz.verdict), title: viz.how_measured || '' }, vt) : null,
      c.confidence === 'ambiguous' ? h('span.verdict.nc', { title: 'The claims engineer marked this mapping or reading as ambiguous' }, 'ambiguous') : null);
    const showEn = this.lang === 'en' && c.lang !== 'en' && c.quote_en;
    const q = h('blockquote.q', { lang: showEn ? 'en' : (c.lang || 'und') });
    q.innerHTML = highlightHTML(showEn ? c.quote_en : c.quote_orig, c.highlight);
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
      showEn ? h('div.gloss-note', null, 'English gloss — not the verbatim wording') : null,
      q,
      opts.compact ? null : h('div.src', null, h('span', null, c.reader || ''), src.title ? h('span', null, src.title) : null, src.document_ref ? h('span', null, 'doc ' + src.document_ref) : null, ...links),
      opts.compact && links.length ? h('div.src', null, ...links) : null,
      c.typo_note ? h('div.note', null, 'Typo note: ' + c.typo_note) : null,
      !opts.compact && c.notes ? h('div.note.n', null, c.notes) : null);
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
