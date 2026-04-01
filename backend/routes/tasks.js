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

// GET /api/tasks/today/:childId  — bugünün görevleri + tüm tamamlama durumları
router.get('/today/:childId', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const dow   = new Date().getDay();

  // Görevleri getir
  const tasks = db.prepare(`
    SELECT t.* FROM tasks t
    WHERE t.family_id = ?
      AND t.is_active = 1
      AND (
        t.recurrence = 'daily'
        OR (t.recurrence = 'weekdays' AND ? BETWEEN 1 AND 5)
        OR (t.recurrence = 'weekly'   AND ? = 1)
      )
    ORDER BY t.category, t.title
  `).all(req.user.family_id, dow, dow);

  // Bugünkü tüm completion'ları getir
  const completions = db.prepare(`
    SELECT * FROM completions
    WHERE child_id = ? AND due_date = ?
    ORDER BY completed_at ASC
  `).all(req.params.childId, today);

  const compByTask = {};
  completions.forEach(c => {
    if (!compByTask[c.task_id]) compByTask[c.task_id] = [];
    compByTask[c.task_id].push(c);
  });

  const parsed = tasks.map(t => {
    const allSubs   = JSON.parse(t.subtasks || '[]');
    const taskComps = compByTask[t.id] || [];

    // Tüm onaylanan ve bekleyen completion'lardan done subtask listesi birleştir
    const approvedDone = taskComps
      .filter(c => c.status === 'approved')
      .flatMap(c => JSON.parse(c.subtasks_done || '[]'));
    const pendingDone = taskComps
      .filter(c => c.status === 'pending')
      .flatMap(c => JSON.parse(c.subtasks_done || '[]'));

    // Tüm tamamlanan alt görevler (tekrar yok)
    const allDone = [...new Set([...approvedDone, ...pendingDone])];

    // En son pending completion (varsa)
    const latestPending = taskComps.find(c => c.status === 'pending');
    // En son approved
    const latestApproved = [...taskComps].reverse().find(c => c.status === 'approved');

    // Görevin genel durumu
    let overallStatus = null;
    if (allSubs.length === 0) {
      // Alt görev yok: tek completion'ı bak
      if (latestPending) overallStatus = 'pending';
      else if (latestApproved) overallStatus = 'approved';
    } else {
      // Alt görev var: hepsi tamamlandı mı?
      const remaining = allSubs.filter(s => !allDone.includes(s));
      if (remaining.length === 0 && allDone.length > 0) {
        overallStatus = latestPending ? 'pending' : 'approved';
      } else if (allDone.length > 0) {
        // Kısmi tamamlama
        overallStatus = latestPending ? 'pending' : (approvedDone.length > 0 ? 'partial' : null);
      }
    }

    return {
      ...t,
      subtasks: allSubs,
      completion: taskComps.length > 0 ? {
        id:            latestPending?.id || latestApproved?.id,
        status:        overallStatus,
        quality:       latestPending?.quality || latestApproved?.quality,
        pts:           taskComps.filter(c=>c.status==='approved').reduce((s,c)=>s+c.pts_awarded,0),
        subtasks_done: allDone,           // tüm tamamlananlar
        approved_done: approvedDone,      // sadece onaylananlar
        pending_done:  pendingDone,       // bekleyenler
      } : null
    };
  });

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
