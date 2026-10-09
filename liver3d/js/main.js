// Liver progression viewer — main module.
// Data contract: README.md ("Scene contract"). Coordinates: js/frame.js. Report claims: js/reports.js + js/claimviz.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as F from './frame.js';
import { loadGeometry, onProgress, peek, stats } from './meshload.js';
import { $, $$, h, esc, fmtVol, fmtPct, pctChange, fmtMB, fmtNum, debounce, clamp, ease } from './util.js';
import { Reports } from './reports.js';
import { ClaimViz } from './claimviz.js';

// ---------------------------------------------------------------- constants
const params = new URLSearchParams(location.search);
const SCENE_URL = params.get('scene') || 'data/scene.json';
const SCENE_BASE = new URL(SCENE_URL, location.href);
const resolve = p => new URL(p, SCENE_BASE).href;
const PREFETCH = params.get('prefetch') !== '0';
const CLAIMS_URL = params.get('claims'); // optional override, relative to the page

const GROUP_ORDER = ['Organ', 'Lesions', 'Internal structure', 'Vessels', 'Couinaud segments', 'Uncertainty'];
const PART_KINDS = ['cores', 'walls', 'nodules', 'calcifications', 'active'];
const PART_DEF = {
  cores: { name: 'Necrotic / cystic cores', color: '#5f7182', opacity: 1 },
  walls: { name: 'Walls / viable rim', color: '#d4a373', opacity: 0.55 },
  nodules: { name: 'Mural nodules', color: '#e91e63', opacity: 1 },
  calcifications: { name: 'Calcifications', color: '#f5f5f5', opacity: 1 },
  active: { name: 'FDG-active tissue', color: '#ffd400', opacity: 1 },
};
const PART_VOL = { cores: ['core_mL', 'cores_mL'], walls: ['wall_mL', 'walls_mL'], active: ['active_mL'], nodules: ['nodules_mL', 'nodule_mL'], calcifications: ['calcifications_mL', 'calcification_mL'] };
const partVol = (pd, k) => { for (const f of PART_VOL[k] || [k + '_mL']) if (pd?.[f] != null) return pd[f]; return null; };
const LESION_DEFAULT_OPACITY = 0.5;
const CAP_MIN_OPACITY = 0.4;     // layers at or above this opacity get a solid cut face
const AXES = ['x', 'y', 'z'];
const AXIS_INFO = {
  x: { name: 'Sagittal', desc: 'right ↔ left', neg: 'left', pos: 'right' },
  y: { name: 'Coronal', desc: 'anterior ↔ posterior', neg: 'posterior', pos: 'anterior' },
  z: { name: 'Axial', desc: 'superior ↔ inferior', neg: 'inferior', pos: 'superior' },
};

// ---------------------------------------------------------------- app state
const S = { scene: null, dates: [], dateByKey: {}, ctls: new Map(), items: {}, groups: [] };
const state = {
  date: null, reg: null, regGhost: true, ctl: {}, solo: null, sel: null, compare: false, growth: false, growthPair: null,
  clip: { x: { on: false, pos: 0, flip: false }, y: { on: false, pos: 0, flip: false }, z: { on: false, pos: 0, flip: false } },
  caps: true, capAll: false, tab: 'layers', orbit: false, claim: null, lang: 'orig',
};
let shown = null;               // date whose meshes are on screen
let defaults = null;            // snapshot of the default state (for reset and for the compact hash)
let bounds = null;              // Sep-frame RAS bounds of the liver (clip slider ranges)

// ---------------------------------------------------------------- three.js setup
const canvas = $('#c');
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.localClippingEnabled = true;
const scene3 = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 8000);
camera.position.set(0, 0, 900);
scene3.add(camera);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.14; controls.screenSpacePanning = true;
controls.autoRotateSpeed = 1.6; controls.zoomSpeed = 1.1;
scene3.add(new THREE.HemisphereLight(0xffffff, 0x3a4255, 0.85));
const headLight = new THREE.DirectionalLight(0xffffff, 1.25); headLight.position.set(0.35, 0.6, 1); camera.add(headLight);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.35); fillLight.position.set(-1, -0.4, -0.6); camera.add(fillLight);

const root = new THREE.Group(); root.name = 'patient-RAS'; root.matrixAutoUpdate = false; root.matrix.copy(F.RAS2THREE); scene3.add(root);
const dateGroup = {};
const capGroup = new THREE.Group(); capGroup.name = 'caps'; scene3.add(capGroup);

// clipping planes (world space). Mesh materials share `clipAll`; caps share `clipOthers[axis]`.
const planes = { x: new THREE.Plane(), y: new THREE.Plane(), z: new THREE.Plane() };
const clipAll = [];
const clipOthers = { x: [], y: [], z: [] };
const capGeom = new THREE.PlaneGeometry(1, 1);
const capFrame = { x: new THREE.Matrix4(), y: new THREE.Matrix4(), z: new THREE.Matrix4() };
const stencilMat = {};
for (const a of AXES) {
  const base = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: clipAll };
  stencilMat[a] = {
    back: new THREE.MeshBasicMaterial({ ...base, side: THREE.BackSide, stencilFail: THREE.IncrementWrapStencilOp, stencilZFail: THREE.IncrementWrapStencilOp, stencilZPass: THREE.IncrementWrapStencilOp }),
    front: new THREE.MeshBasicMaterial({ ...base, side: THREE.FrontSide, stencilFail: THREE.DecrementWrapStencilOp, stencilZFail: THREE.DecrementWrapStencilOp, stencilZPass: THREE.DecrementWrapStencilOp }),
  };
}

let needsRender = true;
const requestRender = () => { needsRender = true; };
let pulseUntil = 0;

// back faces a bit darker, so the inside of a cut or translucent shell reads as "inside"
function shade(mat) {
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tif (!gl_FrontFacing) diffuseColor.rgb *= 0.66;');
  };
  mat.customProgramCacheKey = () => 'liver-bf';
  return mat;
}

const ghostVS = `#include <common>
#include <clipping_planes_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main(){ vec4 mvPosition = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mvPosition.xyz);
gl_Position = projectionMatrix*mvPosition;
#include <clipping_planes_vertex>
}`;
const ghostFS = `#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 color; uniform float base; uniform float rim; varying vec3 vN; varying vec3 vV;
void main(){
#include <clipping_planes_fragment>
float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
gl_FragColor = vec4(color, clamp(base + rim*pow(f, 3.0), 0.0, 0.85));
}`;
function ghostMaterial(organ) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color('#dcd6ff') }, base: { value: organ ? 0.03 : 0.12 }, rim: { value: organ ? 0.4 : 0.8 } },
    vertexShader: ghostVS, fragmentShader: ghostFS, transparent: true, depthWrite: false, depthTest: false,
    side: THREE.FrontSide, clipping: true, clippingPlanes: clipAll,
  });
}

