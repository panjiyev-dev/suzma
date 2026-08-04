import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { Bot, Keyboard, InlineKeyboard, webhookCallback } from 'grammy';
import { verifyInitData } from './verifyInitData.js';
import {
  isRegistered, registerUser, getUser,
  saveProgress, loadProgress, resetProgress,
  logActivity, getStats, listUsers, listUsersFull,
  ensureProfile, getProfile, saveAnswer, setOnboardingStep, setProfileResult,
  setIntroCompleted, setMissedStreak, incrementResetCount, getEngagementCheckList,
} from './db.js';
import { analyzeProfile, generateEngagementMessage } from './gemini.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 7847712643);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://work.5000-words.uz/';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'uz_suzma';
// PUBLIC_URL berilsa (masalan Render/Custom domenda) - webhook rejimi ishlatiladi.
// Berilmasa (lokal kompyuterda) - eski long-polling rejimi ishlaydi, hech narsa sozlash shart emas.
const PUBLIC_URL = process.env.PUBLIC_URL ? process.env.PUBLIC_URL.replace(/\/+$/, '') : undefined;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(24).toString('hex');
const PORT = process.env.PORT || 3000;
const PAGE_SIZE = 10;
const ADMIN_PANEL_USER = process.env.ADMIN_PANEL_USER || 'admin';
const ADMIN_PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD || '';

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN topilmadi. .env faylini .env.example asosida yarating.');
}

const bot = new Bot(BOT_TOKEN);

function openAppKeyboard() {
  return new InlineKeyboard().webApp('🚀 Ilovani ochish', WEBAPP_URL);
}

const FEEDBACK_BTN_TEXT = '💬 Fikr va shikoyat';
function mainMenuKeyboard() {
  return new Keyboard()
    .webApp('📱 Ilova', WEBAPP_URL)
    .text(FEEDBACK_BTN_TEXT)
    .resized();
}

const awaitingFeedback = new Set();
bot.hears(FEEDBACK_BTN_TEXT, async (ctx) => {
  awaitingFeedback.add(ctx.from.id);
  await ctx.reply("Fikr yoki shikoyatingizni yozib yuboring — to'g'ridan-to'g'ri adminga yetadi 👇", { reply_markup: { remove_keyboard: true } });
});

const contactKeyboard = new Keyboard()
  .requestContact('📱 Raqamni yuborish')
  .resized()
  .oneTime();

function isAdmin(ctx) {
  return ctx.from && ctx.from.id === ADMIN_ID;
}

/* ===== KANALGA OBUNA TEKSHIRUVI ===== */
function subscribeKeyboard() {
  return new InlineKeyboard()
    .url("📢 Kanalga o'tish", `https://t.me/${CHANNEL_USERNAME}`)
    .row()
    .text('✅ Tekshirish', 'check_sub');
}

