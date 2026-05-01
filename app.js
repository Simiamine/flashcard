// ──────────────────────────────────────────────
// ÉTAT GLOBAL
// ──────────────────────────────────────────────
const STORAGE_KEY = 'flashcards_app';

let decksConfig = null;       // contenu de decks.json
let currentCode = null;       // code de révision actif
let currentDeckConfig = null; // config du deck (label, decks[])
let allCards = {};            // { deckId: [{id, deckId, q, a}] }

let sessionCards = [];
let sessionIndex = 0;
let sessionKnown = 0;
let sessionUnknown = 0;
let isFlipped = false;

// ──────────────────────────────────────────────
// PERSISTANCE
// ──────────────────────────────────────────────
function loadStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function saveProgress(code, cardId, knew) {
  const store = loadStorage();
  if (!store[code]) store[code] = { progress: {} };
  const prev = store[code].progress[cardId];
  store[code].progress[cardId] = {
    knew,
    seenAt: Date.now(),
    seenCount: ((prev && prev.seenCount) || 0) + 1,
    knownCount: ((prev && prev.knownCount) || 0) + (knew ? 1 : 0),
  };
  saveStorage(store);
}

function getProgress(code) {
  const store = loadStorage();
  return (store[code] && store[code].progress) || {};
}

function resetProgress(code) {
  const store = loadStorage();
  if (store[code]) store[code].progress = {};
  saveStorage(store);
}

// ──────────────────────────────────────────────
// CHARGEMENT decks.json + CSV
// ──────────────────────────────────────────────
async function fetchDecksConfig() {
  const res = await fetch('decks.json');
  return res.json();
}

function parseCSV(text, deckId) {
  const lines = text.split('\n');
  const cards = [];
  let inData = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (!inData) {
      if (line.toLowerCase().startsWith('question')) { inData = true; }
      continue;
    }
    const cols = parseCSVLine(line);
    if (cols.length >= 2) {
      const q = cols[0].trim();
      const a = cols[1].trim();
      if (q && a) cards.push({ id: `${deckId}::${cards.length}`, deckId, q, a });
    }
  }
  return cards;
}

function parseCSVLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ';' && !inQuotes) {
      cols.push(current); current = '';
    } else { current += ch; }
  }
  cols.push(current);
  return cols;
}

async function loadDeckCSVs(deckConfig) {
  document.getElementById('loading-state').style.display = 'block';
  allCards = {};
  const results = await Promise.all(
    deckConfig.decks.map(async ({ id, file }) => {
      try {
        const res = await fetch(file);
        const text = await res.text();
        return [id, parseCSV(text, id)];
      } catch {
        console.warn(`Impossible de charger ${file}`);
        return [id, []];
      }
    })
  );
  allCards = Object.fromEntries(results);
  document.getElementById('loading-state').style.display = 'none';
}

// ──────────────────────────────────────────────
// CODE DE RÉVISION
// ──────────────────────────────────────────────
async function validateCode() {
  const input = document.getElementById('code-input');
  const error = document.getElementById('code-error');
  const code = input.value.trim().toUpperCase();

  if (!code) { error.textContent = 'Entrez un code de révision.'; return; }

  if (!decksConfig) {
    try { decksConfig = await fetchDecksConfig(); }
    catch { error.textContent = 'Impossible de charger la configuration.'; return; }
  }

  if (!decksConfig[code]) {
    error.textContent = 'Code invalide. Vérifiez et réessayez.';
    document.getElementById('deck-preview').classList.add('hidden');
    return;
  }

  error.textContent = '';
  currentCode = code;
  currentDeckConfig = decksConfig[code];

  document.getElementById('deck-preview-title').textContent = currentDeckConfig.label;
  document.getElementById('deck-preview-desc').textContent = currentDeckConfig.description || '';
  document.getElementById('deck-preview').classList.remove('hidden');

  enterApp();
}

document.getElementById('code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') validateCode();
});

// live preview
document.getElementById('code-input').addEventListener('input', async () => {
  const code = document.getElementById('code-input').value.trim().toUpperCase();
  if (!decksConfig) {
    try { decksConfig = await fetchDecksConfig(); } catch { return; }
  }
  if (decksConfig && decksConfig[code]) {
    document.getElementById('deck-preview-title').textContent = decksConfig[code].label;
    document.getElementById('deck-preview-desc').textContent = decksConfig[code].description || '';
    document.getElementById('deck-preview').classList.remove('hidden');
    document.getElementById('code-error').textContent = '';
  } else {
    document.getElementById('deck-preview').classList.add('hidden');
  }
});

