// routes/rewards.js
const express = require('express');
const db      = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');
const { calcTotal } = require('../utils/points');

const router = express.Router();
router.use(authMiddleware);

// GET /api/rewards
router.get('/', (req, res) => {
  const rewards = db.prepare(
    'SELECT * FROM rewards WHERE family_id=? AND is_active=1 ORDER BY pts_required'
  ).all(req.user.family_id);
  res.json(rewards);
});

// POST /api/rewards  (ebeveyn)
router.post('/', parentOnly, (req, res) => {
  const { title, icon, pts_required, stock } = req.body;
  if (!title || !pts_required) return res.status(400).json({ error: 'Zorunlu alan eksik' });

  const result = db.prepare(`
    INSERT INTO rewards (family_id, title, icon, pts_required, stock)
    VALUES (?,?,?,?,?)
  `).run(req.user.family_id, title, icon || '🎁', pts_required, stock || 0);

  res.status(201).json(db.prepare('SELECT * FROM rewards WHERE id=?').get(result.lastInsertRowid));
});

// PUT /api/rewards/:id  (ebeveyn)
router.put('/:id', parentOnly, (req, res) => {
  const { title, icon, pts_required, stock, is_active } = req.body;
  db.prepare(`
    UPDATE rewards SET title=COALESCE(?,title), icon=COALESCE(?,icon),
      pts_required=COALESCE(?,pts_required), stock=COALESCE(?,stock),
      is_active=COALESCE(?,is_active)
    WHERE id=? AND family_id=?
  `).run(title, icon, pts_required, stock, is_active, req.params.id, req.user.family_id);
  res.json(db.prepare('SELECT * FROM rewards WHERE id=?').get(req.params.id));
});

// DELETE /api/rewards/:id  (ebeveyn)
router.delete('/:id', parentOnly, (req, res) => {
  db.prepare('UPDATE rewards SET is_active=0 WHERE id=? AND family_id=?')
    .run(req.params.id, req.user.family_id);
  res.json({ ok: true });
});

// POST /api/rewards/:id/claim  — çocuk ödül talep eder
router.post('/:id/claim', (req, res) => {
  const reward = db.prepare('SELECT * FROM rewards WHERE id=? AND is_active=1').get(req.params.id);
  if (!reward) return res.status(404).json({ error: 'Ödül bulunamadı' });

  const total = calcTotal(db, req.user.id);
  if (total < reward.pts_required)
    return res.status(400).json({ error: 'Yeterli puan yok', current: total, required: reward.pts_required });

  const result = db.prepare(`
    INSERT INTO reward_claims (reward_id, child_id) VALUES (?,?)
  `).run(reward.id, req.user.id);

  res.status(201).json({ id: result.lastInsertRowid, status: 'pending' });
});

// GET /api/rewards/claims/pending  (ebeveyn)
router.get('/claims/pending', parentOnly, (req, res) => {
  const claims = db.prepare(`
    SELECT rc.*, r.title, r.icon, r.pts_required,
           u.name AS child_name
    FROM reward_claims rc
    JOIN rewards r ON r.id = rc.reward_id
    JOIN users u   ON u.id = rc.child_id
    WHERE r.family_id = ? AND rc.status = 'pending'
    ORDER BY rc.claimed_at DESC
  `).all(req.user.family_id);
  res.json(claims);
});

// PATCH /api/rewards/claims/:id/approve  (ebeveyn)
router.patch('/claims/:id/approve', parentOnly, (req, res) => {
  const claim = db.prepare(`
    SELECT rc.*, r.pts_required
    FROM reward_claims rc JOIN rewards r ON r.id=rc.reward_id
    WHERE rc.id=?
  `).get(req.params.id);
  if (!claim) return res.status(404).json({ error: 'Talep bulunamadı' });

  db.transaction(() => {
    db.prepare("UPDATE reward_claims SET status='approved', approved_at=? WHERE id=?")
      .run(new Date().toISOString(), claim.id);

    // Puanı düş
    db.prepare(`
      INSERT INTO point_ledger (child_id, delta, reason, source_type, source_id)
      VALUES (?,?,?,'reward',?)
    `).run(claim.child_id, -claim.pts_required, `Ödül: ${claim.id}`, claim.id);

    const total = calcTotal(db, claim.child_id);
    db.prepare('UPDATE users SET total_points=? WHERE id=?').run(total, claim.child_id);
  })();

  res.json({ ok: true });
});

module.exports = router;
