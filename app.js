/* ===== TELEGRAM MINI APP ===== */
const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
const API_BASE_URL = 'https://learn.5000-words.uz';

async function apiCall(path, body) {
  if (!tg || !tg.initData || API_BASE_URL.includes('YOUR-BOT-SERVER-URL')) return null;
  try {
    const res = await fetch(API_BASE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData, ...body }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}
async function loadServerProgress() {
  return await apiCall('/api/progress/load', {});
}
let syncTimer = null;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const day = wordsData[currentIndex] ? dayOf(currentIndex) : 1;
    apiCall('/api/progress/save', { currentIndex, currentDay: day, srsLearned: srs.learned, srsReviewed: srs.reviewed });
  }, 800);
}
async function resetServerProgress() { await apiCall('/api/progress/reset', {}); }

function haptic(type) {
  if (!tg || !tg.HapticFeedback) return;
  if (type === 'success' || type === 'error' || type === 'warning') tg.HapticFeedback.notificationOccurred(type);
  else if (type === 'selection') tg.HapticFeedback.selectionChanged();
  else tg.HapticFeedback.impactOccurred(type || 'light');
}

function applyViewportHeight() {
  if (!tg) return;
  const h = tg.viewportStableHeight || tg.viewportHeight;
  if (h) document.documentElement.style.setProperty('--tg-vh', h + 'px');
}
function applySafeArea() {
  if (!tg) return;
  const sa = tg.safeAreaInset || {}, csa = tg.contentSafeAreaInset || {};
  document.documentElement.style.setProperty('--tg-safe-top', ((sa.top || 0) + (csa.top || 0)) + 'px');
  document.documentElement.style.setProperty('--tg-safe-bottom', ((sa.bottom || 0) + (csa.bottom || 0)) + 'px');
}
function tgSetChrome(appHex, textIsDark) {
  if (!tg) return;
  try { tg.setBackgroundColor(appHex); } catch (e) {}
  try { tg.setHeaderColor(appHex); } catch (e) { try { tg.setHeaderColor(textIsDark ? 'bg_color' : 'secondary_bg_color'); } catch (e2) {} }
}
function updateBackButton(view) {
  if (!tg || !tg.BackButton) return;
  if (view === 'home') tg.BackButton.hide(); else tg.BackButton.show();
}
function renderProfile() {
  const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const nameEl = document.getElementById('pName'), userEl = document.getElementById('pUsername');
  const imgEl = document.getElementById('avatarImg'), initEl = document.getElementById('avatarInitials');
  if (u) {
    const fullName = [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi';
    nameEl.textContent = fullName;
    userEl.textContent = u.username ? '@' + u.username : ('ID: ' + u.id);
    if (u.photo_url) {
      imgEl.src = u.photo_url; imgEl.style.display = 'block'; initEl.style.display = 'none';
    } else {
      initEl.textContent = fullName.trim().charAt(0).toUpperCase();
      imgEl.style.display = 'none'; initEl.style.display = 'block';
    }
  } else {
    nameEl.textContent = 'Mehmon';
    userEl.textContent = 'Telegram orqali oching';
    imgEl.style.display = 'none'; initEl.style.display = 'block'; initEl.textContent = '🙂';
  }
}
function tgInit() {
  if (!tg) return;
  tg.ready(); tg.expand();
  if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  applyViewportHeight(); applySafeArea();
  tg.onEvent('viewportChanged', applyViewportHeight);
  if (tg.onEvent) { tg.onEvent('safeAreaChanged', applySafeArea); tg.onEvent('contentSafeAreaChanged', applySafeArea); }
  tg.onEvent('themeChanged', () => { if (!localStorage.getItem(KEY_THEME)) applyTheme(tg.colorScheme || 'dark'); });
  if (tg.BackButton) tg.BackButton.onClick(() => switchView('home'));
}

/* ===== HOLAT VA KALITLAR ===== */
const KEY_INDEX = 'mnemo_app_current_index_v2';
const KEY_SRS   = 'mnemo_srs_v1';
const KEY_THEME = 'mnemo_theme';
const INTERVALS = [3, 7, 14];

let currentIndex = 0, transitioning = false, justSwiped = false;

/* Shaxsiy reja uzunligi (30-45 kun) — anketa Gemini tahlili asosida serverdan keladi.
   Kun taqsimoti so'zlarning statik .day maydonidan emas, runtime'da hisoblanadi,
   shunda bir xil 4946 ta so'z istalgan (30-45) kun soniga qayta taqsimlanishi mumkin. */
let dayFirst = {}, dayLast = {}, dayCount = {}, allDays = [], TOTAL_DAYS = 30, wordDay = [];

function computeDayCounts(totalWords, planDays) {
  const rampDays = Math.min(10, planDays);
  const weights = [];
  for (let d = 1; d <= planDays; d++) {
    weights.push(d <= rampDays ? (rampDays === 1 ? 1 : 0.3 + 0.7 * (d - 1) / (rampDays - 1)) : 1);
  }
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.max(10, Math.floor((w / weightSum) * totalWords)));

  let remainder = totalWords - counts.reduce((a, b) => a + b, 0);
  let i = counts.length - 1;
  while (remainder > 0) { counts[i] += 1; remainder--; i = (i - 1 + counts.length) % counts.length; }
  while (remainder < 0) { if (counts[i] > 10) { counts[i] -= 1; remainder++; } i = (i - 1 + counts.length) % counts.length; }
  return counts;
}

