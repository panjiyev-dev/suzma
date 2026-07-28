import Database from 'better-sqlite3';

const db = new Database('users.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    phone_number TEXT NOT NULL,
    registered_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS progress (
    telegram_id INTEGER PRIMARY KEY,
    current_index INTEGER NOT NULL DEFAULT 0,
    current_day INTEGER NOT NULL DEFAULT 1,
    srs_learned TEXT NOT NULL DEFAULT '{}',
    srs_reviewed TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER NOT NULL,
    activity_date TEXT NOT NULL,
    UNIQUE(telegram_id, activity_date)
  );
`);

export function isRegistered(telegramId) {
  return !!db.prepare('SELECT 1 FROM users WHERE telegram_id = ?').get(telegramId);
}

export function registerUser({ telegramId, firstName, lastName, username, phoneNumber }) {
  db.prepare(`
    INSERT INTO users (telegram_id, first_name, last_name, username, phone_number, registered_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      username = excluded.username,
      phone_number = excluded.phone_number
  `).run(telegramId, firstName, lastName, username, phoneNumber, new Date().toISOString());
}

export function saveProgress({ telegramId, currentIndex, currentDay, srsLearned, srsReviewed }) {
  db.prepare(`
    INSERT INTO progress (telegram_id, current_index, current_day, srs_learned, srs_reviewed, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      current_index = excluded.current_index,
      current_day = excluded.current_day,
      srs_learned = excluded.srs_learned,
      srs_reviewed = excluded.srs_reviewed,
      updated_at = excluded.updated_at
  `).run(telegramId, currentIndex, currentDay, JSON.stringify(srsLearned || {}), JSON.stringify(srsReviewed || {}), new Date().toISOString());
}

export function loadProgress(telegramId) {
  const row = db.prepare('SELECT * FROM progress WHERE telegram_id = ?').get(telegramId);
  if (!row) return null;
  return {
    currentIndex: row.current_index,
    currentDay: row.current_day,
    srsLearned: JSON.parse(row.srs_learned || '{}'),
    srsReviewed: JSON.parse(row.srs_reviewed || '{}'),
    updatedAt: row.updated_at,
  };
}

export function resetProgress(telegramId) {
  db.prepare('DELETE FROM progress WHERE telegram_id = ?').run(telegramId);
}

export function logActivity(telegramId) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT OR IGNORE INTO activity_log (telegram_id, activity_date) VALUES (?, ?)').run(telegramId, today);
}

function isoDateNDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function getStats() {
  const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const today = isoDateNDaysAgo(0);
  const yesterday = isoDateNDaysAgo(1);
  const weekAgo = isoDateNDaysAgo(7);
  const activeOn = (date) => db.prepare('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log WHERE activity_date = ?').get(date).c;
  const activeSince = (date) => db.prepare('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log WHERE activity_date >= ?').get(date).c;
  const everActive = db.prepare('SELECT COUNT(DISTINCT telegram_id) c FROM activity_log').get().c;
  return {
    totalUsers,
    today: activeOn(today),
    yesterday: activeOn(yesterday),
    last7Days: activeSince(weekAgo),
    everActive,
  };
}

export function listUsers({ limit, offset }) {
  const total = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  const rows = db.prepare(`
    SELECT u.telegram_id, u.first_name, u.last_name, u.username, u.registered_at,
           p.current_index, p.current_day, p.updated_at
    FROM users u
    LEFT JOIN progress p ON p.telegram_id = u.telegram_id
    ORDER BY (p.updated_at IS NULL) ASC, p.updated_at DESC, u.registered_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
  return { rows, total };
}

export default db;
