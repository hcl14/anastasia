// The ONE place where patient coordinates meet three.js coordinates.
//
// Data: RAS millimetres (x -> patient RIGHT, y -> ANTERIOR, z -> SUPERIOR) of each date's own
// canonical CT frame; scene.registration gives, per date, a row-major 4x4 that maps that date's
// RAS into the Sep 2026 RAS frame (the common frame of the viewer).
//
// three.js world: X -> patient LEFT, Y -> SUPERIOR, Z -> ANTERIOR (right-handed, det +1).
// With three's usual "front" camera (on +Z looking at -Z, up +Y) this gives the radiological
// anterior view: patient right on the viewer's LEFT, head up.
import * as THREE from 'three';

export const RAS2THREE = new THREE.Matrix4().set(
  -1, 0, 0, 0,
   0, 0, 1, 0,
   0, 1, 0, 0,
   0, 0, 0, 1);
export const THREE2RAS = RAS2THREE.clone().invert();

/** point [x,y,z] in the Sep RAS frame -> world Vector3 */
export function rasToWorld(p, out = new THREE.Vector3()) { return out.set(-p[0], p[2], p[1]); }
/** world Vector3 -> [x,y,z] Sep RAS */
export function worldToRas(v) { return [-v.x, v.z, v.y]; }
/** direction in RAS -> world direction (same mapping, no translation) */
export const rasDirToWorld = rasToWorld;
export function worldDirToRas(v) { return [-v.x, v.z, v.y]; }

/** row-major 16 floats (or 4x4 nested) -> Matrix4 */
export function matFromRowMajor(a) {
  const f = Array.isArray(a[0]) ? a.flat() : a;
  if (!f || f.length !== 16 || f.some(x => typeof x !== 'number' || !isFinite(x))) return new THREE.Matrix4();
  return new THREE.Matrix4().set(...f);
}

/** apply a row-major date->Sep matrix (Matrix4) to a RAS point, returns RAS array */
export function applyRas(m, p) {
  const v = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(m);
  return [v.x, v.y, v.z];
}
export function applyRasDir(m, d) {
  const v = new THREE.Vector3(d[0], d[1], d[2]).transformDirection(m);
  return [v.x, v.y, v.z];
}

// Camera presets: direction from the target to the camera, in RAS. The orbit "up" is always
// patient superior; superior/inferior views are tilted by 0.6 degrees so that anterior is at the
// top of the screen, matching axial CT display (the inferior view = radiological axial view).
export const PRESETS = [
  { id: 'ant', label: 'Anterior', key: 'A', dir: [0, 1, 0] },
  { id: 'post', label: 'Posterior', key: 'P', dir: [0, -1, 0] },
  { id: 'rlat', label: 'Right lateral', key: 'Rt', dir: [1, 0, 0] },
  { id: 'llat', label: 'Left lateral', key: 'Lt', dir: [-1, 0, 0] },
  { id: 'sup', label: 'Superior', key: 'S', dir: [0, -0.01, 1] },
  { id: 'inf', label: 'Inferior (axial CT view)', key: 'I', dir: [0, 0.01, -1] },
  { id: 'obl', label: 'Oblique (right-anterior-superior)', key: 'Obl', dir: [0.62, 0.66, 0.42] },
];

const NAMES = [['L', 'R'], ['P', 'A'], ['I', 'S']]; // [negative, positive] per RAS axis
/** label(s) for a world direction, e.g. "R", "RA" */
export function dirLetters(worldDir) {
  const r = worldDirToRas(worldDir);
  const a = r.map(Math.abs);
  const order = [0, 1, 2].sort((i, j) => a[j] - a[i]);
  let s = NAMES[order[0]][r[order[0]] > 0 ? 1 : 0];
  if (a[order[1]] > 0.38) s += NAMES[order[1]][r[order[1]] > 0 ? 1 : 0];
  return s;
}