function dayOf(index) { return wordDay[index]; }

function rebuildDayIndex(planDays) {
  planDays = Math.min(45, Math.max(30, Math.round(planDays) || 30));
  const counts = computeDayCounts(wordsData.length, planDays);
  dayFirst = {}; dayLast = {}; dayCount = {}; wordDay = new Array(wordsData.length);
  let idx = 0;
  for (let d = 1; d <= planDays; d++) {
    dayFirst[d] = idx;
    for (let k = 0; k < counts[d - 1]; k++) { wordDay[idx] = d; idx++; }
    dayLast[d] = idx - 1;
    dayCount[d] = counts[d - 1];
  }
  allDays = Object.keys(dayCount).map(Number).sort((a, b) => a - b);
  TOTAL_DAYS = allDays.length;
}
rebuildDayIndex(30);

let srs = { learned: {}, reviewed: {} };
try { const s = JSON.parse(localStorage.getItem(KEY_SRS)); if (s && s.learned) srs = s; } catch (e) {}
function saveSrs() { localStorage.setItem(KEY_SRS, JSON.stringify(srs)); scheduleSync(); }

function dateKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function todayStr() { return dateKey(new Date()); }
function fromKey(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addKey(s, n) { const d = fromKey(s); d.setDate(d.getDate() + n); return dateKey(d); }
function diffDays(a, b) { return Math.round((fromKey(b) - fromKey(a)) / 86400000); }

/* ===== DOM ===== */
const dayBadgeEl = document.getElementById('dayBadge');
const progressTextEl = document.getElementById('progressText');
const dayBannerEl = document.getElementById('dayBanner');
const stageEl = document.getElementById('stage');
const viewportEl = document.getElementById('viewport');
const toastEl = document.getElementById('toast');
const slots = [document.getElementById('slotA'), document.getElementById('slotB')];
let activeSlot = 0;

const wordImages = typeof imagesData !== 'undefined' ? imagesData : {};

function slotParts(s) {
  return { card: s.querySelector('.card'), word: s.querySelector('.word-main'),
    phon: s.querySelector('.word-phonetic'), trans: s.querySelector('.word-translation'),
    mnem: s.querySelector('.mnemonics-box'), imgBox: s.querySelector('.word-image'),
    img: s.querySelector('.word-image img'), imgCredit: s.querySelector('.word-image-credit') };
}
function renderInto(slot, index) {
  const d = wordsData[index], p = slotParts(slot);
  p.word.textContent = d.word; p.phon.textContent = '(' + d.phonetic + ')';
  p.trans.textContent = d.translation; p.mnem.textContent = d.mnemonic;
  p.card.classList.remove('flipped');

  const image = wordImages[d.word];
  if (image) {
    p.img.onload = () => { p.imgBox.classList.toggle('portrait', p.img.naturalHeight > p.img.naturalWidth); };
    p.img.src = image.url; p.img.alt = d.word;
    p.imgCredit.textContent = image.photographer ? image.photographer + ' / Pexels' : 'Pexels';
    p.imgCredit.href = image.pexelsUrl || 'https://www.pexels.com';
    p.imgBox.style.display = '';
  } else {
    p.img.src = ''; p.imgBox.style.display = 'none';
  }
  preloadAudio(d.word);
}
function setPos(slot, pos, animate) {
  slot.classList.toggle('no-anim', !animate);
  slot.classList.remove('center', 'above', 'below'); slot.classList.add(pos);
  if (!animate) void slot.offsetHeight;
}
function updateTopBar(index) {
  const day = dayOf(index);
  dayBadgeEl.innerHTML = day + '-KUN <span class="caret">▼</span>';
  progressTextEl.textContent = (index + 1) + ' / ' + wordsData.length;
  const pc = document.getElementById('pCurrent'), pd = document.getElementById('pDay');
  if (pc) pc.textContent = index + 1; if (pd) pd.textContent = day;
}
function saveIndex() { localStorage.setItem(KEY_INDEX, currentIndex.toString()); scheduleSync(); }
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.remove('show'), 1900); }