// ---------------------------------------------------------------- helpers over the scene
const dateLabel = k => S.dateByKey[k]?.label || app?.reports?.outsideLabel?.(k) || k;
const dateShort = k => (S.dateByKey[k]?.label || app?.reports?.outsideLabel?.(k) || k).replace(/^(\w{3})\w*\s+(\d{4})$/, '$1 $2');
const prevDate = k => { const i = S.dates.indexOf(k); return i > 0 ? S.dates[i - 1] : null; };
const regModes = () => S.scene.registration?.modes || {};
const regMatrixCache = new Map();
function regM(date, mode = state.reg) {
  const key = mode + '|' + date;
  if (!regMatrixCache.has(key)) {
    const arr = regModes()[mode]?.matrix?.[date];
    regMatrixCache.set(key, arr ? F.matFromRowMajor(arr) : new THREE.Matrix4());
  }
  return regMatrixCache.get(key);
}
// Compare ghost of date p while date c is shown. A mode may carry its own direct p -> c registration:
//   pair_matrix["p__c"]  row-major 4x4, earlier date RAS -> later date RAS (rigid), or
//   pair_field["p__c"]   {json, bin}: displacement grid in the earlier date's RAS (x -> x + D(x), trilinear), applied to the ghost
//                        mesh vertices (the field already contains the rigid part).
// Without either, the ghost uses the per-date matrices (regM(p)), as before.
const pairKey = (p, c) => `${p}__${c}`;
function ghostField(p, c, mode = state.reg) { return state.regGhost ? regModes()[mode]?.pair_field?.[pairKey(p, c)] || null : null; }
// 'Register earlier scan' off: the ghost keeps the plain spine-anchored (scanner / skeleton) relation to the current date, as before
// registration was added, so the raw breathing shift is visible; the current date stays where the Align mode puts it.
const UNREG = 'skeleton';
const qMode = () => (state.regGhost || !regModes()[UNREG] ? state.reg : UNREG);
function ghostLocal(p, c, mode = state.reg) {
  if (!state.regGhost && regModes()[UNREG]) return regM(p, mode).clone().invert().multiply(regM(c, mode)).multiply(regM(c, UNREG).clone().invert()).multiply(regM(p, UNREG));
  // local matrix of a ghost mesh inside dateGroup[p] (whose matrix is regM(p))
  const pm = regModes()[mode]?.pair_matrix?.[pairKey(p, c)];
  if (!pm && !ghostField(p, c, mode)) return new THREE.Matrix4();
  const T = ghostField(p, c, mode) ? new THREE.Matrix4() : F.matFromRowMajor(pm);
  return regM(p, mode).clone().invert().multiply(regM(c, mode)).multiply(T);
}
/** registration quality of the active mode for the pair that Compare shows (or this date -> Sep) */
function regQuality(mode = state.reg, date = shown) {
  const q = regModes()[mode]?.quality; if (!q || !date) return null;
  const p = prevDate(date);
  const pk = p ? pairKey(p, date) : (date !== S.dates[S.dates.length - 1] ? pairKey(date, S.dates[S.dates.length - 1]) : null);
  return pk && q[pk] ? { pair: pk, q: q[pk] } : null;
}
function qualityText(mode = state.reg, date = shown, long = true) {
  const r = regQuality(mode, date); if (!r) return '';
  const q = r.q, les = ['R1', 'L1', 'S8'].filter(k => q[k]);
  const lv = q.liver ? `liver Dice ${fmtNum(q.liver.dice, 2)}${long ? ` (surface ${fmtNum(q.liver.surf_mean_mm, 1)} mm mean)` : ''}` : '';
  const lo = les.length ? (long ? 'lesion centroid offset ' : 'centroid offset ') + les.map(k => `${k} ${fmtNum(q[k].centroid_offset_mm, 1)}`).join(', ') + ' mm' : '';
  return `${long ? pairLabel(r.pair) + ': ' : ''}${[lv, lo].filter(Boolean).join(' · ')}`;
}
// displacement grids and warped ghost geometries (cached per mode + mesh)
const fieldCache = new Map();   // url -> Promise<{dims, origin, spacing, data}>
const warpCache = new Map();    // mode|pair|url -> BufferGeometry | 'pending' | 'failed'
let warpPending = 0;
function loadField(f) {
  const ju = resolve(f.json);
  if (!fieldCache.has(ju)) fieldCache.set(ju, (async () => {
    const meta = await (await fetch(ju)).json();
    const buf = await (await fetch(resolve(f.bin))).arrayBuffer();
    return { ...meta, data: new Float32Array(buf) };
  })());
  return fieldCache.get(ju);
}
/** add the trilinear displacement to every vertex (grid in C order [nx][ny][nz][3], float32, earlier date RAS mm) */
function warpGeometry(g, fld) {
  const [nx, ny, nz] = fld.dims, [ox, oy, oz] = fld.origin, [sx, sy, sz] = fld.spacing, D = fld.data;
  const out = g.clone(); const pos = out.getAttribute('position'); const a = pos.array;
  const idx = (i, j, k) => ((i * ny + j) * nz + k) * 3;
  for (let v = 0; v < a.length; v += 3) {
    let fx = (a[v] - ox) / sx, fy = (a[v + 1] - oy) / sy, fz = (a[v + 2] - oz) / sz;
    fx = clamp(fx, 0, nx - 1.0001); fy = clamp(fy, 0, ny - 1.0001); fz = clamp(fz, 0, nz - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, w = fy - j, t = fz - k;
    for (let c = 0; c < 3; c++) {
      const c000 = D[idx(i, j, k) + c], c100 = D[idx(i + 1, j, k) + c], c010 = D[idx(i, j + 1, k) + c], c110 = D[idx(i + 1, j + 1, k) + c];
      const c001 = D[idx(i, j, k + 1) + c], c101 = D[idx(i + 1, j, k + 1) + c], c011 = D[idx(i, j + 1, k + 1) + c], c111 = D[idx(i + 1, j + 1, k + 1) + c];
      const d = ((c000 * (1 - u) + c100 * u) * (1 - w) + (c010 * (1 - u) + c110 * u) * w) * (1 - t) + ((c001 * (1 - u) + c101 * u) * (1 - w) + (c011 * (1 - u) + c111 * u) * w) * t;
      a[v + c] += d;
    }
  }
  pos.needsUpdate = true; out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
/** geometry the ghost of `it` should use in the current mode (null while a warped one is being prepared) */
function ghostGeometry(it) {
  const g = peek(it.url); if (!g) return null;
  const c = shown, f = ghostField(it.date, c);
  if (!f) return g;
  const key = `${state.reg}|${pairKey(it.date, c)}|${it.url}`;
  const w = warpCache.get(key);
  if (w === 'failed') return g;
  if (w && w !== 'pending') return w;
  if (!w) {
    warpCache.set(key, 'pending'); warpPending++;
    loadField(f).then(fld => { warpCache.set(key, warpGeometry(g, fld)); })
      .catch(e => { console.warn('displacement grid failed', e); warpCache.set(key, 'failed'); toast('Non-rigid ghost could not be loaded; showing the rigid ghost.'); })
      .finally(() => { warpPending--; sync(); });
  }
  return null;
}
const ctlState = id => state.ctl[id] || (state.ctl[id] = { v: false, o: 1 });
const lesionById = id => S.scene.lesions?.find(l => l.id === id);
const partFile = p => (typeof p === 'string' ? p : p?.mesh);

function buildModel() {
  const sc = S.scene;
  S.dates = (sc.dates || []).map(d => d.key);
  for (const d of sc.dates || []) S.dateByKey[d.key] = d;
  const partsExist = (date, kind) => (sc.lesions || []).some(l => partFile(l.parts?.[date]?.[kind]));
  const ctl = (id, o) => { if (!S.ctls.has(id)) S.ctls.set(id, { id, ...o }); return S.ctls.get(id); };

  for (const L of sc.layers || []) {
    const isPart = PART_KINDS.includes(L.id);
    ctl(L.id, {
      name: L.name || PART_DEF[L.id]?.name || L.id, group: L.group || (isPart ? 'Internal structure' : 'Other'),
      color: L.color || PART_DEF[L.id]?.color || '#bbbbbb', defOpacity: L.opacity ?? PART_DEF[L.id]?.opacity ?? 1,
      defVisible: L.default_visible ?? false, layer: L, notVisible: L.not_visible || {}, kind: isPart ? 'part' : 'layer',
    });
  }
  for (const les of sc.lesions || []) {
    for (const date of Object.keys(les.parts || {})) for (const k of Object.keys(les.parts[date] || {})) {
      if (!S.ctls.has(k)) ctl(k, { name: PART_DEF[k]?.name || k, group: 'Internal structure', color: PART_DEF[k]?.color || '#cccccc', defOpacity: PART_DEF[k]?.opacity ?? 1, defVisible: k === 'active' || k === 'nodules', notVisible: {}, kind: 'part', synthetic: true });
    }
  }
  for (const les of sc.lesions || []) {
    ctl('les:' + les.id, {
      name: `${les.id} · ${les.name || ''}`.trim(), short: les.id, group: 'Lesions', color: les.color || '#4caf50',
      defOpacity: les.opacity ?? LESION_DEFAULT_OPACITY, defVisible: les.default_visible ?? true, lesion: les, notVisible: les.not_visible || {}, kind: 'lesion',
    });
  }
  // groups in the agreed order, then anything else the scene brings
  const gs = new Set([...S.ctls.values()].map(c => c.group));
  S.groups = [...GROUP_ORDER.filter(g => gs.has(g)), ...[...gs].filter(g => !GROUP_ORDER.includes(g))];

  let pick = 1;
  for (const date of S.dates) {
    const list = [];
    for (const L of sc.layers || []) {
      if (PART_KINDS.includes(L.id) && partsExist(date, L.id)) continue; // per-lesion parts replace the union layer
      const pd = L.per_date?.[date];
      if (!pd?.mesh) continue;
      list.push({ uid: `${date}|${L.id}`, date, ctl: L.id, kind: 'layer', name: L.name || L.id, url: resolve(pd.mesh), vol: pd.volume_mL, pd });
    }
    for (const les of sc.lesions || []) {
      const pd = les.per_date?.[date];
      if (pd?.mesh) list.push({ uid: `${date}|les:${les.id}`, date, ctl: 'les:' + les.id, kind: 'lesion', lesion: les, name: `${les.id} · ${les.name || ''}`, url: resolve(pd.mesh), vol: pd.volume_mL, pd });
      const parts = les.parts?.[date] || {};
      for (const [k, p] of Object.entries(parts)) {
        const f = partFile(p);
        if (!f) continue;
        const vol = (p && typeof p === 'object' && p.volume_mL != null) ? p.volume_mL : partVol(pd, k);
        list.push({ uid: `${date}|${les.id}|${k}`, date, ctl: k, kind: 'part', part: k, lesion: les, name: `${S.ctls.get(k)?.name || k} in ${les.id}`, url: resolve(f), vol, pd });
      }
      // growth maps: the base set (lesions[].growth) and alternative sets baked with other alignments (lesions[].growth_sets[set]),
      // chosen by the active mode's growth_set
      for (const [set, gs] of [['', les.growth], ...Object.entries(les.growth_sets || {})]) {
        for (const [pair, g] of Object.entries(gs || {})) {
          const [, b] = pair.split('__');
          if (b === date && g?.mesh) list.push({ uid: `${date}|growth|${set}|${les.id}|${pair}`, date, ctl: 'les:' + les.id, kind: 'growth', set, lesion: les, pair, g, name: `${les.id} growth ${pairLabel(pair)}`, url: resolve(g.mesh), vol: pd?.volume_mL, pd });
        }
      }
    }
    for (const it of list) { it.pickId = pick++; it.rank = rankOf(it); }
    S.items[date] = list;
  }
  S.byPick = new Map(); for (const d of S.dates) for (const it of S.items[d]) S.byPick.set(it.pickId, it);
}

function rankOf(it) {
  if (it.kind === 'part') return { calcifications: 10, nodules: 11, active: 12, cores: 13, walls: 14 }[it.part] ?? 15;
  if (it.kind === 'lesion' || it.kind === 'growth') return 20;
  const c = S.ctls.get(it.ctl);
  if (PART_KINDS.includes(it.ctl)) return { calcifications: 10, nodules: 11, active: 12, cores: 13, walls: 14 }[it.ctl];
  if (c.group === 'Uncertainty') return 25;
  if (c.group === 'Vessels') return 30;
  if (c.group === 'Couinaud segments') return 40;
  if (it.ctl === 'liver') return 55;
  if (c.group === 'Organ') return 50;
  return 35;
}

function pairLabel(pair) { const [a, b] = pair.split('__'); return `${dateShort(a)} → ${dateShort(b)}`; }
function growthPairs() {
  const s = new Set();
  for (const l of S.scene.lesions || []) for (const k of Object.keys(l.growth || {})) s.add(k);
  return [...s].sort((p, q) => {
    const [a1, b1] = p.split('__').map(k => S.dates.indexOf(k)), [a2, b2] = q.split('__').map(k => S.dates.indexOf(k));
    return (b1 - a1) - (b2 - a2) || a1 - a2;
  });
}
const growthSet = () => (state.regGhost ? regModes()[state.reg]?.growth_set || '' : 'skeleton');
/** growth map item for the active mode's set (falls back to the base set when that set has no map for this lesion/pair) */
function growthItem(lesionId, date, pair) {
  const c = S.items[date]?.filter(it => it.kind === 'growth' && it.lesion.id === lesionId && it.pair === pair) || [];
  return c.find(it => it.set === growthSet()) || c.find(it => it.set === '');
}
function available(ctlId, date) { return S.items[date]?.some(it => it.ctl === ctlId && it.kind !== 'growth'); }
function notVisibleReason(ctlId, date) {
  const c = S.ctls.get(ctlId);
  if (c.notVisible?.[date]) return c.notVisible[date];
  if (c.kind === 'lesion') {
    const pd = c.lesion.per_date?.[date];
    if (pd?.not_visible) return pd.not_visible;
    return 'not present / not traced on this date';
  }
  return 'no mesh for this date';
}

/** confidence label of a control on a date (scene per_date.confidence, set by the data builder from the consensus reports) */
function confOf(ctlId, date) {
  const c = S.ctls.get(ctlId); if (!c || !date) return null;
  if (c.lesion) return c.lesion.per_date?.[date]?.confidence || null;
  return c.layer?.per_date?.[date]?.confidence || null;
}

// ---------------------------------------------------------------- what is shown
function opacityOf(it) { const o = ctlState(it.ctl).o; return it.kind === 'growth' ? Math.max(o, 0.85) : o; }
function wants(it, date = shown) {
  if (it.date !== date) return false;
  const c = ctlState(it.ctl);
  if (!c.v || c.o <= 0.001) return false;
  if (state.solo && state.solo !== it.ctl) return false;
  if (it.kind === 'growth') return state.growth && state.growthPair === it.pair && growthItem(it.lesion.id, it.date, it.pair) === it;
  if (it.kind === 'lesion' && state.growth) {
    const g = growthItem(it.lesion.id, it.date, state.growthPair);
    if (g && !g.failed && peek(g.url)) return false;
  }
  return true;
}
function ghostWanted(it) {
  if (!state.compare || !shown || it.date !== prevDate(shown)) return false;
  if (!(it.kind === 'lesion' || it.ctl === 'liver')) return false;
  const c = ctlState(it.ctl);
  return c.v && (!state.solo || state.solo === it.ctl);
}
function urlsFor(date) {
  const urls = new Set();
  for (const it of S.items[date] || []) if (wants(it, date) || (it.kind === 'growth' && state.growth && state.growthPair === it.pair && growthItem(it.lesion.id, it.date, it.pair) === it && ctlState(it.ctl).v)) urls.add(it.url);
  if (state.compare) { const p = prevDate(date); for (const it of S.items[p] || []) if ((it.kind === 'lesion' || it.ctl === 'liver') && ctlState(it.ctl).v) urls.add(it.url); }
  return [...urls];
}

function colorOf(it) {
  if (it.kind === 'lesion' || it.kind === 'growth') return S.ctls.get(it.ctl).color;
  return S.ctls.get(it.ctl).color;
}

function ensureMesh(it) {
  if (it.mesh || it.failed) return it.mesh;
  const g = peek(it.url);
  if (!g) return null;
  const vc = it.kind === 'growth' && !!g.getAttribute('color');
  if (it.kind === 'growth' && !vc) it.noColors = true;
  const mk = side => shade(new THREE.MeshStandardMaterial({ color: vc ? 0xffffff : colorOf(it), vertexColors: vc, roughness: 0.62, metalness: 0, side, emissive: 0x000000 }));
  const front = new THREE.Mesh(g, mk(THREE.DoubleSide));
  const back = new THREE.Mesh(g, mk(THREE.BackSide));
  for (const m of [front, back]) {
    m.matrixAutoUpdate = false; m.userData.item = it; m.userData.pickable = true;
    m.material.clippingPlanes = clipAll; m.visible = false;
    dateGroup[it.date].add(m);
  }
  it.mesh = front; it.back = back;
  return front;
}
function ensureGhost(it) {
  if (it.ghost) return it.ghost;
  const g = peek(it.url); if (!g) return null;
  const m = new THREE.Mesh(g, ghostMaterial(it.kind !== 'lesion'));
  m.matrixAutoUpdate = false; m.renderOrder = 300; m.userData.ghostOf = it; m.visible = false;
  dateGroup[it.date].add(m); it.ghost = m; return m;
}

function dimmed(it) {
  if (!focus?.dim) return false;
  if (focus.ctls.has(it.ctl) || focus.keep?.has(it.ctl)) return false;
  if (state.sel && it.lesion?.id === state.sel) return false;
  return true;
}
function applyMaterial(it) {
  const o = opacityOf(it) * (dimmed(it) ? 0.28 : 1), tr = o < 0.999;
  for (const [m, isBack] of [[it.mesh, false], [it.back, true]]) {
    const mat = m.material;
    mat.opacity = o; mat.transparent = tr; mat.depthWrite = !tr;
    if (!isBack) mat.side = tr ? THREE.FrontSide : THREE.DoubleSide;
  }
  // transparent: all back faces outer->inner, then all front faces inner->outer (no popping, nested shells read correctly)
  it.back.visible = it.mesh.visible && tr;
  it.back.renderOrder = 100 + (60 - it.rank);
  it.mesh.renderOrder = tr ? 200 + it.rank : 0;
}

function sync() {
  if (!shown) return;
  const prev = prevDate(shown);
  for (const d of S.dates) for (const it of S.items[d]) {
    if (it.mesh) { it.mesh.visible = wants(it); applyMaterial(it); }
    if (state.compare && d === prev && ghostWanted(it)) ensureGhost(it);
    if (it.ghost) {
      let vis = ghostWanted(it);
      if (vis) {
        const g = ghostGeometry(it);
        if (g) { if (it.ghost.geometry !== g) it.ghost.geometry = g; it.ghost.matrix.copy(ghostLocal(it.date, shown)); it.ghost.matrixWorldNeedsUpdate = true; }
        else vis = false;   // warped geometry still being prepared
      }
      it.ghost.visible = vis;
    }
  }
  rebuildCaps();
  updateHighlights();
  requestRender();
}

// ---------------------------------------------------------------- clipping and caps
function updatePlanes() {
  clipAll.length = 0;
  for (const a of AXES) clipOthers[a].length = 0;
  const c = bounds ? [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2] : [0, 0, 0];
  const size = bounds ? 2.2 * Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2]) : 600;
  AXES.forEach((a, i) => {
    const cl = state.clip[a];
    const nR = [0, 0, 0]; nR[i] = cl.flip ? 1 : -1;          // keep the side below the plane unless flipped
    const pR = c.slice(); pR[i] = cl.pos;
    const n = F.rasDirToWorld(nR).normalize(), p = F.rasToWorld(pR);
    planes[a].setFromNormalAndCoplanarPoint(n, p);
    // cap quad on the plane, facing the removed side
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().negate());
    capFrame[a].compose(p, q, new THREE.Vector3(size, size, 1));
  });
  for (const a of AXES) if (state.clip[a].on) clipAll.push(planes[a]);
  for (const a of AXES) for (const b of AXES) if (b !== a && state.clip[b].on) clipOthers[a].push(planes[b]);
  for (const o of capGroup.children) if (o.userData.axis) o.matrix.copy(capFrame[o.userData.axis]);
  requestRender();
}

