// middleware/auth.js
const jwt = require('jsonwebtoken');
const SECRET = process.env.JWT_SECRET || 'degistir-bunu-production-da';

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token gerekli' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Geçersiz token' });
  }
}

function parentOnly(req, res, next) {
  if (req.user.role !== 'parent') {
    return res.status(403).json({ error: 'Bu işlem sadece ebeveyne izinli' });
  }
  next();
}

module.exports = { authMiddleware, parentOnly };
