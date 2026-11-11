/* ================================================================
   Procedural HDR lighting. Same baked-equirect technique as proven
   elsewhere: a few softboxes and small hot spots painted into a
   half-float environment map, feeding both the PBR materials (via
   PMREM) and a few sparkle accents on eyelets/trims.
   ================================================================ */
const ENV_W = 512, ENV_H = 256;
const ENV_PRESETS = [
  { name: 'Studio',
    base: { top: [0.10, 0.10, 0.11], hor: [0.055, 0.055, 0.06], floor: [0.03, 0.03, 0.032] },
    lights: [
      { t: 'rect', d: [0, 1, 0.25], hw: 0.95, hh: 0.95, soft: 0.4, c: [1, 1, 1], I: 3.8 },
      { t: 'rect', d: [-1, 0.25, 0.5], hw: 0.16, hh: 1.0, soft: 0.08, c: [0.92, 0.96, 1], I: 7.5 },
      { t: 'rect', d: [1, 0.2, 0.45], hw: 0.16, hh: 1.0, soft: 0.08, c: [1, 0.97, 0.9], I: 7.5 },
      { t: 'rect', d: [0.15, 0.3, -1], hw: 0.9, hh: 0.26, soft: 0.12, c: [1, 1, 1], I: 4.2 },
      { t: 'rect', d: [0, -1, 0.2], hw: 1.3, hh: 1.2, soft: 0.5, c: [1, 0.93, 0.85], I: 0.6 },
      { t: 'sparks', n: 18, seed: 7, r: [0.014, 0.03], I: [10, 22], c: [1, 0.99, 0.96] }
    ] },
  { name: 'Street',
    base: { top: [0.1, 0.09, 0.12], hor: [0.14, 0.08, 0.06], floor: [0.04, 0.03, 0.03] },
    lights: [
      { t: 'rect', d: [-0.85, 0.18, 0.55], hw: 0.65, hh: 0.3, soft: 0.16, c: [1, 0.58, 0.26], I: 8.5 },
      { t: 'rect', d: [0, 1, 0.1], hw: 0.8, hh: 0.8, soft: 0.4, c: [0.6, 0.75, 1], I: 2.2 },
      { t: 'rect', d: [0.95, 0.28, 0.2], hw: 0.14, hh: 0.9, soft: 0.07, c: [1, 0.75, 0.5], I: 6 },
      { t: 'rect', d: [0.1, 0.22, -1], hw: 0.85, hh: 0.28, soft: 0.14, c: [1, 0.68, 0.45], I: 4.5 },
      { t: 'sparks', n: 16, seed: 21, r: [0.014, 0.03], I: [9, 18], c: [1, 0.85, 0.7] }
    ] },
  { name: 'Court',
    base: { top: [0.14, 0.15, 0.17], hor: [0.1, 0.1, 0.11], floor: [0.05, 0.05, 0.055] },
    lights: [
      { t: 'rect', d: [0, 1, 0.1], hw: 1.1, hh: 0.5, soft: 0.25, c: [1, 0.99, 0.95], I: 6.5 },
      { t: 'rect', d: [-0.8, 0.5, 0.5], hw: 0.4, hh: 0.4, soft: 0.2, c: [0.95, 0.98, 1], I: 3.5 },
      { t: 'rect', d: [0.8, 0.5, 0.4], hw: 0.4, hh: 0.4, soft: 0.2, c: [0.95, 0.98, 1], I: 3.5 },
      { t: 'rect', d: [0, 0.15, -1], hw: 1.0, hh: 0.3, soft: 0.14, c: [1, 1, 1], I: 3.2 },
      { t: 'sparks', n: 20, seed: 11, r: [0.012, 0.026], I: [12, 24], c: [1, 1, 1] }
    ] }
];
const _envCache = {};

function _norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function _cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
const _ss = t => t * t * (3 - 2 * t);

