'use strict';

/* ================================================================
   State
   ================================================================ */
const state = {
  productId: 'vantage', upper: 'chalk', accent: 'cobalt', size: null,
  view: 'front', auto: !reduceMotion, lightIdx: 0, dragging: false,
  cart: store.get('solevia-cart', []), promo: null
};

let renderer, scene, camera, pmrem, envRaw, envRT, materials, flareMat, shadowMesh;
let curBuild = null, flares = [], thumbs = {};
let lastT = 0;
const _hasTHREE = typeof THREE !== 'undefined';
const _wp = _hasTHREE ? new THREE.Vector3() : null;
const camState = { theta: 0.5, phi: 1.25, radius: 3, target: _hasTHREE ? new THREE.Vector3() : null };
const camTarget = { theta: 0.5, phi: 1.25, radius: 3, minR: 0.6, maxR: 8, target: _hasTHREE ? new THREE.Vector3() : null };
const FOV = 30 * Math.PI / 180;

function hasWebGL2() {
  if (typeof THREE === 'undefined') return false;
  try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')); }
  catch (e) { return false; }
}
function makeEnvTexture(data) {
  const tex = new THREE.DataTexture(data, ENV_W, ENV_H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

/* ================================================================
   Boot
   ================================================================ */
function boot() {
  if (!hasWebGL2()) { runFallback(); return; }
  try { initRenderer(); } catch (e) { console.warn('Solevia: WebGL init failed', e); runFallback(); return; }
  initUI();
  attachToolbar();
  attachPointer($('#gl'));
  window.addEventListener('resize', resize);
  resize();
  $('#loader').classList.add('is-done');
  lastT = performance.now();
  requestAnimationFrame(loop);
  setTimeout(() => $('#hint').classList.add('is-gone'), 5200);
}
function runFallback() {
  $('#loader').classList.add('is-done');
  $('#fallback').hidden = false;
  $('#toolbar').style.display = 'none';
  $('#hint').style.display = 'none';
  initUI();
}

function initRenderer() {
  const canvas = $('#gl');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV * 180 / Math.PI, 1, 0.05, 60);
  pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const tex = makeEnvTexture(envData(0));
  envRaw = tex; envRT = pmrem.fromEquirectangular(tex);
  scene.environment = envRT.texture;
  materials = makeMaterials();
  setVariant(materials, state.upper, state.accent, true);

  flareMat = new THREE.SpriteMaterial({ map: makeStarTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 });
  shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, opacity: 0.5 }));
  shadowMesh.rotation.x = -Math.PI / 2;
  scene.add(shadowMesh);

  buildThumbnails();
}

function initUI() {
  applyThemeTint(state.accent);
  renderSwatches();
  renderRail();
  renderGrid();
  renderFilters();
  attachCartAndForms();
  selectProduct(state.productId, true);
  renderCart();
}

/* ================================================================
   Thumbnails
   ================================================================ */
function buildThumbnails() {
  const TS = 240;
  renderer.setPixelRatio(1);
  renderer.setSize(TS, TS, false);
  const tCam = new THREE.PerspectiveCamera(FOV * 180 / Math.PI, 1, 0.05, 60);
  PRODUCTS.forEach(p => {
    setVariant(materials, p.defaultUpper, p.defaultAccent, true);
    const build = PRODUCT_BUILDERS[p.id](materials);
    scene.add(build.group);
    const fr = frameFor(build, 'front');
    placeCam(tCam, fr);
    renderer.render(scene, tCam);
    thumbs[p.id] = renderer.domElement.toDataURL('image/png');
    scene.remove(build.group);
  });
  setVariant(materials, state.upper, state.accent, true);
}
function placeCam(cam, fr) {
  const x = fr.target.x + fr.radius * Math.sin(fr.phi) * Math.sin(fr.theta);
  const y = fr.target.y + fr.radius * Math.cos(fr.phi);
  const z = fr.target.z + fr.radius * Math.sin(fr.phi) * Math.cos(fr.theta);
  cam.position.set(x, y, z); cam.lookAt(fr.target); cam.updateProjectionMatrix();
}

