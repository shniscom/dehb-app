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
app.use('/api/push',        require('./routes/push').router);

// ── OTOMATİK BİLDİRİM HOOK'LARI ──
// Completion onaylanınca çocuğa bildirim gönder
const { sendToUser } = require('./routes/push');
const db = require('./db');

app.patch('/api/completions/:id/approve', async (req, res, next) => {
  // Orijinal handler çalıştıktan sonra bildirim gönder
  res.on('finish', async () => {
    if (res.statusCode === 200) {
      try {
        await fetch(`http://localhost:${process.env.PORT||3000}/api/push/notify/task-approved`,
          { method:'POST', headers:{'Content-Type':'application/json','Authorization':req.headers.authorization||''},
            body: JSON.stringify({ completion_id: req.params.id }) });
      } catch(e) {}
    }
  });
  next();
});

// ── STATIC FRONTEND ──
const publicDir = path.join(__dirname, '..', 'frontend', 'public');

// Service Worker için doğru MIME type ve no-cache header'ı
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(publicDir, 'sw.js'));
});

// Manifest için doğru MIME type
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(publicDir, 'manifest.json'));
});

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
