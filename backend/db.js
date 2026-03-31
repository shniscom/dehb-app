// db.js — Veritabanı bağlantısı ve şema kurulumu
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'dehb.db');

// data klasörü yoksa oluştur
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);

// WAL modu — eş zamanlı okuma/yazma için
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── ŞEMA ──
db.exec(`
  -- Aileler
  CREATE TABLE IF NOT EXISTS families (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Kullanıcılar (ebeveyn + çocuk)
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id   INTEGER NOT NULL REFERENCES families(id),
    name        TEXT NOT NULL,
    email       TEXT UNIQUE,
    password    TEXT,               -- sadece ebeveynde
    role        TEXT NOT NULL CHECK(role IN ('parent','child')),
    age_group   TEXT CHECK(age_group IN ('young','teen')),
    avatar      TEXT DEFAULT '🦸',
    total_points INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Görevler
  CREATE TABLE IF NOT EXISTS tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id       INTEGER NOT NULL REFERENCES families(id),
    title           TEXT NOT NULL,
    description     TEXT,
    icon            TEXT DEFAULT '📋',
    category        TEXT NOT NULL CHECK(category IN ('rutin','ev','okul','hareket','sosyal','bakim')),
    recurrence      TEXT NOT NULL CHECK(recurrence IN ('daily','weekdays','weekly','custom')),
    duration_min    INTEGER NOT NULL DEFAULT 15,
    pts_base        INTEGER NOT NULL DEFAULT 10,
    pts_great       INTEGER NOT NULL DEFAULT 10,
    pts_good        INTEGER NOT NULL DEFAULT 5,
    pts_late        INTEGER NOT NULL DEFAULT -3,
    pts_skip        INTEGER NOT NULL DEFAULT -5,
    requires_photo  INTEGER DEFAULT 0,
    is_active       INTEGER DEFAULT 1,
    subtasks        TEXT DEFAULT '[]',   -- JSON array
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- Görev tamamlamaları
  CREATE TABLE IF NOT EXISTS completions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id         INTEGER NOT NULL REFERENCES tasks(id),
    child_id        INTEGER NOT NULL REFERENCES users(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','approved','rejected')),
    quality         TEXT CHECK(quality IN ('great','good','ok','late')),
    was_late        INTEGER DEFAULT 0,
    pts_awarded     INTEGER DEFAULT 0,
    photo_url       TEXT,
    parent_note     TEXT,
    completed_at    TEXT DEFAULT (datetime('now')),
    approved_at     TEXT,
    due_date        TEXT    -- görevin yapılması gereken gün (YYYY-MM-DD)
  );

  -- Puan defteri (append-only)
  CREATE TABLE IF NOT EXISTS point_ledger (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    child_id    INTEGER NOT NULL REFERENCES users(id),
    delta       INTEGER NOT NULL,
    reason      TEXT,
    source_type TEXT CHECK(source_type IN ('completion','reward','manual','bonus')),
    source_id   INTEGER,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  -- Ödüller
  CREATE TABLE IF NOT EXISTS rewards (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id       INTEGER NOT NULL REFERENCES families(id),
    title           TEXT NOT NULL,
    icon            TEXT DEFAULT '🎁',
    pts_required    INTEGER NOT NULL,
    stock           INTEGER DEFAULT 0,  -- 0 = sınırsız
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now'))
  );

  -- Ödül talepleri
  CREATE TABLE IF NOT EXISTS reward_claims (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    reward_id   INTEGER NOT NULL REFERENCES rewards(id),
    child_id    INTEGER NOT NULL REFERENCES users(id),
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    claimed_at  TEXT DEFAULT (datetime('now')),
    approved_at TEXT
  );

  -- Push bildirim abonelikleri
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    subscription TEXT NOT NULL,  -- JSON
    created_at  TEXT DEFAULT (datetime('now'))
  );
`);

// ── ÖRNEK VERİ (ilk kurulumda) ──
const seedCheck = db.prepare('SELECT COUNT(*) as cnt FROM families').get();
if (seedCheck.cnt === 0) {
  const insertFamily = db.prepare('INSERT INTO families (name) VALUES (?)');
  const fam = insertFamily.run('Demo Aile');

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('demo123', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (family_id, name, email, password, role, age_group, avatar)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertUser.run(fam.lastInsertRowid, 'Ebeveyn', 'ebeveyn@demo.com', hash, 'parent', null, '👨');
  const child = insertUser.run(fam.lastInsertRowid, 'Ali', null, null, 'child', 'young', '🦸');
  const child2 = insertUser.run(fam.lastInsertRowid, 'Ayşe', null, null, 'child', 'young', '🦋');

  const insertTask = db.prepare(`
    INSERT INTO tasks (family_id, title, icon, category, recurrence, duration_min,
      pts_base, pts_great, pts_good, pts_late, pts_skip, subtasks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertTask.run(fam.lastInsertRowid,'Diş Fırçalama','🦷','rutin','daily',5,10,5,3,-3,-5,
    JSON.stringify(['Fırçayı ıslatmak','2 dk fırçalamak','Ağzı çalkalamak']));
  insertTask.run(fam.lastInsertRowid,'Oda Toplama','🧹','ev','daily',15,10,10,5,-5,-10,
    JSON.stringify(['Yatağı düzelt','Oyuncakları topla','Masayı sil']));
  insertTask.run(fam.lastInsertRowid,'Matematik Ödevi','📐','okul','weekdays',20,15,10,5,-5,-15,
    JSON.stringify(['Soruları çöz','Kontrol et']));
  insertTask.run(fam.lastInsertRowid,'30 Dk Egzersiz','⚽','hareket','daily',30,12,8,4,-4,-10,
    JSON.stringify(['Isınma','Ana egzersiz','Soğuma']));

  const insertReward = db.prepare(`
    INSERT INTO rewards (family_id, title, icon, pts_required, stock)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertReward.run(fam.lastInsertRowid,'Ekstra Oyun Vakti','🎮',50,0);
  insertReward.run(fam.lastInsertRowid,'Dondurma','🍦',80,3);
  insertReward.run(fam.lastInsertRowid,'Film Gecesi','🎬',120,0);
  insertReward.run(fam.lastInsertRowid,'Park Gezisi','🎡',200,0);

  console.log('✅ Demo verisi oluşturuldu.');
  console.log('   Giriş: ebeveyn@demo.com / demo123');
}

module.exports = db;