/* ================================================================
   Camera framing — general views orbit the bounding-box center;
   only 'detail' targets the shoe's own focus point (laces/tongue).
   ================================================================ */
function frameFor(build, viewKey) {
  const box = computeBounds(build.group);
  const size = box.getSize(V3()), center = box.getCenter(V3());
  const maxDim = Math.max(size.x, size.y * 1.15, size.z * 1.4, 0.4);
  const baseDist = (maxDim * 0.62) / Math.tan(FOV / 2) * 1.32;
  const c = build.cam || { theta: 0.55, phi: 1.25 };
  let theta = c.theta, phi = c.phi, radius = baseDist;
  let target = center.clone();
  if (viewKey === 'side') theta = c.theta + Math.PI / 2;
  else if (viewKey === 'top') { phi = 0.4; radius = baseDist * 1.05; }
  else if (viewKey === 'detail') {
    target = build.focus.clone();
    radius = Math.max(build.focusR * 2.6, 0.5);
    theta = c.theta + 0.5; phi = Math.max(0.85, c.phi - 0.05);
  }
  phi = clamp(phi, 0.18, Math.PI - 0.18);
  return { theta, phi, radius, target, minR: radius * 0.3, maxR: radius * 2.8 };
}
function goTo(fr) {
  camTarget.theta = fr.theta; camTarget.phi = fr.phi; camTarget.radius = fr.radius;
  camTarget.minR = fr.minR; camTarget.maxR = fr.maxR; camTarget.target.copy(fr.target);
}

/* ================================================================
   Product selection
   ================================================================ */
function selectProduct(id, instant) {
  state.productId = id;
  const p = byId[id];
  state.size = p.sizes.def;
  renderSizes(p);
  syncPanel();
  updateRailActive(id);
  swapGiantName(p.name);
  if (!renderer) return;

  if (curBuild) scene.remove(curBuild.group);
  flares.forEach(f => scene.remove(f.sprite));
  flares = [];

  curBuild = PRODUCT_BUILDERS[id](materials);
  scene.add(curBuild.group);
  curBuild.sparks.forEach(s => {
    const spr = new THREE.Sprite(flareMat);
    spr.scale.setScalar(s.size * 0.5);
    scene.add(spr);
    flares.push({ anchor: s.obj, sprite: spr, size: s.size * 0.5, phase: s.phase });
  });

  const box = computeBounds(curBuild.group);
  const sz = box.getSize(V3());
  shadowMesh.position.set((box.min.x + box.max.x) / 2, box.min.y + 0.002, (box.min.z + box.max.z) / 2);
  const sw = Math.max(sz.x, sz.z) * 1.15;
  shadowMesh.scale.set(sw, sw * 0.5, 1);

  const fr = frameFor(curBuild, state.view);
  goTo(fr);
  if (instant) { camState.theta = fr.theta; camState.phi = fr.phi; camState.radius = fr.radius; camState.target.copy(fr.target); }
}

function syncPanel() {
  const p = byId[state.productId];
  $('#pType').textContent = p.kind;
  $('#pRating').textContent = p.rating;
  $('#pDesc').textContent = p.blurb;
  const price = unitPrice(p, state.upper, state.accent);
  $('#pPrice').textContent = money(price);
  $('#pInstall').textContent = `or 4 payments of ${money(price / 4)}`;
  $('#vUpper').textContent = UPPERS[state.upper].name;
  $('#vAccent').textContent = ACCENTS[state.accent].name;
  const dl = $('#specs'); dl.innerHTML = '';
  const rows = [
    ['Weight', p.weight], ['Heel-to-toe drop', p.drop], ['Cushioning', p.cushion],
    ['Upper', `${p.upper}, ${UPPERS[state.upper].name}`], ['Accent', ACCENTS[state.accent].name]
  ];
  rows.forEach(([k, v]) => {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    d.append(dt, dd); dl.appendChild(d);
  });
}