const capPool = new Map(); // `${uid}|${axis}` -> {back, front, cap}
function rebuildCaps() {
  const active = AXES.filter(a => state.clip[a].on);
  const used = new Set();
  if (active.length && state.caps && shown) {
    const list = S.items[shown].filter(it => it.mesh?.visible && (opacityOf(it) >= CAP_MIN_OPACITY || state.capAll)).sort((p, q) => q.rank - p.rank);
    let seq = 0;
    for (const it of list) for (const a of active) {
      const key = it.uid + '|' + a;
      let e = capPool.get(key);
      if (!e) {
        const g = it.mesh.geometry;
        const back = new THREE.Mesh(g, stencilMat[a].back), front = new THREE.Mesh(g, stencilMat[a].front);
        for (const m of [back, front]) { m.matrixAutoUpdate = false; m.userData.stencilOf = it; dateGroup[it.date].add(m); }
        const col = new THREE.Color(colorOf(it)).multiplyScalar(0.92);
        const capMat = new THREE.MeshBasicMaterial({
          color: col, side: THREE.DoubleSide, clippingPlanes: clipOthers[a],
          stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc,
          stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp,
        });
        const cap = new THREE.Mesh(capGeom, capMat);
        cap.matrixAutoUpdate = false; cap.matrix.copy(capFrame[a]); cap.userData.axis = a; cap.userData.capOf = it; cap.userData.pickable = true; cap.userData.item = it;
        capGroup.add(cap);
        e = { back, front, cap }; capPool.set(key, e);
      }
      e.back.renderOrder = e.front.renderOrder = 1000 + seq * 2; e.cap.renderOrder = 1000 + seq * 2 + 1; seq++;
      e.back.visible = e.front.visible = e.cap.visible = true;
      used.add(key);
    }
  }
  for (const [key, e] of capPool) if (!used.has(key)) { e.back.visible = e.front.visible = e.cap.visible = false; }
  requestRender();
}

// ---------------------------------------------------------------- highlights (selection, claim focus)
let focus = null; // {ctls:Set, lesion:id|null}
function updateHighlights() {
  let any = false;
  for (const d of S.dates) for (const it of S.items[d]) {
    if (!it.mesh) continue;
    const on = it.mesh.visible && ((state.sel && it.lesion?.id === state.sel && it.kind !== 'part') ||
      (focus && focus.ctls.has(it.ctl) && (!focus.lesion || !it.lesion || it.lesion.id === focus.lesion)));
    it.hl = !!on; any = any || on;
    if (!on) { it.mesh.material.emissive.setRGB(0, 0, 0); it.back.material.emissive.setRGB(0, 0, 0); }
  }
  pulseUntil = any ? Infinity : 0;
}
function pulse(t) {
  const k = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t / 1000 * Math.PI * 1.5));
  for (const d of S.dates) for (const it of S.items[d]) if (it.hl && it.mesh) {
    const c = new THREE.Color(it.mesh.material.vertexColors ? '#ffffff' : colorOf(it)).multiplyScalar(k * 1.6);
    it.mesh.material.emissive.copy(c); it.back.material.emissive.copy(c);
  }
}

// ---------------------------------------------------------------- loading and date switching
let switchToken = 0;
async function ensureDate(date) {
  const urls = urlsFor(date);
  const res = await Promise.allSettled(urls.map(u => loadGeometry(u)));
  res.forEach((r, i) => {
    if (r.status === 'rejected') {
      for (const it of S.items[date].concat(S.items[prevDate(date)] || [])) if (it.url === urls[i]) it.failed = String(r.reason?.message || r.reason);
      console.warn('mesh failed', urls[i], r.reason);
    }
  });
  for (const it of S.items[date]) if (urls.includes(it.url)) ensureMesh(it);
  const fails = res.filter(r => r.status === 'rejected').length;
  if (fails) toast(`${fails} mesh file(s) could not be loaded for ${dateLabel(date)} (see the layer list).`, 5000);
}
async function setDate(date, opts = {}) {
  if (!S.dateByKey[date]) return;
  const tok = ++switchToken;
  state.date = date;
  // growth pair follows the date: prefer previous -> this date
  if (state.growth && !opts.keepPair) {
    const pairs = growthPairs().filter(p => p.endsWith('__' + date));
    const pref = prevDate(date) ? `${prevDate(date)}__${date}` : null;
    state.growthPair = pairs.includes(pref) ? pref : (pairs[0] || state.growthPair);
  }
  renderDateButtons(true);
  await ensureDate(date);
  if (tok !== switchToken) return;
  shown = date;
  renderRegButtons();
  computeBounds();
  updatePlanes();
  sync();
  renderDateButtons(false);
  refreshPanels();
  claimViz.onDate(shown);
  writeHash();
  if (PREFETCH && !prefetched) prefetchOthers();
}
let prefetched = false;
async function prefetchOthers() {
  prefetched = true;
  const idle = window.requestIdleCallback || (f => setTimeout(f, 400));
  for (const d of S.dates) if (d !== shown) {
    await new Promise(r => idle(r));
    await Promise.allSettled(urlsFor(d).map(u => loadGeometry(u)));
    for (const it of S.items[d]) ensureMesh(it);
  }
}
// visibility changes may need meshes that are not loaded yet
async function ensureVisibleLoaded() {
  if (!shown) return;
  await ensureDate(shown);
  sync();
}

function computeBounds() {
  const box = new THREE.Box3();
  for (const d of S.dates) {
    const liver = S.items[d].find(it => it.ctl === 'liver');
    const g = liver && peek(liver.url);
    const src = g ? [g] : S.items[d].map(it => peek(it.url)).filter(Boolean);
    for (const gg of src) box.union(gg.boundingBox.clone().applyMatrix4(regM(d)));
  }
  if (box.isEmpty()) return;
  const nb = { min: box.min.toArray(), max: box.max.toArray() };
  const first = !bounds;
  bounds = nb;
  for (const [i, a] of AXES.entries()) {
    const cl = state.clip[a];
    if (first && !cl._fromHash) cl.pos = Math.round((bounds.min[i] + bounds.max[i]) / 2);
  }
  renderCutPanel();
}

// ---------------------------------------------------------------- camera
function fitDist(r) {
  const f = freeBand();
  if (f.H > 0) r *= clamp(f.H / Math.max(120, f.bottom - f.top), 1, 2.5);
  const vf = camera.fov * Math.PI / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  return r / Math.sin(Math.min(vf, hf) / 2) * 1.04;
}
let tween = null;
function flyTo(pos, target, ms = 650) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos.clone(), t1: target.clone(), start: performance.now(), ms };
  if (!ms) { camera.position.copy(pos); controls.target.copy(target); tween = null; controls.update(); }
  requestRender();
}
function liverSphere() {
  const s = new THREE.Sphere();
  const box = new THREE.Box3();
  const items = S.items[shown] || [];
  const liver = items.find(it => it.ctl === 'liver' && it.mesh);
  for (const it of liver ? [liver] : items.filter(i => i.mesh?.visible)) {
    it.mesh.updateWorldMatrix(true, false);
    box.union(it.mesh.geometry.boundingBox.clone().applyMatrix4(it.mesh.matrixWorld));
  }
  if (box.isEmpty()) return new THREE.Sphere(new THREE.Vector3(), 200);
  box.getBoundingSphere(s); s.radius *= 0.92; return s;
}
function viewDir(rasDir, center, radius, ms) {
  const d = F.rasDirToWorld(rasDir).normalize();
  flyTo(center.clone().addScaledVector(d, fitDist(radius)), center, ms);
}
function presetView(id, ms) {
  const p = F.PRESETS.find(x => x.id === id) || F.PRESETS[0];
  const target = state.sel && state.orbit ? lesionSphere(state.sel) : null;
  const s = target || liverSphere();
  viewDir(p.dir, s.center, s.radius, ms);
}
function lesionCenterRAS(id, date = shown) {
  const les = lesionById(id); if (!les) return null;
  const pd = les.per_date?.[date];
  if (pd?.centroid_ras) return F.applyRas(regM(date), pd.centroid_ras);
  const it = S.items[date]?.find(i => i.kind === 'lesion' && i.lesion.id === id);
  const g = it && peek(it.url);
  if (g) { const c = g.boundingSphere.center.clone().applyMatrix4(regM(date)); return c.toArray(); }
  return null;
}
function lesionSphere(id, date = shown) {
  let d = date, c = lesionCenterRAS(id, d);
  if (!c) { for (const k of [...S.dates].reverse()) { c = lesionCenterRAS(id, k); if (c) { d = k; break; } } }
  if (!c) return null;
  const les = lesionById(id), pd = les.per_date?.[d];
  const it = S.items[d]?.find(i => i.kind === 'lesion' && i.lesion.id === id);
  const g = it && peek(it.url);
  const r = g ? g.boundingSphere.radius : (pd?.long_axis_mm ? pd.long_axis_mm / 2 : 30);
  return new THREE.Sphere(F.rasToWorld(c), Math.max(r * 1.25, 22));
}
function flyToLesion(id, opts = {}) {
  const s = lesionSphere(id);
  if (!s) { toast(`${id} has no position on any date.`); return; }
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
  if (opts.dirRAS) dir.copy(F.rasDirToWorld(opts.dirRAS).normalize());
  flyTo(s.center.clone().addScaledVector(dir, fitDist(s.radius)), s.center, opts.ms);
}

// ---------------------------------------------------------------- selection
function selectLesion(id, opts = {}) {
  state.sel = id || null;
  // in a lesion-anchored alignment, picking another lesion re-anchors the ghost on that lesion
  if (id && regModes()[state.reg]?.lesion && regModes()[state.reg].lesion !== id) {
    const k = Object.keys(regModes()).find(k => regModes()[k].lesion === id);
    if (k) setReg(k);
  }
  if (id && opts.fly !== false) flyToLesion(id);
  if (state.orbit && id) { const s = lesionSphere(id); if (s) controls.target.copy(s.center); }
  updateHighlights();
  refreshLayerRows(); renderLesions(); reports.onSelectLesion(state.sel);
  $('#orbitBtn').disabled = !state.sel;
  requestRender(); writeHash();
}

// ---------------------------------------------------------------- picking (GPU id buffer, respects clipping and caps)
const pickRT = new THREE.WebGLRenderTarget(1, 1, { stencilBuffer: true, depthBuffer: true });
const pickBuf = new Uint8Array(4);
const CUT_BIT = 1 << 20;
let lastPickCut = false;
function idColor(id) { return new THREE.Color().setRGB((id & 255) / 255, ((id >> 8) & 255) / 255, ((id >> 16) & 255) / 255, THREE.LinearSRGBColorSpace); }
function pickMat(o) {
  const src = o.material;
  if (!o.userData.pickMat) {
    o.userData.pickMat = new THREE.MeshBasicMaterial({ color: idColor(o.userData.item.pickId | (o.userData.capOf ? CUT_BIT : 0)) });
  }
  const m = o.userData.pickMat;
  m.side = o.userData.capOf ? THREE.DoubleSide : (src.side === THREE.BackSide ? THREE.BackSide : THREE.DoubleSide);
  m.clippingPlanes = src.clippingPlanes;
  for (const k of ['stencilWrite', 'stencilRef', 'stencilFunc', 'stencilFail', 'stencilZFail', 'stencilZPass']) m[k] = src[k];
  return m;
}
function pickAt(x, y) {
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  if (x < 0 || y < 0 || x >= w || y >= hgt) return null;
  const objs = [];
  scene3.traverse(o => { if (o.isMesh || o.isLine || o.isPoints || o.isSprite) objs.push(o); });
  const saved = objs.map(o => [o, o.visible, o.material]);
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  let hit = null;
  camera.setViewOffset(w, hgt, x, y + viewShift, 1, 1);
  for (const pass of [0, 1]) {
    for (const [o, vis] of saved) {
      if (!vis) continue;
      const it = o.userData.item || o.userData.stencilOf;
      const thin = it && opacityOf(it) < 0.35;
      if (o.userData.stencilOf) o.visible = !(pass === 0 && thin);
      else if (o.userData.pickable) { o.visible = !(pass === 0 && thin); if (o.visible) o.material = pickMat(o); }
      else o.visible = false;
    }
    renderer.setRenderTarget(pickRT);
    renderer.setClearColor(0x000000, 1); renderer.clear(true, true, true);
    renderer.render(scene3, camera);
    renderer.readRenderTargetPixels(pickRT, 0, 0, 1, 1, pickBuf);
    const id = pickBuf[0] | (pickBuf[1] << 8) | (pickBuf[2] << 16);
    if (id) { hit = S.byPick.get(id & (CUT_BIT - 1)) || null; lastPickCut = !!(id & CUT_BIT); break; }
  }
  for (const [o, vis, mat] of saved) { o.visible = vis; o.material = mat; }
  renderer.setRenderTarget(null); renderer.setClearColor(prevClear, prevAlpha);
  applyViewShift();
  return hit;
}