/* ===== SRS ===== */
function getDueReviews() {
  const latestDay = Object.keys(srs.learned).length + 1; // ketma-ket o'rganilgani uchun = hozir turgan (joriy) reja-kuni
  const out = [];
  allDays.forEach(day => {
    const learned = srs.learned[day]; if (!learned) return;
    INTERVALS.forEach(iv => {
      const kk = day + '_' + iv;
      if (srs.reviewed[kk]) return;
      const delta = latestDay - day - iv;
      if (delta >= 0) out.push({ day, interval: iv, overdue: delta, learned });
    });
  });
  out.sort((a, b) => (b.overdue - a.overdue) || (a.day - b.day));
  return out;
}
function nextNewDay() { for (const d of allDays) if (!srs.learned[d]) return d; return null; }

function onReachDayEnd(day) {
  const today = todayStr();
  if (!srs.learned[day]) {
    srs.learned[day] = today; saveSrs();
    toast('✅ ' + day + '-kun o\'rganildi!'); haptic('success');
  } else {
    const latestDay = Object.keys(srs.learned).length + 1;
    const doneNow = [];
    for (const iv of INTERVALS) {
      const kk = day + '_' + iv;
      if (!srs.reviewed[kk] && (latestDay - day - iv) >= 0) {
        srs.reviewed[kk] = today; doneNow.push(iv);
      }
    }
    if (doneNow.length) {
      saveSrs();
      toast('🔁 ' + day + '-kun takrorlandi (+' + doneNow.join(', +') + ')'); haptic('success');
    }
  }
  refreshHomeIfVisible(); updateNavBadge();
}
function maybeMarkProgress(index) {
  const day = dayOf(index);
  if (index === dayLast[day]) onReachDayEnd(day);
}

/* ===== INIT ===== */
function renderCurrentState() {
  renderInto(slots[0], currentIndex);
  setPos(slots[0], 'center', false); setPos(slots[1], 'below', false);
  activeSlot = 0; updateTopBar(currentIndex);
  renderHome(); updateNavBadge();
}
async function init() {
  const saved = localStorage.getItem(KEY_INDEX);
  if (saved !== null && !isNaN(saved)) {
    currentIndex = parseInt(saved, 10);
    if (currentIndex < 0 || currentIndex >= wordsData.length) currentIndex = 0;
  }
  const cachedPlanDays = parseInt(localStorage.getItem(KEY_PLAN_DAYS), 10);
  if (!isNaN(cachedPlanDays) && cachedPlanDays !== TOTAL_DAYS) {
    rebuildDayIndex(cachedPlanDays);
    if (currentIndex >= wordsData.length) currentIndex = wordsData.length - 1;
  }
  document.getElementById('totalWords').textContent = wordsData.length;
  renderCurrentState();
  if (shouldShowIntro()) openIntro(TOTAL_DAYS);

  const res = await loadServerProgress();
  let changed = false;

  if (res && res.progress) {
    const remote = res.progress;
    currentIndex = Math.min(Math.max(remote.currentIndex || 0, 0), wordsData.length - 1);
    srs = { learned: remote.srsLearned || {}, reviewed: remote.srsReviewed || {} };
    localStorage.setItem(KEY_INDEX, currentIndex.toString());
    localStorage.setItem(KEY_SRS, JSON.stringify(srs));
    changed = true;
  }

  if (res && res.profile) {
    if (res.profile.planDays && res.profile.planDays !== TOTAL_DAYS) {
      rebuildDayIndex(res.profile.planDays);
      localStorage.setItem(KEY_PLAN_DAYS, res.profile.planDays.toString());
      if (currentIndex >= wordsData.length) currentIndex = wordsData.length - 1;
      changed = true;
    }
    if (res.profile.introCompleted) {
      localStorage.setItem(KEY_INTRO, '1');
      introOverlayEl.classList.remove('show');
    } else if (res.profile.planDays) {
      openIntro(TOTAL_DAYS);
    }
  }

  if (changed) renderCurrentState();
  if (!res) scheduleSync();
}

/* ===== REELS NAV ===== */
function navigate(dir) {
  if (transitioning) return;
  const step = dir === 'next' ? 1 : -1;
  const ni = currentIndex + step;
  if (ni < 0 || ni >= wordsData.length) return;

  transitioning = true;
  const active = slots[activeSlot], incoming = slots[1 - activeSlot];
  const oldDay = dayOf(currentIndex), newDay = dayOf(ni);

  renderInto(incoming, ni);
  setPos(incoming, dir === 'next' ? 'below' : 'above', false);
  requestAnimationFrame(() => {
    setPos(active, dir === 'next' ? 'above' : 'below', true);
    setPos(incoming, 'center', true);
  });

  let done = false;
  const finish = () => {
    activeSlot = 1 - activeSlot; currentIndex = ni; saveIndex(); updateTopBar(currentIndex);
    if (newDay !== oldDay) triggerDayBanner(newDay);
    maybeMarkProgress(currentIndex);
    transitioning = false;
  };
  const onEnd = (e) => {
    if (e.target !== incoming || e.propertyName !== 'transform' || done) return;
    done = true; incoming.removeEventListener('transitionend', onEnd); finish();
  };
  incoming.addEventListener('transitionend', onEnd);
  setTimeout(() => { if (!done) { done = true; incoming.removeEventListener('transitionend', onEnd); finish(); } }, 520);
}
const goToNextWord = () => navigate('next');
const goToPrevWord = () => navigate('prev');

