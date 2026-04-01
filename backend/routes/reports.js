// routes/reports.js
const express = require('express');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// Yardımcı: childId'ye erişim yetkisi var mı?
// Ebeveyn aynı ailedeki herkese, çocuk sadece kendine erişebilir
function canAccessChild(req, childId) {
  if (req.user.role === 'parent') {
    const child = db.prepare('SELECT id FROM users WHERE id=? AND family_id=?').get(childId, req.user.family_id);
    return !!child;
  }
  return parseInt(req.user.id) === parseInt(childId);
}

// GET /api/reports/weekly/:childId
router.get('/weekly/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erişim reddedildi' });
  const { childId } = req.params;
  const today = new Date();

  // Son 7 gün
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const rows = db.prepare(`
    SELECT due_date,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) as pending,
      COALESCE(SUM(pts_awarded),0) as pts_earned
    FROM completions
    WHERE child_id=? AND due_date >= ?
    GROUP BY due_date
  `).all(childId, days[0]);

  const byDate = {};
  rows.forEach(r => byDate[r.due_date] = r);

  const weekly = days.map(d => ({
    date: d,
    day: ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'][new Date(d+'T12:00:00').getDay()],
    total:    (byDate[d]?.total    || 0),
    done:     (byDate[d]?.done     || 0),
    pending:  (byDate[d]?.pending  || 0),
    rejected: (byDate[d]?.rejected || 0),
    pts_earned: (byDate[d]?.pts_earned || 0),
  }));

  res.json(weekly);
});

// GET /api/reports/category/:childId
router.get('/category/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erişim reddedildi' });
  const cats = db.prepare(`
    SELECT t.category,
      COUNT(*) as total,
      SUM(CASE WHEN c.status='approved' THEN 1 ELSE 0 END) as done,
      ROUND(100.0 * SUM(CASE WHEN c.status='approved' THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
    FROM completions c
    JOIN tasks t ON t.id=c.task_id
    WHERE c.child_id=?
    GROUP BY t.category
  `).all(req.params.childId);
  res.json(cats);
});

// GET /api/reports/streak/:childId
router.get('/streak/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erişim reddedildi' });
  const { childId } = req.params;
  const days = 30;
  const rows = db.prepare(`
    SELECT due_date,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as done
    FROM completions WHERE child_id=?
    GROUP BY due_date
    ORDER BY due_date DESC LIMIT ?
  `).all(childId, days);

  const streak = rows.map(r => ({
    date: r.due_date,
    type: r.done === r.total && r.total > 0 ? 'full'
        : r.done > 0 ? 'partial'
        : 'empty'
  }));

  // Güncel seri sayısı
  let current = 0;
  for (const s of streak) {
    if (s.type === 'full') current++;
    else break;
  }

  res.json({ streak, current_streak: current });
});