// keep the model centred in the part of the canvas that the claim bar does not cover
let viewShift = 0;
function freeBand() {
  // the vertical band of the canvas not covered by the top bar (and registration line) or by the claim bar
  const sr = stage.getBoundingClientRect(), H = sr.height;
  let top = 0, bottom = H;
  for (const id of ['#topbar', '#regInfo']) {
    const el = $(id); if (!el || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect(); if (r.height) top = Math.max(top, r.bottom - sr.top);
  }
  const bar = $('#claimbar');
  if (!bar.hidden && stage.contains(bar)) {
    const r = bar.getBoundingClientRect();
    if (r.top - sr.top > H * 0.35) bottom = Math.min(bottom, r.top - sr.top);
    else top = Math.max(top, r.bottom - sr.top);
  }
  top = Math.min(top, H * 0.45); bottom = Math.max(bottom, top + H * 0.3);
  return { top, bottom, H };
}
function applyViewShift() {
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  let sh = 0;
  if (w && hgt) { const f = freeBand(); sh = hgt / 2 - (f.top + f.bottom) / 2; }
  viewShift = Math.round(sh);
  if (viewShift) camera.setViewOffset(w, hgt, 0, viewShift, w, hgt); else camera.clearViewOffset();
  requestRender();
}
new ResizeObserver(() => applyViewShift()).observe($('#claimbar'));

// on narrow screens the claim bar lives in the panel under the canvas instead of covering the model
const narrowMQ = matchMedia('(max-width: 820px)');
function placeClaimBar() {
  const bar = $('#claimbar');
  if (narrowMQ.matches) { if (bar.parentElement !== $('#side')) $('#side').insertBefore(bar, $('.tabs')); }
  else if (bar.parentElement !== stage) stage.append(bar);
  applyViewShift();
}
narrowMQ.addEventListener?.('change', placeClaimBar);
placeClaimBar();

// ---------------------------------------------------------------- labels projected from 3D
const labelHost = $('#labels');
const labels = new Set();
function addLabel(text, worldPos, cls = 'info') {
  const el = h('div'); el.className = 'lbl ' + cls; el.textContent = text; labelHost.append(el);
  const L = { el, pos: worldPos.clone(), remove() { el.remove(); labels.delete(L); } };
  labels.add(L); requestRender(); return L;
}
const _v = new THREE.Vector3();
function updateLabels() {
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  for (const L of labels) {
    _v.copy(L.pos).project(camera);
    const vis = _v.z < 1 && _v.z > -1 && Math.abs(_v.x) < 1.2 && Math.abs(_v.y) < 1.2;
    L.el.style.display = vis ? '' : 'none';
    if (vis) L.el.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px,${((1 - _v.y) / 2 * hgt).toFixed(1)}px) translate(-50%,-50%)`;
  }
}

// orientation letters on the canvas edges (as on CT viewers)
const orientEls = { l: $('#orient .o-l'), r: $('#orient .o-r'), t: $('#orient .o-t'), b: $('#orient .o-b') };
function updateOrient() {
  const m = camera.matrixWorld.elements;
  const right = new THREE.Vector3(m[0], m[1], m[2]), up = new THREE.Vector3(m[4], m[5], m[6]);
  orientEls.r.textContent = F.dirLetters(right); orientEls.l.textContent = F.dirLetters(right.clone().negate());
  orientEls.t.textContent = F.dirLetters(up); orientEls.b.textContent = F.dirLetters(up.clone().negate());
}

// ---------------------------------------------------------------- UI: top bar
function renderDateButtons(loading) {
  const host = $('#dateButtons');
  if (!host.childElementCount) {
    S.scene.dates.forEach((d, i) => {
      host.append(h('button', {
        'data-date': d.key, 'aria-pressed': 'false', title: `${d.label}: scan ${d.scan || ''}${d.ct ? ' — ' + d.ct : ''} (key ${i + 1})`,
        onclick: () => { stopPlay(); setDate(d.key); },
      }, h('b', null, d.label, h('kbd', null, String(i + 1))), h('small', null, d.scan ? new Date(d.scan + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')));
    });
  }
  for (const b of $$('button', host)) {
    b.setAttribute('aria-pressed', String(b.dataset.date === state.date));
    b.classList.toggle('loading', !!loading && b.dataset.date === state.date && state.date !== shown);
  }
}
function renderRegButtons() {
  const host = $('#regButtons'); host.innerHTML = '';
  host.append(h('label.small.muted.reg-label', { for: 'regSelect', style: { padding: '0 4px' } }, 'Align:'));
  // one selector: whole-scene alignments first, then the lesion-anchored ones (scene modes with `lesion`)
  const sel = h('select', { id: 'regSelect', 'aria-label': 'Alignment between dates', title: regModes()[state.reg]?.note || '' });
  const groups = [['Whole liver / spine', ([, m]) => !m.lesion], ['Lesion-anchored (growth in place)', ([, m]) => !!m.lesion]];
  for (const [gl, f] of groups) {
    const ms = Object.entries(regModes()).filter(f); if (!ms.length) continue;
    const og = h('optgroup', { label: gl });
    for (const [k, m] of ms) og.append(h('option', { value: k }, (m.label || k) + (k === S.scene.registration?.default ? ' (default)' : '')));
    sel.append(og);
  }
  sel.value = state.reg || '';
  sel.onchange = e => setReg(e.target.value);
  host.append(sel);
  const m = regModes()[state.reg] || {};
  const qt = qualityText(qMode());
  const res = Object.entries(m.residual_mm || {}).filter(([, v]) => v != null).map(([d, v]) => `${dateShort(d)} ${(+v).toFixed(1)} mm`).join(' · ');
  const ri = $('#regInfo');
  ri.innerHTML = `<b>${esc(m.label || state.reg || 'no registration')}</b>` + (state.compare && !state.regGhost ? ' · <b>ghost NOT registered</b> (spine frame)' : '') +
    (qt ? (state.compare && !state.regGhost ? ' — without registration, ' : ' — after alignment, ') + esc(qt) : (res ? ' — residual vs Sep frame: ' + esc(res) : '')) +
    ` <span class="note">${esc(m.note || 'No registration note in the scene.')}` +
    ` ${esc(S.scene.registration?.follow_note || '')}</span>`;
  ri.title = (m.note || '') + ' — click to expand / collapse';
  ri.append(glossary());
  ri.onclick = e => { if (!e.target.closest('.glossary')) ri.classList.toggle('open'); };
  measureTopbar();
}
function setReg(k) {
  if (!regModes()[k]) return;
  state.reg = k;
  for (const d of S.dates) { dateGroup[d].matrix.copy(regM(d)); dateGroup[d].matrixWorldNeedsUpdate = true; }
  bounds = null; computeBounds(); updatePlanes();
  renderRegButtons(); claimViz.onRegistration(); renderLegend(); ensureVisibleLoaded(); requestRender(); writeHash();
}
function measureTopbar() {
  const hgt = $('#topbar').getBoundingClientRect().height;
  stage.style.setProperty('--topbar-h', Math.round(hgt + 14) + 'px');
  stage.style.setProperty('--viewtools-h', Math.round($('#viewtools').getBoundingClientRect().height + 10) + 'px');
}

let playing = false, playTimer = null;
function stopPlay() { playing = false; clearTimeout(playTimer); $('#play').setAttribute('aria-pressed', 'false'); $('#play').innerHTML = '&#9654;'; }
async function togglePlay() {
  if (playing) return stopPlay();
  playing = true; $('#play').setAttribute('aria-pressed', 'true'); $('#play').innerHTML = '&#10074;&#10074;';
  const step = async () => {
    if (!playing) return;
    const i = S.dates.indexOf(state.date);
    await setDate(S.dates[(i + 1) % S.dates.length]);
    if (playing) playTimer = setTimeout(step, 1500);
  };
  step();
}
function setRegGhost(on) {
  state.regGhost = !!on; $('#regGhost').checked = state.regGhost;
  renderRegButtons(); renderLegend(); ensureVisibleLoaded(); requestRender(); writeHash();
}
/** the 'i' popover next to the Register checkbox: click / tap toggles, hover opens on devices with a mouse, Esc or an outside click closes */
function initRegPopover() {
  const btn = $('#regInfoBtn'), pop = $('#regPop'), wrap = btn.parentElement;
  const set = open => { pop.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  let pinned = false, t = null;
  // click / tap pins it open (or closes a pinned one); hovering the 'i' shows it until the pointer leaves the icon and the popover
  btn.addEventListener('click', e => { e.stopPropagation(); pinned = !(pinned && !pop.hidden); set(pinned); });
  if (matchMedia('(hover: hover)').matches) {
    btn.addEventListener('mouseenter', () => { clearTimeout(t); set(true); });
    for (const el of [btn, pop]) {
      el.addEventListener('mouseenter', () => clearTimeout(t));
      el.addEventListener('mouseleave', () => { if (!pinned) t = setTimeout(() => set(false), 250); });
    }
  }
  const close = () => { pinned = false; set(false); };
  document.addEventListener('click', e => { if (!pop.hidden && !wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
}
/** plain-language glossary of the alignment numbers (status line and About tab) */
function glossary(open = false) {
  const items = [
    ['Dice', 'overlap of two outlines: 1.00 = identical, 0 = no overlap. About 0.9 or more is very good, 0.7–0.9 fair, below 0.5 poor. A lesion that really grew cannot reach 1.00 (L1 grew from 25 to 54 mL, so about 0.63 is the best possible).'],
    ['Centroid offset', 'distance in mm between the centres of the same structure on the two dates, after alignment.'],
    ['Surface distance', 'how far apart the two outline surfaces are, in mm: the mean, and the 95th percentile (the worst 5 % of places are further apart).'],
    ['Residual', 'the mismatch that is left after alignment.'],
    ['Consensus masks', 'outlines agreed by two independent AI teams and an adjudicator, checked against the written reports.'],
    ['PET-defined only', 'activity seen on PET without a boundary on the CT.'],
  ];
  return h('details.glossary', { open: open || null }, h('summary', null, 'What do these numbers mean?'),
    h('dl', null, ...items.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
}
function setCompare(on) {
  state.compare = on; $('#compareBtn').setAttribute('aria-pressed', String(on));
  ensureVisibleLoaded(); renderLegend(); writeHash();
}
function setGrowth(on, pair) {
  state.growth = on;
  if (pair) state.growthPair = pair;
  const pairs = growthPairs();
  if (on && !pair) {
    const pref = `${prevDate(shown)}__${shown}`;
    state.growthPair = pairs.includes(pref) ? pref : (pairs.find(p => p.endsWith('__' + shown)) || state.growthPair || pairs[0] || null);
  }
  $('#growthBtn').setAttribute('aria-pressed', String(on));
  $('#growthPair').value = state.growthPair || '';
  if (on && state.growthPair) {
    const later = state.growthPair.split('__')[1];
    if (later !== shown) { setDate(later, { keepPair: true }); renderLegend(); writeHash(); return; }
  }
  ensureVisibleLoaded(); renderLegend(); writeHash();
}
function renderGrowthSelect() {
  const sel = $('#growthPair'); sel.innerHTML = '';
  const pairs = growthPairs();
  for (const p of pairs) sel.append(h('option', { value: p }, pairLabel(p)));
  if (!pairs.length) { sel.append(h('option', { value: '' }, 'none')); $('#growthBtn').disabled = true; sel.disabled = true; $('#growthBtn').title = 'The scene has no growth maps.'; }
  sel.value = state.growthPair || pairs[0] || '';
}

function renderLegend() {
  const host = $('#legend'); host.innerHTML = '';
  if (state.growth) {
    const pair = state.growthPair;
    const gs = (S.scene.lesions || []).map(l => (growthSet() && l.growth_sets?.[growthSet()]?.[pair]) || l.growth?.[pair]).filter(Boolean);
    const scale = Math.max(...gs.map(g => +g.scale_mm || 10), 1);
    const note = gs.find(g => g.note)?.note || 'signed surface distance of the later surface from the earlier one';
    if (!pair || !pair.endsWith('__' + shown)) {
      host.append(h('div', null, h('b', null, 'Growth map: '), `no growth map ends at ${dateLabel(shown)}; showing plain surfaces.`));
    } else {
      host.append(h('div', null, h('b', null, `Growth map ${pairLabel(pair)}`), ' (mm)'),
        h('div.grad'), h('div.ticks', null, h('span', null, `−${scale} retraction`), h('span', null, '0'), h('span', null, `+${scale} growth`)),
        h('details', null, h('summary', { class: 'small' }, 'How to read the colours'), h('p', null, note + '. Colours are baked into the meshes by the data builder; values beyond ±' + scale + ' mm saturate.')));
      const miss = (S.scene.lesions || []).filter(l => l.per_date?.[shown] && !l.growth?.[pair]).map(l => l.id);
      if (miss.length) host.append(h('p', null, `No growth map for: ${miss.join(', ')} (plain colour).`));
    }
  }
  renderVolumeLegend(host);
  if (state.compare) {
    const p = prevDate(shown);
    host.append(h('div', { style: { marginTop: state.growth ? '6px' : 0 } }, h('span.ghostkey'),
      p ? (state.regGhost ? `Ghost outline = ${dateLabel(p)} (liver and lesions), placed with the ${regModes()[state.reg]?.label || state.reg} alignment`
        : `Ghost outline = ${dateLabel(p)} (liver and lesions), NOT registered: plain spine-anchored scanner frame (raw breathing shift)`) : 'Compare: no earlier date than the first scan.'),
      p && qualityText(qMode()) ? h('div.small', { class: 'reg-q', title: 'Residual after alignment for this date pair (registration_quality.json). Volumes are measured on each date\'s own CT and do not depend on the alignment.' }, (state.regGhost ? 'Residual: ' : 'Mismatch without registration: ') + qualityText(qMode(), shown, false)) : null);
  }
}

/** first clause of a confidence label (full text in the tooltip and in the Layers panel) */
function shortConf(t) { t = String(t); let m = t.split(/\s\(|;\s|\.\s/)[0]; if (!/\s/.test(m) && t.includes(')')) m = t.slice(0, t.indexOf(')') + 1); return m.length > 40 ? m.slice(0, 38) + '…' : m; }
/** compact table of the current date's volumes (scene source) with the confidence labels */
let volLegendOpen = null;
function renderVolumeLegend(host) {
  if (!shown) return;
  const rows = [];
  for (const les of S.scene.lesions || []) {
    const pd = les.per_date?.[shown];
    if (pd?.volume_mL != null && pd.mesh) rows.push({ sw: les.color, name: les.id, title: les.name, vol: pd.volume_mL, conf: pd.confidence });
  }
  for (const L of S.scene.layers || []) {
    const pd = L.per_date?.[shown];
    if (!(pd?.mesh || pd?.shown_as) || pd.volume_mL == null || /^seg\d$/.test(L.id)) continue;
    rows.push({ sw: L.color, name: L.name || L.id, vol: pd.volume_mL, conf: pd.confidence });
  }
  const segc = (S.scene.layers || []).find(L => /^seg\d$/.test(L.id) && L.per_date?.[shown]?.confidence)?.per_date[shown].confidence;
  if (segc) rows.push({ sw: 'linear-gradient(90deg,#8dd3c7,#fb8072,#fccde5)', name: 'Couinaud segments', vol: null, conf: segc });
  if (!rows.length) return;
  if (volLegendOpen === null) volLegendOpen = !matchMedia('(max-width: 760px)').matches;
  const src = S.scene.source === 'consensus' ? 'consensus' : (S.scene.source || '?');
  const det = h('details.vols', { open: volLegendOpen && !state.claim ? true : null },   // collapsed while a claim bar is shown
    h('summary', null, h('b', null, `Volumes · ${dateLabel(shown)}`), h('span.muted', null, ` (${src} masks)`)),
    h('table.vols', null, h('tbody', null, ...rows.map(r => h('tr', null,
      h('td', null, h('span.sw', { style: { background: r.sw } })),
      h('td.n', { title: r.title || r.name }, r.name),
      h('td.v', null, r.vol != null ? fmtVol(r.vol) : ''),
      h('td.c', { title: r.conf || '' }, r.conf ? '⚠ ' + shortConf(r.conf) : ''))))));
  det.addEventListener('toggle', () => { if (!state.claim) volLegendOpen = det.open; });
  host.append(det);
}

// ---------------------------------------------------------------- UI: layers panel
function setCtl(id, patch, opts = {}) {
  Object.assign(ctlState(id), patch);
  if (!opts.silent) { refreshLayerRow(id); if (patch.v) ensureVisibleLoaded(); else sync(); writeHash(); }
}
function renderLayersPanel() {
  const host = $('#p-layers'); host.innerHTML = '';
  host.append(h('div.row-btns', null,
    h('button', { onclick: () => { for (const c of S.ctls.values()) Object.assign(ctlState(c.id), { v: c.defVisible, o: c.defOpacity }); state.solo = null; refreshLayerRows(); ensureVisibleLoaded(); writeHash(); } }, 'Default layers'),
    h('button', { onclick: () => { state.solo = null; refreshLayerRows(); sync(); writeHash(); }, id: 'unsolo', hidden: true }, 'Show all (end solo)'),
    h('button', { onclick: showInside, title: 'Lesion shells translucent, internal structure on' }, 'Look inside lesions')));
  for (const g of S.groups) {
    const ctls = [...S.ctls.values()].filter(c => c.group === g);
    if (!ctls.length) continue;
    const gcb = h('input', { type: 'checkbox', 'aria-label': `Show all ${g}` });
    gcb.addEventListener('click', e => e.stopPropagation());
    gcb.addEventListener('change', () => { for (const c of ctls) if (available(c.id, shown) || !shown) ctlState(c.id).v = gcb.checked; refreshLayerRows(); ensureVisibleLoaded(); writeHash(); });
    const det = h('details.group', { open: g !== 'Couinaud segments' && g !== 'Uncertainty' ? true : null },
      h('summary', null, gcb, h('span', null, g), h('span.small.muted', { 'data-gcount': g }), h('span.chev', null, '›')));
    det._gcb = gcb; det._ctls = ctls;
    for (const c of ctls) det.append(layerRow(c));
    host.append(det);
  }
  host.append(h('p.small.muted', null, 'Click a name to solo it; S = solo. Opacity below ', String(CAP_MIN_OPACITY), ' draws no solid cut face (see Cut).'));
  refreshLayerRows();
}
function layerRow(c) {
  const cb = h('input', { type: 'checkbox', 'aria-label': `Show ${c.name}` });
  cb.addEventListener('change', () => setCtl(c.id, { v: cb.checked }));
  const rng = h('input', { type: 'range', min: 0, max: 1, step: 0.01, 'aria-label': `Opacity of ${c.name}` });
  rng.addEventListener('input', () => { ctlState(c.id).o = +rng.value; sync(); writeHashSoon(); });
  const solo = h('button.solo', { 'aria-pressed': 'false', title: `Show only ${c.name}`, 'aria-label': `Solo ${c.name}` }, 'S');
  solo.addEventListener('click', () => { state.solo = state.solo === c.id ? null : c.id; if (state.solo) ctlState(c.id).v = true; refreshLayerRows(); ensureVisibleLoaded(); writeHash(); });
  const nm = h('span.nm', { title: c.name }, c.lesion ? c.lesion.id : c.name, h('small'));
  nm.addEventListener('click', () => { if (c.lesion) selectLesion(c.lesion.id); else { cb.checked = !cb.checked; setCtl(c.id, { v: cb.checked }); } });
  const why = h('div.why');
  const conf = h('div.conf', { hidden: true });
  const row = h('div.lrow', { 'data-ctl': c.id }, cb, h('span.sw', { style: { background: c.color } }), nm, rng, solo, why, conf);
  c.ui = { row, cb, rng, solo, nm, why, conf };
  return row;
}
function refreshLayerRow(id) {
  const c = S.ctls.get(id); if (!c?.ui) return;
  const st = ctlState(id), av = !shown || available(id, shown);
  c.ui.cb.checked = st.v; c.ui.rng.value = st.o;
  c.ui.solo.setAttribute('aria-pressed', String(state.solo === id));
  c.ui.row.classList.toggle('na', !av);
  c.ui.row.classList.toggle('sel', !!(c.lesion && c.lesion.id === state.sel));
  const reason = av ? '' : notVisibleReason(id, shown);
  c.ui.why.textContent = reason.length > 150 ? reason.slice(0, 147) + '…' : reason;
  c.ui.why.hidden = av;
  const cf = av && shown ? confOf(id, shown) : null;
  c.ui.conf.textContent = cf ? '⚠ ' + cf : ''; c.ui.conf.hidden = !cf; c.ui.conf.title = cf || '';
  c.ui.cb.disabled = c.ui.rng.disabled = !av;
  let vol = null, fail = null;
  for (const it of S.items[shown] || []) if (it.ctl === id && it.kind !== 'growth') { if (it.vol != null) vol = (vol || 0) + it.vol; if (it.failed) fail = it.failed; }
  const extra = c.lesion ? ` ${c.lesion.name || ''}` : '';
  c.ui.nm.querySelector('small').textContent = (c.lesion ? extra + ' · ' : '') + (vol != null ? fmtVol(vol) : '') + (fail ? ' · load failed' : '');
  c.ui.row.title = fail ? 'Load failed: ' + fail : (av ? '' : notVisibleReason(id, shown));
}
function refreshLayerRows() {
  for (const c of S.ctls.values()) refreshLayerRow(c.id);
  for (const det of $$('#p-layers details.group')) {
    const avail = det._ctls.filter(c => available(c.id, shown));
    const on = avail.filter(c => ctlState(c.id).v).length;
    det._gcb.checked = avail.length > 0 && on === avail.length; det._gcb.indeterminate = on > 0 && on < avail.length;
    det._gcb.disabled = !avail.length;
    det.querySelector('[data-gcount]').textContent = `${avail.length}/${det._ctls.length} on ${dateShort(shown || state.date)}`;
  }
  const u = $('#unsolo'); if (u) u.hidden = !state.solo;
}
function showInside() {
  for (const c of S.ctls.values()) {
    if (c.kind === 'part') Object.assign(ctlState(c.id), { v: true });
    if (c.kind === 'lesion') Object.assign(ctlState(c.id), { v: true, o: Math.min(ctlState(c.id).o, 0.25) });
  }
  if (S.ctls.has('liver')) Object.assign(ctlState('liver'), { o: Math.min(ctlState('liver').o, 0.15) });
  refreshLayerRows(); ensureVisibleLoaded(); writeHash();
}

// ---------------------------------------------------------------- UI: lesions panel
function renderLesions() {
  const host = $('#p-lesions'); host.innerHTML = '';
  const les = S.scene.lesions || [];
  if (!les.length) { host.append(h('p.empty', null, 'The scene lists no lesions.')); return; }
  const ds = S.dates;
  const thead = h('tr', null, h('th.l', null, ''), h('th.l', null, 'ID'), ...ds.map(d => h('th', { title: dateLabel(d) }, dateShort(d))),
    ...ds.slice(1).map((d, i) => h('th', { title: `volume change ${dateLabel(ds[i])} → ${dateLabel(d)}` }, `Δ${i ? '' : ''} ${dateShort(ds[i]).slice(0, 3)}→${dateShort(d).slice(0, 3)}`)));
  const tb = h('tbody');
  for (const l of les) {
    const vols = ds.map(d => l.per_date?.[d]?.volume_mL);
    const tr = h('tr', { class: l.id === state.sel ? 'sel' : '', tabindex: 0, 'aria-selected': String(l.id === state.sel), title: `${l.name || ''} — segment ${l.segment || '?'}` },
      h('td.l', null, h('span.sw', { style: { background: l.color } })),
      h('td.l', null, h('b', null, l.id), h('div.small.muted.lname', null, l.name || '')),
      ...ds.map((d, i) => vols[i] != null ? h('td', { style: d === shown ? { fontWeight: 650 } : null }, fmtVol(vols[i]).replace(' mL', '')) : h('td.na', { title: l.per_date?.[d]?.not_visible || 'not present / not traced' }, '—')),
      ...ds.slice(1).map((d, i) => { const p = pctChange(vols[i], vols[i + 1]); return h('td', { class: p == null ? 'na' : p > 5 ? 'up' : p < -5 ? 'down' : 'flat' }, fmtPct(p)); }));
    tr.addEventListener('click', () => selectLesion(l.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLesion(l.id); } });
    tb.append(tr);
  }
  host.append(h('h2', null, 'Lesions — volume per date (mL) and change'),
    h('div.tablewrap', null, h('table.les', null, h('thead', null, thead), tb)),
    h('p.small.muted', null, 'Click a lesion to fly to it and highlight it. Volumes are measured on each date\'s own CT grid (no registration involved).'));
  host.append(h('h2', null, 'Volume over time (log scale)'), volumeChart());
  if (state.sel) host.append(lesionDetail(state.sel));
}
function volumeChart() {
  const les = (S.scene.lesions || []).filter(l => S.dates.some(d => l.per_date?.[d]?.volume_mL > 0));
  const W = 340, H = 170, ml = 54, mr = 34, mt = 10, mb = 22;
  const vals = les.flatMap(l => S.dates.map(d => l.per_date?.[d]?.volume_mL).filter(v => v > 0));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'chart'; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Lesion volumes over the three dates, logarithmic scale');
  if (!vals.length) return svg;
  const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...vals)))), hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...vals))));
  const x = i => ml + i * (W - ml - mr) / Math.max(1, S.dates.length - 1);
  const y = v => mt + (H - mt - mb) * (1 - (Math.log10(v) - Math.log10(lo)) / Math.max(1e-6, Math.log10(hi) - Math.log10(lo)));
  let s = '';
  for (let e = Math.log10(lo); e <= Math.log10(hi) + 1e-9; e++) { const v = Math.pow(10, e); s += `<line class="ax" x1="${ml}" x2="${W - mr}" y1="${y(v)}" y2="${y(v)}"/><text x="${ml - 4}" y="${y(v) + 3}" text-anchor="end">${v >= 1 ? v : v.toFixed(-e)} mL</text>`; }
  S.dates.forEach((d, i) => { s += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" ${d === shown ? 'style="font-weight:700;fill:currentColor"' : ''}>${esc(dateShort(d))}</text>`; });
  for (const l of les) {
    const pts = S.dates.map((d, i) => { const v = l.per_date?.[d]?.volume_mL; return v > 0 ? [x(i), y(v)] : null; });
    let path = '', pen = false;
    for (const p of pts) { if (!p) { pen = false; continue; } path += (pen ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); pen = true; }
    const cls = 'ln' + (state.sel === l.id ? ' sel' : state.sel ? ' dim' : '');
    s += `<g data-les="${esc(l.id)}" style="cursor:pointer"><path class="${cls}" d="${path}" stroke="${esc(l.color)}"><title>${esc(l.id)} ${esc(l.name || '')}</title></path>`;
    for (const p of pts) if (p) s += `<circle cx="${p[0]}" cy="${p[1]}" r="${state.sel === l.id ? 4 : 3}" fill="${esc(l.color)}"/>`;
    const last = [...pts].reverse().find(Boolean);
    if (last) s += `<text x="${last[0] + 5}" y="${last[1] + 3}" style="fill:${esc(l.color)};font-weight:650">${esc(l.id)}</text>`;
    s += '</g>';
  }
  svg.innerHTML = s;
  svg.addEventListener('click', e => { const g = e.target.closest('[data-les]'); if (g) selectLesion(g.dataset.les); });
  return svg;
}
function lesionDetail(id) {
  const l = lesionById(id); if (!l) return h('div');
  const ds = S.dates;
  const row = (label, f) => [h('dt', null, label), ...ds.map(d => h('dd', { class: d === shown ? 'cur' : '' }, l.per_date?.[d] ? f(l.per_date[d]) : '—'))];
  const box = h('div.lesdetail', null,
    h('div', null, h('span.sw', { style: { background: l.color, marginRight: '6px' } }), h('b', null, `${l.id} — ${l.name || ''}`), h('span.muted', null, l.segment ? ` · segment ${l.segment}` : '')),
    h('dl', null, h('dt'), ...ds.map(d => h('dd', { class: d === shown ? 'cur' : '' }, dateShort(d))),
      row('Volume', p => fmtVol(p.volume_mL)), row('Long axis', p => p.long_axis_mm != null ? fmtNum(p.long_axis_mm) + ' mm' : '—'),
      row('Core', p => fmtVol(p.core_mL)), row('Wall', p => fmtVol(p.wall_mL)), row('Active', p => fmtVol(p.active_mL)),
      row('SUVmax', p => p.suv_max != null ? fmtNum(p.suv_max, 1) : '—'), row('Mean HU', p => p.mean_hu != null ? fmtNum(p.mean_hu) : '—'),
      row('Mesh check', p => p.verify?.dice != null ? `Dice ${fmtNum(p.verify.dice, 3)}` : '—'),
      ...(ds.some(d => l.per_date?.[d]?.confidence) ? row('Confidence', p => p.confidence ? h('span.confv', { title: p.confidence }, p.confidence) : '—') : []),
      ...(l.match ? [h('dt', null, 'Same lesion?'), ...ds.map(d => h('dd', { class: d === shown ? 'cur' : '', title: l.match[d] ? `${l.match[d].method || ''}${l.match[d].dist_to_registration_landmark_mm != null ? ' · ' + l.match[d].dist_to_registration_landmark_mm + ' mm from landmark' : ''}` : '' }, l.match[d]?.confidence || '—'))] : [])),
    h('div.row-btns', null,
      h('button', { onclick: () => flyToLesion(id) }, 'Fly to'),
      h('button', { onclick: () => setOrbit(!state.orbit), 'aria-pressed': String(state.orbit) }, 'Orbit'),
      h('button', { onclick: () => sliceLesion(id) }, 'Slice through'),
      h('button', { onclick: () => { state.solo = state.solo === 'les:' + id ? null : 'les:' + id; refreshLayerRows(); ensureVisibleLoaded(); writeHash(); } }, 'Solo'),
      h('button', { onclick: () => selectLesion(null) }, 'Deselect')));
  const gpairs = Object.entries(l.growth || {});
  if (gpairs.length) box.append(h('p.small.muted', null, 'Growth (surface distance): ' + gpairs.map(([p, g]) => `${pairLabel(p)} max ${fmtNum(g.max_mm, 1)} / mean ${fmtNum(g.mean_mm, 1)} mm`).join('; ')));
  box.append(h('h2', null, `What the reports say about ${l.id}`), reports.quotesForLesion(id));
  return box;
}

