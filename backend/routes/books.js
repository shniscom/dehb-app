// routes/books.js — Kitap takip sistemi
const express = require('express');
const db      = require('../db');
const { authMiddleware, parentOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── GET /api/books — aileye ait tüm kitaplar (ebeveyn + çocuk görebilir) ──
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT b.*,
           u.name AS child_name, u.avatar AS child_avatar
    FROM books b
    LEFT JOIN users u ON b.child_id = u.id
    WHERE b.family_id = ?
    ORDER BY b.updated_at DESC
  `).all(req.user.family_id);
  res.json(rows);
});

// ── GET /api/books/child/:childId — belirli çocuğun kitapları ──
router.get('/child/:childId', (req, res) => {
  const { childId } = req.params;
  // Çocuklar sadece kendi kitaplarını görebilir
  if (req.user.role === 'child' && req.user.id !== parseInt(childId)) {
    return res.status(403).json({ error: 'Yetkisiz' });
  }
  const rows = db.prepare(`
    SELECT * FROM books
    WHERE family_id = ? AND (child_id = ? OR child_id IS NULL)
    ORDER BY updated_at DESC
  `).all(req.user.family_id, childId);
  res.json(rows);
});

// ── POST /api/books — yeni kitap ekle (sadece ebeveyn) ──
router.post('/', (req, res) => {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Sadece ebeveyn kitap ekleyebilir' });

  const { title, author, publisher, page_count, cover_emoji, child_id, notes } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Kitap adı zorunlu' });

  // child_id aynı aileye ait mi kontrol et
  if (child_id) {
    const child = db.prepare('SELECT id FROM users WHERE id=? AND family_id=? AND role=?')
      .get(child_id, req.user.family_id, 'child');
    if (!child) return res.status(400).json({ error: 'Geçersiz çocuk ID' });
  }

  const result = db.prepare(`
    INSERT INTO books (family_id, child_id, title, author, publisher, page_count, cover_emoji, notes, added_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.family_id,
    child_id || null,
    title.trim(),
    (author || '').trim(),
    (publisher || '').trim(),
    parseInt(page_count) || 0,
    cover_emoji || '📖',
    (notes || '').trim(),
    req.user.id
  );

  const book = db.prepare('SELECT * FROM books WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json(book);
});

// ── PUT /api/books/:id — kitap güncelle (sadece ebeveyn) ──
router.put('/:id', (req, res) => {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Sadece ebeveyn güncelleyebilir' });

  const book = db.prepare('SELECT * FROM books WHERE id=? AND family_id=?')
    .get(req.params.id, req.user.family_id);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadı' });

  const { title, author, publisher, page_count, cover_emoji, child_id, notes, read_count } = req.body;

  db.prepare(`
    UPDATE books SET
      title       = COALESCE(?, title),
      author      = COALESCE(?, author),
      publisher   = COALESCE(?, publisher),
      page_count  = COALESCE(?, page_count),
      cover_emoji = COALESCE(?, cover_emoji),
      child_id    = ?,
      notes       = COALESCE(?, notes),
      read_count  = COALESCE(?, read_count),
      updated_at  = datetime('now')
    WHERE id=? AND family_id=?
  `).run(
    title?.trim() || null,
    author?.trim() || null,
    publisher?.trim() || null,
    page_count !== undefined ? parseInt(page_count) : null,
    cover_emoji || null,
    child_id !== undefined ? (child_id || null) : book.child_id,
    notes?.trim() || null,
    read_count !== undefined ? Math.max(0, parseInt(read_count)) : null,
    req.params.id,
    req.user.family_id
  );

  const updated = db.prepare('SELECT * FROM books WHERE id=?').get(req.params.id);
  res.json(updated);
});

// ── PATCH /api/books/:id/read-count — okuma sayısını artır/azalt (ebeveyn) ──
router.patch('/:id/read-count', (req, res) => {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Sadece ebeveyn değiştirebilir' });

  const book = db.prepare('SELECT * FROM books WHERE id=? AND family_id=?')
    .get(req.params.id, req.user.family_id);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadı' });

  const { delta } = req.body; // +1 veya -1
  const newCount = Math.max(0, book.read_count + (parseInt(delta) || 1));

  db.prepare('UPDATE books SET read_count=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(newCount, book.id);

  res.json({ id: book.id, read_count: newCount });
});

// ── DELETE /api/books/:id — kitap sil (sadece ebeveyn) ──
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Sadece ebeveyn silebilir' });

  const book = db.prepare('SELECT id FROM books WHERE id=? AND family_id=?')
    .get(req.params.id, req.user.family_id);
  if (!book) return res.status(404).json({ error: 'Kitap bulunamadı' });

  db.prepare('DELETE FROM books WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── GET /api/books/stats — kitap istatistikleri ──
router.get('/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      child_id,
      COUNT(*) as book_count,
      SUM(read_count) as total_reads,
      SUM(page_count * read_count) as total_pages_read
    FROM books
    WHERE family_id = ?
    GROUP BY child_id
  `).all(req.user.family_id);
  res.json(stats);
});

module.exports = router;
