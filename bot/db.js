import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || 'file:users.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await client.execute(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    phone_number TEXT NOT NULL,
    registered_at TEXT NOT NULL
  )
`);
await client.execute(`
  CREATE TABLE IF NOT EXISTS progress (
    telegram_id INTEGER PRIMARY KEY,
    current_index INTEGER NOT NULL DEFAULT 0,
    current_day INTEGER NOT NULL DEFAULT 1,
    srs_learned TEXT NOT NULL DEFAULT '{}',
    srs_reviewed TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )
`);
await client.execute(`
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    activity_date TEXT NOT NULL,
    UNIQUE(telegram_id, activity_date)
  )
`);
await client.execute(`
  CREATE TABLE IF NOT EXISTS user_profile (
    telegram_id INTEGER PRIMARY KEY,
    answers TEXT NOT NULL DEFAULT '{}',
    onboarding_step INTEGER NOT NULL DEFAULT 0,
    plan_days INTEGER,
    tone TEXT,
    pain_point TEXT,
    hope_point TEXT,
    intro_completed INTEGER NOT NULL DEFAULT 0,
    missed_streak INTEGER NOT NULL DEFAULT 0,
    reset_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`);

export async function isRegistered(telegramId) {
  const res = await client.execute({ sql: 'SELECT 1 FROM users WHERE telegram_id = ?', args: [telegramId] });
  return res.rows.length > 0;
}

export async function registerUser({ telegramId, firstName, lastName, username, phoneNumber }) {
  await client.execute({
    sql: `
      INSERT INTO users (telegram_id, first_name, last_name, username, phone_number, registered_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        username = excluded.username,
        phone_number = excluded.phone_number
    `,
    args: [telegramId, firstName, lastName, username, phoneNumber, new Date().toISOString()],
  });
}

export async function saveProgress({ telegramId, currentIndex, currentDay, srsLearned, srsReviewed }) {
  await client.execute({
    sql: `
      INSERT INTO progress (telegram_id, current_index, current_day, srs_learned, srs_reviewed, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        current_index = excluded.current_index,
        current_day = excluded.current_day,
        srs_learned = excluded.srs_learned,
        srs_reviewed = excluded.srs_reviewed,
        updated_at = excluded.updated_at
    `,
    args: [telegramId, currentIndex, currentDay, JSON.stringify(srsLearned || {}), JSON.stringify(srsReviewed || {}), new Date().toISOString()],
  });
}

export async function loadProgress(telegramId) {
  const res = await client.execute({ sql: 'SELECT * FROM progress WHERE telegram_id = ?', args: [telegramId] });
  const row = res.rows[0];
  if (!row) return null;
  return {
    currentIndex: Number(row.current_index),
    currentDay: Number(row.current_day),
    srsLearned: JSON.parse(row.srs_learned || '{}'),
    srsReviewed: JSON.parse(row.srs_reviewed || '{}'),
    updatedAt: row.updated_at,
  };
}

export async function resetProgress(telegramId) {
  await client.execute({ sql: 'DELETE FROM progress WHERE telegram_id = ?', args: [telegramId] });
}

export async function logActivity(telegramId) {
  const today = new Date().toISOString().slice(0, 10);
  await client.execute({
    sql: 'INSERT OR IGNORE INTO activity_log (telegram_id, activity_date) VALUES (?, ?)',
    args: [telegramId, today],
  });
}

export async function ensureProfile(telegramId) {
  await client.execute({
    sql: 'INSERT OR IGNORE INTO user_profile (telegram_id, created_at) VALUES (?, ?)',
    args: [telegramId, new Date().toISOString()],
  });
}

export async function getProfile(telegramId) {
  const res = await client.execute({ sql: 'SELECT * FROM user_profile WHERE telegram_id = ?', args: [telegramId] });
  const row = res.rows[0];
  if (!row) return null;
  return {
    telegramId: Number(row.telegram_id),
    answers: JSON.parse(row.answers || '{}'),
    onboardingStep: Number(row.onboarding_step),
    planDays: row.plan_days === null ? null : Number(row.plan_days),
    tone: row.tone,
    painPoint: row.pain_point,
    hopePoint: row.hope_point,
    introCompleted: Number(row.intro_completed) === 1,
    missedStreak: Number(row.missed_streak),
    resetCount: Number(row.reset_count),
  };
}

export async function saveAnswer(telegramId, key, value) {
  const profile = await getProfile(telegramId);
  const answers = profile ? profile.answers : {};
  answers[key] = value;
  await client.execute({
    sql: 'UPDATE user_profile SET answers = ? WHERE telegram_id = ?',
    args: [JSON.stringify(answers), telegramId],
  });
}

export async function setOnboardingStep(telegramId, step) {
  await client.execute({
    sql: 'UPDATE user_profile SET onboarding_step = ? WHERE telegram_id = ?',
    args: [step, telegramId],
  });
}

export async function setProfileResult(telegramId, { planDays, tone, painPoint, hopePoint }) {
  await client.execute({
    sql: 'UPDATE user_profile SET plan_days = ?, tone = ?, pain_point = ?, hope_point = ? WHERE telegram_id = ?',
    args: [planDays, tone, painPoint, hopePoint, telegramId],
  });
}

export async function setIntroCompleted(telegramId) {
  await client.execute({
    sql: 'UPDATE user_profile SET intro_completed = 1 WHERE telegram_id = ?',
    args: [telegramId],
  });
}

export async function getLastActiveDate(telegramId) {
  const res = await client.execute({
    sql: 'SELECT MAX(activity_date) d FROM activity_log WHERE telegram_id = ?',
    args: [telegramId],
  });
  return res.rows[0] ? res.rows[0].d : null;
}

export async function setMissedStreak(telegramId, streak) {
  await client.execute({
    sql: 'UPDATE user_profile SET missed_streak = ? WHERE telegram_id = ?',
    args: [streak, telegramId],
  });
}

export async function incrementResetCount(telegramId) {
  await client.execute({
    sql: 'UPDATE user_profile SET reset_count = reset_count + 1, missed_streak = 0 WHERE telegram_id = ?',
    args: [telegramId],
  });
}

export async function getEngagementCheckList() {
  const res = await client.execute(`
    SELECT u.telegram_id, u.first_name,
           p.tone, p.pain_point, p.hope_point, p.missed_streak,
           (SELECT MAX(activity_date) FROM activity_log a WHERE a.telegram_id = u.telegram_id) AS last_active
    FROM users u
    JOIN user_profile p ON p.telegram_id = u.telegram_id
    WHERE p.intro_completed = 1
  `);
  return res.rows.map((r) => ({
    telegramId: Number(r.telegram_id),
    firstName: r.first_name,
    tone: r.tone,
    painPoint: r.pain_point,
    hopePoint: r.hope_point,
    missedStreak: Number(r.missed_streak),
    lastActive: r.last_active,
  }));
}

function isoDateNDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function countWhere(sql, args) {
  const res = await client.execute({ sql, args });
  return Number(res.rows[0].c);
}

export async function getStats() {
  const today = isoDateNDaysAgo(0);
  const yesterday = isoDateNDaysAgo(1);
  const weekAgo = isoDateNDaysAgo(7);
  const [totalUsers, todayActive, yesterdayActive, last7Active, everActive] = await Promise.all([
    countWhere('SELECT COUNT(*) c FROM users', []),
    countWhere('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log WHERE activity_date = ?', [today]),
    countWhere('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log WHERE activity_date = ?', [yesterday]),
    countWhere('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log WHERE activity_date >= ?', [weekAgo]),
    countWhere('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log', []),
  ]);
  return { totalUsers, today: todayActive, yesterday: yesterdayActive, last7Days: last7Active, everActive };
}

export async function listUsers({ limit, offset }) {
  const total = await countWhere('SELECT COUNT(*) c FROM users', []);
  const res = await client.execute({
    sql: `
      SELECT u.telegram_id, u.first_name, u.last_name, u.username, u.registered_at,
             p.current_index, p.current_day, p.updated_at
      FROM users u
      LEFT JOIN progress p ON p.telegram_id = u.telegram_id
      ORDER BY (p.updated_at IS NULL) ASC, p.updated_at DESC, u.registered_at DESC
      LIMIT ? OFFSET ?
    `,
    args: [limit, offset],
  });
  const rows = res.rows.map((r) => ({
    telegram_id: Number(r.telegram_id),
    first_name: r.first_name,
    last_name: r.last_name,
    username: r.username,
    registered_at: r.registered_at,
    current_index: r.current_index === null ? null : Number(r.current_index),
    current_day: r.current_day === null ? null : Number(r.current_day),
    updated_at: r.updated_at,
  }));
  return { rows, total };
}

export default client;
