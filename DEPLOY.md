# 🚀 Coolify Deploy Rehberi — Görev Kahramanı

## Ön Koşullar
- Hostinger VPS çalışıyor
- Coolify kurulu ve erişilebilir
- GitHub/GitLab hesabı (kod buraya push edilecek)

---

## 1. Kodu GitHub'a Push Et

```bash
# Projeyi git reposuna al
cd dehb-app
git init
git add .
git commit -m "ilk commit"

# GitHub'da yeni repo aç, sonra:
git remote add origin https://github.com/KULLANICI_ADIN/dehb-app.git
git push -u origin main
```

---

## 2. Coolify'da Yeni Servis Oluştur

1. Coolify panelini aç → **New Resource**
2. **Docker Compose** seç
3. GitHub reposunu bağla
4. **Branch:** main
5. **Docker Compose Path:** `docker-compose.yml` (otomatik bulur)

---

## 3. Environment Değişkenlerini Gir

Coolify'da **Environment Variables** bölümüne şunları ekle:

```
JWT_SECRET    = buraya-en-az-32-karakterlik-rastgele-string-yaz
ALLOWED_ORIGIN = https://senin-domain.com   (veya * test için)
PORT          = 3000
```

**JWT_SECRET üretmek için:**
```bash
# Terminalden çalıştır:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 4. Domain & Port Ayarı

- Coolify → **Domains** → domain ekle (ör: gorev.siteadi.com)
- Port: **3000**
- SSL: Coolify otomatik Let's Encrypt sertifikası alır ✅

---

## 5. Volume Ayarı (VERİTABANI KAYBETMEMEK İÇİN ÖNEMLİ!)

Coolify → **Volumes** bölümünde şunu gör:
```
dehb_data → /app/data
```
Bu volume sayesinde container yeniden deploy edilse bile SQLite dosyası korunur.

---

## 6. İlk Deploy

**Deploy** butonuna bas. Coolify:
1. Docker image build eder
2. Container başlatır
3. Health check geçerse yeşil yanar

İlk başlatmada demo verisi otomatik oluşur:
- **Ebeveyn:** ebeveyn@demo.com / demo123
- **Aile Kodu:** 1

---

## 7. Güncelleme Nasıl Yapılır?

```bash
git add .
git commit -m "güncelleme açıklaması"
git push
```

Coolify otomatik webhook ile yeni deploy başlatır (ayarlıysa).
Ya da Coolify panelinden **Redeploy** butonuna basılır.

---

## 8. Yedekleme

SQLite dosyasını yedeklemek için VPS'ten:

```bash
# Manuel yedek
docker cp <container_id>:/app/data/dehb.db ./yedek-$(date +%Y%m%d).db

# Otomatik günlük yedek (crontab'a ekle)
0 3 * * * docker cp $(docker ps -qf name=dehb):/app/data/dehb.db /yedekler/dehb-$(date +\%Y\%m\%d).db
```

---

## Sorun Giderme

**Container başlamıyor:**
```bash
docker logs <container_id>
```

**Veritabanı izin hatası:**
```bash
docker exec -it <container_id> chmod 755 /app/data
```

**Port çakışması:**
Coolify panelinde port 3000'in başka servis tarafından kullanılmadığını kontrol et.

---

## Dosya Yapısı (Özet)

```
dehb-app/
├── Dockerfile
├── docker-compose.yml
├── .gitignore
├── backend/
│   ├── server.js          ← Express sunucusu
│   ├── db.js              ← SQLite bağlantısı + şema
│   ├── package.json
│   ├── .env.example
│   ├── middleware/
│   │   └── auth.js        ← JWT doğrulama
│   ├── routes/
│   │   ├── auth.js        ← Giriş/çıkış
│   │   ├── tasks.js       ← Görev CRUD
│   │   ├── completions.js ← Tamamlama & onay
│   │   ├── rewards.js     ← Ödül yönetimi
│   │   └── reports.js     ← İstatistik & rapor
│   └── utils/
│       └── points.js      ← Puan hesaplama
└── frontend/
    └── public/
        ├── index.html     ← Yönlendirici
        ├── login.html     ← Giriş sayfası
        ├── child.html     ← Çocuk arayüzü (prototip)
        ├── parent.html    ← Ebeveyn arayüzü (prototip)
        └── js/
            └── api.js     ← API istemcisi
```