/* ===== FLIP / TTS / BANNER ===== */
function flipActive() { if (transitioning || justSwiped) return; slotParts(slots[activeSlot]).card.classList.toggle('flipped'); haptic('light'); }
stageEl.addEventListener('click', flipActive);

const ttsSupported = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
if (ttsSupported) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.getVoices(); };
}
function pickEnglishVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en-us'))
    || voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'))
    || null;
}
const audioCache = new Map();
const AUDIO_CACHE_LIMIT = 30;

function ttsUrl(word) {
  return API_BASE_URL + '/api/tts?word=' + encodeURIComponent(word);
}
function preloadAudio(word) {
  if (audioCache.has(word)) return;
  const a = new Audio();
  a.preload = 'auto';
  a.src = ttsUrl(word);
  audioCache.set(word, a);
  if (audioCache.size > AUDIO_CACHE_LIMIT) {
    audioCache.delete(audioCache.keys().next().value);
  }
}

function speakWithBrowserTts(text) {
  if (!ttsSupported) { toast("Bu qurilmada ovoz ijrosi ishlamaydi"); return; }
  try {
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.85; u.volume = 1;
    const voice = pickEnglishVoice();
    if (voice) u.voice = voice;
    u.onerror = () => toast("Ovozni ijro etib bo'lmadi");
    window.speechSynthesis.speak(u);
  } catch (e) { toast("Ovozni ijro etib bo'lmadi"); }
}
function speakWord(text) {
  let a = audioCache.get(text);
  if (!a) { a = new Audio(); a.src = ttsUrl(text); audioCache.set(text, a); }
  a.onerror = () => speakWithBrowserTts(text);
  a.currentTime = 0;
  a.playbackRate = 1.1;
  a.play().catch(() => speakWithBrowserTts(text));
}
function speakCurrentWord(e) {
  e.stopPropagation();
  speakWord(wordsData[currentIndex].word);
}
document.querySelectorAll('.audio-btn').forEach(b => b.addEventListener('click', speakCurrentWord));
document.querySelectorAll('.word-image-credit').forEach(a => a.addEventListener('click', (e) => e.stopPropagation()));

function triggerDayBanner(n) {
  dayBannerEl.textContent = '🚀 ' + n + '-KUN BOSHLANDI!';
  dayBannerEl.classList.add('show');
  setTimeout(() => dayBannerEl.classList.remove('show'), 2000);
}

/* ===== SWIPE / WHEEL / KEYS ===== */
let startY = 0, startX = 0;
viewportEl.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; startX = e.touches[0].clientX; }, { passive: true });
viewportEl.addEventListener('touchend', (e) => {
  const dy = startY - e.changedTouches[0].clientY, dx = startX - e.changedTouches[0].clientX;
  if (Math.abs(dy) > 45 && Math.abs(dy) > Math.abs(dx)) {
    justSwiped = true; haptic('selection'); (dy > 0 ? goToNextWord() : goToPrevWord());
    setTimeout(() => { justSwiped = false; }, 350);
  }
}, { passive: true });
let isWheeling = false;
viewportEl.addEventListener('wheel', (e) => {
  if (isWheeling) return; isWheeling = true;
  if (e.deltaY > 0) goToNextWord(); else if (e.deltaY < 0) goToPrevWord();
  setTimeout(() => { isWheeling = false; }, 450);
}, { passive: true });
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('view-read').classList.contains('active')) return;
  if (e.key === 'ArrowDown' || e.key === 'PageDown') goToNextWord();
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') goToPrevWord();
  else if (e.key === ' ') { e.preventDefault(); flipActive(); }
});

/* ===== DAY PICKER ===== */
const dayPicker = document.getElementById('dayPicker');
function isDayLocked(day) {
  return !srs.learned[day] && day !== nextNewDay();
}
function dayStatus(day) {
  if (dayOf(currentIndex) === day) return 'current';
  if (getDueReviews().some(r => r.day === day)) return 'due';
  if (srs.learned[day]) return 'learned';
  if (isDayLocked(day)) return 'locked';
  return '';
}
function statusLabel(st, day) {
  if (st === 'current') return 'joriy';
  if (st === 'due') return 'takror';
  if (st === 'learned') return '✓';
  if (st === 'locked') return '🔒';
  return dayCount[day] + ' so\'z';
}
function buildDayGrid(container) {
  container.innerHTML = '';
  allDays.forEach(day => {
    const st = dayStatus(day);
    const b = document.createElement('button');
    b.className = 'day-chip ' + st;
    b.innerHTML = '<span class="dn">' + day + '</span><span class="st">' + statusLabel(st, day) + '</span>' + (st === 'due' ? '<span class="dot"></span>' : '');
    if (st === 'locked') {
      b.disabled = true;
    } else {
      b.addEventListener('click', () => jumpToDay(day));
    }
    container.appendChild(b);
  });
}
function openPicker() { buildDayGrid(document.getElementById('pickerGrid')); dayPicker.classList.add('show'); haptic('light'); }
function closePicker() { dayPicker.classList.remove('show'); }
dayBadgeEl.addEventListener('click', openPicker);
document.getElementById('closePicker').addEventListener('click', closePicker);
dayPicker.addEventListener('click', (e) => { if (e.target === dayPicker) closePicker(); });