async function isSubscribed(userId) {
  try {
    const member = await bot.api.getChatMember(`@${CHANNEL_USERNAME}`, userId);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (e) {
    console.error('Obunani tekshirishda xato:', e);
    return false;
  }
}

async function sendSubscribeGate(ctx) {
  await ctx.reply(
    `Assalomu alaykum! Botdan foydalanish uchun avval @${CHANNEL_USERNAME} kanaliga obuna bo'ling 👇\n\nObuna bo'lgach, "✅ Tekshirish" tugmasini bosing.`,
    { reply_markup: subscribeKeyboard() }
  );
}

/* ===== KIRISH ANKETASI (ro'yxatdan o'tgach, shaxsiy reja va ohangni aniqlash uchun) ===== */
const STEPS = [
  { key: 'goal', type: 'options', question: "Ingliz tilini nima uchun o'rganmoqchisiz?", options: ['💼 Ish/martaba', "✈️ Chet elga ko'chish/sayohat", '📝 IELTS/imtihon', '🌱 O\'z rivojlanishim uchun', '👨‍👩‍👧 Oilam/farzandlarim uchun'] },
  { key: 'level', type: 'options', question: 'Hozirgi darajangizni qanday baholaysiz?', options: ['🔰 Deyarli bilmayman', '📘 Oz-moz tushunaman', "💬 O'rtacha gaplasha olaman"] },
  { key: 'timeBudget', type: 'options', question: "Kuniga o'rganishga qancha vaqt ajrata olasiz?", options: ['10 daqiqa', '20 daqiqa', '30 daqiqa', '45+ daqiqa'] },
  { key: 'pastAttempts', type: 'options', question: 'Ilgari necha marta til o\'rganishga urinib, tashlab ketgansiz?', options: ['Hech qachon', '1-2 marta', '3 martadan ko\'p'] },
  { key: 'whyFailed', type: 'options', question: 'Nega tashlab ketgan edingiz?', options: ['⏰ Vaqt yo\'q edi', '😴 Zerikarli edi', '📉 Natija ko\'rinmadi', '🔋 Motivatsiya yo\'qoldi'], skip: (a) => a.pastAttempts === 'Hech qachon' },
  { key: 'painPoint', type: 'options', question: "Agar ingliz tilini o'rganmasangiz, eng katta yo'qotishingiz nima bo'ladi?", options: ['💼 Ish imkoniyati', "✈️ Orzu qilgan mamlakat", '👨‍👩‍👧 Oilamga yordam berolmaslik', "😔 O'zimni past his qilish"] },
  { key: 'hopePoint', type: 'text', question: "Agar bu tilni o'rgansangiz, hayotingiz qanday o'zgaradi? Bir necha so'z bilan yozing." },
  { key: 'forWhom', type: 'options', question: 'Bu qaror kim uchun muhim?', options: ["Faqat o'zim uchun", 'Oilam/yaqinlarim uchun'] },
  { key: 'selfType', type: 'options', question: "O'zingizni qanday odam deb bilasiz?", options: ['Menga tashqi bosim/eslatma kerak', "O'zim intizomliman"] },
  { key: 'age', type: 'number', question: 'Necha yoshdasiz? (raqam bilan yozing)' },
  { key: 'hasParents', type: 'options', question: 'Ota-onangiz bormi?', options: ['Ha', "Yo'q"], skip: (a) => Number(a.age) >= 25 },
  { key: 'parentsInfo', type: 'text', question: 'Ular sizdan nimalarni kutishadi, qanday orzulari bor? Qisqacha yozing.', skip: (a) => Number(a.age) >= 25 || a.hasParents === "Yo'q" },
  { key: 'hasChildren', type: 'options', question: 'Farzandlaringiz bormi?', options: ['Ha', "Yo'q"], skip: (a) => Number(a.age) < 25 },
  { key: 'childrenInfo', type: 'text', question: 'Ularga qanday na\'muna bo\'lishni xohlaysiz? Qisqacha yozing.', skip: (a) => Number(a.age) < 25 || a.hasChildren === "Yo'q" },
];

function surveyKeyboard(stepIndex, options) {
  const kb = new InlineKeyboard();
  options.forEach((opt, i) => {
    kb.text(opt, `survey_${stepIndex}_${i}`).row();
  });
  return kb;
}

async function askStep(ctx, fromIndex) {
  const profile = await getProfile(ctx.from.id);
  let idx = fromIndex;
  while (idx < STEPS.length && STEPS[idx].skip && STEPS[idx].skip(profile.answers)) idx++;
  if (idx >= STEPS.length) {
    await finishOnboarding(ctx, profile);
    return;
  }
  await setOnboardingStep(ctx.from.id, idx);
  const step = STEPS[idx];
  if (step.type === 'options') {
    await ctx.reply(step.question, { reply_markup: surveyKeyboard(idx, step.options) });
  } else {
    await ctx.reply(step.question);
  }
}

async function startOnboarding(ctx) {
  await ensureProfile(ctx.from.id);
  await ctx.reply("Ajoyib! Endi sizni yaxshiroq tanishib, shaxsiy rejangizni tuzib berish uchun bir nechta savol beraman 🙂");
  await askStep(ctx, 0);
}

async function finishOnboarding(ctx, profile) {
  await ctx.reply("Rahmat! Javoblaringizni tahlil qilyapman...");
  const result = await analyzeProfile(profile.answers);
  await setProfileResult(ctx.from.id, result);
  await setOnboardingStep(ctx.from.id, -1);
  await ctx.reply(
    `✅ Shaxsiy rejangiz tayyor: *${result.planDays} kunlik* dastur.\n\nEndi ilovani oching — u yerda kirish darsini (mnemonika texnikasi va amaliy mashqlar) o'tib, so'zlarni o'rganishni boshlaysiz.`,
    { parse_mode: 'Markdown', reply_markup: openAppKeyboard() }
  );
  await ctx.reply('Pastdagi menyudan ham foydalanishingiz mumkin 👇', { reply_markup: mainMenuKeyboard() });
}

bot.callbackQuery(/^survey_(\d+)_(\d+)$/, async (ctx) => {
  const stepIndex = Number(ctx.match[1]);
  const optionIndex = Number(ctx.match[2]);
  const profile = await getProfile(ctx.from.id);
  if (!profile || profile.onboardingStep !== stepIndex) {
    await ctx.answerCallbackQuery();
    return;
  }
  const step = STEPS[stepIndex];
  const value = step.options[optionIndex];
  await ctx.answerCallbackQuery();
  try { await ctx.editMessageReplyMarkup({ reply_markup: undefined }); } catch (e) {}
  await saveAnswer(ctx.from.id, step.key, value);
  await askStep(ctx, stepIndex + 1);
});

/* ===== FOYDALANUVCHI OQIMI ===== */
async function resumeOrOpenApp(ctx) {
  const profile = await getProfile(ctx.from.id);
  if (!profile || profile.planDays === null) {
    if (profile && profile.onboardingStep >= 0) {
      await ctx.reply("Anketani davom ettiramiz 🙂");
      await askStep(ctx, profile.onboardingStep);
    } else {
      await startOnboarding(ctx);
    }
    return;
  }
  await ctx.reply("Ilovani ochish uchun pastdagi menyudan foydalaning 👇", { reply_markup: mainMenuKeyboard() });
}

bot.command('start', async (ctx) => {
  if (await isRegistered(ctx.from.id)) {
    await ctx.reply(`Xush kelibsiz, ${ctx.from.first_name}! Siz allaqachon ro'yxatdan o'tgansiz.`);
    await resumeOrOpenApp(ctx);
    return;
  }
  await sendSubscribeGate(ctx);
});

bot.callbackQuery('check_sub', async (ctx) => {
  const subscribed = await isSubscribed(ctx.from.id);
  if (!subscribed) {
    await ctx.answerCallbackQuery({
      text: "❌ Siz hali obuna bo'lmadingiz. Iltimos, avval kanalga obuna bo'ling.",
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery({ text: '✅ Obuna tasdiqlandi!' });

  if (await isRegistered(ctx.from.id)) {
    try { await ctx.editMessageText(`Xush kelibsiz, ${ctx.from.first_name}! Siz allaqachon ro'yxatdan o'tgansiz.`); } catch (e) {}
    await resumeOrOpenApp(ctx);
    return;
  }

  try {
    await ctx.editMessageText("✅ Obuna tasdiqlandi! Endi telefon raqamingizni yuboring 👇");
  } catch (e) {}
  await ctx.reply(
    "Telefon raqamingizni yuborish uchun pastdagi tugmani bosing 👇",
    { reply_markup: contactKeyboard }
  );
});

bot.on('message:contact', async (ctx) => {
  const contact = ctx.message.contact;
  if (contact.user_id !== ctx.from.id) {
    await ctx.reply("Iltimos, faqat o'zingizning raqamingizni yuboring.");
    return;
  }
  const subscribed = await isSubscribed(ctx.from.id);
  if (!subscribed) {
    await ctx.reply(
      `Ro'yxatdan o'tish uchun avval @${CHANNEL_USERNAME} kanaliga obuna bo'lishingiz kerak.`,
      { reply_markup: subscribeKeyboard() }
    );
    return;
  }
  const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
  await registerUser({
    telegramId: ctx.from.id,
    firstName: ctx.from.first_name || '',
    lastName: ctx.from.last_name || '',
    username: ctx.from.username || '',
    phoneNumber: contact.phone_number,
  });
  await ctx.reply("✅ Ro'yxatdan o'tdingiz!", { reply_markup: { remove_keyboard: true } });
  await startOnboarding(ctx);

  if (ctx.from.id !== ADMIN_ID) {
    const uname = ctx.from.username ? ' (@' + ctx.from.username + ')' : '';
    bot.api.sendMessage(
      ADMIN_ID,
      `🆕 Yangi ro'yxat: ${fullName}${uname}\n📱 ${contact.phone_number}\n🆔 ${ctx.from.id}`
    ).catch(() => {});
  }
});

/* ===== ADMIN (message:text'dan OLDIN ro'yxatdan o'tishi shart, aks holda /admin ushlab qolinadi) ===== */
async function statsMessage() {
  const s = await getStats();
  return (
    `📊 *Admin statistikasi*\n\n` +
    `👥 Jami ro'yxatdan o'tgan: *${s.totalUsers}*\n` +
    `🟢 Bugun faol: *${s.today}*\n` +
    `🟡 Kecha faol: *${s.yesterday}*\n` +
    `📅 So'nggi 7 kunda faol: *${s.last7Days}*\n` +
    `✅ Umuman ilovadan foydalangan: *${s.everActive}*`
  );
}

async function usersPageContent(page) {
  const { rows, total } = await listUsers({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const lines = rows.map((r, i) => {
    const num = page * PAGE_SIZE + i + 1;
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Noma\'lum';
    const uname = r.username ? ' @' + r.username : '';
    const prog = r.current_day
      ? `${r.current_day}-kun, ${r.current_index + 1}/4946 so'z`
      : "hali boshlamagan";
    const last = r.updated_at ? new Date(r.updated_at).toLocaleDateString('uz-UZ') : '—';
    return `${num}. ${name}${uname}\n   📍 ${prog} · 🕓 ${last}`;
  });
  const text = `📋 Foydalanuvchilar (${page + 1}/${totalPages})\n\n` + (lines.join('\n\n') || 'Hozircha hech kim yo\'q.');

  const kb = new InlineKeyboard();
  if (page > 0) kb.text('‹ Oldingi', `users_${page - 1}`);
  if (page + 1 < totalPages) kb.text('Keyingi ›', `users_${page + 1}`);
  return { text, kb };
}

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply(await statsMessage(), {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('📋 Foydalanuvchilar ro\'yxati', 'users_0'),
  });
});

bot.callbackQuery(/^users_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) { await ctx.answerCallbackQuery(); return; }
  const page = Number(ctx.match[1]);
  const { text, kb } = await usersPageContent(page);
  try {
    await ctx.editMessageText(text, { reply_markup: kb });
  } catch (e) {
    console.error("Foydalanuvchilar ro'yxatini yangilashda xato:", e);
  }
  await ctx.answerCallbackQuery();
});

/* ===== CATCH-ALL (har doim eng oxirida bo'lishi kerak) ===== */
bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  if (awaitingFeedback.has(ctx.from.id)) {
    awaitingFeedback.delete(ctx.from.id);
    const u = await getUser(ctx.from.id);
    const fullName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || "Noma'lum";
    const uname = ctx.from.username ? '@' + ctx.from.username : '—';
    const phone = (u && u.phoneNumber) || '—';
    bot.api.sendMessage(
      ADMIN_ID,
      `💬 Yangi fikr-mulohaza\n👤 ${fullName} (${uname})\n📱 ${phone}\n🆔 ${ctx.from.id}\n\n${ctx.message.text}`
    ).catch(() => {});
    await ctx.reply('Rahmat! Fikringiz adminga yetkazildi 🙏', { reply_markup: mainMenuKeyboard() });
    return;
  }

  if (await isRegistered(ctx.from.id)) {
    const profile = await getProfile(ctx.from.id);
    if (profile && profile.onboardingStep >= 0) {
      const step = STEPS[profile.onboardingStep];
      if (step.type === 'options') {
        await ctx.reply("Iltimos, yuqoridagi tugmalardan birini tanlang 👆");
        return;
      }
      const text = ctx.message.text.trim();
      if (step.type === 'number') {
        const num = parseInt(text, 10);
        if (isNaN(num) || num < 1 || num > 120) {
          await ctx.reply("Iltimos, yoshingizni faqat raqam bilan yozing (masalan: 23).");
          return;
        }
        await saveAnswer(ctx.from.id, step.key, num);
      } else {
        await saveAnswer(ctx.from.id, step.key, text);
      }
      await askStep(ctx, profile.onboardingStep + 1);
      return;
    }
    await ctx.reply("Ilovani ochish uchun pastdagi menyudan foydalaning 👇", { reply_markup: mainMenuKeyboard() });
  } else {
    await ctx.reply("Avval ro'yxatdan o'ting: /start buyrug'ini yuboring.");
  }
});

