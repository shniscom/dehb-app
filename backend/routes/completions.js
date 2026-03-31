// routes/completions.js
const express = require('express');
const db      = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');
const { calcPoints, calcTotal }      = require('../utils/points');

const router = express.Router();
router.use(authMiddleware);

// POST /api/completions  — çocuk görevi tamamladı (onay bekliyor)
router.post('/', (req, res) => {
  const { task_id, quality, was_late, photo_url } = req.body;
  if (!task_id) return res.status(400).json({ error: 'task_id gerekli' });

  const today = new Date().toISOString().split('T')[0];

  // Aynı görev bugün zaten tamamlandı mı?
  const existing = db.prepare(
    "SELECT id FROM completions WHERE task_id=? AND child_id=? AND due_date=? AND status != 'rejected'"
  ).get(task_id, req.user.id, today);
  if (existing) return res.status(409).json({ error: 'Bu görev bugün zaten tamamlandı' });

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(task_id);
  if (!task) return res.status(404).json({ error: 'Görev bulunamadı' });

  // Puan hesabı (ön tahmin — ebeveyn onaylayınca kesinleşir)
  const pts = calcPoints(task, quality || 'ok');

  const result = db.prepare(`
    INSERT INTO completions (task_id, child_id, quality, was_late, pts_awarded, photo_url, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(task_id, req.user.id, quality || 'ok', was_late ? 1 : 0, pts, photo_url || null, today);

  res.status(201).json({
    id: result.lastInsertRowid,
    status: 'pending',
    pts_preview: pts,
    message: 'Görev onay bekliyor!'
  });
});

// GET /api/completions/pending  — ebeveyn: onay bekleyenler
router.get('/pending', parentOnly, (req, res) => {
  const pending = db.prepare(`
    SELECT c.*, t.title, t.icon, t.category,
           u.name AS child_name, u.avatar AS child_avatar
    FROM completions c
    JOIN tasks t ON t.id = c.task_id
    JOIN users u ON u.id = c.child_id
    WHERE t.family_id = ? AND c.status = 'pending'
    ORDER BY c.completed_at DESC
  `).all(req.user.family_id);
  res.json(pending);
});

// GET /api/completions/history/:childId  — geçmiş
router.get('/history/:childId', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const history = db.prepare(`
    SELECT c.*, t.title, t.icon, t.category
    FROM completions c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.child_id = ?
    ORDER BY c.completed_at DESC
    LIMIT ?
  `).all(req.params.childId, limit);
  res.json(history);
});

// PATCH /api/completions/:id/approve  — ebeveyn onaylar
router.patch('/:id/approve', parentOnly, (req, res) => {
  const { quality, parent_note } = req.body;

  const comp = db.prepare(`
    SELECT c.*, t.pts_base, t.pts_great, t.pts_good, t.pts_late, t.pts_skip
    FROM completions c JOIN tasks t ON t.id = c.task_id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!comp)          return res.status(404).json({ error: 'Tamamlama bulunamadı' });
  if (comp.status !== 'pending') return res.status(400).json({ error: 'Bu onay zaten işlendi' });

  // Ebeveyn kaliteyi değiştirebilir
  const finalQuality = quality || comp.quality || 'ok';
  const pts = calcPoints(comp, finalQuality);

  const now = new Date().toISOString();

  // Transaction: completion güncelle + ledger yaz + user total güncelle
  db.transaction(() => {
    db.prepare(`
      UPDATE completions
      SET status='approved', quality=?, pts_awarded=?, parent_note=?, approved_at=?
      WHERE id=?
    `).run(finalQuality, pts, parent_note || null, now, comp.id);

    db.prepare(`
      INSERT INTO point_ledger (child_id, delta, reason, source_type, source_id)
      VALUES (?, ?, ?, 'completion', ?)
    `).run(comp.child_id, pts, `Görev onayı: ${comp.id}`, comp.id);

    // total_points kolonu hız için cache — asıl kaynak ledger
    const total = calcTotal(db, comp.child_id);
    db.prepare('UPDATE users SET total_points=? WHERE id=?').run(total, comp.child_id);
  })();

  res.json({ ok: true, pts_awarded: pts, new_total: calcTotal(db, comp.child_id) });
});

// PATCH /api/completions/:id/reject  — ebeveyn reddeder
router.patch('/:id/reject', parentOnly, (req, res) => {
  const { parent_note } = req.body;
  db.prepare(`
    UPDATE completions SET status='rejected', parent_note=?, approved_at=?
    WHERE id=?
  `).run(parent_note || null, new Date().toISOString(), req.params.id);
  res.json({ ok: true });
});

module.exports = router;