function jumpToDay(day) {
  if (isDayLocked(day)) { toast("🔒 Avval oldingi kunlarni tugating"); closePicker(); return; }
  currentIndex = dayFirst[day]; saveIndex();
  const s = slots[activeSlot];
  renderInto(s, currentIndex); setPos(s, 'center', false);
  setPos(slots[1 - activeSlot], 'below', false);
  updateTopBar(currentIndex);
  closePicker(); switchView('read');
}

/* ===== TAKRORLASH MASHQLARI (moslashtirish + test) ===== */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const MATCH_BATCH_SIZE = 4;
const EXTRA_REPS_ON_WRONG = 2;

let reviewState = null;
let reviewIntroData = null;

function buildReviewSteps(dayWords) {
  const shuffled = shuffleArray(dayWords);
  const steps = [];
  let i = 0;
  while (i < shuffled.length) {
    const remaining = shuffled.length - i;
    const useMatch = remaining >= 2 && Math.random() < 0.5;
    if (useMatch) {
      const size = Math.min(MATCH_BATCH_SIZE, remaining);
      steps.push({ type: 'match', words: shuffled.slice(i, i + size) });
      i += size;
    } else {
      steps.push({ type: 'quiz', word: shuffled[i] });
      i += 1;
    }
  }
  return steps;
}

function buildQuizOptions(word, pool) {
  const others = pool.filter((w) => w.word !== word.word);
  const distractors = shuffleArray(others).slice(0, 3).map((w) => w.translation);
  return shuffleArray([word.translation, ...distractors]);
}

function requeueWord(word) {
  for (let n = 0; n < EXTRA_REPS_ON_WRONG; n++) {
    const remainingSteps = reviewState.queue.length - reviewState.stepIndex - 1;
    const insertAt = reviewState.stepIndex + 1 + Math.floor(Math.random() * Math.max(1, remainingSteps + 1));
    reviewState.queue.splice(insertAt, 0, { type: 'quiz', word });
  }
}

function markWordResult(word, wasWrong) {
  const key = word.word;
  if (!reviewState.results.has(key)) reviewState.results.set(key, { wrong: false });
  if (wasWrong) reviewState.results.get(key).wrong = true;
}

function showReviewScreen(name) {
  document.getElementById('reviewOverlay').classList.add('show');
  ['intro', 'quiz', 'result'].forEach((n) => {
    document.getElementById('reviewScreen-' + n).classList.toggle('active', n === name);
  });
}

function openReviewIntro(day, interval) {
  const words = wordsData.slice(dayFirst[day], dayLast[day] + 1);
  reviewIntroData = { day, interval, words };
  document.getElementById('reviewIntroTitle').textContent = day + '-kun takrorlash';
  document.getElementById('reviewIntroSub').textContent = '+' + interval + ' kunlik takror · ' + words.length + " so'z";
  showReviewScreen('intro');
}

function startReviewSession() {
  const { day, interval, words } = reviewIntroData;
  reviewState = {
    day, interval,
    pool: words,
    queue: buildReviewSteps(words),
    stepIndex: 0,
    results: new Map(),
  };
  showReviewScreen('quiz');
  renderReviewStep();
}

function reviewProgressText() {
  const done = Math.min(reviewState.stepIndex, reviewState.queue.length);
  return done + ' / ' + reviewState.queue.length;
}

function renderReviewStep() {
  if (reviewState.stepIndex >= reviewState.queue.length) { finishReviewSession(); return; }
  const step = reviewState.queue[reviewState.stepIndex];
  document.getElementById('reviewProgressText').textContent = reviewProgressText();
  const pct = Math.round((reviewState.stepIndex / reviewState.queue.length) * 100);
  document.getElementById('reviewProgressBar').style.width = pct + '%';
  if (step.type === 'quiz') renderQuizStep(step);
  else renderMatchStep(step);
}

function nextReviewStep() {
  reviewState.stepIndex += 1;
  renderReviewStep();
}

