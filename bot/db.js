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