// GET /api/reports/summary/:childId
router.get('/summary/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erişim reddedildi' });
  const { childId } = req.params;

  const overall = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as done,
      COALESCE(SUM(pts_awarded),0) as total_pts
    FROM completions WHERE child_id=?
  `).get(childId);

  const bestHour = db.prepare(`
    SELECT CAST(strftime('%H', completed_at) AS INTEGER) as hour, COUNT(*) as cnt
    FROM completions WHERE child_id=? AND status='approved'
    GROUP BY hour ORDER BY cnt DESC LIMIT 1
  `).get(childId);

  const worstCat = db.prepare(`
    SELECT t.category,
      ROUND(100.0*SUM(CASE WHEN c.status='approved' THEN 1 ELSE 0 END)/COUNT(*),1) as pct
    FROM completions c JOIN tasks t ON t.id=c.task_id
    WHERE c.child_id=?
    GROUP BY t.category ORDER BY pct ASC LIMIT 1
  `).get(childId);

  const child = db.prepare('SELECT name,avatar,total_points,age_group FROM users WHERE id=?').get(childId);

  res.json({
    child,
    overall,
    best_hour: bestHour?.hour,
    worst_category: worstCat,
    insights: generateInsights(overall, bestHour, worstCat)
  });
});

function generateInsights(overall, bestHour, worstCat) {
  const insights = [];
  const pct = overall.total > 0 ? Math.round((overall.done / overall.total) * 100) : 0;

  if (pct >= 80) insights.push({ type:'good', icon:'⭐', text:`Harika! Bu haftaki başarı oranı %${pct}.` });
  else if (pct >= 60) insights.push({ type:'info', icon:'📈', text:`Başarı oranı %${pct}. Hedef %80.` });
  else insights.push({ type:'warn', icon:'⚠️', text:`Başarı oranı %${pct}. Görev sayısını veya süreyi gözden geçirin.` });

  if (bestHour !== undefined && bestHour !== null) {
    insights.push({ type:'info', icon:'🕐', text:`En verimli saat ${bestHour}:00-${bestHour+1}:00. Zor görevleri bu saate alın.` });
  }

  if (worstCat) {
    const catNames = {rutin:'Rutin',ev:'Ev',okul:'Okul',hareket:'Hareket',sosyal:'Sosyal',bakim:'Bakım'};
    insights.push({ type:'warn', icon:'🎯', text:`En zorlanılan alan: ${catNames[worstCat.category]} (%${worstCat.pct}). Görev süresini kısaltmayı deneyin.` });
  }

  return insights;
}

// UTC → Türkiye saatine çevir (UTC+3)
function toTurkeyTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  d.setHours(d.getHours() + 3);
  return d.toISOString().replace('T', ' ').slice(0, 16);
}

// GET /api/reports/activity/:childId?days=7
// Günlük detaylı aktivite log — her tamamlama, alt görevler, bonus, saat bilgisi
router.get('/activity/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erişim reddedildi' });

  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const startDate = (() => {
    const d = new Date(); d.setDate(d.getDate() - (days - 1));
    return d.toISOString().split('T')[0];
  })();

  const rows = db.prepare(`
    SELECT
      c.id, c.due_date, c.status, c.quality, c.pts_awarded,
      c.subtasks_done, c.behavior_bonus, c.behavior_note,
      c.completed_at, c.approved_at, c.parent_note, c.was_late,
      t.title AS task_title, t.icon AS task_icon, t.category,
      t.subtasks, t.pts_base, t.pts_great, t.pts_good, t.duration_min
    FROM completions c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.child_id = ? AND c.due_date >= ?
    ORDER BY c.due_date DESC, c.completed_at DESC
  `).all(req.params.childId, startDate);

  // Günlere göre grupla
  const byDay = {};
  rows.forEach(r => {
    const day = r.due_date;
    if (!byDay[day]) byDay[day] = { date: day, completions: [], total_pts: 0, done_count: 0, pending_count: 0 };

    const allSubs  = JSON.parse(r.subtasks || '[]');
    const doneSubs = JSON.parse(r.subtasks_done || '[]');

    const entry = {
      id:              r.id,
      task_title:      r.task_title,
      task_icon:       r.task_icon,
      category:        r.category,
      status:          r.status,
      quality:         r.quality,
      pts_awarded:     r.pts_awarded,
      pts_base:        r.pts_base,
      behavior_bonus:  r.behavior_bonus,
      behavior_note:   r.behavior_note,
      parent_note:     r.parent_note,
      was_late:        r.was_late,
      duration_min:    r.duration_min,
      all_subtasks:    allSubs,
      done_subtasks:   doneSubs,
      completion_rate: allSubs.length > 0 ? Math.round((doneSubs.length / allSubs.length) * 100) : 100,
      // Türkiye saati
      completed_at_tr: toTurkeyTime(r.completed_at),
      approved_at_tr:  toTurkeyTime(r.approved_at),
      completed_hour:  r.completed_at ? new Date(r.completed_at).getUTCHours() + 3 : null,
    };

    byDay[day].completions.push(entry);
    if (r.status === 'approved') { byDay[day].total_pts += r.pts_awarded; byDay[day].done_count++; }
    if (r.status === 'pending')  byDay[day].pending_count++;
  });

  res.json(Object.values(byDay).sort((a,b) => b.date.localeCompare(a.date)));
});

module.exports = router;