// ---------------------------------------------------------------- UI: cut panel
function renderCutPanel() {
  const host = $('#p-cut'); host.innerHTML = '';
  host.append(h('p.small.muted', null, 'Cut planes are fixed in the Sep 2026 frame, so the same cut stays in place when you switch dates. Solid layers get a coloured cut face; translucent ones stay see-through.'));
  AXES.forEach((a, i) => {
    const cl = state.clip[a], info = AXIS_INFO[a];
    const lo = bounds ? Math.floor(bounds.min[i] - 5) : -300, hi = bounds ? Math.ceil(bounds.max[i] + 5) : 300;
    const on = h('input', { type: 'checkbox', checked: cl.on || null, id: 'clip-' + a });
    const val = h('span.val');
    const rng = h('input', { type: 'range', min: lo, max: hi, step: 0.5, value: cl.pos, 'aria-label': `${info.name} cut position (mm)` });
    const flip = h('button', { title: 'Keep the other side' }, 'Flip');
    const side = () => `${(+cl.pos).toFixed(1)} mm · removes ${cl.flip ? info.neg : info.pos} part`;
    val.textContent = side();
    on.addEventListener('change', () => { cl.on = on.checked; updatePlanes(); rebuildCaps(); writeHash(); });
    rng.addEventListener('input', () => { cl.pos = +rng.value; if (!cl.on) { cl.on = true; on.checked = true; updatePlanes(); rebuildCaps(); } val.textContent = side(); updatePlanes(); writeHashSoon(); });
    flip.addEventListener('click', () => { cl.flip = !cl.flip; val.textContent = side(); updatePlanes(); writeHash(); });
    host.append(h('div.clip', null, h('div.h', null, h('label', { for: 'clip-' + a }, on, `${info.name}`), h('span.small.muted', null, info.desc), flip), rng, val));
  });
  const caps = h('input', { type: 'checkbox', checked: state.caps || null });
  caps.addEventListener('change', () => { state.caps = caps.checked; rebuildCaps(); writeHash(); });
  const capAll = h('input', { type: 'checkbox', checked: state.capAll || null });
  capAll.addEventListener('change', () => { state.capAll = capAll.checked; rebuildCaps(); writeHash(); });
  host.append(h('label.inline', null, caps, 'Solid cut faces (caps)'), h('label.inline', null, capAll, 'Also cap translucent layers (liver, segments)'));
  host.append(h('div.row-btns', null,
    h('button', { onclick: () => state.sel ? sliceLesion(state.sel) : toast('Select a lesion first (Lesions tab or click it in 3D).'), disabled: !state.sel || null }, state.sel ? `Slice through ${state.sel}` : 'Slice through selected lesion'),
    h('button', { onclick: () => { for (const a of AXES) state.clip[a].on = false; renderCutPanel(); updatePlanes(); rebuildCaps(); writeHash(); } }, 'Remove all cuts')));
  host.append(h('p.small.muted', null, 'Tip: “Slice through” puts an axial cut through the lesion centre, shows cores, walls, nodules, calcifications and FDG-active tissue, and looks up at the cut face from below — the orientation of an axial CT slice (anterior up, patient right on the left).'));
}
function sliceLesion(id) {
  const c = lesionCenterRAS(id) || lesionCenterRAS(id, S.dates.find(d => lesionById(id)?.per_date?.[d]));
  if (!c) return toast(`${id}: no centroid on ${dateLabel(shown)}.`);
  for (const a of AXES) state.clip[a].on = false;
  Object.assign(state.clip.z, { on: true, pos: Math.round(c[2] * 2) / 2, flip: true }); // remove the inferior half, look up from below: radiological axial view
  const hasParts = S.items[shown].some(it => it.kind === 'part' && it.lesion.id === id);
  for (const k of S.ctls.values()) if (k.kind === 'part') ctlState(k.id).v = true;
  Object.assign(ctlState('les:' + id), { v: true, o: Math.max(ctlState('les:' + id).o, 0.6) }); // >= cap threshold: solid lesion cut face, parts drawn on top of it
  if (S.ctls.has('liver')) ctlState('liver').o = Math.min(ctlState('liver').o, 0.18);
  state.sel = id;
  refreshLayerRows(); renderCutPanel(); updatePlanes(); ensureVisibleLoaded();
  updateHighlights(); renderLesions(); reports.onSelectLesion(id);
  flyToLesion(id, { dirRAS: [0.0, 0.3, -1] });
  if (!hasParts) toast(`${id} has no internal-structure meshes on ${dateLabel(shown)}; the cut face shows the lesion only.`, 4000);
  writeHash();
}

