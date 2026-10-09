// Visualises one report claim on the model: reported size box (orange, dashed) vs the model's
// measured extents (teal), size-change morph between dates, activity markers, segment and vessel focus.
import * as THREE from 'three';
import * as F from './frame.js';
import { h, esc, highlightHTML, fmtPct, fmtDims, fmtVol, fmtNum, pctChange, parseSegments, ease, clamp } from './util.js';
import { verdictClass, verdictText, changeVerdict, linkURL, shortReader } from './reports.js';

const ORANGE = new THREE.Color('#ff9f1c'), TEAL = new THREE.Color('#2ec4b6'), SUVY = new THREE.Color('#ffe14d');
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true); cyl.translate(0, 0.5, 0); cyl.rotateX(Math.PI / 2); // unit tube along +Z from 0..1
const sph = new THREE.SphereGeometry(1, 20, 14);

/** spec: {center:Vector3 world, axes:[Vector3 x3 world unit], dims:[a,b,c] (null = not given)} */
function edgesOf(spec) {
  const [u, v, w] = spec.axes, d = spec.dims.map(x => (x == null || !isFinite(x) ? 0 : x / 2));
  const P = (i, j, k) => spec.center.clone().addScaledVector(u, i * d[0]).addScaledVector(v, j * d[1]).addScaledVector(w, k * d[2]);
  const E = [];
  const nz = d.map(x => x > 0);
  // box edges, collapsing duplicates for flat (2D) or linear (1D) reports
  const seen = new Set();
  const add = (a, b) => { const k = [a, b].map(p => p.toArray().map(x => x.toFixed(2)).join(',')).sort().join('|'); if (a.distanceTo(b) < 1e-6 || seen.has(k)) return; seen.add(k); E.push([a, b]); };
  for (const j of [-1, 1]) for (const k of [-1, 1]) add(P(-1, j, k), P(1, j, k));
  for (const i of [-1, 1]) for (const k of [-1, 1]) add(P(i, -1, k), P(i, 1, k));
  for (const i of [-1, 1]) for (const j of [-1, 1]) add(P(i, j, -1), P(i, j, 1));
  if (nz.filter(Boolean).length === 1) { // 1D: end ticks
    const ax = spec.axes[nz.indexOf(true)], other = spec.axes[(nz.indexOf(true) + 1) % 3], L = d[nz.indexOf(true)];
    for (const s of [-1, 1]) { const c = spec.center.clone().addScaledVector(ax, s * L); add(c.clone().addScaledVector(other, -3), c.clone().addScaledVector(other, 3)); }
  }
  return E;
}
function tubes(edges, { color, dashed, radius, ghost }) {
  const segs = [];
  for (const [a, b] of edges) {
    const L = a.distanceTo(b);
    if (!dashed) { segs.push([a, b]); continue; }
    const dash = Math.max(2.5, Math.min(7, L / 9)), gap = dash * 0.6;
    const dir = b.clone().sub(a).normalize();
    for (let s = 0; s < L; s += dash + gap) segs.push([a.clone().addScaledVector(dir, s), a.clone().addScaledVector(dir, Math.min(L, s + dash))]);
  }
  const mk = (depthTest, opacity) => {
    const m = new THREE.InstancedMesh(cyl, new THREE.MeshBasicMaterial({ color, depthTest, depthWrite: depthTest, transparent: opacity < 1, opacity }), Math.max(1, segs.length));
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1);
    segs.forEach(([a, b], i) => {
      const L = a.distanceTo(b);
      q.setFromUnitVectors(z, b.clone().sub(a).normalize());
      M.compose(a, q, new THREE.Vector3(radius, radius, L));
      m.setMatrixAt(i, M);
    });
    m.count = segs.length; m.instanceMatrix.needsUpdate = true; m.frustumCulled = false;
    m.renderOrder = depthTest ? 500 : 499;
    return m;
  };
  const g = new THREE.Group();
  g.add(mk(true, ghost ? 0.35 : 1));
  g.add(mk(false, ghost ? 0.12 : 0.3)); // the part hidden behind tissue stays faintly visible
  return g;
}
function lerpSpec(a, b, k) {
  const axes = a.axes.map((x, i) => x.clone().lerp(b.axes[i], k));
  // re-orthonormalise
  axes[0].normalize(); axes[1].sub(axes[0].clone().multiplyScalar(axes[1].dot(axes[0]))).normalize(); axes[2].crossVectors(axes[0], axes[1]).normalize();
  if (axes[2].dot(a.axes[2]) < 0) axes[2].negate();
  return { center: a.center.clone().lerp(b.center, k), axes, dims: a.dims.map((x, i) => (x == null || b.dims[i] == null) ? (k < 0.5 ? x : b.dims[i]) : x + (b.dims[i] - x) * k) };
}