function swapGiantName(name) {
  const el = $('#giantName');
  el.classList.add('is-swap');
  setTimeout(() => { el.textContent = name; el.classList.remove('is-swap'); }, 260);
}
function updateRailActive(id) { $$('#rail button').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === id))); }

/* ================================================================
   Upper / accent / size selection
   ================================================================ */
function applyThemeTint(accentKey) {
  const a = ACCENTS[accentKey];
  document.documentElement.style.setProperty('--ah', a.hue);
  document.documentElement.style.setProperty('--as', a.sat);
}
function updateAria(containerId, key) { $$(`#${containerId} [data-key]`).forEach(b => b.setAttribute('aria-checked', String(b.dataset.key === key))); }

function chooseUpper(key) {
  if (state.upper === key) return;
  state.upper = key;
  if (materials) setVariant(materials, state.upper, state.accent, false);
  updateAria('swUpper', key);
  syncPanel();
}
function chooseAccent(key) {
  if (state.accent === key) return;
  state.accent = key;
  if (materials) setVariant(materials, state.upper, state.accent, false);
  updateAria('swAccent', key);
  applyThemeTint(key);
  syncPanel();
}
function chooseSize(v) {
  state.size = v;
  $('#vSize').textContent = v;
  $$('#swSize [data-key]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.key === v)));
}

function renderSwatches() {
  const su = $('#swUpper'); su.innerHTML = '';
  Object.keys(UPPERS).forEach(key => {
    const u = UPPERS[key], b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.key = key; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(key === state.upper));
    b.title = u.name; b.setAttribute('aria-label', u.name);
    b.style.setProperty('--sw', u.hex);
    b.addEventListener('click', () => chooseUpper(key));
    su.appendChild(b);
  });
  const sa = $('#swAccent'); sa.innerHTML = '';
  Object.keys(ACCENTS).forEach(key => {
    const a = ACCENTS[key], b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.key = key; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(key === state.accent));
    b.title = a.name; b.setAttribute('aria-label', a.name);
    b.style.setProperty('--sw', a.hex);
    b.addEventListener('click', () => chooseAccent(key));
    sa.appendChild(b);
  });
}
function renderSizes(p) {
  $('#lblSize').textContent = p.sizes.label;
  const wrap = $('#swSize'); wrap.innerHTML = '';
  p.sizes.values.forEach(v => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'size'; b.dataset.key = v; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v === p.sizes.def));
    b.textContent = v;
    b.addEventListener('click', () => chooseSize(v));
    wrap.appendChild(b);
  });
  $('#vSize').textContent = p.sizes.def;
}

/* ================================================================
   Rail / grid / filters
   ================================================================ */
function thumbImg(id, cls) {
  return thumbs[id] ? `<img alt="" src="${thumbs[id]}" class="${cls} is-ready">` : `<img alt="" class="${cls}">`;
}
function renderRail() {
  const rail = $('#rail'); rail.innerHTML = '';
  PRODUCTS.forEach(p => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.id = p.id; b.setAttribute('aria-current', String(p.id === state.productId));
    b.innerHTML = `<span class="rail__img">${thumbImg(p.id, '')}</span>${p.name}`;
    b.addEventListener('click', () => selectProduct(p.id));
    rail.appendChild(b);
  });
}
function renderGrid() {
  const grid = $('#grid'); grid.innerHTML = '';
  PRODUCTS.forEach(p => {
    const price = unitPrice(p, p.defaultUpper, p.defaultAccent);
    const card = document.createElement('div');
    card.className = 'card'; card.dataset.cat = p.cat;
    card.innerHTML = `
      <button type="button" class="card__media" aria-label="View ${p.name}">
        ${thumbImg(p.id, '')}
        <span class="card__tag">${p.kind}</span>
      </button>
      <div class="card__body"><div><h3>${p.name}</h3><p>${p.cat}</p></div><span class="card__price">${money(price)}</span></div>`;
    card.querySelector('.card__media').addEventListener('click', () => {
      selectProduct(p.id);
      $('#explore').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    });
    grid.appendChild(card);
  });
}
function renderFilters() {
  const cats = ['All', ...new Set(PRODUCTS.map(p => p.cat))];
  const wrap = $('#filters'); wrap.innerHTML = '';
  cats.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = c; b.setAttribute('aria-pressed', String(i === 0));
    b.addEventListener('click', () => {
      $$('#filters button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $$('#grid .card').forEach(card => { card.hidden = !(c === 'All' || card.dataset.cat === c); });
    });
    wrap.appendChild(b);
  });
}