function renderQuizStep(step) {
  const area = document.getElementById('reviewArea');
  const options = buildQuizOptions(step.word, reviewState.pool);
  area.innerHTML =
    '<div class="quiz-word-card"><div class="quiz-word">' + step.word.word + '</div>' +
    '<div class="quiz-phonetic">(' + step.word.phonetic + ')</div></div>' +
    '<div class="quiz-options">' +
      options.map((opt) => '<button class="quiz-option">' + opt + '</button>').join('') +
    '</div>';
  let answered = false;
  area.querySelectorAll('.quiz-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const correct = btn.textContent === step.word.translation;
      area.querySelectorAll('.quiz-option').forEach((b) => {
        if (b.textContent === step.word.translation) b.classList.add('correct');
        else if (b === btn && !correct) b.classList.add('wrong');
        b.disabled = true;
      });
      markWordResult(step.word, !correct);
      if (!correct) requeueWord(step.word);
      haptic(correct ? 'success' : 'error');
      setTimeout(nextReviewStep, correct ? 550 : 950);
    });
  });
}

function renderMatchStep(step) {
  const area = document.getElementById('reviewArea');
  const leftWords = step.words;
  const rightWords = shuffleArray(step.words);
  area.innerHTML =
    '<div class="match-hint">So\'zni tanlang, keyin tarjimasini toping</div>' +
    '<div class="match-grid">' +
      '<div class="match-col" id="matchLeft">' +
        leftWords.map((w) => '<button class="match-item">' + w.word + '</button>').join('') +
      '</div>' +
      '<div class="match-col" id="matchRight">' +
        rightWords.map((w, i) => '<button class="match-item" data-ri="' + i + '">' + w.translation + '</button>').join('') +
      '</div>' +
    '</div>';

  const matchedCount = { n: 0 };
  let selectedLeftBtn = null, selectedLeftWord = null;

  area.querySelector('#matchLeft').querySelectorAll('.match-item').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('matched')) return;
      area.querySelector('#matchLeft').querySelectorAll('.match-item').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedLeftBtn = btn; selectedLeftWord = leftWords[i];
    });
  });

  area.querySelector('#matchRight').querySelectorAll('.match-item').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (!selectedLeftWord || btn.classList.contains('matched')) return;
      const correct = rightWords[i].word === selectedLeftWord.word;
      if (correct) {
        selectedLeftBtn.classList.remove('selected'); selectedLeftBtn.classList.add('matched');
        btn.classList.add('matched');
        matchedCount.n += 1;
        haptic('success');
        markWordResult(selectedLeftWord, false);
        selectedLeftWord = null; selectedLeftBtn = null;
        if (matchedCount.n === leftWords.length) setTimeout(nextReviewStep, 400);
      } else {
        btn.classList.add('shake');
        haptic('error');
        markWordResult(selectedLeftWord, true);
        requeueWord(selectedLeftWord);
        setTimeout(() => btn.classList.remove('shake'), 400);
      }
    });
  });
}

function finishReviewSession() {
  let wrongCount = 0;
  reviewState.results.forEach((r) => { if (r.wrong) wrongCount++; });
  const total = reviewState.results.size;
  const correctFirstTry = total - wrongCount;
  document.getElementById('reviewResultStats').innerHTML =
    '<div class="result-stat correct"><div class="rn">' + correctFirstTry + '</div><div class="rl">To\'g\'ri</div></div>' +
    '<div class="result-stat wrong"><div class="rn">' + wrongCount + '</div><div class="rl">Xato qilingan</div></div>';
  showReviewScreen('result');
  haptic('success');
}

function closeReviewSession(markDone) {
  const day = reviewState ? reviewState.day : null;
  document.getElementById('reviewOverlay').classList.remove('show');
  reviewState = null;
  if (markDone && day) onReachDayEnd(day);
}

document.getElementById('reviewStartBtn').addEventListener('click', startReviewSession);
document.getElementById('reviewFinishBtn').addEventListener('click', () => closeReviewSession(true));
document.querySelectorAll('.review-close').forEach((b) => b.addEventListener('click', () => closeReviewSession(false)));

/* ===== HOME RENDER ===== */
const UZ_MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];
const UZ_DOW = ['yakshanba','dushanba','seshanba','chorshanba','payshanba','juma','shanba'];

