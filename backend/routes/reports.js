// routes/reports.js
const express = require('express');
const db      = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function canAccessChild(req, childId) {
  if (req.user.role === 'parent') {
    const child = db.prepare('SELECT id FROM users WHERE id=? AND family_id=?').get(childId, req.user.family_id);
    return !!child;
  }
  return parseInt(req.user.id) === parseInt(childId);
}

// UTC+3 (Turkiye)
function toTR(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  d.setHours(d.getHours() + 3);
  return d.toISOString().replace('T',' ').slice(0,16);
}

router.get('/weekly/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erisim reddedildi' });
  const { childId } = req.params;
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  const rows = db.prepare(`
    SELECT due_date,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as done,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END) as pending,
      COALESCE(SUM(pts_awarded),0) as pts_earned
    FROM completions WHERE child_id=? AND due_date >= ?
    GROUP BY due_date
  `).all(childId, days[0]);
  const byDate = {};
  rows.forEach(r => byDate[r.due_date] = r);
  const weekly = days.map(d => ({
    date: d,
    day: ['Paz','Pzt','Sal','Car','Per','Cum','Cmt'][new Date(d+'T12:00:00').getDay()],
    total:    byDate[d]?.total    || 0,
    done:     byDate[d]?.done     || 0,
    pending:  byDate[d]?.pending  || 0,
    rejected: byDate[d]?.rejected || 0,
    pts_earned: byDate[d]?.pts_earned || 0,
  }));
  res.json(weekly);
});

router.get('/category/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erisim reddedildi' });
  const cats = db.prepare(`
    SELECT t.category,
      COUNT(*) as total,
      SUM(CASE WHEN c.status='approved' THEN 1 ELSE 0 END) as done,
      ROUND(100.0 * SUM(CASE WHEN c.status='approved' THEN 1 ELSE 0 END) / COUNT(*), 1) as pct
    FROM completions c JOIN tasks t ON t.id=c.task_id
    WHERE c.child_id=? GROUP BY t.category
  `).all(req.params.childId);
  res.json(cats);
});

router.get('/streak/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erisim reddedildi' });
  const { childId } = req.params;
  const rows = db.prepare(`
    SELECT due_date,
      COUNT(*) as total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) as done
    FROM completions WHERE child_id=?
    GROUP BY due_date ORDER BY due_date DESC LIMIT 30
  `).all(childId);
  const streak = rows.map(r => ({
    date: r.due_date,
    type: r.done===r.total && r.total>0 ? 'full' : r.done>0 ? 'partial' : 'empty'
  }));
  let current = 0;
  for (const s of streak) { if (s.type==='full') current++; else break; }
  res.json({ streak, current_streak: current });
});