/* ================================================================
   Toolbar + pointer / keyboard camera control
   ================================================================ */
function attachToolbar() {
  $$('#toolbar [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $$('#toolbar [data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#toolbar [data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      state.view = btn.dataset.view;
      goTo(frameFor(curBuild, state.view));
    });
  });
  $('#btnAuto').setAttribute('aria-pressed', String(state.auto));
  $('#btnAuto').addEventListener('click', () => {
    state.auto = !state.auto;
    $('#btnAuto').setAttribute('aria-pressed', String(state.auto));
  });
  $('#btnZoomIn').addEventListener('click', () => { camTarget.radius = clamp(camTarget.radius * 0.82, camTarget.minR, camTarget.maxR); });
  $('#btnZoomOut').addEventListener('click', () => { camTarget.radius = clamp(camTarget.radius * 1.22, camTarget.minR, camTarget.maxR); });
  $('#lightName').textContent = ENV_PRESETS[state.lightIdx].name;
  $('#btnLight').addEventListener('click', () => setLight((state.lightIdx + 1) % ENV_PRESETS.length));
}
function setLight(idx) {
  state.lightIdx = idx;
  const tex = makeEnvTexture(envData(idx));
  const rt = pmrem.fromEquirectangular(tex);
  envRaw.dispose(); envRT.dispose();
  envRaw = tex; envRT = rt;
  scene.environment = rt.texture;
  $('#lightName').textContent = ENV_PRESETS[idx].name;
}

