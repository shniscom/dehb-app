# Dockerfile
FROM node:20-alpine

# Çalışma dizini
WORKDIR /app

# Bağımlılıkları önce kopyala (layer cache için)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Kaynak kodları kopyala
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Veri klasörü (SQLite dosyası burada tutulacak)
RUN mkdir -p /app/data

# Port
EXPOSE 3000

# Sağlık kontrolü
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Başlat
CMD ["node", "backend/server.js"]