router.get('/summary/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erisim reddedildi' });
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
    WHERE c.child_id=? GROUP BY t.category ORDER BY pct ASC LIMIT 1
  `).get(childId);
  const child = db.prepare('SELECT name,avatar,total_points,age_group FROM users WHERE id=?').get(childId);
  const pct = overall.total > 0 ? Math.round((overall.done/overall.total)*100) : 0;
  const insights = [];
  if (pct >= 80) insights.push({type:'good',icon:'star',text:'Harika! Basari orani %'+pct+'.'});
  else if (pct >= 60) insights.push({type:'info',icon:'chart',text:'Basari orani %'+pct+'. Hedef %80.'});
  else insights.push({type:'warn',icon:'warn',text:'Basari orani %'+pct+'. Gorev sayisini gozden gecirin.'});
  if (bestHour != null) insights.push({type:'info',icon:'clock',text:'En verimli saat '+bestHour+':00-'+(bestHour+1)+':00.'});
  if (worstCat) {
    const names={rutin:'Rutin',ev:'Ev',okul:'Okul',hareket:'Hareket',sosyal:'Sosyal',bakim:'Bakim'};
    insights.push({type:'warn',icon:'target',text:'En zorlanilan: '+(names[worstCat.category]||worstCat.category)+' (%'+worstCat.pct+').'});
  }
  res.json({ child, overall, best_hour:bestHour?.hour, worst_category:worstCat, insights });
});

// GET /api/reports/activity/:childId?days=7
// Ayni gorev icin ayri completion satirlari yerine tek satirda birlestir
router.get('/activity/:childId', (req, res) => {
  if (!canAccessChild(req, req.params.childId)) return res.status(403).json({ error: 'Erisim reddedildi' });

  const days = Math.min(parseInt(req.query.days) || 7, 30);
  const startDate = (() => {
    const d = new Date(); d.setDate(d.getDate() - (days - 1));
    return d.toISOString().split('T')[0];
  })();

  const rows = db.prepare(`
    SELECT c.id, c.due_date, c.status, c.quality, c.pts_awarded,
      c.subtasks_done, c.behavior_bonus, c.behavior_note,
      c.completed_at, c.approved_at, c.parent_note, c.was_late,
      t.id AS task_id, t.title AS task_title, t.icon AS task_icon,
      t.category, t.subtasks, t.pts_base, t.duration_min
    FROM completions c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.child_id = ? AND c.due_date >= ?
    ORDER BY c.due_date DESC, t.id, c.completed_at ASC
  `).all(req.params.childId, startDate);

  // Gun -> Gorev bazinda grupla
  const byDay = {};
  rows.forEach(r => {
    const day    = r.due_date;
    const taskId = r.task_id;
    if (!byDay[day]) byDay[day] = { date: day, tasks: {}, total_pts: 0, done_count: 0, pending_count: 0 };
    if (!byDay[day].tasks[taskId]) {
      byDay[day].tasks[taskId] = {
        task_id:      taskId,
        task_title:   r.task_title,
        task_icon:    r.task_icon,
        category:     r.category,
        duration_min: r.duration_min,
        pts_base:     r.pts_base,
        all_subtasks: JSON.parse(r.subtasks || '[]'),
        completions:  [],
        total_pts:    0,
        overall_status: null,
      };
    }
    const doneSubs = JSON.parse(r.subtasks_done || '[]');
    byDay[day].tasks[taskId].completions.push({
      id:             r.id,
      status:         r.status,
      quality:        r.quality,
      pts_awarded:    r.pts_awarded,
      done_subtasks:  doneSubs,
      behavior_bonus: r.behavior_bonus || 0,
      behavior_note:  r.behavior_note,
      parent_note:    r.parent_note,
      was_late:       r.was_late,
      completed_at_tr: toTR(r.completed_at),
      approved_at_tr:  toTR(r.approved_at),
    });
    if (r.status === 'approved') {
      byDay[day].tasks[taskId].total_pts += r.pts_awarded;
      byDay[day].total_pts  += r.pts_awarded;
      byDay[day].done_count++;
    }
    if (r.status === 'pending') byDay[day].pending_count++;
  });

  // Her gorev icin genel durumu hesapla
  Object.values(byDay).forEach(day => {
    Object.values(day.tasks).forEach(task => {
      const allSubs     = task.all_subtasks;
      const allDone     = Array.from(new Set(task.completions.flatMap(c => c.done_subtasks)));
      const hasPending  = task.completions.some(c => c.status === 'pending');
      const hasApproved = task.completions.some(c => c.status === 'approved');

      task.all_done_subtasks = allDone;
      task.completion_rate = allSubs.length > 0
        ? Math.round((allDone.length / allSubs.length) * 100)
        : (hasApproved ? 100 : 0);

      if (allSubs.length > 0) {
        task.overall_status = allDone.length >= allSubs.length
          ? (hasPending ? 'pending' : 'approved')
          : (hasPending ? 'partial_pending' : hasApproved ? 'partial_approved' : 'pending');
      } else {
        task.overall_status = hasPending ? 'pending' : hasApproved ? 'approved' : null;
      }
    });

    // tasks'i diziye cevir, son completion saatine gore sirala (yeniden eskiye)
    day.tasks = Object.values(day.tasks).sort((a, b) => {
      const aT = a.completions[a.completions.length-1]?.completed_at_tr || '';
      const bT = b.completions[b.completions.length-1]?.completed_at_tr || '';
      return bT.localeCompare(aT);
    });
  });

  res.json(Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date)));
});

module.exports = router;
