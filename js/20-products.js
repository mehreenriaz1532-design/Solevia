/* ================================================================
   Procedural sneakers. Every shoe is a set of lofted parametric
   surfaces (upper, outsole, midsole, tongue) plus tube/torus detail
   parts (laces, eyelets, heel tab, accent stripe), all sharing the
   same length-wise (u: 0 heel -> 1 toe) parametrization.
   Every builder returns { group, focus, focusR, sparks, cam }.
   ================================================================ */

/* half cross-section: ny (0 bottom -> 1 top), nz (0 center -> 1 outer edge) */
function crossSection(profileHalf, v) {
  if (v <= 0.5) { const [ny, nz] = listLerp(profileHalf, v * 2); return [ny, nz]; }
  const [ny, nz] = listLerp(profileHalf, 1 - (v - 0.5) * 2); return [ny, -nz];
}

function buildShoe(M, o) {
  const LEN = o.len, WID = o.wid, HGT = o.hgt;
  const WK = o.widthKeys, HK = o.heightKeys, PH = o.profileHalf;
  const g = new THREE.Group(), sparks = [];

  function upperPoint(u, v, out) {
    const w = keyLerp(WK, u) * WID * 0.5;
    const h = keyLerp(HK, u) * HGT;
    const [ny, nz] = crossSection(PH, v);
    out.set((u - 0.5) * LEN, ny * h, nz * w);
  }
  const upperMesh = new THREE.Mesh(parametric(upperPoint, 96, 60), M.upper);
  g.add(upperMesh);

  function solePoint(u, v, out, h0, h1, widthMul) {
    const w = keyLerp(WK, u) * WID * 0.5 * widthMul;
    let ny, nz;
    if (v <= 0.5) { const t = v * 2; ny = t; nz = Math.sin(t * Math.PI * 0.5); }
    else { const t = (v - 0.5) * 2; ny = 1 - t; nz = -Math.sin(t * Math.PI * 0.5); }
    out.set((u - 0.5) * LEN, lerp(h0, h1, ny), nz * w);
  }
  const sT = o.soleThick;
  g.add(new THREE.Mesh(parametric((u, v, p) => solePoint(u, v, p, -0.1 * sT, -0.04 * sT, 1.08), 76, 26), M.outsole));
  g.add(new THREE.Mesh(parametric((u, v, p) => solePoint(u, v, p, -0.04 * sT, 0.018 * sT, 1.14), 76, 26), M.sole));

  let tongueTopU = 0.6;
  if (o.hasLaces) {
    const tongueSpan = o.tongueSpan || [0.27, 0.60];
    tongueTopU = tongueSpan[1];
    const TPH = [[0, 0], [0.25, 0.82], [0.6, 1.0], [1.0, 0.22]];
    function tonguePoint(u, v, out) {
      const uu = lerp(tongueSpan[0], tongueSpan[1], u);
      const centerY = keyLerp(HK, uu) * HGT;
      const [ny, nz] = crossSection(TPH, v);
      const tH = lerp(0.1, 0.24, Math.sin(u * Math.PI)) * (o.tongueH || 1);
      const tW = 0.27 * (WID / 0.9);
      out.set((uu - 0.5) * LEN, centerY - 0.04 + ny * tH, nz * tW);
    }
    g.add(new THREE.Mesh(parametric(tonguePoint, 28, 18), M.upper));

    const N_EYE = o.eyelets || 5;
    const left = [], right = [];
    for (let i = 0; i < N_EYE; i++) {
      const t = i / (N_EYE - 1), uu = lerp(tongueSpan[0] + 0.03, tongueSpan[1] - 0.03, t);
      const y = keyLerp(HK, uu) * HGT + 0.025;
      const w = keyLerp(WK, uu) * WID * 0.5 * 0.72;
      const x = (uu - 0.5) * LEN;
      left.push(V3(x, y, w)); right.push(V3(x, y, -w));
    }
    for (let i = 0; i < N_EYE; i++) {
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 8, 14), M.trim).translateX(left[i].x).translateY(left[i].y).translateZ(left[i].z));
      g.add(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 8, 14), M.trim).translateX(right[i].x).translateY(right[i].y).translateZ(right[i].z));
    }
    for (let i = 0; i < N_EYE - 1; i++) {
      g.add(new THREE.Mesh(tubeGeo([left[i], V3((left[i].x + right[i + 1].x) / 2, Math.max(left[i].y, right[i + 1].y) + 0.05, 0), right[i + 1]], 0.018, { seg: 10, rad: 6 }), M.accent));
      g.add(new THREE.Mesh(tubeGeo([right[i], V3((right[i].x + left[i + 1].x) / 2, Math.max(right[i].y, left[i + 1].y) + 0.03, 0), left[i + 1]], 0.018, { seg: 10, rad: 6 }), M.accent));
    }
    const lastL = left[N_EYE - 1], lastR = right[N_EYE - 1];
    g.add(new THREE.Mesh(tubeGeo([lastL, V3(lastL.x + 0.1, lastL.y - 0.05, lastL.z * 0.6), V3(lastL.x + 0.14, lastL.y - 0.22, lastL.z * 0.3)], 0.016, { seg: 10, rad: 6 }), M.accent));
    g.add(new THREE.Mesh(tubeGeo([lastR, V3(lastR.x + 0.1, lastR.y - 0.05, lastR.z * 0.6), V3(lastR.x + 0.14, lastR.y - 0.22, lastR.z * 0.3)], 0.016, { seg: 10, rad: 6 }), M.accent));

    const midI = Math.floor(N_EYE / 2);
    sparks.push(anchorAt(g, partMatrix(left[midI], UP, 1), 0.3, 0), anchorAt(g, partMatrix(right[midI], UP, 1), 0.3, 2.4));
  }

  const hU = o.heelTabU !== undefined ? o.heelTabU : 0.075;
  const hY = keyLerp(HK, hU) * HGT, hX = (hU - 0.5) * LEN;
  const tabPts = [
    V3(hX + 0.06, hY - 0.01, 0), V3(hX + 0.01, hY + 0.045, 0),
    V3(hX + 0.005, hY + 0.09, 0), V3(hX + 0.045, hY + 0.10, 0)
  ];
  g.add(new THREE.Mesh(tubeGeo(tabPts, 0.026, { seg: 16, rad: 8 }), M.trim));

  const stripeSpan = o.stripeSpan || [0.46, 0.86];
  function stripePoint(u, v, out, side) {
    const uu = lerp(stripeSpan[0], stripeSpan[1], u);
    const baseW = keyLerp(WK, uu) * WID * 0.5;
    const h = keyLerp(HK, uu) * HGT;
    const bandY = lerp(h * 0.58, h * 0.16, u);
    const taper = 0.18 + 0.82 * Math.sin(Math.PI * clamp(u, 0, 1));
    const thickness = 0.09 * taper * (WID / 0.9);
    const yy = bandY + (v - 0.5) * thickness * 2;
    out.set((uu - 0.5) * LEN, yy, side * (baseW + 0.018));
  }
  g.add(new THREE.Mesh(parametric((u, v, p) => stripePoint(u, v, p, 1), 22, 6), M.accent));
  g.add(new THREE.Mesh(parametric((u, v, p) => stripePoint(u, v, p, -1), 22, 6), M.accent));

  const detailU = o.hasLaces ? (o.tongueSpan || [0.27, 0.60]).reduce((a, b) => a + b) / 2 : 0.45;
  const focus = V3((detailU - 0.5) * LEN, keyLerp(HK, detailU) * HGT * 0.7, 0);
  const focusR = Math.max(WID, HGT * 0.6) * 0.5;
  return { group: g, focus, focusR, sparks, cam: o.cam || { theta: 0.26, phi: 1.3 } };
}