function renderHome() {
  const now = new Date();
  document.getElementById('todayDate').textContent = now.getDate() + '-' + UZ_MONTHS[now.getMonth()] + ', ' + UZ_DOW[now.getDay()];

  const d = wordsData[currentIndex];
  const pct = Math.round(((currentIndex + 1) / wordsData.length) * 100);
  document.getElementById('continueCard').innerHTML =
    '<div class="hero-card">' +
      '<div class="lbl">DAVOM ETISH</div>' +
      '<div class="big">' + dayOf(currentIndex) + '-kun · ' + d.word + '</div>' +
      '<div class="sub">' + (currentIndex + 1) + ' / ' + wordsData.length + ' so\'z</div>' +
      '<div class="hero-bar"><span style="width:' + pct + '%"></span></div>' +
      '<button class="go" id="continueBtn">Davom etish →</button>' +
    '</div>';
  document.getElementById('continueBtn').addEventListener('click', () => switchView('read'));

  const due = getDueReviews();
  const rl = document.getElementById('reviewList'); rl.innerHTML = '';
  if (due.length === 0) {
    rl.innerHTML = '<div class="empty-note">Bugun takrorlash uchun kun yo\'q 🎉<br>Yangi kun o\'rgansangiz, u 3·7·14 kundan keyin shu yerda paydo bo\'ladi.</div>';
  } else {
    due.forEach(r => {
      const when = r.overdue === 0 ? 'Bugun' : (r.overdue + ' kun kechikdi');
      const card = document.createElement('div');
      card.className = 'task-card review';
      card.innerHTML =
        '<div class="badge-num">' + r.day + '</div>' +
        '<div class="info"><b>' + r.day + '-kunni takrorlang</b>' +
        '<span>+' + r.interval + ' kunlik · <span class="' + (r.overdue > 0 ? 'over' : '') + '">' + when + '</span></span></div>' +
        '<div class="chev">›</div>';
      card.addEventListener('click', () => openReviewIntro(r.day, r.interval));
      rl.appendChild(card);
    });
  }

  const nn = nextNewDay();
  const nl = document.getElementById('newLesson'); nl.innerHTML = '';
  if (nn === null) {
    nl.innerHTML = '<div class="empty-note">Barcha 30 kun o\'rganildi! 🏆</div>';
  } else {
    const card = document.createElement('div');
    card.className = 'task-card newl';
    card.innerHTML =
      '<div class="badge-num">' + nn + '</div>' +
      '<div class="info"><b>' + nn + '-kunni boshlang</b><span>' + dayCount[nn] + ' ta yangi so\'z</span></div>' +
      '<div class="chev">›</div>';
    card.addEventListener('click', () => jumpToDay(nn));
    nl.appendChild(card);
  }

  document.getElementById('stLearned').textContent = Object.keys(srs.learned).length + '/' + TOTAL_DAYS;
  document.getElementById('stReviews').textContent = due.length;
  document.getElementById('stPercent').textContent = pct + '%';

  buildDayGrid(document.getElementById('homeGrid'));
}
function refreshHomeIfVisible() { if (document.getElementById('view-home').classList.contains('active')) renderHome(); }
function updateNavBadge() {
  const n = getDueReviews().length, b = document.getElementById('navBadge');
  if (n > 0) { b.textContent = n; b.classList.add('show'); } else b.classList.remove('show');
}

/* ===== VIEW SWITCH ===== */
const views = { home: document.getElementById('view-home'), read: document.getElementById('view-read'), person: document.getElementById('view-person') };
function switchView(v) {
  Object.values(views).forEach(s => s.classList.remove('active'));
  views[v].classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'home') renderHome();
  if (v === 'person') { updateTopBar(currentIndex); renderProfile(); }
  updateBackButton(v);
}
document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => { haptic('selection'); switchView(btn.dataset.view); }));

/* ===== THEME ===== */
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');
const themeSub = document.getElementById('themeSub');
const metaTheme = document.querySelector('meta[name="theme-color"]');
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark';
  themeToggle.checked = dark;
  themeIcon.textContent = dark ? '🌙' : '☀️';
  themeSub.textContent = dark ? "Qorong'i tema yoqilgan" : "Yorug' tema yoqilgan";
  const hex = dark ? '#0d0d15' : '#f5f6fb';
  metaTheme.setAttribute('content', hex);
  localStorage.setItem(KEY_THEME, t);
  tgSetChrome(hex, dark);
}
themeToggle.addEventListener('change', () => { haptic('light'); applyTheme(themeToggle.checked ? 'dark' : 'light'); });
applyTheme(localStorage.getItem(KEY_THEME) || (tg && tg.colorScheme) || 'dark');

/* ===== RESET ===== */
const confirmResetModal = document.getElementById('confirmResetModal');
const resetSuccessEl = document.getElementById('resetSuccess');

document.getElementById('resetBtn').addEventListener('click', () => {
  confirmResetModal.classList.add('show'); haptic('warning');
});
document.getElementById('cancelResetBtn').addEventListener('click', () => {
  confirmResetModal.classList.remove('show');
});
confirmResetModal.addEventListener('click', (e) => {
  if (e.target === confirmResetModal) confirmResetModal.classList.remove('show');
});

document.getElementById('confirmResetBtn').addEventListener('click', async () => {
  confirmResetModal.classList.remove('show');
  currentIndex = 0; saveIndex();
  srs = { learned: {}, reviewed: {} }; saveSrs();
  renderInto(slots[activeSlot], 0); setPos(slots[activeSlot], 'center', false); setPos(slots[1 - activeSlot], 'below', false);
  updateTopBar(0); renderHome(); updateNavBadge();
  switchView('home');

  await resetServerProgress();
  haptic('success');
  resetSuccessEl.classList.add('show');
  clearTimeout(resetSuccessEl._t);
  resetSuccessEl._t = setTimeout(() => resetSuccessEl.classList.remove('show'), 1700);
});

