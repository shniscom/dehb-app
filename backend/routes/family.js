// routes/family.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, parentOnly);

// ── EBEVEYN PROFİL GÜNCELLEME ──

// PUT /api/family/parent/profile
router.put('/parent/profile', (req, res) => {
  const { name, email } = req.body;
  if (!name && !email)
    return res.status(400).json({ error: 'En az bir alan gerekli' });

  // Email başkası tarafından kullanılıyor mu?
  if (email) {
    const existing = db.prepare(
      'SELECT id FROM users WHERE email=? AND id != ?'
    ).get(email, req.user.id);
    if (existing) return res.status(409).json({ error: 'Bu email zaten kullanılıyor' });
  }

  db.prepare(`
    UPDATE users
    SET name  = COALESCE(?, name),
        email = COALESCE(?, email)
    WHERE id = ?
  `).run(name || null, email || null, req.user.id);

  const updated = db.prepare(
    'SELECT id, name, email, role, avatar FROM users WHERE id=?'
  ).get(req.user.id);
  res.json(updated);
});

// PUT /api/family/parent/password
router.put('/parent/password', (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Mevcut ve yeni şifre gerekli' });
  if (new_password.length < 6)
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password))
    return res.status(401).json({ error: 'Mevcut şifre hatalı' });

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, req.user.id);
  res.json({ ok: true, message: 'Şifre güncellendi' });
});

// PUT /api/family/parent/avatar
router.put('/parent/avatar', (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'Avatar gerekli' });
  db.prepare('UPDATE users SET avatar=? WHERE id=?').run(avatar, req.user.id);
  res.json({ ok: true });
});

// ── ÇOCUK YÖNETİMİ ──

// GET /api/family/children
router.get('/children', (req, res) => {
  const children = db.prepare(`
    SELECT u.id, u.name, u.avatar, u.age_group, u.total_points,
      (SELECT COUNT(*) FROM completions c WHERE c.child_id=u.id) as total_completions,
      (SELECT COUNT(*) FROM completions c WHERE c.child_id=u.id AND c.status='approved') as approved_completions,
      u.created_at
    FROM users u
    WHERE u.family_id=? AND u.role='child'
    ORDER BY u.created_at ASC
  `).all(req.user.family_id);
  res.json(children);
});

// POST /api/family/children  — yeni çocuk ekle
router.post('/children', (req, res) => {
  const { name, age_group, avatar } = req.body;
  if (!name) return res.status(400).json({ error: 'İsim gerekli' });
  if (!['young','teen'].includes(age_group))
    return res.status(400).json({ error: 'age_group: young veya teen olmalı' });

  const result = db.prepare(`
    INSERT INTO users (family_id, name, role, age_group, avatar)
    VALUES (?, ?, 'child', ?, ?)
  `).run(req.user.family_id, name.trim(), age_group, avatar || '🦸');

  const child = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(child);
});

// PUT /api/family/children/:id  — çocuk bilgisi güncelle
router.put('/children/:id', (req, res) => {
  const { name, age_group, avatar } = req.body;

  // Aynı aileye ait mi kontrol et
  const child = db.prepare(
    "SELECT * FROM users WHERE id=? AND family_id=? AND role='child'"
  ).get(req.params.id, req.user.family_id);
  if (!child) return res.status(404).json({ error: 'Çocuk bulunamadı' });

  if (age_group && !['young','teen'].includes(age_group))
    return res.status(400).json({ error: 'age_group: young veya teen olmalı' });

  db.prepare(`
    UPDATE users
    SET name      = COALESCE(?, name),
        age_group = COALESCE(?, age_group),
        avatar    = COALESCE(?, avatar)
    WHERE id=?
  `).run(name || null, age_group || null, avatar || null, req.params.id);

  const updated = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/family/children/:id  — çocuk sil
router.delete('/children/:id', (req, res) => {
  const child = db.prepare(
    "SELECT * FROM users WHERE id=? AND family_id=? AND role='child'"
  ).get(req.params.id, req.user.family_id);
  if (!child) return res.status(404).json({ error: 'Çocuk bulunamadı' });

  // Soft delete yerine hard delete — tüm ilgili verileri temizle
  db.transaction(() => {
    db.prepare('DELETE FROM point_ledger   WHERE child_id=?').run(req.params.id);
    db.prepare('DELETE FROM reward_claims  WHERE child_id=?').run(req.params.id);
    db.prepare('DELETE FROM completions    WHERE child_id=?').run(req.params.id);
    db.prepare('DELETE FROM push_subscriptions WHERE user_id=?').run(req.params.id);
    db.prepare('DELETE FROM users          WHERE id=?').run(req.params.id);
  })();

  res.json({ ok: true });
});

// POST /api/family/children/:id/reset-points  — puanları sıfırla
router.post('/children/:id/reset-points', (req, res) => {
  const child = db.prepare(
    "SELECT * FROM users WHERE id=? AND family_id=? AND role='child'"
  ).get(req.params.id, req.user.family_id);
  if (!child) return res.status(404).json({ error: 'Çocuk bulunamadı' });

  db.transaction(() => {
    db.prepare('DELETE FROM point_ledger WHERE child_id=?').run(req.params.id);
    db.prepare('UPDATE users SET total_points=0 WHERE id=?').run(req.params.id);
  })();

  res.json({ ok: true });
});

// GET /api/family/children/:id/stats  — çocuk istatistikleri
router.get('/children/:id/stats', (req, res) => {
  const child = db.prepare(
    "SELECT id, name, avatar, age_group, total_points, created_at FROM users WHERE id=? AND family_id=?"
  ).get(req.params.id, req.user.family_id);
  if (!child) return res.status(404).json({ error: 'Çocuk bulunamadı' });

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) as pending,
      COALESCE(SUM(pts_awarded),0) as total_pts_earned
    FROM completions WHERE child_id=?
  `).get(req.params.id);

  res.json({ child, stats });
});

module.exports = router;
