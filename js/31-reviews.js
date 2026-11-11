'use strict';

const SEED_REVIEWS = [
  { id: 'seed1', name: 'Jordan M.', rating: 5, productId: 'vantage', photo: null,
    text: 'The 3D viewer actually showed me how the cobalt stripe would look before I ordered — Vantage looks exactly like the preview.' },
  { id: 'seed2', name: 'Alicia R.', rating: 5, productId: 'ridge', photo: null,
    text: 'Ridge is my first high-top in years and the collar height in the 3D model matched the real fit description perfectly.' },
  { id: 'seed3', name: 'Theo B.', rating: 4, productId: 'haze', photo: null,
    text: 'Haze is great for slipping on quickly, though I wish there were more accent color options. Still my go-to pair.' }
];

let reviews = store.get('solevia-reviews', SEED_REVIEWS);
let editingId = null;
let selectedStars = 5;
let pendingPhoto = null;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function starsDisplay(n) {
  let s = `<span class="stars" role="img" aria-label="Rated ${n} out of 5">`;
  for (let i = 0; i < 5; i++) s += `<svg viewBox="0 0 24 24"${i < n ? '' : ' style="opacity:.28"'}><use href="#i-star"/></svg>`;
  return s + '</span>';
}
function reviewProductImg(productId) {
  return thumbs[productId]
    ? `<img src="${thumbs[productId]}" alt="">`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:42px;height:42px;stroke:var(--accent);fill:none;stroke-width:1.4;stroke-linejoin:round"><use href="#i-shoe"/></svg>`;
}

function renderProductSelect() {
  const sel = $('#revProduct'); sel.innerHTML = '';
  PRODUCTS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = `${p.name} — ${p.kind}`;
    sel.appendChild(opt);
  });
}
function renderStarsInput() {
  const wrap = $('#revStarsInput'); wrap.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.v = String(i);
    b.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-star"/></svg>';
    b.addEventListener('click', () => { selectedStars = i; updateStarsInput(); });
    wrap.appendChild(b);
  }
  updateStarsInput();
}
function updateStarsInput() {
  $$('#revStarsInput button').forEach(b => {
    const v = +b.dataset.v;
    b.setAttribute('aria-checked', String(v === selectedStars));
    b.classList.toggle('is-on', v <= selectedStars);
  });
}

function renderReviews() {
  const grid = $('#revGrid'); grid.innerHTML = '';
  reviews.forEach(r => {
    const p = byId[r.productId];
    const photoHtml = r.photo ? `<img class="rev-card__photo" src="${r.photo}" alt="Photo shared with this review">` : '';
    const card = document.createElement('article');
    card.className = 'rev-card'; card.dataset.id = r.id;
    card.innerHTML = `
      <div class="rev-card__head">
        <div class="rev-card__who">
          <strong>${escapeHtml(r.name)}</strong>
          ${starsDisplay(r.rating)}
        </div>
        <div class="rev-card__actions">
          <button type="button" class="linkbtn" data-act="edit">Edit</button>
          <button type="button" class="linkbtn" data-act="del">Delete</button>
        </div>
      </div>
      <p class="rev-card__text">${escapeHtml(r.text)}</p>
      ${photoHtml}
      <div class="rev-card__product">
        ${reviewProductImg(r.productId)}
        <span>${p ? p.name : 'Solevia pair'}</span>
      </div>`;
    card.querySelector('[data-act="edit"]').addEventListener('click', () => startEdit(r.id));
    card.querySelector('[data-act="del"]').addEventListener('click', () => deleteReview(r.id));
    grid.appendChild(card);
  });
}

function resetReviewForm() {
  $('#revForm').reset();
  if (PRODUCTS[0]) $('#revProduct').value = PRODUCTS[0].id;
  selectedStars = 5; updateStarsInput();
  pendingPhoto = null;
}
function startEdit(id) {
  const r = reviews.find(x => x.id === id);
  if (!r) return;
  editingId = id;
  $('#revName').value = r.name;
  $('#revProduct').value = r.productId;
  $('#revText').value = r.text;
  selectedStars = r.rating; updateStarsInput();
  pendingPhoto = r.photo || null;
  $('#revSubmit').textContent = 'Update review';
  $('#revCancel').hidden = false;
  $('#revMsg').textContent = '';
  $('#reviews').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  $('#revName').focus();
}
function stopEditing() {
  editingId = null;
  $('#revSubmit').textContent = 'Submit review';
  $('#revCancel').hidden = true;
}
function deleteReview(id) {
  reviews = reviews.filter(r => r.id !== id);
  store.set('solevia-reviews', reviews);
  renderReviews();
  if (editingId === id) { stopEditing(); resetReviewForm(); }
}

function initReviews() {
  renderProductSelect();
  renderStarsInput();
  renderReviews();

  $('#revPhoto').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) { pendingPhoto = null; return; }
    if (!file.type.startsWith('image/')) { $('#revMsg').textContent = 'Please choose an image file.'; e.target.value = ''; pendingPhoto = null; return; }
    if (file.size > 3 * 1024 * 1024) { $('#revMsg').textContent = 'Please choose an image under 3 MB.'; e.target.value = ''; pendingPhoto = null; return; }
    const reader = new FileReader();
    reader.onload = () => { pendingPhoto = reader.result; };
    reader.readAsDataURL(file);
  });

  $('#revForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#revName').value.trim();
    const productId = $('#revProduct').value;
    const text = $('#revText').value.trim();
    if (!name || !text || !productId) { $('#revMsg').textContent = 'Please fill in your name, the pair, and a review.'; return; }
    const data = { name, rating: selectedStars, text, productId, photo: pendingPhoto };
    if (editingId) {
      const idx = reviews.findIndex(r => r.id === editingId);
      if (idx >= 0) reviews[idx] = { ...reviews[idx], ...data };
      stopEditing();
      $('#revMsg').textContent = 'Review updated.';
    } else {
      reviews.unshift({ id: 'r' + Date.now() + Math.random().toString(36).slice(2, 6), ...data });
      if (reviews.length > 3) reviews.pop();
      $('#revMsg').textContent = 'Thanks for the review!';
    }
    store.set('solevia-reviews', reviews);
    renderReviews();
    resetReviewForm();
  });

  $('#revCancel').addEventListener('click', () => {
    stopEditing();
    resetReviewForm();
    $('#revMsg').textContent = '';
  });
}

initReviews();
