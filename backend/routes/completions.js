// routes/completions.js
const express = require('express');
const db      = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');
const { calcPoints, calcSubtaskPoints, calcTotal } = require('../utils/points');

const router = express.Router();
router.use(authMiddleware);

// POST /api/completions — çocuk görevi tamamladı
router.post('/', (req, res) => {
  const { task_id, quality, was_late, photo_url, subtasks_done } = req.body;
  if (!task_id) return res.status(400).json({ error: 'task_id gerekli' });
  const today = new Date().toISOString().split('T')[0];

  const existing = db.prepare(
    "SELECT id FROM completions WHERE task_id=? AND child_id=? AND due_date=? AND status != 'rejected'"
  ).get(task_id, req.user.id, today);
  if (existing) return res.status(409).json({ error: 'Bu görev bugün zaten tamamlandı' });

  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(task_id);
  if (!task) return res.status(404).json({ error: 'Görev bulunamadı' });

  const allSubtasks  = JSON.parse(task.subtasks || '[]');
  const doneSubtasks = subtasks_done || [];

  // Alt görev bazlı puan hesapla
  const pts = calcPoints(task, quality || 'ok', allSubtasks, doneSubtasks);

  const result = db.prepare(`
    INSERT INTO completions (task_id,child_id,quality,was_late,pts_awarded,photo_url,subtasks_done,due_date)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(task_id, req.user.id, quality||'ok', was_late?1:0, pts,
         photo_url||null, JSON.stringify(doneSubtasks), today);

  // Alt görev puan dağılımını da döndür (UI'da göstermek için)
  const subtaskPts = calcSubtaskPoints(task.pts_base, allSubtasks.length);
  const subtaskBreakdown = allSubtasks.map((s, i) => ({
    name: s,
    pts: subtaskPts[i] || 0,
    done: doneSubtasks.includes(s)
  }));

  res.status(201).json({
    id: result.lastInsertRowid,
    status: 'pending',
    pts_preview: pts,
    subtask_breakdown: subtaskBreakdown,
    done_count: doneSubtasks.length,
    total_count: allSubtasks.length
  });
});

// GET /api/completions/pending
router.get('/pending', parentOnly, (req, res) => {
  const pending = db.prepare(`
    SELECT c.*, t.title, t.icon, t.category, t.subtasks,
           t.pts_base, t.pts_great, t.pts_good, t.pts_late,
           u.name AS child_name, u.avatar AS child_avatar
    FROM completions c
    JOIN tasks t ON t.id=c.task_id
    JOIN users u ON u.id=c.child_id
    WHERE t.family_id=? AND c.status='pending'
    ORDER BY c.completed_at DESC
  `).all(req.user.family_id);

  res.json(pending.map(p => {
    const allSubs  = JSON.parse(p.subtasks || '[]');
    const doneSubs = JSON.parse(p.subtasks_done || '[]');
    const subtaskPts = calcSubtaskPoints(p.pts_base, allSubs.length);
    return {
      ...p,
      subtasks:      allSubs,
      subtasks_done: doneSubs,
      subtask_breakdown: allSubs.map((s, i) => ({
        name: s, pts: subtaskPts[i] || 0, done: doneSubs.includes(s)
      }))
    };
  }));
});

// GET /api/completions/history/:childId
router.get('/history/:childId', (req, res) => {
  const limit = parseInt(req.query.limit) || 30;
  const rows = db.prepare(`
    SELECT c.*, t.title, t.icon, t.category
    FROM completions c JOIN tasks t ON t.id=c.task_id
    WHERE c.child_id=? ORDER BY c.completed_at DESC LIMIT ?
  `).all(req.params.childId, limit);
  res.json(rows.map(h => ({ ...h, subtasks_done: JSON.parse(h.subtasks_done || '[]') })));
});

// GET /api/completions/calendar/:childId
router.get('/calendar/:childId', (req, res) => {
  const { start, end } = req.query;
  const today = new Date().toISOString().split('T')[0];
  const startDate = start || (() => { const d=new Date(); d.setDate(d.getDate()-6); return d.toISOString().split('T')[0]; })();
  const endDate = end || today;

  const rows = db.prepare(`
    SELECT c.due_date, c.status, c.pts_awarded, c.quality,
           t.id as task_id, t.title, t.icon, t.category
    FROM completions c JOIN tasks t ON t.id=c.task_id
    WHERE c.child_id=? AND c.due_date BETWEEN ? AND ?
    ORDER BY c.due_date, t.title
  `).all(req.params.childId, startDate, endDate);

  const result = {};
  rows.forEach(r => {
    if (!result[r.due_date]) result[r.due_date] = {};
    result[r.due_date][r.task_id] = { status:r.status, pts:r.pts_awarded, quality:r.quality, title:r.title, icon:r.icon };
  });
  res.json(result);
});

// PATCH /api/completions/:id/approve — ebeveyn onaylar
router.patch('/:id/approve', parentOnly, (req, res) => {
  const { quality, parent_note, behavior_bonus, behavior_note, subtasks_override } = req.body;

  const comp = db.prepare(`
    SELECT c.*, t.pts_base, t.pts_great, t.pts_good, t.pts_late, t.pts_skip, t.subtasks
    FROM completions c JOIN tasks t ON t.id=c.task_id WHERE c.id=?
  `).get(req.params.id);

  if (!comp)                     return res.status(404).json({ error: 'Tamamlama bulunamadı' });
  if (comp.status !== 'pending') return res.status(400).json({ error: 'Bu onay zaten işlendi' });

  const finalQuality = quality || comp.quality || 'ok';
  const allSubtasks  = JSON.parse(comp.subtasks || '[]');

  // Ebeveyn alt görevleri override ettiyse onu kullan, yoksa çocuğunkini
  const doneSubs = subtasks_override !== undefined
    ? (Array.isArray(subtasks_override) ? subtasks_override : [])
    : JSON.parse(comp.subtasks_done || '[]');

  // Alt görev bazlı puan hesapla
  let pts = calcPoints(comp, finalQuality, allSubtasks, doneSubs);

  // Davranış bonusu: max %50 bonus, max %30 ceza
  const maxBonus   = Math.round(comp.pts_base * 0.5);
  const maxPenalty = Math.round(comp.pts_base * 0.3);
  let bonus = parseInt(behavior_bonus) || 0;
  if (bonus >  maxBonus)   bonus = maxBonus;
  if (bonus < -maxPenalty) bonus = -maxPenalty;
  pts = Math.max(0, pts + bonus);

  const now = new Date().toISOString();

  db.transaction(() => {
    db.prepare(`
      UPDATE completions
      SET status='approved', quality=?, pts_awarded=?, parent_note=?, approved_at=?,
          behavior_bonus=?, behavior_note=?, subtasks_done=?
      WHERE id=?
    `).run(finalQuality, pts, parent_note||null, now, bonus, behavior_note||null,
           JSON.stringify(doneSubs), comp.id);

    db.prepare(`INSERT INTO point_ledger (child_id,delta,reason,source_type,source_id) VALUES (?,?,?,'completion',?)`)
      .run(comp.child_id, pts, `Görev onayı: ${comp.id}`, comp.id);

    const total = calcTotal(db, comp.child_id);
    db.prepare('UPDATE users SET total_points=? WHERE id=?').run(total, comp.child_id);
  })();

  res.json({ ok:true, pts_awarded:pts, behavior_bonus:bonus, new_total:calcTotal(db, comp.child_id) });
});

// PATCH /api/completions/:id/reject
router.patch('/:id/reject', parentOnly, (req, res) => {
  db.prepare("UPDATE completions SET status='rejected', parent_note=?, approved_at=? WHERE id=?")
    .run(req.body.parent_note||null, new Date().toISOString(), req.params.id);
  res.json({ ok:true });
});

// DELETE /api/completions/reactivate/:taskId
router.delete('/reactivate/:taskId', parentOnly, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { child_id } = req.query;
  if (!child_id) return res.status(400).json({ error: 'child_id gerekli' });

  const comp = db.prepare(`
    SELECT c.* FROM completions c JOIN tasks t ON t.id=c.task_id
    WHERE c.task_id=? AND c.child_id=? AND c.due_date=? AND t.family_id=?
  `).get(req.params.taskId, child_id, today, req.user.family_id);

  if (!comp) return res.status(404).json({ error: 'Bugün için tamamlama kaydı bulunamadı' });

  db.transaction(() => {
    if (comp.status === 'approved' && comp.pts_awarded > 0) {
      db.prepare(`INSERT INTO point_ledger (child_id,delta,reason,source_type,source_id) VALUES (?,?,'Görev reaktive edildi','manual',?)`)
        .run(comp.child_id, -comp.pts_awarded, comp.id);
      const total = calcTotal(db, comp.child_id);
      db.prepare('UPDATE users SET total_points=? WHERE id=?').run(total, comp.child_id);
    }
    db.prepare('DELETE FROM completions WHERE id=?').run(comp.id);
  })();

  res.json({ ok:true, pts_reversed: comp.status==='approved' ? comp.pts_awarded : 0 });
});

module.exports = router;