async function enterApp() {
  await loadDeckCSVs(currentDeckConfig);

  const sel = document.getElementById('select-deck');
  sel.innerHTML = `<option value="all">Tous les decks</option>` +
    currentDeckConfig.decks.map(d => `<option value="${d.id}">${d.label}</option>`).join('');

  document.getElementById('screen-code').style.display = 'none';
  document.getElementById('screen-app').style.display = 'block';
  document.getElementById('header-deck-label').textContent = currentDeckConfig.label;

  updateCardCount();
  renderProgress();
}

function logout() {
  currentCode = null;
  currentDeckConfig = null;
  allCards = {};
  document.getElementById('screen-app').style.display = 'none';
  document.getElementById('screen-code').style.display = 'flex';
  document.getElementById('code-input').value = '';
  document.getElementById('deck-preview').classList.add('hidden');
  document.getElementById('code-error').textContent = '';
  document.getElementById('study-zone').classList.add('hidden');
  document.getElementById('session-end').style.display = 'none';
  document.getElementById('session-controls').style.display = 'block';
}

// ──────────────────────────────────────────────
// NAVIGATION ONGLETS
// ──────────────────────────────────────────────
function switchTab(view, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-study').style.display = view === 'study' ? 'block' : 'none';
  document.getElementById('view-progress').style.display = view === 'progress' ? 'block' : 'none';
  if (view === 'progress') renderProgress();
}

