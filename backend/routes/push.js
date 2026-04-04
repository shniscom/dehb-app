// routes/push.js — Push bildirimleri (Firebase Admin SDK)
const express = require('express');
const db      = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Firebase Admin başlat ──
let firebaseAdmin = null;
function getAdmin() {
  if (firebaseAdmin) return firebaseAdmin;
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      let serviceAccount = null;

      // Önce base64 formatını dene (Coolify için önerilen)
      if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decoded);
      }
      // Sonra düz JSON formatını dene
      else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      }

      if (!serviceAccount) {
        console.warn('[Push] Firebase service account bulunamadı — push devre dışı');
        return null;
      }
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
    firebaseAdmin = admin;
    return admin;
  } catch(e) {
    console.warn('[Push] Firebase Admin yüklenemedi:', e.message);
    return null;
  }
}

// ── YARDIMCI: Kullanıcıya bildirim gönder ──
async function sendToUser(userId, { title, body, url, tag, data = {} }) {
  const admin = getAdmin();
  if (!admin) return { sent: 0, error: 'Firebase yapılandırılmamış' };

  const tokens = db.prepare('SELECT token FROM push_tokens WHERE user_id=?').all(userId);
  if (!tokens.length) return { sent: 0, error: 'Token yok' };

  let sent = 0;
  const invalidTokens = [];

  for (const row of tokens) {
    try {
      await admin.messaging().send({
        token: row.token,
        notification: { title, body },
        webpush: {
          fcmOptions: { link: url || '/' },
          notification: {
            title, body,
            icon:  '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag:   tag || 'gk',
            data:  { url: url || '/', ...data },
          },
        },
      });
      sent++;
    } catch(e) {
      if (e.code === 'messaging/registration-token-not-registered') {
        invalidTokens.push(row.token);
      }
    }
  }

  // Geçersiz token'ları temizle
  if (invalidTokens.length) {
    const del = db.prepare('DELETE FROM push_tokens WHERE user_id=? AND token=?');
    invalidTokens.forEach(t => del.run(userId, t));
  }

  // Log
  db.prepare(`INSERT INTO push_log (user_id,type,title,body,success) VALUES (?,?,?,?,?)`)
    .run(userId, tag||'general', title, body, sent > 0 ? 1 : 0);

  return { sent, total: tokens.length };
}

// ── Token kayıt/silme ──
router.post('/subscribe', (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'Token gerekli' });
  try {
    db.prepare('INSERT OR REPLACE INTO push_tokens (user_id,token,platform) VALUES (?,?,?)')
      .run(req.user.id, token, platform || 'web');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/unsubscribe', (req, res) => {
  const { token } = req.body;
  db.prepare('DELETE FROM push_tokens WHERE user_id=? AND token=?').run(req.user.id, token || '');
  res.json({ ok: true });
});

// ── BİLDİRİM SENARYOLARI (backend tetikler) ──

// Çocuk görevi tamamladı → ebeveyne bildirim
router.post('/notify/task-completed', async (req, res) => {
  const { completion_id } = req.body;
  const comp = db.prepare(`
    SELECT c.*, t.title, t.icon, u.name AS child_name, u.family_id
    FROM completions c
    JOIN tasks t ON t.id=c.task_id
    JOIN users u ON u.id=c.child_id
    WHERE c.id=?
  `).get(completion_id);
  if (!comp) return res.status(404).json({ error: 'Completion bulunamadı' });

  const parent = db.prepare("SELECT id FROM users WHERE family_id=? AND role='parent'").get(comp.family_id);
  if (!parent) return res.json({ sent: 0, reason: 'Ebeveyn yok' });

  const result = await sendToUser(parent.id, {
    title: `${comp.icon||'📋'} Görev Tamamlandı!`,
    body:  `${comp.child_name}, "${comp.title}" görevini tamamladı. Onayla!`,
    url:   '/parent.html',
    tag:   'task-completed',
  });
  res.json(result);
});

// Ebeveyn onayladı → çocuğa bildirim
router.post('/notify/task-approved', async (req, res) => {
  const { completion_id } = req.body;
  const comp = db.prepare(`
    SELECT c.*, t.title, t.icon FROM completions c JOIN tasks t ON t.id=c.task_id WHERE c.id=?
  `).get(completion_id);
  if (!comp) return res.status(404).json({ error: 'Completion bulunamadı' });

  const result = await sendToUser(comp.child_id, {
    title: `⭐ +${comp.pts_awarded} Puan Kazandın!`,
    body:  `"${comp.title}" görevi onaylandı! Harika iş!`,
    url:   '/child.html',
    tag:   'task-approved',
  });
  res.json(result);
});

