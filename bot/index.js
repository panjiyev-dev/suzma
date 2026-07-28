import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Bot, Keyboard, InlineKeyboard, webhookCallback } from 'grammy';
import { verifyInitData } from './verifyInitData.js';
import {
  isRegistered, registerUser,
  saveProgress, loadProgress, resetProgress,
  logActivity, getStats, listUsers,
} from './db.js';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID || 7847712643);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://merry-pavlova-5b0e8f.netlify.app/';
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'uz_suzma';
// PUBLIC_URL berilsa (masalan Render/Custom domenda) - webhook rejimi ishlatiladi.
// Berilmasa (lokal kompyuterda) - eski long-polling rejimi ishlaydi, hech narsa sozlash shart emas.
const PUBLIC_URL = process.env.PUBLIC_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(24).toString('hex');
const PORT = process.env.PORT || 3000;
const PAGE_SIZE = 10;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN topilmadi. .env faylini .env.example asosida yarating.');
}

const bot = new Bot(BOT_TOKEN);

function openAppKeyboard() {
  return new InlineKeyboard().webApp('🚀 Ilovani ochish', WEBAPP_URL);
}

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

/* ===== FOYDALANUVCHI OQIMI ===== */
bot.command('start', async (ctx) => {
  if (await isRegistered(ctx.from.id)) {
    await ctx.reply(
      `Xush kelibsiz, ${ctx.from.first_name}! Siz allaqachon ro'yxatdan o'tgansiz.`,
      { reply_markup: openAppKeyboard() }
    );
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
    await ctx.reply("Ilovani ochish uchun tugmani bosing 👇", { reply_markup: openAppKeyboard() });
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
  await ctx.reply("So'zlarni o'rganishni boshlang 👇", { reply_markup: openAppKeyboard() });

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
  if (await isRegistered(ctx.from.id)) {
    await ctx.reply("Ilovani ochish uchun tugmani bosing 👇", { reply_markup: openAppKeyboard() });
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
  res.json({ progress: await loadProgress(req.tgUser.id) });
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

if (PUBLIC_URL) {
  app.post('/telegram-webhook', webhookCallback(bot, 'express', { secretToken: WEBHOOK_SECRET }));
}

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