// ---------------------------------------------------------------- UI: about panel
function renderAbout() {
  const sc = S.scene, host = $('#p-about'); host.innerHTML = '';
  const consensus = sc.source === 'consensus';
  const nv = [];
  for (const c of S.ctls.values()) for (const [d, r] of Object.entries(c.notVisible || {})) nv.push(`${c.lesion ? c.lesion.id : c.name} — ${dateLabel(d)}: ${r}`);
  const registered = [];
  for (const L of sc.layers || []) for (const [d, pd] of Object.entries(L.per_date || {})) if (pd?.registered_from || pd?.inferred || pd?.provenance) registered.push(`${L.name} — ${dateLabel(d)}: ${pd.registered_from ? 'registered from ' + dateLabel(pd.registered_from) : ''}${pd.inferred ? ' inferred' : ''}${pd.provenance ? ' ' + pd.provenance : ''}`);
  const ver = [];
  for (const L of sc.layers || []) for (const [d, pd] of Object.entries(L.per_date || {})) if (pd?.verify?.dice != null) ver.push(pd.verify.dice);
  for (const l of sc.lesions || []) for (const pd of Object.values(l.per_date || {})) if (pd?.verify?.dice != null) ver.push(pd.verify.dice);
  const st = stats();
  host.append(h('div.about', null,
    h('h2', null, 'About this model'),
    h('p', null, consensus
      ? 'The surfaces are exact reproductions of the reviewed slice-by-slice masks (consensus). They were not smoothed into shape, simplified or decimated; every mesh was voxelised back and compared with its mask.'
      : `This scene is marked source "${sc.source || 'unknown'}". The surfaces reproduce the masks they were built from exactly, but those masks are NOT the reviewed consensus — treat every boundary as provisional.`),
    ver.length ? h('p', null, `Mesh-to-mask check: Dice ${fmtNum(Math.min(...ver), 3)}–${fmtNum(Math.max(...ver), 3)} over ${ver.length} meshes (hover a structure for its own numbers).`) : null,
    h('p', null, 'What is inferred or registered rather than seen:'),
    h('ul', null, ...(sc.notes || []).map(n => h('li', null, n)), ...registered.map(n => h('li', null, n)), ...nv.map(n => h('li', null, n))),
    h('p', null, 'Why the alignments differ: the patient breathed differently at each scan (the liver dome sits at a different height relative to the spine on each date). No single rigid transform aligns the spine, the liver and every lesion at once. "Spine-anchored" keeps the skeleton fixed, so the liver and its lesions shift by roughly a centimetre between dates; the liver-anchored modes fit the liver, so the spine does not line up; a lesion-anchored mode superimposes one lesion on itself (so its growth is seen in place) and lets everything else drift. Whatever is chosen, every structure of a date (PET-active tissue, segments, vessels, report boxes) moves with the same transform. Volumes, sizes and growth numbers are measured on each date\'s own CT and do not depend on this choice.'),
    ...Object.entries(regModes()).map(([k, m]) => h('p.small', null, h('b', null, (m.label || k) + ': '), m.note || '',
      m.quality ? ' After alignment: ' + Object.keys(m.quality).filter(pk => { const [a, b] = pk.split('__'); return S.dates.indexOf(b) - S.dates.indexOf(a) === 1; }).map(pk => qualityText(k, pk.split('__')[1], true)).join('; ') + '.'
        : (m.residual_mm ? ' Residual: ' + Object.entries(m.residual_mm).map(([d, v]) => `${dateShort(d)} ${v} mm`).join(', ') + '.' : ''))),
    glossary(true),
    h('h2', null, 'Scene'),
    h('div.kv', null, h('b', null, 'Source'), String(sc.source || '—'), h('b', null, 'Generated'), String(sc.generated || '—'), h('b', null, 'Scene file'), SCENE_URL,
      h('b', null, 'Dates'), (sc.dates || []).map(d => `${d.label} (${d.scan}${d.ct ? ', ' + d.ct : ''})`).join('; '),
      h('b', null, 'Loaded'), `${st.n} meshes, ${fmtMB(st.bytes)}, ${(st.tris / 1e6).toFixed(2)} M triangles`),
    h('h2', null, 'Controls'),
    h('p.small', null, 'Keys: 1/2/3 dates · space play · C compare · G growth map · O orbit selected lesion · R reset · Esc close claim / deselect. Mouse: drag rotate, wheel zoom, right-drag pan. Touch: one finger rotate, two fingers zoom/pan.'),
    themeRow()));
}
function themeRow() {
  const cur = document.documentElement.dataset.theme || 'auto';
  const mk = (k, l) => h('button', { 'aria-pressed': String(cur === k), onclick: () => { if (k === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = k; try { localStorage.setItem('liver3d-theme', k); } catch (e) { } applyTheme(); renderAbout(); } }, l);
  return h('div.theme-row', null, h('span.small.muted', null, 'Theme'), mk('auto', 'Auto'), mk('dark', 'Dark'), mk('light', 'Light'));
}
function applyTheme() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#050508';
  renderer.setClearColor(new THREE.Color(bg), 1); requestRender();
}