// ──────────────────────────────────────────────
// SESSION
// ──────────────────────────────────────────────
function getFilteredCards() {
  const deckId = document.getElementById('select-deck').value;
  const filter = document.getElementById('select-filter').value;
  const progress = getProgress(currentCode);

  let cards = deckId === 'all'
    ? Object.values(allCards).flat()
    : (allCards[deckId] || []);

  if (filter === 'unknown') cards = cards.filter(c => !progress[c.id] || !progress[c.id].knew);
  else if (filter === 'known') cards = cards.filter(c => progress[c.id] && progress[c.id].knew);

  return cards;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function updateCardCount() {
  if (!currentCode) return;
  const cards = getFilteredCards();
  const label = document.getElementById('card-count-label');
  const btn = document.getElementById('btn-start');
  if (cards.length === 0) {
    label.textContent = 'Aucune carte dans cette sélection';
    btn.disabled = true;
  } else {
    label.textContent = `${cards.length} carte${cards.length > 1 ? 's' : ''} à réviser`;
    btn.disabled = false;
  }
}

function startSession() {
  const cards = getFilteredCards();
  if (!cards.length) return;

  sessionCards = shuffle(cards);
  sessionIndex = 0;
  sessionKnown = 0;
  sessionUnknown = 0;

  document.getElementById('session-controls').style.display = 'none';
  document.getElementById('session-end').style.display = 'none';
  document.getElementById('study-zone').classList.remove('hidden');
  document.getElementById('card-total').textContent = sessionCards.length;
  document.getElementById('session-known-count').textContent = '✓ 0';
  document.getElementById('session-unknown-count').textContent = '✗ 0';

  showCard();
}

function showCard() {
  if (sessionIndex >= sessionCards.length) { endSession(); return; }
  isFlipped = false;
  document.getElementById('flashcard').classList.remove('flipped');
  document.getElementById('card-actions').classList.remove('visible');
  const card = sessionCards[sessionIndex];
  document.getElementById('card-index').textContent = sessionIndex + 1;
  document.getElementById('card-question').innerHTML = card.q;
  document.getElementById('card-answer').innerHTML = card.a;
  const pct = (sessionIndex / sessionCards.length) * 100;
  document.getElementById('study-progress-fill').style.width = pct + '%';
}

function flipCard() {
  if (isFlipped) return;
  isFlipped = true;
  document.getElementById('flashcard').classList.add('flipped');
  document.getElementById('card-actions').classList.add('visible');
}

function markCard(knew) {
  if (!isFlipped) { flipCard(); return; }
  const card = sessionCards[sessionIndex];
  saveProgress(currentCode, card.id, knew);
  if (knew) sessionKnown++; else sessionUnknown++;
  document.getElementById('session-known-count').textContent = `✓ ${sessionKnown}`;
  document.getElementById('session-unknown-count').textContent = `✗ ${sessionUnknown}`;
  sessionIndex++;
  showCard();
}

function endSession() {
  document.getElementById('study-zone').classList.add('hidden');
  document.getElementById('session-end').style.display = 'block';
  const total = sessionKnown + sessionUnknown;
  const pct = total > 0 ? Math.round((sessionKnown / total) * 100) : 0;
  document.getElementById('end-known').textContent = sessionKnown;
  document.getElementById('end-unknown').textContent = sessionUnknown;
  document.getElementById('end-pct').textContent = pct + '%';
  const msgs = ['Aucune carte révisée.', 'Courage, la régularité paie !', 'Bon début, continue !', 'Très bien ! Continue.', 'Parfait ! Tu maîtrises ces cartes.'];
  document.getElementById('end-message').textContent = total === 0 ? msgs[0] : pct === 100 ? msgs[4] : pct >= 80 ? msgs[3] : pct >= 50 ? msgs[2] : msgs[1];
}

function resetToControls() {
  document.getElementById('session-end').style.display = 'none';
  document.getElementById('session-controls').style.display = 'block';
}

// ──────────────────────────────────────────────
// PROGRESSION
// ──────────────────────────────────────────────
function renderProgress() {
  if (!currentCode || !currentDeckConfig) return;
  const progress = getProgress(currentCode);
  const allFlat = Object.values(allCards).flat();
  const total = allFlat.length;
  const seen = Object.keys(progress).length;
  const known = Object.values(progress).filter(p => p.knew).length;

  document.getElementById('global-stats').innerHTML = `
    <div class="stat-card">
      <div class="stat-value stat-value--success">${known}</div>
      <div class="stat-label">Cartes sues</div>
    </div>
    <div class="stat-card">
      <div class="stat-value stat-value--danger">${seen - known}</div>
      <div class="stat-label">À retravailler</div>
    </div>
    <div class="stat-card">
      <div class="stat-value stat-value--neutral">${total - seen}</div>
      <div class="stat-label">Pas encore vues</div>
    </div>
  `;

  const deckStatsEl = document.getElementById('deck-stats');
  deckStatsEl.innerHTML = '';

  currentDeckConfig.decks.forEach(({ id, label }) => {
    const cards = allCards[id] || [];
    const cardProgress = cards.map(c => progress[c.id]);
    const dSeen = cardProgress.filter(Boolean).length;
    const dKnown = cardProgress.filter(p => p && p.knew).length;
    const dUnseen = cards.length - dSeen;
    const pct = cards.length > 0 ? Math.round((dKnown / cards.length) * 100) : 0;

    const div = document.createElement('div');
    div.className = 'deck-section';
    div.innerHTML = `
      <div class="deck-section-header">
        <span class="deck-section-title">${label}</span>
        <span class="deck-section-count">${dKnown} / ${cards.length} (${pct}%)</span>
      </div>
      <div class="deck-bar"><div class="deck-bar-fill" style="width:${pct}%"></div></div>
      <div class="deck-detail">
        <span class="detail-item"><span class="dot dot-green"></span>${dKnown} sues</span>
        <span class="detail-item"><span class="dot dot-red"></span>${dSeen - dKnown} à revoir</span>
        <span class="detail-item"><span class="dot dot-gray"></span>${dUnseen} pas vues</span>
      </div>
    `;
    deckStatsEl.appendChild(div);
  });
}

function confirmReset() {
  if (!confirm('Réinitialiser toute la progression sur ce deck ? Cette action est irréversible.')) return;
  resetProgress(currentCode);
  renderProgress();
  updateCardCount();
  showToast('Progression réinitialisée.');
}

// ──────────────────────────────────────────────
// CLAVIER
// ──────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!currentCode) return;
  if (document.getElementById('study-zone').classList.contains('hidden')) return;
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!isFlipped) flipCard(); }
  else if (e.key === 'ArrowRight') { if (isFlipped) markCard(true); }
  else if (e.key === 'ArrowLeft') { if (isFlipped) markCard(false); }
});

// ──────────────────────────────────────────────
// TOAST & UTILS
// ──────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function escapeHTML(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ──────────────────────────────────────────────
// INIT
// ──────────────────────────────────────────────
(async function init() {
  document.getElementById('view-study').style.display = 'block';
  document.getElementById('view-progress').style.display = 'none';
  try { decksConfig = await fetchDecksConfig(); } catch {}
})();