// Ebeveyn reddetti → çocuğa bildirim
router.post('/notify/task-rejected', async (req, res) => {
  const { completion_id } = req.body;
  const comp = db.prepare(`
    SELECT c.*, t.title FROM completions c JOIN tasks t ON t.id=c.task_id WHERE c.id=?
  `).get(completion_id);
  if (!comp) return res.status(404).json({ error: 'Completion bulunamadı' });

  const result = await sendToUser(comp.child_id, {
    title: '📝 Görev Değerlendirildi',
    body:  `"${comp.title}" bu sefer onaylanmadı. Yarın tekrar dene!`,
    url:   '/child.html',
    tag:   'task-rejected',
  });
  res.json(result);
});

// Çocuk ödül talep etti → ebeveyne bildirim
router.post('/notify/reward-claimed', async (req, res) => {
  const { claim_id } = req.body;
  const claim = db.prepare(`
    SELECT rc.*, r.title, r.icon, r.pts_required,
           u.name AS child_name, u.family_id
    FROM reward_claims rc
    JOIN rewards r ON r.id=rc.reward_id
    JOIN users u ON u.id=rc.child_id
    WHERE rc.id=?
  `).get(claim_id);
  if (!claim) return res.status(404).json({ error: 'Talep bulunamadı' });

  const parent = db.prepare("SELECT id FROM users WHERE family_id=? AND role='parent'").get(claim.family_id);
  if (!parent) return res.json({ sent: 0 });

  const result = await sendToUser(parent.id, {
    title: `${claim.icon||'🎁'} Ödül Talebi!`,
    body:  `${claim.child_name}, "${claim.title}" ödülünü talep etti (${claim.pts_required} puan).`,
    url:   '/parent.html',
    tag:   'reward-claimed',
  });
  res.json(result);
});

// Ebeveyn ödülü onayladı → çocuğa bildirim
router.post('/notify/reward-approved', async (req, res) => {
  const { child_id, reward_title, reward_icon } = req.body;
  const result = await sendToUser(child_id, {
    title: `${reward_icon||'🎉'} Ödülün Onaylandı!`,
    body:  `"${reward_title}" ödülünü kazandın! Tebrikler!`,
    url:   '/child.html',
    tag:   'reward-approved',
  });
  res.json(result);
});

// Seri tehlikede → çocuğa hatırlatma (cron ile çağrılır)
router.post('/notify/streak-warning', parentOnly, async (req, res) => {
  const { child_id, streak_count } = req.body;
  const result = await sendToUser(child_id, {
    title: '🔥 Serin Tehlikede!',
    body:  streak_count > 0
      ? `${streak_count} günlük serin kırılmak üzere! Bugün bir görev tamamla.`
      : 'Bugün henüz görev yapmadın. Hadi başla!',
    url:   '/child.html',
    tag:   'streak-warning',
  });
  res.json(result);
});

// Akşam hatırlatması — ebeveyn panelinden tetiklenebilir
router.post('/notify/evening-reminder', parentOnly, async (req, res) => {
  const { child_id } = req.body;
  const child = db.prepare('SELECT name FROM users WHERE id=?').get(child_id);
  const result = await sendToUser(child_id, {
    title: '🌙 Görev Vakti!',
    body:  `${child?.name||'Merhaba'}, bugünkü görevlerini tamamladın mı?`,
    url:   '/child.html',
    tag:   'reminder',
  });
  res.json(result);
});

// ── TEST BİLDİRİMİ ──
router.post('/test', parentOnly, async (req, res) => {
  const result = await sendToUser(req.user.id, {
    title: '🎉 Test Bildirimi',
    body:  'Push bildirimleri çalışıyor! Harika!',
    url:   '/parent.html',
    tag:   'test',
  });
  res.json(result);
});

// ── PUSH LOG — son gönderilen bildirimler ──
router.get('/log', parentOnly, (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM push_log
    WHERE user_id = ?
    ORDER BY sent_at DESC LIMIT 20
  `).all(req.user.id);
  res.json(logs);
});

// ── TOKEN KONTROL ──
router.get('/status', (req, res) => {
  const tokens = db.prepare('SELECT token, platform, created_at FROM push_tokens WHERE user_id=?').all(req.user.id);
  res.json({
    token_count: tokens.length,
    permission: 'check_client_side',
    tokens: tokens.map(t => ({ platform: t.platform, created_at: t.created_at, token_preview: t.token.slice(0,20)+'...' }))
  });
});

module.exports = { router, sendToUser };