bot.catch((err) => console.error('Bot xatosi:', err));

async function registerCommands() {
  await bot.api.setMyCommands([
    { command: 'start', description: "Botni ishga tushirish" },
  ]);
  await bot.api.setMyCommands(
    [
      { command: 'start', description: "Botni ishga tushirish" },
      { command: 'admin', description: "Admin statistikasi" },
    ],
    { scope: { type: 'chat', chat_id: ADMIN_ID } }
  );
}

/* ===== API SERVER (Mini App progress sinxronizatsiyasi) ===== */
const app = express();
app.use(cors());
app.use(express.json());

function withAuth(req, res, next) {
  const user = verifyInitData(req.body.initData, BOT_TOKEN);
  if (!user) return res.status(401).json({ error: 'invalid_init_data' });
  req.tgUser = user;
  next();
}

app.post('/api/progress/load', withAuth, async (req, res) => {
  await logActivity(req.tgUser.id);
  const profile = await getProfile(req.tgUser.id);
  res.json({
    progress: await loadProgress(req.tgUser.id),
    profile: profile ? { planDays: profile.planDays, introCompleted: profile.introCompleted } : null,
  });
});

app.post('/api/profile/complete-intro', withAuth, async (req, res) => {
  await setIntroCompleted(req.tgUser.id);
  await logActivity(req.tgUser.id);
  res.json({ ok: true });
});