/* ===== MAJBURIY KIRISH DARSI (mnemonika texnikasi + amaliy mashqlar) ===== */
const KEY_INTRO = 'mnemo_intro_completed_v1';
const KEY_PLAN_DAYS = 'mnemo_plan_days_v1';
const introOverlayEl = document.getElementById('introOverlay');
const introScreens = [...document.querySelectorAll('.intro-screen')];
const introDotsEl = document.getElementById('introDots');
introScreens.forEach((_, i) => {
  const dot = document.createElement('span');
  dot.className = 'dot' + (i === 0 ? ' active' : '');
  introDotsEl.appendChild(dot);
});
let introEx1Started = false;

function introGoTo(index) {
  if (index < 0 || index >= introScreens.length) return;
  introScreens.forEach((s, i) => s.classList.toggle('active', i === index));
  [...introDotsEl.children].forEach((d, i) => d.classList.toggle('active', i === index));
  if (index === 2 && !introEx1Started) {
    introEx1Started = true;
    setTimeout(() => {
      document.getElementById('introEx1Words').style.display = 'none';
      document.getElementById('introEx1Prompt').style.display = 'none';
      document.getElementById('introEx1Result').style.display = 'block';
    }, 10000);
  }
}

document.querySelectorAll('.intro-next-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = introScreens.indexOf(btn.closest('.intro-screen'));
    introGoTo(idx + 1);
  });
});
document.querySelectorAll('.intro-back-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = introScreens.indexOf(btn.closest('.intro-screen'));
    introGoTo(idx - 1);
  });
});

document.getElementById('introEx1Check').addEventListener('click', () => {
  const input = document.getElementById('introEx1Input');
  const n = parseInt(input.value, 10);
  if (isNaN(n) || n < 0 || n > 10) {
    input.focus();
    haptic('warning');
    return;
  }
  const fb = document.getElementById('introEx1Feedback');
  if (n >= 8) {
    fb.textContent = `${n} tasi — juda kuchli xotira! Lekin bu ancha vaqt va zo'r berishni talab qiladi. Mnemonika esa buni deyarli avtomatik qiladi — hozir ko'ramiz.`;
  } else if (n >= 5) {
    fb.textContent = `${n} tasi — yomon emas, lekin ko'pchilik odam standart usulda atigi 3-4 tasini eslaydi. Mnemonika esa buni tubdan o'zgartiradi — hozir ko'ramiz qanday.`;
  } else {
    fb.textContent = `${n} tasi — bu ko'pchilikda shunday, hech qanday muammo yo'q. Standart yodlash shunday ishlaydi. Endi buni butunlay o'zgartiramiz.`;
  }
  fb.style.display = 'block';
  document.getElementById('introEx1Next').style.display = 'block';
  haptic('success');
});

document.getElementById('introEx2Check').addEventListener('click', () => {
  const textarea = document.getElementById('introEx2Text');
  const text = textarea.value.trim();
  if (text.length < 15) {
    textarea.focus();
    haptic('warning');
    return;
  }
  const targetWords = ['telefon', 'qovun', 'uy', 'quyon', 'olma'];
  const lower = text.toLowerCase();
  const usedCount = targetWords.filter((w) => lower.includes(w)).length;
  const fb = document.getElementById('introEx2Feedback');
  if (usedCount >= 4) {
    fb.textContent = `Zo'r! ${usedCount}/5 so'zni hikoyangizga bog'ladingiz. Endi ko'zingizni yumib, shu 5 ta so'zni tartib bilan eslashga harakat qiling — ko'rasiz, bu safar ancha osonroq chiqadi.`;
  } else {
    fb.textContent = `Hikoyangiz yozildi. Keyingi safar barcha 5 ta so'zni hikoyaga aniq kiritishga harakat qiling — shunda bog'lanish yanada kuchli bo'ladi. Endi ko'zingizni yumib, shu 5 ta so'zni tartib bilan eslashga harakat qiling.`;
  }
  fb.style.display = 'block';
  document.getElementById('introEx2Next').style.display = 'block';
  haptic('success');
});

async function finishIntro() {
  localStorage.setItem(KEY_INTRO, '1');
  introOverlayEl.classList.remove('show');
  await apiCall('/api/profile/complete-intro', {});
  haptic('success');
}
document.getElementById('introFinishBtn').addEventListener('click', finishIntro);

function shouldShowIntro() { return localStorage.getItem(KEY_INTRO) !== '1'; }
function openIntro(planDays) {
  document.getElementById('introPlanDays').textContent = planDays || TOTAL_DAYS;
  introOverlayEl.classList.add('show');
}

/* ===== START ===== */
tgInit();
init();