function attachPointer(canvas) {
  const pointers = new Map();
  let lastX = 0, lastY = 0, pinchD = null;
  function hideHint() { $('#hint').classList.add('is-gone'); }
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) { state.dragging = true; $('#viewer').classList.add('is-drag'); lastX = e.clientX; lastY = e.clientY; }
    hideHint();
  });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinchD != null) camTarget.radius = clamp(camTarget.radius + (pinchD - d) * 0.01, camTarget.minR, camTarget.maxR);
      pinchD = d;
      return;
    }
    if (!state.dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    camState.theta -= dx * 0.0072;
    camState.phi = clamp(camState.phi - dy * 0.0072, 0.18, Math.PI - 0.18);
    camTarget.theta = camState.theta; camTarget.phi = camState.phi;
  });
  function up(e) {
    pointers.delete(e.pointerId); pinchD = null;
    if (pointers.size === 0) { state.dragging = false; $('#viewer').classList.remove('is-drag'); }
  }
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    camTarget.radius = clamp(camTarget.radius + e.deltaY * 0.0016 * camTarget.radius, camTarget.minR, camTarget.maxR);
  }, { passive: false });
  canvas.addEventListener('keydown', e => {
    const step = 0.12;
    if (e.key === 'ArrowLeft') { camTarget.theta -= step; camState.theta -= step; e.preventDefault(); }
    else if (e.key === 'ArrowRight') { camTarget.theta += step; camState.theta += step; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { camTarget.phi = clamp(camTarget.phi - 0.1, 0.18, Math.PI - 0.18); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { camTarget.phi = clamp(camTarget.phi + 0.1, 0.18, Math.PI - 0.18); e.preventDefault(); }
  });
}

function resize() {
  if (!renderer) return;
  const el = $('#viewer'), w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

/* ================================================================
   Render loop
   ================================================================ */
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (t - lastT) / 1000 || 0.016); lastT = t;
  if (materials) stepVariant(materials, 1 - Math.exp(-dt / 0.18));
  if (state.auto && !state.dragging) { camTarget.theta += dt * 0.26; camState.theta += dt * 0.26; }
  if (!state.dragging) {
    const k = 1 - Math.exp(-dt / 0.28);
    camState.theta += (camTarget.theta - camState.theta) * k;
    camState.phi += (camTarget.phi - camState.phi) * k;
    camState.radius += (camTarget.radius - camState.radius) * k;
    camState.target.lerp(camTarget.target, k);
  } else {
    camState.radius += (camTarget.radius - camState.radius) * (1 - Math.exp(-dt / 0.12));
  }
  const x = camState.target.x + camState.radius * Math.sin(camState.phi) * Math.sin(camState.theta);
  const y = camState.target.y + camState.radius * Math.cos(camState.phi);
  const z = camState.target.z + camState.radius * Math.sin(camState.phi) * Math.cos(camState.theta);
  camera.position.set(x, y, z);
  camera.lookAt(camState.target);

  const tt = t * 0.001;
  flares.forEach(f => {
    f.anchor.getWorldPosition(_wp);
    f.sprite.position.copy(_wp);
    const pulse = reduceMotion ? 1 : 0.78 + 0.22 * Math.sin(tt * 2.1 + f.phase);
    f.sprite.scale.setScalar(f.size * pulse);
  });
  renderer.render(scene, camera);
}

/* ================================================================
   Cart
   ================================================================ */
const cartKey = (id, upper, accent, size) => [id, upper, accent, size].join('|');
function cartCount() { return state.cart.reduce((s, l) => s + l.qty, 0); }
function cartSubtotal() { return state.cart.reduce((s, l) => s + unitPrice(byId[l.id], l.upper, l.accent) * l.qty, 0); }
function getPromoDiscount(sub) { return state.promo === 'SOLEVIA10' ? Math.round(sub * 0.1) : 0; }