app.post('/api/progress/save', withAuth, async (req, res) => {
  const { currentIndex, currentDay, srsLearned, srsReviewed } = req.body;
  await saveProgress({
    telegramId: req.tgUser.id,
    currentIndex: Number(currentIndex) || 0,
    currentDay: Number(currentDay) || 1,
    srsLearned: srsLearned || {},
    srsReviewed: srsReviewed || {},
  });
  await logActivity(req.tgUser.id);
  res.json({ ok: true });
});

app.post('/api/progress/reset', withAuth, async (req, res) => {
  await resetProgress(req.tgUser.id);
  res.json({ ok: true });
});

/* ===== TTS PROKSI (so'z talaffuzi, doimiy keshlangan) ===== */
const TTS_CACHE_DIR = path.join(process.cwd(), 'tts-cache');
if (!fs.existsSync(TTS_CACHE_DIR)) fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });

function ttsCacheFile(word) {
  const hash = crypto.createHash('sha1').update(word.toLowerCase().trim()).digest('hex');
  return path.join(TTS_CACHE_DIR, hash + '.mp3');
}

app.get('/api/tts', async (req, res) => {
  const word = String(req.query.word || '').trim().slice(0, 100);
  if (!word) return res.status(400).json({ error: 'word talab qilinadi' });

  const filePath = ttsCacheFile(word);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.set('Content-Type', 'audio/mpeg');

  if (fs.existsSync(filePath)) {
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  try {
    const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=' + encodeURIComponent(word);
    const upstream = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!upstream.ok) throw new Error('upstream status ' + upstream.status);
    const buf = Buffer.from(await upstream.arrayBuffer());
    fs.writeFileSync(filePath, buf);
    res.send(buf);
  } catch (e) {
    console.error('TTS xatosi:', word, e.message);
    res.status(502).json({ error: 'tts_failed' });
  }
});