// ---------------------------------------------------------------- tabs, panels
function setTab(t) {
  state.tab = t;
  for (const b of $$('.tabs [role=tab]')) { const on = b.dataset.tab === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; }
  for (const p of $$('#tabpanels [role=tabpanel]')) p.hidden = p.id !== 'p-' + t;
  if (t === 'about') renderAbout();
  writeHash();
}
function refreshPanels() {
  refreshLayerRows(); renderLesions(); reports.onDate(shown); renderLegend();
  $('#sceneMeta').textContent = `${dateLabel(shown)} · ${S.dateByKey[shown]?.ct || ''}`;
  if (state.tab === 'about') renderAbout();
}

// ---------------------------------------------------------------- URL hash state
// #d=<date>&r=<reg>&v=<+id,-id>&o=<id:opacity,...>&solo=<id>&sel=<lesion>&cmp=1&g=<pair>&clip=<axis:pos:flip,...>&caps=0&capall=1&cam=<px,py,pz,tx,ty,tz>&tab=<tab>&claim=<id>&lang=en&orbit=1
let hashLock = false;
function hashString() {
  const p = [];
  p.push('d=' + shown);
  if (state.reg) p.push('r=' + state.reg);
  const v = [], o = [];
  for (const c of S.ctls.values()) {
    const st = ctlState(c.id);
    if (st.v !== c.defVisible) v.push((st.v ? '+' : '-') + c.id);
    if (Math.abs(st.o - c.defOpacity) > 0.004) o.push(c.id + ':' + (+st.o).toFixed(2));
  }
  if (v.length) p.push('v=' + v.map(encodeURIComponent).join(','));
  if (o.length) p.push('o=' + o.map(encodeURIComponent).join(','));
  if (state.solo) p.push('solo=' + encodeURIComponent(state.solo));
  if (state.sel) p.push('sel=' + encodeURIComponent(state.sel));
  if (state.compare) p.push('cmp=1');
  if (!state.regGhost) p.push('nr=1');
  if (state.growth) p.push('g=' + state.growthPair);
  const cl = AXES.filter(a => state.clip[a].on).map(a => `${a}:${(+state.clip[a].pos).toFixed(1)}:${state.clip[a].flip ? 1 : 0}`);
  if (cl.length) p.push('clip=' + cl.join(','));
  if (!state.caps) p.push('caps=0');
  if (state.capAll) p.push('capall=1');
  const c = camera.position, t = controls.target;
  p.push('cam=' + [c.x, c.y, c.z, t.x, t.y, t.z].map(x => x.toFixed(1)).join(','));
  if (state.tab !== 'layers') p.push('tab=' + state.tab);
  if (state.claim) p.push('claim=' + encodeURIComponent(state.claim));
  if (state.lang !== 'orig') p.push('lang=' + state.lang);
  if (state.orbit) p.push('orbit=1');
  return '#' + p.join('&');
}
function writeHash() {
  if (hashLock || !shown) return;
  const s = hashString();
  if (s !== location.hash) { hashLock = true; history.replaceState(null, '', s); hashLock = false; }
}
const writeHashSoon = debounce(writeHash, 250);
function parseHash(str) {
  const out = {};
  for (const kv of str.replace(/^#/, '').split('&')) { if (!kv) continue; const i = kv.indexOf('='); out[kv.slice(0, i < 0 ? undefined : i)] = i < 0 ? '' : kv.slice(i + 1); }
  return out;
}
function applyHash(hs, { camera: doCam = true } = {}) {
  const q = parseHash(hs);
  if (q.r && regModes()[q.r]) state.reg = q.r;
  for (const c of S.ctls.values()) Object.assign(ctlState(c.id), { v: c.defVisible, o: c.defOpacity });
  // tokens are written with encodeURIComponent, so '+' arrives as %2B: decode before reading the sign
  if (q.v) for (const t of q.v.split(',')) { let s = t; try { s = decodeURIComponent(t); } catch (e) { } const id = s.slice(1); if (S.ctls.has(id) && (s[0] === '+' || s[0] === '-')) ctlState(id).v = s[0] === '+'; }
  if (q.o) for (const t of q.o.split(',')) { const s = decodeURIComponent(t); const i = s.lastIndexOf(':'); const id = s.slice(0, i); if (S.ctls.has(id)) ctlState(id).o = clamp(+s.slice(i + 1) || 0, 0, 1); }
  state.solo = q.solo && S.ctls.has(decodeURIComponent(q.solo)) ? decodeURIComponent(q.solo) : null;
  state.sel = q.sel && lesionById(decodeURIComponent(q.sel)) ? decodeURIComponent(q.sel) : null;
  state.compare = q.cmp === '1';
  state.regGhost = q.nr !== '1';
  state.growth = !!q.g && growthPairs().includes(q.g); state.growthPair = state.growth ? q.g : state.growthPair;
  for (const a of AXES) state.clip[a].on = false;
  if (q.clip) for (const t of q.clip.split(',')) { const [a, pos, fl] = t.split(':'); if (state.clip[a] && isFinite(+pos)) Object.assign(state.clip[a], { on: true, pos: +pos, flip: fl === '1', _fromHash: true }); }
  state.caps = q.caps !== '0'; state.capAll = q.capall === '1';
  state.tab = ['layers', 'lesions', 'reports', 'cut', 'about'].includes(q.tab) ? q.tab : 'layers';
  state.claim = q.claim ? decodeURIComponent(q.claim) : null;
  state.lang = q.lang === 'en' ? 'en' : 'orig';
  state.orbit = q.orbit === '1';
  if (q.d && S.dateByKey[q.d]) state.date = q.d;
  let cam = null;
  if (doCam && q.cam) { const a = q.cam.split(',').map(Number); if (a.length === 6 && a.every(isFinite)) cam = a; }
  return cam;
}

// ---------------------------------------------------------------- misc UI
let toastT;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); }
function setOrbit(on) {
  state.orbit = on && !!state.sel;
  controls.autoRotate = state.orbit;
  if (state.orbit) { const s = lesionSphere(state.sel); if (s) flyTo(camera.position.clone().sub(controls.target).setLength(fitDist(s.radius)).add(s.center), s.center); }
  $('#orbitBtn').setAttribute('aria-pressed', String(state.orbit));
  if (state.tab === 'lesions') renderLesions();
  writeHash();
}
function resetAll() {
  stopPlay(); claimViz.clear();
  history.replaceState(null, '', location.pathname + location.search);
  for (const c of S.ctls.values()) Object.assign(ctlState(c.id), { v: c.defVisible, o: c.defOpacity });
  Object.assign(state, { solo: null, sel: null, compare: false, regGhost: true, growth: false, orbit: false, claim: null });
  $('#regGhost').checked = true;
  controls.autoRotate = false;
  for (const a of AXES) state.clip[a].on = false, state.clip[a].flip = false;
  state.caps = true; state.capAll = false;
  $('#compareBtn').setAttribute('aria-pressed', 'false'); $('#growthBtn').setAttribute('aria-pressed', 'false'); $('#orbitBtn').setAttribute('aria-pressed', 'false');
  bounds = null;
  setDate(S.dates[S.dates.length - 1]).then(() => { presetView('ant', 0); renderCutPanel(); selectLesion(null, { fly: false }); });
  if (state.reg !== S.scene.registration?.default && regModes()[S.scene.registration?.default]) setReg(S.scene.registration.default);
}
function screenshot() {
  renderer.render(scene3, camera);
  const w = canvas.width, hh = canvas.height, dpr = renderer.getPixelRatio();
  const fs = Math.round(13 * dpr), lh = Math.round(18 * dpr);
  // caption lines: view state, then the active claim quoted verbatim (wrapped, never shortened)
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `${fs}px -apple-system,Helvetica,Arial,sans-serif`;
  const wrap = (text, maxW) => {
    const out = []; let line = '';
    for (const word of String(text).split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (meas.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line); return out;
  };
  const regL = regModes()[state.reg]?.label || state.reg;
  const extra = [state.compare ? `ghost = ${dateLabel(prevDate(shown)) || '—'}` : '', state.growth ? `growth ${pairLabel(state.growthPair)}` : '', AXES.some(a => state.clip[a].on) ? 'cut' : ''].filter(Boolean).join(' · ');
  let lines = wrap(`${dateLabel(shown)} · ${regL} · source: ${S.scene.source || '?'}${extra ? ' · ' + extra : ''}`, w - 20 * dpr);
  const cl = state.claim && reports.byId(state.claim);
  if (cl) {
    lines.push(...wrap(`${cl.reader} (${cl.id}): “${cl.quote_orig}”`, w - 20 * dpr));
    if (cl.lang !== 'en' && cl.quote_en) lines.push(...wrap(`English gloss: ${cl.quote_en}`, w - 20 * dpr));
    // the report-vs-model rows of the claim bar (Report / Model / Change / Verdict ...), so a shared PNG carries the comparison
    const kids = [...document.querySelectorAll('#claimbar .cmp > *')];
    const rows = [];
    for (let i = 0; i + 1 < kids.length; i += 2) if (kids[i].classList.contains('k')) rows.push(`${kids[i].textContent}: ${kids[i + 1].textContent}`);
    if (rows.length) lines.push(...wrap('Model comparison (' + (S.scene.source || '?') + ' masks) — ' + rows.join(' · '), w - 20 * dpr));
  }
  const pad = lines.length * lh + Math.round(10 * dpr);
  const out = document.createElement('canvas'); out.width = w; out.height = hh + pad;
  const g = out.getContext('2d');
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#050508';
  g.fillStyle = bg; g.fillRect(0, 0, w, hh + pad);
  g.drawImage(canvas, 0, 0);
  const fg = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#fff';
  g.fillStyle = fg; g.font = `${fs}px -apple-system,Helvetica,Arial,sans-serif`;
  lines.forEach((l, i) => g.fillText(l, 10 * dpr, hh + lh * (i + 1)));
  // orientation letters
  g.font = `600 ${Math.round(15 * dpr)}px ui-monospace,Menlo,monospace`; g.textAlign = 'center';
  g.fillText(orientEls.l.textContent, 14 * dpr, hh / 2); g.fillText(orientEls.r.textContent, w - 14 * dpr, hh / 2);
  g.fillText(orientEls.t.textContent, w / 2, 20 * dpr); g.fillText(orientEls.b.textContent, w / 2, hh - 8 * dpr);
  // projected labels (claim boxes)
  g.font = `600 ${Math.round(12 * dpr)}px -apple-system,Helvetica,Arial,sans-serif`;
  for (const L of labels) if (L.el.style.display !== 'none') {
    _v.copy(L.pos).project(camera);
    const x = (_v.x + 1) / 2 * w, y = (1 - _v.y) / 2 * hh;
    g.fillStyle = 'rgba(5,5,8,.72)'; const tw = g.measureText(L.el.textContent).width; g.fillRect(x - tw / 2 - 4 * dpr, y - 9 * dpr, tw + 8 * dpr, 17 * dpr);
    g.fillStyle = getComputedStyle(L.el).color; g.fillText(L.el.textContent, x, y + 4 * dpr);
  }
  out.toBlob(b => {
    const a = h('a', { href: URL.createObjectURL(b), download: `liver_${shown}_${state.reg}${state.claim ? '_' + state.claim : ''}.png` });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
}

// ---------------------------------------------------------------- pointer: hover tooltip, click to select
const tip = $('#tooltip');
let hoverT = 0, downAt = null, lastPointer = null;
canvas.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; tip.hidden = true; if (tween) tween = null; });
canvas.addEventListener('pointermove', e => {
  lastPointer = e;
  if (e.buttons || e.pointerType === 'touch') { tip.hidden = true; return; }
  clearTimeout(hoverT); hoverT = setTimeout(() => hover(e), 70);
});
canvas.addEventListener('pointerleave', () => { clearTimeout(hoverT); tip.hidden = true; });
canvas.addEventListener('pointerup', e => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
  if (moved > 5) return;
  const r = canvas.getBoundingClientRect();
  const it = pickAt(e.clientX - r.left, e.clientY - r.top);
  if (it?.lesion) selectLesion(it.lesion.id, { fly: false });
  if (e.pointerType === 'touch' && it) showTip(it, e, r);
});
canvas.addEventListener('dblclick', e => {
  const r = canvas.getBoundingClientRect();
  const it = pickAt(e.clientX - r.left, e.clientY - r.top);
  if (it?.lesion) selectLesion(it.lesion.id);
});
function hover(e) {
  const r = canvas.getBoundingClientRect();
  const it = pickAt(e.clientX - r.left, e.clientY - r.top);
  if (!it) { tip.hidden = true; canvas.style.cursor = ''; return; }
  canvas.style.cursor = it.lesion ? 'pointer' : '';
  showTip(it, e, r);
}
function showTip(it, e, r) {
  const c = S.ctls.get(it.ctl);
  const lines = [];
  let title = it.kind === 'part' ? `${c.name} — ${it.lesion.id}` : it.kind === 'lesion' || it.kind === 'growth' ? `${it.lesion.id} · ${it.lesion.name || ''}` : c.name;
  lines.push(`${dateLabel(it.date)}${it.vol != null ? ' · ' + fmtVol(it.vol) : ''}`);
  if (it.kind === 'growth') { lines.push(`growth map ${pairLabel(it.pair)}: max ${fmtNum(it.g.max_mm, 1)} mm, mean ${fmtNum(it.g.mean_mm, 1)} mm`); if (it.noColors) lines.push('mesh has no vertex colours'); }
  if (it.lesion && it.kind !== 'part' && it.lesion.segment) lines.push('segment ' + it.lesion.segment);
  const v = it.pd?.verify; if (v?.dice != null) lines.push(`mesh vs mask: Dice ${fmtNum(v.dice, 3)}${v.p95_mm != null ? `, p95 ${fmtNum(v.p95_mm, 1)} mm` : ''}`);
  const cf = it.kind === 'part' ? confOf(it.ctl, it.date) : (it.pd?.confidence || null);
  if (cf) lines.push('confidence: ' + cf);
  if (it.pd?.registered_from) lines.push(`registered from ${dateLabel(it.pd.registered_from)}, not seen on this CT`);
  const src = it.kind === 'part' ? null : it.pd?.source;
  if (src?.flag) lines.push('mask: ' + src.flag);
  else if (src?.kind) lines.push('mask: ' + src.kind + (src.reviewed === false ? ' (unreviewed)' : ''));
  if (lastPickCut) title += ' (cut face)';
  tip.innerHTML = `<b>${esc(title)}</b>${lines.map(esc).join('<br>')}`;
  tip.hidden = false;
  const x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
  tip.style.left = Math.min(x, r.width - tip.offsetWidth - 6) + 'px'; tip.style.top = Math.min(y, r.height - tip.offsetHeight - 6) + 'px';
}