/* ---------- style presets ---------- */
const RUNNER_WIDTH = [[0, 0.50], [0.08, 0.78], [0.36, 1.0], [0.60, 0.86], [0.82, 0.56], [1.0, 0.20]];
const RUNNER_HEIGHT = [[0, 0.80], [0.13, 1.0], [0.30, 0.56], [0.50, 0.42], [0.66, 0.48], [0.80, 0.46], [0.93, 0.28], [1.0, 0.10]];
const RUNNER_PROFILE = [[0, 0], [0.02, 0.68], [0.06, 0.95], [0.20, 1.0], [0.48, 0.92], [0.74, 0.62], [0.92, 0.28], [1.0, 0]];

const HIGHTOP_HEIGHT = [[0, 1.55], [0.10, 1.72], [0.24, 1.46], [0.32, 0.58], [0.50, 0.42], [0.66, 0.48], [0.80, 0.46], [0.93, 0.28], [1.0, 0.10]];

function buildRunner(M, o = {}) {
  return buildShoe(M, Object.assign({
    len: 2.6, wid: 0.9, hgt: 0.78, soleThick: 1.0,
    widthKeys: RUNNER_WIDTH, heightKeys: RUNNER_HEIGHT, profileHalf: RUNNER_PROFILE,
    hasLaces: true, eyelets: 5
  }, o));
}
function buildHightop(M, o = {}) {
  return buildShoe(M, Object.assign({
    len: 2.6, wid: 0.92, hgt: 0.78, soleThick: 1.05,
    widthKeys: RUNNER_WIDTH, heightKeys: HIGHTOP_HEIGHT, profileHalf: RUNNER_PROFILE,
    hasLaces: true, eyelets: 6, tongueSpan: [0.30, 0.62], heelTabU: 0.1,
    cam: { theta: 0.26, phi: 1.26 }
  }, o));
}
function buildSlipon(M, o = {}) {
  return buildShoe(M, Object.assign({
    len: 2.55, wid: 0.88, hgt: 0.62,
    widthKeys: RUNNER_WIDTH, heightKeys: [[0, 0.74], [0.15, 0.82], [0.35, 0.5], [0.55, 0.4], [0.75, 0.44], [0.92, 0.26], [1.0, 0.1]],
    profileHalf: RUNNER_PROFILE, soleThick: 1.0, hasLaces: false, heelTabU: 0.09
  }, o));
}

const PRODUCT_BUILDERS = {
  vantage: M => buildRunner(M),
  ridge: M => buildHightop(M),
  drift: M => buildRunner(M, { soleThick: 1.9, wid: 0.98 }),
  haze: M => buildSlipon(M),
  summit: M => buildHightop(M, { hgt: 0.86, wid: 0.98, soleThick: 1.15 }),
  pulse: M => buildRunner(M, { hgt: 0.7, soleThick: 0.8, len: 2.5 })
};
