// Mesh loading: fetch with byte progress, PLY parsing (no decimation, no resampling), in-memory cache.
import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const ply = new PLYLoader();
const cache = new Map();       // url -> Promise<BufferGeometry>
const listeners = new Set();
const prog = { pending: 0, files: 0, filesDone: 0, bytes: 0, bytesTotal: 0, label: '' };

export function onProgress(fn) { listeners.add(fn); }
function emit() { for (const fn of listeners) fn({ ...prog }); }
export function setProgressLabel(s) { prog.label = s; emit(); }

export function isCached(url) { return cache.has(url) && cache.get(url).__done === true; }
export function peek(url) { const p = cache.get(url); return p && p.__done ? p.__value : null; }

export function loadGeometry(url) {
  if (cache.has(url)) return cache.get(url);
  prog.pending++; prog.files++; emit();
  const p = (async () => {
    let bytesSeen = 0, declared = 0;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      declared = +res.headers.get('content-length') || 0;
      // gzip transfer: content-length is the compressed size; still a fair progress estimate
      prog.bytesTotal += declared; emit();
      let buf;
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); bytesSeen += value.length;
          prog.bytes += value.length;
          emit();
        }
        buf = new Uint8Array(bytesSeen);
        let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
        buf = buf.buffer;
      } else {
        buf = await res.arrayBuffer(); bytesSeen = buf.byteLength; prog.bytes += bytesSeen;
      }
      const g = /\.qm\.gz(\?|$)/.test(url) ? await parseQM(buf) : ply.parse(buf);
      if (!g.getAttribute('position') || g.getAttribute('position').count === 0) throw new Error('empty mesh ' + url);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      g.userData.bytes = bytesSeen; g.userData.url = url;
      p.__done = true; p.__value = g;
      return g;
    } finally {
      prog.pending--; prog.filesDone++;
      if (prog.pending === 0) { prog.files = 0; prog.filesDone = 0; prog.bytes = 0; prog.bytesTotal = 0; prog.label = ''; }
      emit();
    }
  })();
  p.catch(() => { p.__done = true; p.__failed = true; });
  cache.set(url, p);
  return p;
}

// QM1 (tools/export_qm.py): gzip of a header, u16 quantized positions, zig-zag delta indices, optional RGB colours
async function gunzip(buf) {
  if (typeof DecompressionStream === 'function') {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
    return new Uint8Array(await ds.arrayBuffer());
  }
  const { gunzipSync } = await import('../vendor/fflate.esm.js?v=a584f9404f');   // vendored fallback (MIT), older browsers only
  return gunzipSync(new Uint8Array(buf));
}
async function parseQM(buf) {
  const u8 = await gunzip(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== 0x00314d51) throw new Error('not a QM1 mesh');
  const nv = dv.getUint32(4, true), nf = dv.getUint32(8, true), flags = dv.getUint32(12, true);
  const o = [16, 20, 24].map(k => dv.getFloat32(k, true)), st = [28, 32, 36].map(k => dv.getFloat32(k, true));
  let off = 40;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) pos[i] = o[i % 3] + dv.getUint16(off + 2 * i, true) * st[i % 3];
  off += nv * 6;
  const idx = new Uint32Array(nf * 3); let prev = 0;
  for (let i = 0; i < nf * 3; i++) { const z = dv.getInt32(off + 4 * i, true); prev += (z >>> 1) ^ -(z & 1); idx[i] = prev; }
  off += nf * 12;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (flags & 1) {   // sRGB bytes -> linear, as PLYLoader does
    const c = new Float32Array(nv * 3), col = new THREE.Color();
    for (let i = 0; i < nv; i++) { col.setRGB(u8[off + 3 * i] / 255, u8[off + 3 * i + 1] / 255, u8[off + 3 * i + 2] / 255).convertSRGBToLinear(); c[3 * i] = col.r; c[3 * i + 1] = col.g; c[3 * i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return g;
}

export function stats() {
  let n = 0, bytes = 0, tris = 0, verts = 0;
  for (const p of cache.values()) if (p.__value) {
    n++; bytes += p.__value.userData.bytes || 0;
    const g = p.__value; verts += g.getAttribute('position').count;
    tris += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
  }
  return { n, bytes, tris, verts };
}