// ---------------------------------------------------------------- keyboard
addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (/^[1-9]$/.test(k) && S.dates[+k - 1]) { stopPlay(); setDate(S.dates[+k - 1]); }
  else if (k === ' ' && !e.target.closest('button,a,[role=button],[tabindex]:not(canvas)')) { e.preventDefault(); togglePlay(); }
  else if (k === 'c') setCompare(!state.compare);
  else if (k === 'g' && !$('#growthBtn').disabled) setGrowth(!state.growth);
  else if (k === 'o') setOrbit(!state.orbit);
  else if (k === 'r') resetAll();
  else if (k === 'escape') { if (state.claim) claimViz.clear(); else if (state.sel) selectLesion(null, { fly: false }); }
});

// ---------------------------------------------------------------- resize + loop
function resize() {
  const w = stage.clientWidth, hh = stage.clientHeight;
  if (!w || !hh) return;
  renderer.setSize(w, hh, false); camera.aspect = w / hh; camera.updateProjectionMatrix();
  measureTopbar(); applyViewShift();
}
new ResizeObserver(resize).observe(stage);
controls.addEventListener('change', () => { requestRender(); writeHashSoon(); });
controls.addEventListener('start', () => { tween = null; });
let lastT = performance.now();
renderer.setAnimationLoop(t => {
  const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
  if (tween) {
    const k = clamp((performance.now() - tween.start) / Math.max(1, tween.ms), 0, 1), e = ease(k);
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) { tween = null; writeHashSoon(); }
    needsRender = true;
  }
  const moved = controls.update();
  if (pulseUntil > t) { pulse(t); needsRender = true; }
  if (claimViz.tick(dt)) needsRender = true;
  if (needsRender || moved) {
    renderer.render(scene3, camera);
    updateLabels(); updateOrient();
    needsRender = false;
  }
});

// ---------------------------------------------------------------- progress
const progEl = $('#progress');
let progShownAt = 0;
onProgress(p => {
  if (!p.pending) { progEl.hidden = true; return; }
  if (progEl.hidden) { progEl.hidden = false; progShownAt = performance.now(); }
  progEl.classList.toggle('corner', !!shown);
  const frac = p.bytesTotal ? Math.min(1, p.bytes / p.bytesTotal) : p.filesDone / Math.max(1, p.files);
  progEl.querySelector('i').style.width = (frac * 100).toFixed(1) + '%';
  progEl.querySelector('span').textContent = `Loading meshes ${p.filesDone}/${p.files}` + (p.bytesTotal ? ` · ${fmtMB(Math.min(p.bytes, p.bytesTotal))} of ${fmtMB(p.bytesTotal)}` : '');
});

// ---------------------------------------------------------------- the app object handed to the report modules
const app = {
  get scene() { return S.scene; }, setReg, get ghostPending() { return warpPending; }, ghostLocal, regQuality, get state() { return state; }, get shown() { return shown; }, get dates() { return S.dates; },
  scene3, root, camera, controls, dateLabel, dateShort, regM, lesionById, lesionCenterRAS, lesionSphere, ctls: S.ctls, items: S.items,
  setDate, selectLesion, flyToLesion, flyTo, fitDist, addLabel, requestRender, toast, writeHash, peek, ctlState, available,
  setCtls(patches) { for (const [id, p] of Object.entries(patches)) if (S.ctls.has(id)) Object.assign(ctlState(id), p); refreshLayerRows(); const done = ensureVisibleLoaded(); writeHash(); return done; },
  loadVisible() { return ensureVisibleLoaded(); },
  setFocus(f) { focus = f; sync(); },
  get focus() { return focus; },
  partSphere(lesionId, kind, date) {
    const it = S.items[date]?.find(i => i.kind === 'part' && i.part === kind && i.lesion.id === lesionId) || S.items[date]?.find(i => i.ctl === kind && i.kind === 'layer');
    const g = it && peek(it.url);
    if (!g) return null;
    const c = g.boundingSphere.center.clone().applyMatrix4(regM(date));
    return { center: F.rasToWorld(c.toArray()), radius: g.boundingSphere.radius, item: it };
  },
  async ensureDate(d) { await ensureDate(d); },
  setClaimState(id) { const was = !!state.claim; state.claim = id; document.body.classList.toggle('has-claim', !!id); reports.markActive(id); writeHash(); if (was !== !!id) renderLegend(); setTimeout(applyViewShift, 0); },
  setTab, sliceLesion, freeBand,
  fitLiver() { const s = liverSphere(); const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize(); flyTo(s.center.clone().addScaledVector(dir, fitDist(s.radius)), s.center); },
};
const reports = new Reports(app, $('#p-reports'));
const claimViz = new ClaimViz(app, $('#claimbar'));
app.reports = reports; app.claimViz = claimViz;

// ---------------------------------------------------------------- boot
async function boot() {
  applyTheme();
  try { const t = localStorage.getItem('liver3d-theme'); if (t && t !== 'auto') { document.documentElement.dataset.theme = t; applyTheme(); } } catch (e) { }
  let sc;
  try {
    const res = await fetch(SCENE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    sc = await res.json();
  } catch (err) {
    const f = $('#fatal'); f.hidden = false;
    f.innerHTML = `<b>Could not load the scene</b> <code>${esc(SCENE_URL)}</code>: ${esc(err.message)}.<br><br>` +
      `Serve this folder over HTTP (e.g. <code>python3 -m http.server</code>) — the page cannot read files from <code>file://</code>. ` +
      `To use another scene, add <code>?scene=path/to/scene.json</code> to the URL (for the synthetic development scene: <a href="?scene=data_test/scene.json">?scene=data_test/scene.json</a>).`;
    return;
  }
  S.scene = sc;
  if (!Array.isArray(sc.dates) || !sc.dates.length) { $('#fatal').hidden = false; $('#fatal').textContent = 'scene.json has no dates.'; return; }
  buildModel();
  for (const d of S.dates) { const g = new THREE.Group(); g.name = 'date:' + d; g.matrixAutoUpdate = false; root.add(g); dateGroup[d] = g; }
  state.reg = regModes()[sc.registration?.default] ? sc.registration.default : Object.keys(regModes())[0] || null;
  state.date = S.dates[S.dates.length - 1];
  { const ps = growthPairs(), last = state.date, pref = `${prevDate(last)}__${last}`; state.growthPair = ps.includes(pref) ? pref : (ps.find(p => p.endsWith('__' + last)) || ps[0] || null); }
  for (const c of S.ctls.values()) state.ctl[c.id] = { v: c.defVisible, o: c.defOpacity };
  const cam = applyHash(location.hash);
  for (const d of S.dates) dateGroup[d].matrix.copy(regM(d));

  if (sc.source !== 'consensus') {
    const b = $('#sourceBanner'); b.hidden = false;
    b.innerHTML = `<b>source: ${esc(sc.source || 'unknown')}</b> — ${sc.source === 'placeholder' ? 'built from unreviewed / interim masks, not the reviewed consensus.' : 'not patient consensus data.'} Do not use these boundaries for decisions.`;
  }
  document.title = 'Liver progression 3D' + (sc.source !== 'consensus' ? ` (${sc.source})` : '');

  // static UI
  renderRegButtons(); renderGrowthSelect(); renderLayersPanel(); renderCutPanel();
  const pres = $('#presets');
  for (const p of F.PRESETS) pres.append(h('button', { title: p.label + ' view', 'aria-label': p.label + ' view', onclick: () => presetView(p.id) }, p.key));
  $('#play').onclick = togglePlay;
  $('#compareBtn').onclick = () => setCompare(!state.compare);
  $('#regGhost').onchange = e => setRegGhost(e.target.checked);
  initRegPopover();
  $('#growthBtn').onclick = () => setGrowth(!state.growth);
  $('#growthPair').onchange = e => setGrowth(true, e.target.value);
  $('#orbitBtn').onclick = () => setOrbit(!state.orbit);
  $('#orbitBtn').disabled = !state.sel;
  $('#shotBtn').onclick = screenshot;
  $('#resetBtn').onclick = resetAll;
  $('#linkBtn').onclick = async () => { writeHash(); try { await navigator.clipboard.writeText(location.href); toast('Link to this view copied.'); } catch (e) { prompt('Copy this link:', location.href); } };
  for (const b of $$('.tabs [role=tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('.tabs').addEventListener('keydown', e => {
    const tabs = $$('.tabs [role=tab]'); const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[j].focus(); setTab(tabs[j].dataset.tab); }
  });
  $('#sheetToggle').onclick = () => { const app_ = $('#app'); const min = app_.classList.toggle('sheet-min'); $('#sheetToggle').textContent = min ? 'Show panel' : 'Hide panel'; $('#sheetToggle').setAttribute('aria-expanded', String(!min)); resize(); };
  $('#compareBtn').setAttribute('aria-pressed', String(state.compare));
  $('#growthBtn').setAttribute('aria-pressed', String(state.growth));
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', applyTheme);
  addEventListener('hashchange', () => {
    if (hashLock) return;
    const cam2 = applyHash(location.hash);
    afterStateChange(cam2);
  });

  await reports.load(CLAIMS_URL ? new URL(CLAIMS_URL, location.href) : SCENE_BASE, CLAIMS_URL ? CLAIMS_URL.split('/').pop() : sc.reports);
  setTab(state.tab);
  resize();
  await setDate(state.date, { keepPair: true });
  afterStateChange(cam, true);
}
function afterStateChange(cam, first) {
  for (const d of S.dates) dateGroup[d].matrix.copy(regM(d));
  renderRegButtons(); renderCutPanel(); updatePlanes();
  $('#compareBtn').setAttribute('aria-pressed', String(state.compare)); $('#regGhost').checked = state.regGhost;
  $('#growthBtn').setAttribute('aria-pressed', String(state.growth)); $('#growthPair').value = state.growthPair || '';
  $('#orbitBtn').setAttribute('aria-pressed', String(state.orbit)); $('#orbitBtn').disabled = !state.sel;
  controls.autoRotate = state.orbit;
  setTab(state.tab);
  if (state.date !== shown) setDate(state.date, { keepPair: true }); else ensureVisibleLoaded();
  refreshPanels(); reports.setLang(state.lang);
  if (cam) { camera.position.set(cam[0], cam[1], cam[2]); controls.target.set(cam[3], cam[4], cam[5]); controls.update(); }
  else if (first) presetView('ant', 0);
  if (state.claim) { const id = state.claim; claimViz.showById(id, { fly: !cam }); }
  requestRender();
}

window.__liver = { app, S, state, renderer, scene3, camera, controls, pickAt, planes, stats };
boot().catch(err => { console.error(err); const f = $('#fatal'); f.hidden = false; f.textContent = 'Viewer error: ' + err.message; });
