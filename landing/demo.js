const demoWords = [
  { word: 'Answer', phonetic: 'anse', translation: 'javob bermoq', mnemonic: "(Ananas) Savol berganingizda doskadagi ananas tilga kirib, to'g'ri javobni aytib berdi.",
    image: { url: 'https://images.pexels.com/photos/208494/pexels-photo-208494.jpeg?auto=compress&cs=tinysrgb&h=350', photographer: 'Pixabay', pexelsUrl: 'https://www.pexels.com/photo/questions-answers-signage-208494/' } },
  { word: 'Walk', phonetic: 'uolk', translation: 'piyoda yurmoq', mnemonic: "(Volk/Bo'ri) Ulkan bo'ri (volk) orqa oyoqlarida tikka turib, ko'chada siz bilan piyoda yuribdi.",
    image: { url: 'https://images.pexels.com/photos/9584386/pexels-photo-9584386.jpeg?auto=compress&cs=tinysrgb&h=350', photographer: 'Maryia Plashchynskaya', pexelsUrl: 'https://www.pexels.com/photo/people-walking-on-a-road-9584386/' } },
  { word: 'Scarf', phonetic: 'skarf', translation: 'sharf', mnemonic: "(Shkaf) Shkafni ochishingiz bilan ichidan mingta rangli sharflar to'kilib ketdi.",
    image: { url: 'https://images.pexels.com/photos/16049198/pexels-photo-16049198.jpeg?auto=compress&cs=tinysrgb&h=350', photographer: 'Elina Volkova', pexelsUrl: 'https://www.pexels.com/photo/pretty-brunette-woman-in-jacket-with-scarf-on-neck-16049198/' } },
];

const CAPTION_FRONT = "Kartadagi so'zni o'qing va ustiga bosing. Talaffuzni eshitish uchun karnaychani bosing 🔊";
const CAPTION_BACK = "✨ Mana shunday — tarjima va assotsiatsiya darhol chiqadi. Real ilovada aynan shu tarzda ishlaydi. Yana bosing — keyingi so'zga o'tasiz";

const TTS_API_BASE = 'https://learn.5000-words.uz';

let demoIndex = 0;
let demoFlipped = false;

const demoCard = document.getElementById('demoCard');
const demoWordEl = document.getElementById('demoWord');
const demoPhonEl = document.getElementById('demoPhon');
const demoTransEl = document.getElementById('demoTrans');
const demoMnemEl = document.getElementById('demoMnem');
const demoCaptionEl = document.getElementById('demoCaption');
const demoProgressEl = document.getElementById('demoProgress');
const demoAudioBtn = document.getElementById('demoAudio');
const demoDotsEl = document.getElementById('demoDots');
const demoImageEl = document.getElementById('demoImage');
const demoImageImgEl = demoImageEl ? demoImageEl.querySelector('img') : null;
const demoImageCreditEl = document.getElementById('demoImageCredit');

demoWords.forEach((_, i) => {
  const dot = document.createElement('span');
  dot.className = 'demo-dot';
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    demoIndex = i;
    demoFlipped = false;
    render();
  });
  demoDotsEl.appendChild(dot);
});

function render() {
  const w = demoWords[demoIndex];
  demoWordEl.textContent = w.word;
  demoPhonEl.textContent = '(' + w.phonetic + ')';
  demoTransEl.textContent = w.translation;
  demoMnemEl.textContent = w.mnemonic;
  demoProgressEl.textContent = (demoIndex + 1) + ' / ' + demoWords.length;
  demoCaptionEl.textContent = demoFlipped ? CAPTION_BACK : CAPTION_FRONT;
  demoCard.classList.toggle('flipped', demoFlipped);
  [...demoDotsEl.children].forEach((d, i) => d.classList.toggle('active', i === demoIndex));

  if (demoImageEl && w.image) {
    demoImageImgEl.onload = () => { demoImageEl.classList.toggle('portrait', demoImageImgEl.naturalHeight > demoImageImgEl.naturalWidth); };
    demoImageImgEl.src = w.image.url; demoImageImgEl.alt = w.word;
    demoImageCreditEl.textContent = w.image.photographer ? w.image.photographer + ' / Pexels' : 'Pexels';
    demoImageCreditEl.href = w.image.pexelsUrl || 'https://www.pexels.com';
    demoImageEl.style.display = '';
  }
  preloadDemoAudio(w.word);
}

demoCard.addEventListener('click', () => {
  if (!demoFlipped) {
    demoFlipped = true;
  } else {
    demoFlipped = false;
    demoIndex = (demoIndex + 1) % demoWords.length;
  }
  render();
});

const demoAudioCache = new Map();
function demoTtsUrl(word) { return TTS_API_BASE + '/api/tts?word=' + encodeURIComponent(word); }
function preloadDemoAudio(word) {
  if (demoAudioCache.has(word)) return;
  const a = new Audio();
  a.preload = 'auto';
  a.src = demoTtsUrl(word);
  demoAudioCache.set(word, a);
}
function speakDemoWithBrowserTts(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.85;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}
function speakDemoWord(text) {
  let a = demoAudioCache.get(text);
  if (!a) { a = new Audio(); a.src = demoTtsUrl(text); demoAudioCache.set(text, a); }
  a.onerror = () => speakDemoWithBrowserTts(text);
  a.currentTime = 0;
  a.play().catch(() => speakDemoWithBrowserTts(text));
}

demoAudioBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  speakDemoWord(demoWords[demoIndex].word);
});

render();
if (demoImageCreditEl) demoImageCreditEl.addEventListener('click', (e) => e.stopPropagation());

/* ===== SAHIFA OXIRIGA YETGANDA CHIQADIGAN XABAR ===== */
const bottomAlert = document.getElementById('bottomAlert');
const bottomAlertClose = document.getElementById('bottomAlertClose');
let bottomAlertShown = false;

function showBottomAlert() {
  if (bottomAlertShown) return;
  bottomAlertShown = true;
  bottomAlert.classList.add('show');
}
function hideBottomAlert() {
  bottomAlert.classList.remove('show');
}

const footerEl = document.querySelector('.footer');
if (footerEl && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => { if (entry.isIntersecting) showBottomAlert(); });
  }, { threshold: 0.6 });
  observer.observe(footerEl);
}

bottomAlertClose.addEventListener('click', hideBottomAlert);
bottomAlert.addEventListener('click', (e) => { if (e.target === bottomAlert) hideBottomAlert(); });