function prepEnv(preset) {
  const rects = [], spots = [];
  let seed = 1;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  for (const L of preset.lights) {
    if (L.t === 'rect') {
      const w = _norm3(L.d), hint = Math.abs(w[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
      const u = _norm3(_cross3(hint, w)), v = _cross3(w, u);
      rects.push({ w, u, v, hw: L.hw, hh: L.hh, soft: L.soft, c: L.c, I: L.I });
    } else if (L.t === 'sparks') {
      seed = L.seed;
      for (let i = 0; i < L.n; i++) {
        const y = lerp(-0.2, 1, rnd()), a = rnd() * TAU, rr = Math.sqrt(1 - y * y), r = lerp(L.r[0], L.r[1], rnd());
        spots.push({ d: [Math.cos(a) * rr, y, Math.sin(a) * rr], r, I: lerp(L.I[0], L.I[1], rnd()), c: L.c, co: Math.cos(r * 1.7) });
      }
    }
  }
  return { rects, spots };
}

function envData(idx) {
  if (_envCache[idx]) return _envCache[idx];
  const P = ENV_PRESETS[idx], { rects, spots } = prepEnv(P), b = P.base;
  const W = ENV_W, H = ENV_H, out = new Uint16Array(W * H * 4), half = THREE.DataUtils.toHalfFloat;
  let o = 0;
  for (let j = 0; j < H; j++) {
    const el = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(el), cr = Math.cos(el);
    const k = Math.sqrt(Math.abs(y)), tgt = y >= 0 ? b.top : b.floor;
    for (let i = 0; i < W; i++) {
      const az = ((i + 0.5) / W - 0.5) * TAU, x = Math.cos(az) * cr, z = Math.sin(az) * cr;
      let r = lerp(b.hor[0], tgt[0], k), g = lerp(b.hor[1], tgt[1], k), bl = lerp(b.hor[2], tgt[2], k);
      for (let n = 0; n < rects.length; n++) {
        const L = rects[n], dw = x * L.w[0] + y * L.w[1] + z * L.w[2];
        if (dw < 0.08) continue;
        const px = (x * L.u[0] + y * L.u[1] + z * L.u[2]) / dw, py = (x * L.v[0] + y * L.v[1] + z * L.v[2]) / dw;
        const m = _ss(clamp((L.hw - Math.abs(px)) / L.soft, 0, 1)) * _ss(clamp((L.hh - Math.abs(py)) / L.soft, 0, 1));
        if (m <= 0) continue;
        const s = L.I * m; r += L.c[0] * s; g += L.c[1] * s; bl += L.c[2] * s;
      }
      for (let n = 0; n < spots.length; n++) {
        const S = spots[n], cd = x * S.d[0] + y * S.d[1] + z * S.d[2];
        if (cd < S.co) continue;
        const m = _ss(clamp((S.r - Math.acos(Math.min(1, cd))) / (S.r * 0.55), 0, 1));
        if (m <= 0) continue;
        const s = S.I * m; r += S.c[0] * s; g += S.c[1] * s; bl += S.c[2] * s;
      }
      out[o++] = half(r); out[o++] = half(g); out[o++] = half(bl); out[o++] = half(1);
    }
  }
  return (_envCache[idx] = out);
}

/* ================================================================
   Geometry helpers
   ================================================================ */
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = (typeof THREE !== 'undefined') ? V3(0, 1, 0) : null;
const M4 = {
  t: (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z),
  rx: a => new THREE.Matrix4().makeRotationX(a),
  ry: a => new THREE.Matrix4().makeRotationY(a),
  rz: a => new THREE.Matrix4().makeRotationZ(a),
  s: (x, y, z) => new THREE.Matrix4().makeScale(x, y === undefined ? x : y, z === undefined ? x : z)
};
const xf = (geo, ...ms) => { ms.forEach(m => geo.applyMatrix4(m)); return geo; };

function mergeGeos(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let n = 0; parts.forEach(g => { n += g.attributes.position.count; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/* Surface from fn(u, v, out) with u, v in [0,1); normals from finite differences. */
function parametric(fn, nu, nv) {
  const pos = [], nor = [], idx = [], p = V3(), a = V3(), b = V3(), n = V3(), e = 1e-3;
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      fn(u, v, p); fn(u + e, v, a); fn(u, v + e, b);
      a.sub(p); b.sub(p); n.crossVectors(a, b).normalize();
      pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const A = i * (nv + 1) + j, B = (i + 1) * (nv + 1) + j;
    idx.push(A, B, A + 1, B, B + 1, A + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function tubeGeo(points, r, o = {}) {
  const pts = points.map(p => (p.isVector3 ? p : V3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, !!o.closed, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, o.seg || 16, r, o.rad || 8, !!o.closed);
}

/* keyframe interpolation: pairs are [u, value] at explicit u positions (0..1) */
function keyLerp(pairs, u) {
  u = clamp(u, 0, 1);
  for (let i = 0; i < pairs.length - 1; i++) {
    const [u0, v0] = pairs[i], [u1, v1] = pairs[i + 1];
    if (u >= u0 && u <= u1) { const t = (u - u0) / Math.max(1e-6, u1 - u0); return lerp(v0, v1, t); }
  }
  return pairs[pairs.length - 1][1];
}
/* walk evenly through a list of [y,z] pairs by normalized position t (0..1) */
function listLerp(list, t) {
  t = clamp(t, 0, 1);
  const n = list.length - 1, fi = t * n, i0 = Math.floor(fi), i1 = Math.min(i0 + 1, n), f = fi - i0;
  const a = list[i0], b = list[i1];
  return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
}

/* ================================================================
   Materials — plain PBR, no refraction needed (fabric/rubber/foam
   are all opaque). upper/accent colors lerp smoothly on change.
   ================================================================ */
function makeMaterials() {
  const upper = new THREE.MeshStandardMaterial({ color: 0xd7d2c6, roughness: 0.8, metalness: 0.0 });
  const sole = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.88, metalness: 0.0 });
  const outsole = new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.95, metalness: 0.0 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x2159c9, roughness: 0.55, metalness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.4, metalness: 0.5 });
  return {
    upper, sole, outsole, accent, trim,
    tUpper: new THREE.Color(0xd7d2c6), tUpperRough: 0.8,
    tAccent: new THREE.Color(0x2159c9), tAccentRough: 0.55
  };
}
function setVariant(M, upperKey, accentKey, instant) {
  const u = UPPERS[upperKey], a = ACCENTS[accentKey];
  M.tUpper.set(u.hex); M.tUpperRough = u.rough;
  M.tAccent.set(a.hex); M.tAccentRough = a.rough;
  if (instant) {
    M.upper.color.copy(M.tUpper); M.upper.roughness = M.tUpperRough;
    M.accent.color.copy(M.tAccent); M.accent.roughness = M.tAccentRough;
  }
}
function stepVariant(M, k) {
  M.upper.color.lerp(M.tUpper, k);
  M.upper.roughness += (M.tUpperRough - M.upper.roughness) * k;
  M.accent.color.lerp(M.tAccent, k);
  M.accent.roughness += (M.tAccentRough - M.accent.roughness) * k;
}

/* ================================================================
   Instancing + bounds + small textures
   ================================================================ */
const _dummy = (typeof THREE !== 'undefined') ? new THREE.Object3D() : null;
function partMatrix(pos, up, scale, spin) {
  _dummy.position.copy(pos);
  _dummy.quaternion.setFromUnitVectors(UP, up.clone().normalize());
  if (spin) _dummy.rotateY(spin);
  _dummy.scale.setScalar(scale);
  _dummy.updateMatrix();
  return _dummy.matrix.clone();
}
function instanced(geo, mat, matrices) {
  const m = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((mx, i) => m.setMatrixAt(i, mx));
  m.instanceMatrix.needsUpdate = true;
  m.frustumCulled = false;
  return m;
}
function anchorAt(parent, matrix, size, phase) {
  const o = new THREE.Object3D();
  matrix.decompose(o.position, o.quaternion, o.scale);
  o.scale.set(1, 1, 1);
  parent.add(o);
  return { obj: o, size, phase, axis: UP.clone() };
}

function computeBounds(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), v = V3(), mm = new THREE.Matrix4();
  root.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, mm); mm.premultiply(o.matrixWorld);
        for (let k = 0; k < 8; k++) {
          v.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(mm);
          box.expandByPoint(v);
        }
      }
    } else {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); box.expandByPoint(v); }
    }
  });
  return box;
}

function makeStarTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.08, 'rgba(255,255,255,.9)');
  grd.addColorStop(0.24, 'rgba(255,255,255,.22)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.globalCompositeOperation = 'lighter';
  [[0, 3.0, .9], [Math.PI / 2, 3.0, .9]].forEach(([rot, th, a]) => {
    g.save(); g.translate(64, 64); g.rotate(rot);
    const lg = g.createLinearGradient(-64, 0, 64, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${a})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect(-64, -th / 2, 128, th); g.restore();
  });
  return new THREE.CanvasTexture(c);
}
function makeShadowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,.6)'); grd.addColorStop(0.45, 'rgba(0,0,0,.2)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
