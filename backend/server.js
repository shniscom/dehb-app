// server.js — Ana Express sunucusu
require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const path     = require('path');

const app = express();

// ── MIDDLEWARE ──
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── API ROUTES ──
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/family',      require('./routes/family'));
app.use('/api/tasks',       require('./routes/tasks'));
app.use('/api/completions', require('./routes/completions'));
app.use('/api/rewards',     require('./routes/rewards'));
app.use('/api/reports',     require('./routes/reports'));

// ── STATIC FRONTEND ──
// Production'da frontend dosyaları /public klasöründen servis edilir
const publicDir = path.join(__dirname, '..', 'frontend', 'public');
app.use(express.static(publicDir));

// SPA fallback — tüm bilinmeyen route'lar index.html'e döner
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── HEALTH CHECK ──
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── ERROR HANDLER ──
app.use((err, req, res, next) => {
  console.error('❌ Sunucu hatası:', err.message);
  res.status(500).json({ error: 'Sunucu hatası', detail: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Görev Kahramanı sunucusu çalışıyor: http://localhost:${PORT}`);
  console.log(`📁 Veritabanı: ${process.env.DB_DIR || './data'}/dehb.db`);
});