export class ClaimViz {
  constructor(app, bar) {
    this.app = app; this.bar = bar; this.group = new THREE.Group(); this.group.name = 'claim-viz'; app.scene3.add(this.group);
    this.labels = []; this.claim = null; this.anim = null; this.notes = []; this.pts = []; this.dimOthers = true;
  }
  lesionOf(c) {
    const app = this.app;
    if (c.lesion_id && app.lesionById(c.lesion_id)) return c.lesion_id;
    if (c.model?.lesion && app.lesionById(c.model.lesion)) return c.model.lesion;
    return null;
  }
  showById(id, opts) { const c = this.app.reports.byId(id); if (c) this.show(c, opts); else this.app.setClaimState(null); }

  async show(c, opts = {}) {
    const app = this.app;
    if (this.claim && this.claim !== c) this.restoreLayers();
    this.clearVisuals(); this.anim = null;
    this.claim = c; app.setClaimState(c.id);
    const date = this.claimDate(c);
    if (date && date !== app.shown && app.dates.includes(date)) await app.setDate(date);
    if (this.claim !== c) return;
    const lid = this.lesionOf(c);
    if (lid) app.selectLesion(lid, { fly: false });
    this.applyFocus(c);
    this.build(); this.renderBar();
    // segment / contact / active-tissue labels need the meshes the claim just switched on: wait for them, then redraw
    await app.loadVisible();
    if (this.claim !== c) return;
    if (!this.anim) { this.build(); this.renderBar(); }
    if (opts.fly !== false) this.frame(lid);
  }
  /** fly so that the lesion and every drawn box are in view */
  frame(lid) {
    const app = this.app;
    const sph = lid ? app.lesionSphere(lid) : null;
    if (!this.pts.length) { if (lid) app.flyToLesion(lid); else app.fitLiver(); return; }
    const s = new THREE.Sphere().setFromPoints(this.pts);
    if (sph) s.union(sph);
    s.radius = Math.max(s.radius * 1.08, 25);
    let dir = new THREE.Vector3().subVectors(app.camera.position, app.controls.target).normalize();
    // a flat (axial) reported rectangle is invisible edge-on: look from anterior-superior so it opens up
    const c = this.claim;
    const flat = [c?.viz, c?.viz_from, c?.viz_to].some(v => v?.reported_mm && v.reported_mm[2] == null && v.reported_mm.some(x => x != null)) || (c?.size_mm && c.size_mm[2] == null);
    const upness = Math.abs(F.worldDirToRas(dir)[2]);
    if (flat && upness < 0.45) dir = F.rasDirToWorld([0.25, 0.75, 0.62]).normalize();
    app.flyTo(s.center.clone().addScaledVector(dir, app.fitDist(s.radius)), s.center);
  }
  claimDate(c) {
    if (c.kind === 'size_change') return c.viz_to?.date_key || c.change?.to?.date_key || c.date_key;
    return c.viz?.date_key || c.date_key;
  }
  /** undo the layer changes a claim made, unless the user changed that layer since */
  restoreLayers() {
    const app = this.app, back = {};
    for (const [id, { before, after }] of Object.entries(this.applied || {})) {
      const cur = app.ctlState(id);
      if (cur.v === after.v && Math.abs(cur.o - after.o) < 1e-3) back[id] = before;
    }
    this.applied = {};
    if (Object.keys(back).length) app.setCtls(back);
  }
  clear() {
    this.restoreLayers();
    this.clearVisuals(); this.claim = null; this.anim = null; this.bar.hidden = true;
    this.app.setFocus(null); this.app.setClaimState(null); this.app.requestRender();
  }
  clearVisuals() {
    // InstancedMesh.dispose() frees its per-instance matrix buffer on the GPU (the morph rebuilds the boxes every frame)
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse(x => { if (x.material) x.material.dispose?.(); if (x.isInstancedMesh) x.dispose(); }); }
    for (const L of this.labels) L.remove();
    this.labels = []; this.notes = []; this.pts = [];
  }
  onDate() { if (this.claim && !this.anim) { this.applyFocus(this.claim, true); this.build(); this.renderBar(); } }
  onRegistration() { if (this.claim) { this.build(); } }

  // ------------------------------------------------ specs in world space
  specFromViz(viz, which) {
    if (!viz?.center_ras || !viz?.axes_ras) return null;
    const M = this.app.regM(viz.date_key);
    const c = F.rasToWorld(F.applyRas(M, viz.center_ras));
    const axes = viz.axes_ras.map(a => F.rasDirToWorld(F.applyRasDir(M, a)).normalize());
    return { center: c, axes, dims: (which === 'model' ? viz.model_mm : viz.reported_mm) || [null, null, null], date: viz.date_key };
  }
  specFallback(lesionId, date, dims) {
    const app = this.app;
    const les = app.lesionById(lesionId), pd = les?.per_date?.[date];
    if (!pd?.centroid_ras || !dims) return null;
    const M = app.regM(date);
    const c = F.rasToWorld(F.applyRas(M, pd.centroid_ras));
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(a => F.rasDirToWorld(F.applyRasDir(M, a)).normalize());
    return { center: c, axes, dims: [dims[0] ?? null, dims[1] ?? null, dims[2] ?? null], date, fallback: true };
  }
  radiusFor(spec) { const m = Math.max(...spec.dims.filter(x => x > 0), 10); return clamp(m / 170, 0.3, 0.9); }

  drawBox(spec, kind, { ghost = false, labels = true } = {}) {
    if (!spec) return;
    const rep = kind === 'rep';
    for (const [a, b] of edgesOf(spec)) this.pts.push(a, b);
    this.group.add(tubes(edgesOf(spec), { color: rep ? ORANGE : TEAL, dashed: rep, radius: this.radiusFor(spec) * (rep ? 1 : 0.8), ghost }));
    if (!labels) return;
    const [u, v, w] = spec.axes, d = spec.dims.map(x => (x > 0 ? x / 2 : 0));
    const at = (i, j, k) => spec.center.clone().addScaledVector(u, i * d[0]).addScaledVector(v, j * d[1]).addScaledVector(w, k * d[2]);
    const cls = (rep ? 'rep' : 'mod') + (ghost ? ' dim' : '');
    if (rep) {
      // the other date's box gets only its title (which carries the numbers): per-edge labels of two nearby boxes overlap
      if (!ghost) {
        if (spec.dims[0] > 0) this.labels.push(this.app.addLabel(`${fmtNum(spec.dims[0])} mm`, at(0, -1, -1).addScaledVector(v, -4), cls));
        if (spec.dims[1] > 0) this.labels.push(this.app.addLabel(`${fmtNum(spec.dims[1])} mm`, at(1, 0, -1).addScaledVector(u, 4), cls));
        if (spec.dims[2] > 0) this.labels.push(this.app.addLabel(`${fmtNum(spec.dims[2])} mm`, at(1, 1, 0).addScaledVector(u, 4), cls));
      }
      const title = `report ${fmtDims(spec.dims)}${spec.dims[2] == null ? ' (cc not given)' : ''}${ghost ? ' · ' + this.app.dateShort(spec.date) : ''}`;
      // the other date's title goes under its box, so it does not sit on the current box's title when the boxes nearly coincide
      this.labels.push(this.app.addLabel(title, ghost ? at(-1, -1, -1).addScaledVector(w, -8) : at(-1, 1, 1).addScaledVector(w, 6), cls));
    } else {
      this.labels.push(this.app.addLabel(`model ${fmtDims(spec.dims)}${ghost ? ' · ' + this.app.dateShort(spec.date) : ''}`, at(1, -1, 1).addScaledVector(w, 6), cls));
    }
  }

  // ------------------------------------------------ build per kind
  build() {
    this.clearVisuals();
    const c = this.claim; if (!c) return;
    const app = this.app, shown = app.shown;
    const lid = this.lesionOf(c);
    if (c.viz?.reason) this.notes.push('Data builder: ' + c.viz.reason + (c.viz.model_mm_is ? ` (model box = ${c.viz.model_mm_is})` : ''));
    const hasRep = (c.viz?.reported_mm || c.size_mm || []).some(x => x != null);
    if (c.kind !== 'size' && c.kind !== 'size_change' && c.viz?.model_mm && !hasRep) {
      const mod = this.specFromViz(c.viz, 'model');
      if (mod) this.drawBox(mod, 'mod', { ghost: mod.date !== shown });
    } else if (c.kind === 'size' || (c.kind !== 'size_change' && hasRep && (c.viz?.center_ras || lid))) {
      const rep = this.specFromViz(c.viz, 'rep') || this.specFallback(lid, c.viz?.date_key || c.date_key, c.size_mm);
      const mod = this.specFromViz(c.viz, 'model');
      const other = rep && rep.date !== shown;
      this.drawBox(rep, 'rep', { ghost: other }); this.drawBox(mod, 'mod', { ghost: other });
      if (!rep) this.notes.push('No position for this claim (no model measurement and no lesion centroid for that date).');
      else if (rep.fallback) this.notes.push('Model measurement not available in this claims file: the reported size is drawn axis-aligned (x, y, z) at the lesion centroid; the true measurement direction is unknown.');
      if (other) this.notes.push(`The boxes belong to the ${app.dateLabel(rep.date)} scan (shown faint on ${app.dateLabel(shown)}).`);
    }
    if (c.kind === 'size_change') {
      const fr = this.specFromViz(c.viz_from, 'rep') || this.specFallback(lid, c.change?.from?.date_key, c.change?.from?.size_mm);
      const to = this.specFromViz(c.viz_to, 'rep') || this.specFallback(lid, c.change?.to?.date_key, c.change?.to?.size_mm);
      const frM = this.specFromViz(c.viz_from, 'model'), toM = this.specFromViz(c.viz_to, 'model');
      if (this.anim) return; // tick() draws the morph
      for (const [s, m] of [[fr, frM], [to, toM]]) {
        if (!s) continue;
        const cur = s.date === shown;
        this.drawBox(s, 'rep', { ghost: !cur }); this.drawBox(m, 'mod', { ghost: !cur, labels: cur });
      }
      const outside = [c.change?.from?.date_key, c.change?.to?.date_key].filter(k => k && !app.dates.includes(k));
      if (outside.length) this.notes.push(`${outside.map(k => app.dateLabel(k)).join(', ')}: that scan is not part of the 3D model, so only the other side can be shown.`);
      else if (!lid) this.notes.push('This statement is not mapped to one lesion of the model, so no boxes are drawn.');
      else if (!fr || !to) this.notes.push('One side of the change has no position (lesion not traced on that date, or no size reported).');
      else if (fr.fallback || to.fallback) this.notes.push('Model measurements not in this claims file: boxes are axis-aligned at the lesion centroids.');
    }
    if (c.kind === 'activity') {
      const date = c.date_key;
      const sp = lid ? app.partSphere(lid, 'active', date) : null;
      const les = lid && app.lesionById(lid);
      const at = sp?.center || (lid && app.lesionCenterRAS(lid, date) ? F.rasToWorld(app.lesionCenterRAS(lid, date)) : null);
      if (at) {
        const r = clamp((sp?.radius || 10) / 12, 1.2, 4);
        const m = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: SUVY, depthTest: false, transparent: true, opacity: 0.9 }));
        m.scale.setScalar(r); m.position.copy(at); m.renderOrder = 510; this.group.add(m);
        const rep = c.suv?.max != null ? `report SUVmax ${c.suv.max}` : 'report: activity';
        const mod = les?.per_date?.[date]?.suv_max;
        this.labels.push(app.addLabel(rep + (mod != null ? ` · model SUVmax ${fmtNum(mod, 1)}` : ''), at.clone().add(new THREE.Vector3(0, r * 3 + 4, 0)), 'suv'));
      }
      if (!lid) this.notes.push('Not mapped to one lesion of the model: the FDG-active layer is highlighted as a whole.');
      else if (!sp) this.notes.push(`No FDG-active tissue mesh for ${lid} on ${app.dateLabel(date)}; marker at the lesion centre.`);
      else this.notes.push('Marker = centre of the active-tissue mesh, not the voxel where SUVmax was measured.');
    }
    if (c.kind === 'location' || c.segment) {
      const segs = parseSegments(c.segment);
      for (const n of segs) {
        const sp = app.partSphere(null, 'seg' + n, app.shown);
        if (sp) this.labels.push(app.addLabel(`Segment ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n - 1]} (report: ${c.segment})`, sp.center, 'info'));
      }
      if (segs.length && !segs.some(n => app.ctls.has('seg' + n))) this.notes.push('The scene has no Couinaud segment meshes.');
      else if (segs.length && !segs.some(n => app.available('seg' + n, app.shown))) this.notes.push(`No segment meshes on ${app.dateLabel(app.shown)}.`);
    }
    if (c.kind === 'vessel_relation') {
      const ids = this.vesselCtls(c);
      const contacts = [...app.ctls.keys()].filter(k => k.startsWith('contact'));
      for (const k of contacts) {
        const sp = app.partSphere(null, k, app.shown);
        if (sp) this.labels.push(app.addLabel('contact patch (model)', sp.center, 'mod'));
      }
      if (!ids.length) this.notes.push(`No vessel layer matches “${c.vessel || c.structure || ''}”.`);
      for (const k of ids) if (!app.available(k, app.shown)) this.notes.push(`${app.ctls.get(k).name}: not available on ${app.dateLabel(app.shown)}.`);
      if (contacts.length && !contacts.some(k => app.available(k, app.shown))) this.notes.push(`No contact-patch mesh on ${app.dateLabel(app.shown)}.`);
    }
    app.requestRender();
  }
  vesselCtls(c) {
    const t = `${c.vessel || ''} ${c.structure || ''}`.toLowerCase();
    const out = [];
    const has = id => this.app.ctls.has(id) && !out.includes(id) && out.push(id);
    if (/portal|ворот|портал/.test(t)) has('portal');
    if (/hepatic vein|печ[её]н\w* вен|печінк\w* вен|\bhv\b|vena hepatica/.test(t)) has('hepatic_veins');
    if (/cava|ivc|порож|пол[оа]/.test(t)) has('ivc');
    if (/arter|артер/.test(t)) has('hepatic_artery');
    if (/bile|duct|жовч|желч/.test(t)) has('bile_ducts');
    for (const id of this.app.ctls.keys()) if (t.includes(id.replace(/_/g, ' '))) has(id);
    return out;
  }
  applyFocus(c, quiet) {
    const app = this.app, patch = {}, focus = new Set();
    const lid = this.lesionOf(c);
    if (!lid && (c.lesion_id === 'liver' || c.structure === 'liver') && app.ctls.has('liver')) focus.add('liver');
    if (lid && !quiet) patch['les:' + lid] = { v: true };
    if (c.kind === 'activity') {
      if (app.ctls.has('active')) { patch.active = { v: true, o: Math.max(app.ctlState('active').o, 0.9) }; focus.add('active'); }
      if (lid && !quiet) patch['les:' + lid] = { v: true, o: Math.min(app.ctlState('les:' + lid).o, 0.3) };
      if (!lid) focus.add('active');
    }
    if (c.kind === 'location' || c.segment) for (const n of parseSegments(c.segment)) if (app.ctls.has('seg' + n)) { patch['seg' + n] = { v: true, o: Math.max(app.ctlState('seg' + n).o, 0.45) }; focus.add('seg' + n); }
    if (c.kind === 'vessel_relation') {
      for (const k of this.vesselCtls(c)) { patch[k] = { v: true }; focus.add(k); }
      for (const k of app.ctls.keys()) if (k.startsWith('contact')) { patch[k] = { v: true, o: 1 }; focus.add(k); }
    }
    if (Object.keys(patch).length && !quiet) {
      this.applied = {};
      for (const [id, p] of Object.entries(patch)) {
        const before = { ...app.ctlState(id) };
        this.applied[id] = { before, after: { ...before, ...p } };
      }
      app.setCtls(patch);
    }
    const keep = new Set(lid ? ['les:' + lid] : []);
    app.setFocus({ ctls: focus, keep, lesion: c.kind === 'activity' ? lid : null, dim: this.dimOthers && (focus.size > 0 || keep.size > 0) });
  }

  // ------------------------------------------------ size-change animation
  async playChange() {
    const c = this.claim, app = this.app; if (!c || c.kind !== 'size_change') return;
    const a = c.viz_from?.date_key || c.change?.from?.date_key, b = c.viz_to?.date_key || c.change?.to?.date_key;
    if (!a || !b || !app.dates.includes(a) || !app.dates.includes(b)) { app.toast('Both dates of this change must be in the 3D model to play it.'); return; }
    await app.ensureDate(b);
    if (app.shown !== a) await app.setDate(a);
    const lid = this.lesionOf(c);
    const fr = this.specFromViz(c.viz_from, 'rep') || this.specFallback(lid, a, c.change?.from?.size_mm);
    const to = this.specFromViz(c.viz_to, 'rep') || this.specFallback(lid, b, c.change?.to?.size_mm);
    if (!fr || !to) { app.toast('Cannot animate: one of the two dates has no position for this lesion.'); return; }
    this.anim = { t: 0, start: performance.now(), dur: 2.8, a, b, fr, to, frM: this.specFromViz(c.viz_from, 'model'), toM: this.specFromViz(c.viz_to, 'model'), switched: false };
    this.renderBar();
  }
  tick(dt) {
    const A = this.anim; if (!A) return false;
    A.t = (performance.now() - A.start) / 1000;
    const k = clamp(A.t / A.dur, 0, 1), e = ease(k);
    if (!A.switched && k >= 0.5) { A.switched = true; this.app.setDate(A.b); }
    this.clearVisuals();
    const r = lerpSpec(A.fr, A.to, e); r.date = e < 0.5 ? A.a : A.b;
    this.drawBox(r, 'rep');
    if (A.frM && A.toM) { const m = lerpSpec(A.frM, A.toM, e); m.date = r.date; this.drawBox(m, 'mod'); }
    this.drawBox(A.fr, 'rep', { ghost: true, labels: false });
    if (k >= 1) { this.anim = null; this.build(); this.renderBar(); }
    return true;
  }

  // ------------------------------------------------ the bar under the model
  renderBar() {
    const c = this.claim, app = this.app, bar = this.bar;
    if (!c) { bar.hidden = true; return; }
    bar.hidden = false; bar.innerHTML = '';
    const lid = this.lesionOf(c);
    const les = lid && app.lesionById(lid);
    const lang = app.state.lang;
    const close = h('button.cb-close', { 'aria-label': 'Close claim', title: 'Close (Esc)', onclick: () => this.clear() }, '×');
    bar.append(h('div.cb-head', null,
      h('div.small', null, h('span.kind', null, c.kind), ' ', les ? h('span.lchip', { style: { background: les.color } }, lid) : (c.lesion_id || ''), ' ',
        h('b', null, shortReader(c.reader)), h('span.muted', null, ` · on the ${app.dateLabel(c.date_key)} scan`)), close));
    const q = h('blockquote.q', { lang: c.lang || 'und' }); q.innerHTML = highlightHTML(c.quote_orig, c.highlight);
    bar.append(q);
    if (c.lang !== 'en' && c.quote_en) {
      const g = h('blockquote.q', { lang: 'en', style: { opacity: lang === 'en' ? 1 : 0.75, fontSize: '12px' } }); g.innerHTML = highlightHTML(c.quote_en, c.highlight);
      bar.append(h('div.gloss-note', null, 'English gloss (not verbatim)'), g);
    }
    const cmp = h('div.cmp');
    const row = (k, v) => cmp.append(h('span.k', null, k), v instanceof Node ? v : h('span', null, v));
    const hasRep = (c.viz?.reported_mm || c.size_mm || []).some(x => x != null);
    if (c.kind === 'size' || (c.viz && c.kind !== 'size_change' && hasRep)) {
      const v = c.viz;
      row('Report', h('span.rep', null, fmtDims(v?.reported_mm || c.size_mm) + (((v?.reported_mm || c.size_mm || [])[2] == null) ? ' (craniocaudal not given)' : '')));
      if (v?.model_mm) {
        row('Model', h('span.mod', null, fmtDims(v.model_mm)));
        row('Difference', (v.delta_pct || []).map((d, i) => `${['long axis', 'perpendicular', 'craniocaudal'][i]} ${d == null ? '—' : fmtPct(d)}`).join(' · '));
        row('Verdict', h('span', { class: 'verdict ' + verdictClass(v.verdict) }, verdictText(v)));
        if (v.how_measured) row('Measured as', v.how_measured);
      } else row('Model', h('span.muted', null, 'not computed in this claims file'));
    }
    if (c.kind === 'size_change') {
      const ch = c.change || {}, f = ch.from || {}, t = ch.to || {};
      const vf = c.viz_from, vt = c.viz_to;
      const repPct = ch.percent ?? pctChange(f.size_mm?.[0], t.size_mm?.[0]);
      const rng = Array.isArray(ch.percent_range) ? ` (range ${ch.percent_range.map(x => fmtPct(x)).join(' to ')})` : '';
      const fromR = Array.isArray(f.size_range_mm) ? ` [range ${f.size_range_mm.join('–')} mm]` : '';
      row('Report', h('span.rep', null, `${fmtDims(f.size_mm)}${fromR} → ${fmtDims(t.size_mm)}` + (repPct != null ? ` (${ch.percent != null ? 'stated ' : 'long axis '}${fmtPct(repPct)}${rng})` : ' (no numbers given)')));
      if (vf?.model_mm && vt?.model_mm) {
        const la = pctChange(vf.model_mm[0], vt.model_mm[0]);
        const lv = pctChange(les?.per_date?.[f.date_key]?.volume_mL, les?.per_date?.[t.date_key]?.volume_mL);
        row('Model', h('span.mod', null, `${fmtDims(vf.model_mm)} → ${fmtDims(vt.model_mm)} (long axis ${fmtPct(la)}${lv != null ? ', volume ' + fmtPct(lv) : ''}${c.model_change_pct != null ? `; builder: ${fmtPct(c.model_change_pct)}` : ''})`));
        const cv = changeVerdict(c);
        if (cv) row('Change', h('span', { class: 'verdict ' + cv.cls, title: cv.title }, cv.core));
        row(cv ? 'Each date' : 'Verdict', h('span', null, h('span', { class: 'verdict ' + verdictClass(vf.verdict) }, `${app.dateShort(f.date_key)}: ${verdictText(vf)}`), ' ', h('span', { class: 'verdict ' + verdictClass(vt.verdict) }, `${app.dateShort(t.date_key)}: ${verdictText(vt)}`)));
      } else {
        const lv = pctChange(les?.per_date?.[f.date_key]?.volume_mL, les?.per_date?.[t.date_key]?.volume_mL);
        row('Model', h('span.mod', null, lv != null ? `volume ${fmtVol(les.per_date[f.date_key].volume_mL)} → ${fmtVol(les.per_date[t.date_key].volume_mL)} (${fmtPct(lv)}); diameters not computed in this claims file` : 'not computed in this claims file'));
      }
      row('Dates', `${app.dateLabel(f.date_key)} → ${app.dateLabel(t.date_key)}`);
    }
    if (c.kind === 'activity') {
      const pd = les?.per_date?.[c.date_key];
      row('Report', h('span.rep', null, c.suv?.max != null ? `SUVmax ${c.suv.max}${c.suv.reference != null ? ` (reference ${c.suv.reference})` : ''}` : 'activity described'));
      row('Model', h('span.mod', null, pd ? `SUVmax ${pd.suv_max != null ? fmtNum(pd.suv_max, 1) : '—'} · active tissue ${fmtVol(pd.active_mL)}` : '—'));
    }
    if (c.kind === 'location' || c.segment) row('Segment', `${c.segment || '—'} → highlighted: ${parseSegments(c.segment).map(n => 'seg' + n).join(', ') || 'none'}`);
    if (c.kind === 'vessel_relation') row('Vessel', `${c.vessel || c.structure || '—'} → highlighted: ${this.vesselCtls(c).map(k => app.ctls.get(k).name).join(', ') || 'none'}`);
    if (cmp.childElementCount) bar.append(cmp);
    for (const n of this.notes) bar.append(h('div.small.muted', { style: { marginTop: '3px' } }, n));
    if (c.typo_note) bar.append(h('div.small', { style: { color: 'var(--warn)' } }, 'Typo note: ' + c.typo_note));
    if (c.notes) bar.append(h('div.small.muted', null, c.notes));
    const actions = h('div.actions');
    if (c.kind === 'size_change') {
      const ok = [c.change?.from?.date_key, c.change?.to?.date_key].every(k => app.dates.includes(k)) && lid;
      actions.append(h('button', { onclick: () => this.playChange(), disabled: (this.anim || !ok) ? true : null, title: ok ? 'Switch dates while morphing the reported box' : 'Needs both dates in the model and a lesion mapping' }, this.anim ? 'Playing…' : '▶ Play change'));
    }
    if (les) actions.append(h('button', { onclick: () => app.flyToLesion(lid) }, 'Fly to'), h('button', { onclick: () => app.sliceLesion(lid) }, 'Slice through'));
    const src = c.source || {};
    const rp = linkURL(src, src.report_page), op = linkURL(src, src.original_page);
    if (rp) actions.append(h('a', { href: rp, target: '_blank', rel: 'noopener noreferrer', class: 'small', style: { alignSelf: 'center', color: 'var(--accent)' } }, 'report page ↗'));
    const of = !op && src.original_file ? linkURL(src, src.original_file) : null;
    if (op || of) actions.append(h('a', { href: op || of, target: '_blank', rel: 'noopener noreferrer', class: 'small', style: { alignSelf: 'center', color: 'var(--accent)' } }, op ? 'original ↗' : 'original document ↗'));
    const dim = h('input', { type: 'checkbox', checked: this.dimOthers || null });
    dim.addEventListener('change', () => { this.dimOthers = dim.checked; this.applyFocus(c, true); });
    actions.append(h('label.small', { style: { display: 'flex', gap: '5px', alignItems: 'center' } }, dim, 'dim other structures'));
    bar.append(actions);
    bar.append(h('div.small.muted', { style: { marginTop: '4px' } }, h('span', { style: { color: 'var(--orange)' } }, '▬ ▬ reported size'), '  ', h('span', { style: { color: 'var(--teal)' } }, '━━ model extents'), ' · boxes are placed with the current alignment; sizes do not depend on it.'));
  }
}
