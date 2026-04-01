// routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'degistir-bunu-production-da';

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email ve şifre gerekli' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Email veya şifre hatalı' });

  const token = jwt.sign(
    { id: user.id, family_id: user.family_id, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '30d' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, avatar: user.avatar, family_id: user.family_id }
  });
});

// POST /api/auth/child-login  (çocuk için PIN veya isim bazlı giriş)
router.post('/child-login', (req, res) => {
  const { child_id, family_id } = req.body;
  const child = db.prepare(
    "SELECT * FROM users WHERE id = ? AND family_id = ? AND role = 'child'"
  ).get(child_id, family_id);

  if (!child) return res.status(404).json({ error: 'Çocuk bulunamadı' });

  const token = jwt.sign(
    { id: child.id, family_id: child.family_id, role: 'child', name: child.name },
    SECRET,
    { expiresIn: '90d' }
  );

  res.json({
    token,
    user: { id: child.id, name: child.name, role: 'child', avatar: child.avatar,
            age_group: child.age_group, family_id: child.family_id }
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id,name,role,avatar,age_group,family_id,total_points FROM users WHERE id=?')
    .get(req.user.id);
  res.json(user);
});

// GET /api/auth/children?family_id=1  — token gerektirmez, sadece family_id ile çocukları listele
router.get('/children', (req, res) => {
  const family_id = req.query.family_id;
  if (!family_id) return res.status(400).json({ error: 'family_id gerekli' });

  const children = db.prepare(
    "SELECT id,name,avatar,age_group,total_points FROM users WHERE family_id=? AND role='child' ORDER BY id"
  ).all(family_id);

  res.json(children);
});

module.exports = router;
