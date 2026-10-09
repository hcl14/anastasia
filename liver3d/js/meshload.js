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
      const g = ply.parse(buf);
      if (!g.getAttribute('position') || g.getAttribute('position').count === 0) throw new Error('empty mesh ' + url);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.computeBoundingBox(); g.computeBoundingSphere();
      g.userData.bytes = bytesSeen; g.userData.url = url;
      p.__done = true; p.__value = g;
      return g;
    } finally {
      prog.pending--; prog.filesDone++;
      if (prog.pending === 0) { prog.files = 0; prog.filesDone = 0; prog.bytes = 0; prog.bytesTotal = 0; }
      emit();
    }
  })();
  p.catch(() => { p.__done = true; p.__failed = true; });
  cache.set(url, p);
  return p;
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
