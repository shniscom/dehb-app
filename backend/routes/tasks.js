// routes/tasks.js
const express = require('express');
const db = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/tasks  — aileye ait tüm aktif görevler
router.get('/', (req, res) => {
  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE family_id = ? AND is_active = 1 ORDER BY category, title'
  ).all(req.user.family_id);

  // subtasks JSON parse
  const parsed = tasks.map(t => ({ ...t, subtasks: JSON.parse(t.subtasks || '[]') }));
  res.json(parsed);
});

// GET /api/tasks/today/:childId  — bugünün görevleri + tamamlama durumu
router.get('/today/:childId', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const dow   = new Date().getDay(); // 0=Pazar, 1=Pzt ... 6=Cmt

  const tasks = db.prepare(`
    SELECT t.*,
      c.id        AS comp_id,
      c.status    AS comp_status,
      c.quality   AS comp_quality,
      c.pts_awarded AS comp_pts
    FROM tasks t
    LEFT JOIN completions c
      ON c.task_id = t.id
      AND c.child_id = ?
      AND c.due_date = ?
    WHERE t.family_id = ?
      AND t.is_active = 1
      AND (
        t.recurrence = 'daily'
        OR (t.recurrence = 'weekdays' AND ? BETWEEN 1 AND 5)
        OR (t.recurrence = 'weekly'   AND ? = 1)
      )
    ORDER BY t.category, t.title
  `).all(req.params.childId, today, req.user.family_id, dow, dow);

  const parsed = tasks.map(t => ({
    ...t,
    subtasks: JSON.parse(t.subtasks || '[]'),
    completion: t.comp_id ? {
      id: t.comp_id, status: t.comp_status,
      quality: t.comp_quality, pts: t.comp_pts
    } : null
  }));

  res.json(parsed);
});

// POST /api/tasks  — yeni görev oluştur (sadece ebeveyn)
router.post('/', parentOnly, (req, res) => {
  const { title, description, icon, category, recurrence, duration_min,
          pts_base, pts_great, pts_good, pts_late, pts_skip,
          requires_photo, subtasks } = req.body;

  if (!title || !category || !recurrence)
    return res.status(400).json({ error: 'Zorunlu alanlar eksik' });

  const result = db.prepare(`
    INSERT INTO tasks
      (family_id, title, description, icon, category, recurrence, duration_min,
       pts_base, pts_great, pts_good, pts_late, pts_skip, requires_photo, subtasks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    req.user.family_id,
    title, description || null,
    icon || '📋', category, recurrence,
    duration_min || 15,
    pts_base || 10, pts_great || 10, pts_good || 5,
    pts_late || -3, pts_skip || -5,
    requires_photo ? 1 : 0,
    JSON.stringify(subtasks || [])
  );

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json({ ...task, subtasks: JSON.parse(task.subtasks) });
});

// PUT /api/tasks/:id  — güncelle (sadece ebeveyn)
router.put('/:id', parentOnly, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=? AND family_id=?')
    .get(req.params.id, req.user.family_id);
  if (!task) return res.status(404).json({ error: 'Görev bulunamadı' });

  const fields = ['title','description','icon','category','recurrence','duration_min',
                  'pts_base','pts_great','pts_good','pts_late','pts_skip','requires_photo'];
  const updates = {};
  fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (req.body.subtasks) updates.subtasks = JSON.stringify(req.body.subtasks);

  if (!Object.keys(updates).length) return res.json(task);

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`)
    .run(...Object.values(updates), req.params.id);

  const updated = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  res.json({ ...updated, subtasks: JSON.parse(updated.subtasks) });
});

// DELETE /api/tasks/:id  — soft delete
router.delete('/:id', parentOnly, (req, res) => {
  db.prepare('UPDATE tasks SET is_active=0 WHERE id=? AND family_id=?')
    .run(req.params.id, req.user.family_id);
  res.json({ ok: true });
});

module.exports = router;
