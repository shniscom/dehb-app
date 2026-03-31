// js/api.js — Tüm backend çağrıları burada merkezi olarak yönetilir

const API_BASE = window.location.origin + '/api';

// ── TOKEN YÖNETİMİ ──
const Auth = {
  getToken:  ()    => localStorage.getItem('token'),
  setToken:  (t)   => localStorage.setItem('token', t),
  getUser:   ()    => JSON.parse(localStorage.getItem('user') || 'null'),
  setUser:   (u)   => localStorage.setItem('user', JSON.stringify(u)),
  clear:     ()    => { localStorage.removeItem('token'); localStorage.removeItem('user'); },
  isLoggedIn:()    => !!localStorage.getItem('token'),
};

// ── TEMEL İSTEK FONKSİYONU ──
async function apiCall(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  if (res.status === 401) {
    Auth.clear();
    window.location.href = '/login.html';
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const get    = (path)        => apiCall('GET',    path);
const post   = (path, body)  => apiCall('POST',   path, body);
const put    = (path, body)  => apiCall('PUT',    path, body);
const patch  = (path, body)  => apiCall('PATCH',  path, body);
const del    = (path)        => apiCall('DELETE', path);

// ── AUTH API ──
const AuthAPI = {
  login:        (email, password) => post('/auth/login', { email, password }),
  childLogin:   (child_id, family_id) => post('/auth/child-login', { child_id, family_id }),
  me:           ()                => get('/auth/me'),
  children:     ()                => get('/auth/children'),
};

// ── GÖREV API ──
const TasksAPI = {
  list:         ()          => get('/tasks'),
  today:        (childId)   => get(`/tasks/today/${childId}`),
  create:       (data)      => post('/tasks', data),
  update:       (id, data)  => put(`/tasks/${id}`, data),
  remove:       (id)        => del(`/tasks/${id}`),
};

// ── TAMAMLAMA API ──
const CompletionsAPI = {
  complete:     (data)      => post('/completions', data),
  pending:      ()          => get('/completions/pending'),
  history:      (childId, limit=30) => get(`/completions/history/${childId}?limit=${limit}`),
  approve:      (id, data)  => patch(`/completions/${id}/approve`, data),
  reject:       (id, note)  => patch(`/completions/${id}/reject`, { parent_note: note }),
};

// ── ÖDÜL API ──
const RewardsAPI = {
  list:         ()          => get('/rewards'),
  create:       (data)      => post('/rewards', data),
  update:       (id, data)  => put(`/rewards/${id}`, data),
  remove:       (id)        => del(`/rewards/${id}`),
  claim:        (id)        => post(`/rewards/${id}/claim`),
  pendingClaims:()          => get('/rewards/claims/pending'),
  approveClaim: (id)        => patch(`/rewards/claims/${id}/approve`),
};

// ── RAPOR API ──
const ReportsAPI = {
  weekly:       (childId)   => get(`/reports/weekly/${childId}`),
  category:     (childId)   => get(`/reports/category/${childId}`),
  streak:       (childId)   => get(`/reports/streak/${childId}`),
  summary:      (childId)   => get(`/reports/summary/${childId}`),
};

// ── POLLING (gerçek zamanlı simülasyon) ──
// Gerçek WebSocket yerine 30sn'de bir onay durumu kontrol eder
class Poller {
  constructor(fn, intervalMs = 30000) {
    this.fn = fn;
    this.intervalMs = intervalMs;
    this.timer = null;
  }
  start() {
    this.fn();
    this.timer = setInterval(this.fn, this.intervalMs);
  }
  stop() {
    clearInterval(this.timer);
  }
}

// ── YARDIMCI ──
function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('tr-TR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// Global export
window.Auth = Auth;
window.AuthAPI = AuthAPI;
window.TasksAPI = TasksAPI;
window.CompletionsAPI = CompletionsAPI;
window.RewardsAPI = RewardsAPI;
window.ReportsAPI = ReportsAPI;
window.Poller = Poller;
window.formatDate = formatDate;
window.todayStr = todayStr;