if (PUBLIC_URL) {
  app.post('/telegram-webhook', webhookCallback(bot, 'express', { secretToken: WEBHOOK_SECRET }));
}

/* ===== ADMIN PANEL (veb, login/parol bilan himoyalangan) ===== */
function adminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded && ADMIN_PANEL_PASSWORD) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIdx = decoded.indexOf(':');
    const user = decoded.slice(0, sepIdx);
    const pass = decoded.slice(sepIdx + 1);
    if (user === ADMIN_PANEL_USER && pass === ADMIN_PANEL_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="5000-words admin"');
  res.status(401).send('Kirish rad etildi');
}

app.get('/admin', adminAuth, (req, res) => {
  res.sendFile(path.join(process.cwd(), 'admin.html'));
});

app.get('/admin/api/stats', adminAuth, async (req, res) => {
  res.json(await getStats());
});

app.get('/admin/api/users', adminAuth, async (req, res) => {
  res.json(await listUsersFull());
});

/* ===== KUNLIK FAOLLIK NAZORATI (1/2/3 kun kirmagan foydalanuvchilarga eslatma, 3 kunda reset) ===== */
async function runEngagementCheck() {
  const list = await getEngagementCheckList();
  const today = new Date();
  for (const u of list) {
    if (!u.lastActive) continue;
    const last = new Date(u.lastActive + 'T00:00:00');
    const daysSince = Math.floor((today - last) / 86400000);

    if (daysSince <= 0) {
      if (u.missedStreak !== 0) await setMissedStreak(u.telegramId, 0);
      continue;
    }
    if (daysSince < 1 || daysSince > 3 || daysSince <= u.missedStreak) continue;

    const level = daysSince;
    try {
      const message = await generateEngagementMessage({
        level, tone: u.tone, painPoint: u.painPoint, hopePoint: u.hopePoint, firstName: u.firstName,
      });
      await bot.api.sendMessage(u.telegramId, message, { reply_markup: openAppKeyboard() });
    } catch (e) {
      console.error('Eslatma yuborishda xato:', u.telegramId, e.message);
    }

    if (level === 3) {
      await resetProgress(u.telegramId);
      await incrementResetCount(u.telegramId);
    } else {
      await setMissedStreak(u.telegramId, level);
    }
  }
}

cron.schedule('0 9 * * *', () => {
  runEngagementCheck().catch((e) => console.error('runEngagementCheck xatosi:', e));
}, { timezone: 'Asia/Tashkent' });

app.listen(PORT, () => console.log(`Server ${PORT}-portda ishga tushdi`));

async function launchBot() {
  await registerCommands().catch((err) => console.error("Buyruqlarni o'rnatishda xato:", err));
  if (PUBLIC_URL) {
    await bot.api.setWebhook(`${PUBLIC_URL}/telegram-webhook`, { secret_token: WEBHOOK_SECRET });
    console.log('Bot webhook rejimida ishga tushdi:', PUBLIC_URL);
  } else {
    await bot.api.deleteWebhook().catch(() => {});
    bot.start();
    console.log('Bot long-polling rejimida ishga tushdi (lokal)');
  }
}
launchBot();