function addToCart() {
  const p = byId[state.productId];
  const key = cartKey(p.id, state.upper, state.accent, state.size);
  const line = state.cart.find(l => l.key === key);
  if (line) line.qty++; else state.cart.push({ key, id: p.id, upper: state.upper, accent: state.accent, size: state.size, qty: 1 });
  store.set('solevia-cart', state.cart);
  renderCart();
  const b = $('#bagCount'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}
function changeQty(key, d) {
  const l = state.cart.find(x => x.key === key); if (!l) return;
  l.qty += d;
  if (l.qty <= 0) state.cart = state.cart.filter(x => x.key !== key);
  store.set('solevia-cart', state.cart); renderCart();
}
function removeLine(key) { state.cart = state.cart.filter(x => x.key !== key); store.set('solevia-cart', state.cart); renderCart(); }

function renderCart() {
  const count = cartCount();
  $('#bagCount').textContent = String(count);
  $('#bagCount').hidden = count === 0;
  $('#bagBtn').setAttribute('aria-label', `Open bag, ${count} item${count === 1 ? '' : 's'}`);

  const list = $('#lines'); list.innerHTML = '';
  const has = state.cart.length > 0;
  $('#empty').hidden = has; $('#sum').hidden = !has; list.hidden = !has;

  state.cart.forEach(l => {
    const p = byId[l.id], price = unitPrice(p, l.upper, l.accent);
    const li = document.createElement('li'); li.className = 'line';
    const img = thumbs[l.id] ? `<img alt="" src="${thumbs[l.id]}">` : `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-shoe"/></svg>`;
    li.innerHTML = `
      <div class="line__img">${img}</div>
      <div>
        <h3>${p.name}</h3>
        <p>${UPPERS[l.upper].name} · ${ACCENTS[l.accent].name} · US ${l.size}</p>
        <div class="line__ctl">
          <div class="qty">
            <button type="button" aria-label="Decrease quantity" data-act="dec">–</button>
            <span>${l.qty}</span>
            <button type="button" aria-label="Increase quantity" data-act="inc">+</button>
          </div>
          <button type="button" class="linkbtn" data-act="rm">Remove</button>
        </div>
      </div>
      <div class="line__price">${money(price * l.qty)}</div>`;
    li.querySelector('[data-act="dec"]').addEventListener('click', () => changeQty(l.key, -1));
    li.querySelector('[data-act="inc"]').addEventListener('click', () => changeQty(l.key, 1));
    li.querySelector('[data-act="rm"]').addEventListener('click', () => removeLine(l.key));
    list.appendChild(li);
  });

  const sub = cartSubtotal(), promo = getPromoDiscount(sub);
  $('#rowDisc').hidden = !promo;
  if (promo) { $('#discLabel').textContent = `Promo (${state.promo})`; $('#sumDisc').textContent = '-' + money(promo); }
  const afterDisc = Math.max(0, sub - promo);
  const ship = has && afterDisc < 150 ? 8 : 0;
  $('#sumSub').textContent = money(sub);
  $('#sumShip').textContent = ship ? money(ship) : 'Free';
  $('#sumTotal').textContent = money(afterDisc + ship);
  const remain = Math.max(0, 150 - afterDisc);
  $('#shipText').textContent = has ? (remain > 0 ? `Add ${money(remain)} more for free shipping.` : `You've unlocked free shipping.`) : 'Free shipping on orders over $150.';
  $('#shipBar').style.width = has ? clamp(afterDisc / 150 * 100, 0, 100) + '%' : '0%';
}

/* ================================================================
   Drawer / modal / forms / theme / FAQ+Policies
   ================================================================ */
let lastFocus = null;
function anyOverlayOpen() {
  return $('#drawer').classList.contains('is-open') || $('#modal').classList.contains('is-open') || $('#infoModal').classList.contains('is-open');
}
function openDrawer() { lastFocus = document.activeElement; $('#scrim').classList.add('is-open'); $('#drawer').classList.add('is-open'); $('#drawer').setAttribute('aria-hidden', 'false'); document.body.classList.add('is-locked'); $('#drawerClose').focus(); }
function closeDrawer() { $('#scrim').classList.remove('is-open'); $('#drawer').classList.remove('is-open'); $('#drawer').setAttribute('aria-hidden', 'true'); if (!anyOverlayOpen()) document.body.classList.remove('is-locked'); if (lastFocus) lastFocus.focus(); }
function openModal() { $('#modal').classList.add('is-open'); $('#modal').setAttribute('aria-hidden', 'false'); document.body.classList.add('is-locked'); $('#modalClose').focus(); }
function closeModal() { $('#modal').classList.remove('is-open'); $('#modal').setAttribute('aria-hidden', 'true'); if (!anyOverlayOpen()) document.body.classList.remove('is-locked'); }

const FAQ_ITEMS = [
  ['Is Solevia a real store?', 'No — this is a concept store built to showcase interactive 3D product visualization. Checkout is simulated and no payment is ever taken.'],
  ['Can I really change the color?', 'Yes. Every upper and accent swap updates the 3D model in real time, using the same rendering the shoe was built with.'],
  ['How accurate are the 3D previews?', 'Each pair is built and lit procedurally, so what you see in the viewer is the same geometry used everywhere else on the site.'],
  ['Do you ship internationally?', 'This is a demo, so no orders are fulfilled — but the bag shows how shipping and free-shipping thresholds would work.'],
  ['How do I leave a review?', 'Scroll to the Reviews section near the bottom of the page. Anyone can add one, tied to any pair in the collection.']
];
const POLICY_ITEMS = [
  ['Shipping', 'Shipping is simulated as free over $150, and $8 below that — shown live in your bag as you shop.'],
  ['Exchanges', 'The site describes free 30-day exchanges, matching a real retailer\u2019s policy — no physical exchanges are processed here.'],
  ['Materials', 'All upper and sole materials described are illustrative. Every pair is rendered procedurally, not manufactured.'],
  ['Your data', 'This demo keeps your bag, theme, and reviews in your browser\u2019s local storage only — nothing is sent to a server.']
];
function openInfoModal(title, items) {
  $('#infoModalTitle').textContent = title;
  $('#infoModalBody').innerHTML = items.map(([h, p]) => `<h3>${h}</h3><p>${p}</p>`).join('');
  $('#infoModal').classList.add('is-open');
  $('#infoModal').setAttribute('aria-hidden', 'false');
  document.body.classList.add('is-locked');
  $('#infoModalClose').focus();
}
function closeInfoModal() {
  $('#infoModal').classList.remove('is-open');
  $('#infoModal').setAttribute('aria-hidden', 'true');
  if (!anyOverlayOpen()) document.body.classList.remove('is-locked');
}

function attachCartAndForms() {
  $('#btnAdd').addEventListener('click', addToCart);
  $('#bagBtn').addEventListener('click', openDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', () => { closeDrawer(); closeModal(); closeInfoModal(); });
  $('#emptyBrowse').addEventListener('click', () => { closeDrawer(); $('#collection').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); });
  $('#modalClose').addEventListener('click', closeModal);
  $('#infoModalClose').addEventListener('click', closeInfoModal);
  $('#infoModal').addEventListener('click', e => { if (e.target.id === 'infoModal') closeInfoModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeModal(); closeInfoModal(); } });

  $('[data-info="faq"]').addEventListener('click', () => openInfoModal('Frequently asked questions', FAQ_ITEMS));
  $('[data-info="policies"]').addEventListener('click', () => openInfoModal('Policies', POLICY_ITEMS));
  $$('[data-social]').forEach(a => a.addEventListener('click', e => e.preventDefault()));

  $('#promoForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#promoInput').value.trim().toUpperCase();
    if (v === 'SOLEVIA10') { state.promo = 'SOLEVIA10'; $('#promoMsg').textContent = '10% off applied.'; }
    else if (v === '') { state.promo = null; $('#promoMsg').textContent = 'Try SOLEVIA10 for 10% off.'; }
    else { state.promo = null; $('#promoMsg').textContent = "That code isn't valid."; }
    renderCart();
  });

  $('#btnCheckout').addEventListener('click', () => {
    const sub = cartSubtotal(), promo = getPromoDiscount(sub), ship = (sub - promo) < 150 ? 8 : 0;
    const total = Math.max(0, sub - promo) + ship;
    $('#modalText').textContent = `Your order totaling ${money(total)} is on its way. This is a concept store, so no payment was taken and nothing ships — thank you for browsing Solevia.`;
    state.cart = []; state.promo = null; store.set('solevia-cart', []);
    renderCart(); closeDrawer(); openModal();
  });

  $('#newsForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#newsEmail');
    if (input.checkValidity() && input.value.trim()) { $('#newsMsg').textContent = "Thanks — you're on the list."; input.value = ''; }
    else { $('#newsMsg').textContent = 'Enter a valid email address.'; }
  });

  const savedTheme = store.get('solevia-theme', null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  const nextLabel = () => (document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  $('#themeBtn').setAttribute('aria-label', `Switch to ${nextLabel()} theme`);
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('solevia-theme', next);
    $('#themeBtn').setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
  });
}

boot();
