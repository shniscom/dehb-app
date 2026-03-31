// utils/points.js — Merkezi puan hesaplama mantığı

/**
 * Kalite + gecikme durumuna göre puan hesapla
 * @param {Object} task   - görev kaydı (pts_base, pts_great, pts_good, pts_late, pts_skip)
 * @param {string} quality - 'great' | 'good' | 'ok' | 'late' | 'skip'
 * @returns {number}
 */
function calcPoints(task, quality) {
  if (quality === 'skip') return task.pts_skip; // negatif

  let pts = task.pts_base;

  if (quality === 'great') pts += task.pts_great;
  else if (quality === 'good') pts += task.pts_good;
  else if (quality === 'late') pts += task.pts_late; // negatif delta

  // Toplam hiçbir zaman negatife düşmesin
  // (kümülatif totale uygulanırken Math.max(0, total+delta) kullanılır)
  return pts;
}

/**
 * Point ledger'dan güncel toplam puanı hesapla
 */
function calcTotal(db, childId) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(delta), 0) as total FROM point_ledger WHERE child_id = ?'
  ).get(childId);
  return Math.max(0, row.total);
}

module.exports = { calcPoints, calcTotal };
