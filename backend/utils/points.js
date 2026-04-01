// utils/points.js — Merkezi puan hesaplama mantığı

/**
 * Alt görev puanlarını hesapla
 * Toplam pts_base'i alt görevlere eşit böl, kalanı son alt göreve ver
 * Örnek: 15 puan, 2 alt görev → [7, 8]
 */
function calcSubtaskPoints(totalPts, subtaskCount) {
  if (!subtaskCount || subtaskCount <= 0) return [];
  const base = Math.floor(totalPts / subtaskCount);
  const remainder = totalPts - base * subtaskCount;
  return Array.from({ length: subtaskCount }, (_, i) =>
    i === subtaskCount - 1 ? base + remainder : base
  );
}

/**
 * Tamamlanan alt görevlere göre kazanılan puanı hesapla
 * @param {number} totalPts       - görevin toplam base puanı
 * @param {string[]} allSubtasks  - tüm alt görevler
 * @param {string[]} doneSubtasks - çocuğun tamamladığı alt görevler
 * @returns {number}
 */
function calcSubtaskEarned(totalPts, allSubtasks, doneSubtasks) {
  if (!allSubtasks || allSubtasks.length === 0) return totalPts; // alt görev yoksa tam puan
  const ptsList = calcSubtaskPoints(totalPts, allSubtasks.length);
  let earned = 0;
  allSubtasks.forEach((sub, i) => {
    if (doneSubtasks.includes(sub)) earned += ptsList[i];
  });
  return earned;
}

/**
 * Kalite + alt görev + gecikme durumuna göre puan hesapla
 * @param {Object}   task         - görev kaydı
 * @param {string}   quality      - 'great' | 'good' | 'ok' | 'late' | 'skip'
 * @param {string[]} allSubtasks  - tüm alt görevler (opsiyonel)
 * @param {string[]} doneSubtasks - tamamlanan alt görevler (opsiyonel)
 * @returns {number}
 */
function calcPoints(task, quality, allSubtasks, doneSubtasks) {
  if (quality === 'skip') return task.pts_skip || -5;

  // Base puanı: alt görev varsa orana göre, yoksa tam
  let basePts;
  if (allSubtasks && allSubtasks.length > 0 && doneSubtasks) {
    basePts = calcSubtaskEarned(task.pts_base, allSubtasks, doneSubtasks);
  } else {
    basePts = task.pts_base;
  }

  // Kalite bonusu sadece TÜM alt görevler tamamlandıysa tam verilir
  // Kısmi tamamlamada kalite bonusu oransal olur
  const completionRatio = (allSubtasks && allSubtasks.length > 0 && doneSubtasks)
    ? doneSubtasks.length / allSubtasks.length
    : 1;

  let bonus = 0;
  if (quality === 'great') bonus = Math.round((task.pts_great || 0) * completionRatio);
  else if (quality === 'good') bonus = Math.round((task.pts_good || 0) * completionRatio);
  else if (quality === 'late') bonus = Math.round((task.pts_late || 0) * completionRatio);

  return Math.max(0, basePts + bonus);
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

module.exports = { calcPoints, calcSubtaskPoints, calcSubtaskEarned, calcTotal };
