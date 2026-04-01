// js/api.js
const API_BASE = window.location.origin + '/api';

const Auth = {
  getToken:  ()    => localStorage.getItem('token'),
  setToken:  (t)   => localStorage.setItem('token', t),
  getUser:   ()    => JSON.parse(localStorage.getItem('user') || 'null'),
  setUser:   (u)   => localStorage.setItem('user', JSON.stringify(u)),
  clear:     ()    => { localStorage.removeItem('token'); localStorage.removeItem('user'); },
  isLoggedIn:()    => !!localStorage.getItem('token'),
};

async function apiCall(method, path, body=null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = Auth.getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API_BASE + path, { method, headers, body: body ? JSON.stringify(body) : null });
  if (res.status === 401) { Auth.clear(); window.location.href = '/login.html'; return; }
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const get   = (path)       => apiCall('GET',    path);
const post  = (path, body) => apiCall('POST',   path, body);
const put   = (path, body) => apiCall('PUT',    path, body);
const patch = (path, body) => apiCall('PATCH',  path, body);
const del   = (path)       => apiCall('DELETE', path);

const AuthAPI = {
  login:       (email, password) => post('/auth/login', { email, password }),
  childLogin:  (child_id, family_id) => post('/auth/child-login', { child_id, family_id }),
  me:          () => get('/auth/me'),
  // join_code veya family_id ile çocukları listele
  children:    (code_or_id) => {
    const isNum = /^\d+$/.test(String(code_or_id));
    const param = isNum ? `family_id=${code_or_id}` : `join_code=${code_or_id}`;
    return fetch(`${API_BASE}/auth/children?${param}`).then(r=>r.json()).then(d=>{ if(d.error) throw new Error(d.error); return d; });
  },
};

const FamilyAPI = {
  updateProfile:  (data)   => put('/family/parent/profile', data),
  updatePassword: (data)   => put('/family/parent/password', data),
  updateAvatar:   (avatar) => put('/family/parent/avatar', { avatar }),
  listChildren:   ()       => get('/family/children'),
  addChild:       (data)   => post('/family/children', data),
  updateChild:    (id, data) => put(`/family/children/${id}`, data),
  deleteChild:    (id)     => del(`/family/children/${id}`),
  resetPoints:    (id)     => post(`/family/children/${id}/reset-points`),
  childStats:     (id)     => get(`/family/children/${id}/stats`),
  manualPoints:   (id, delta, reason) => post(`/family/children/${id}/points`, { delta, reason }),
  // Aile kodu
  getCode:        ()       => get('/family/code'),
  regenerateCode: ()       => post('/family/code/regenerate'),
  setCode:        (code)   => put('/family/code', { code }),
};

const TasksAPI = {
  list:   ()         => get('/tasks'),
  today:  (childId)  => get(`/tasks/today/${childId}`),
  create: (data)     => post('/tasks', data),
  update: (id, data) => put(`/tasks/${id}`, data),
  remove: (id)       => del(`/tasks/${id}`),
};

const CompletionsAPI = {
  complete:    (data)      => post('/completions', data),
  pending:     ()          => get('/completions/pending'),
  history:     (childId, limit=30) => get(`/completions/history/${childId}?limit=${limit}`),
  calendar:    (childId, start, end) => {
    let q = `start=${start||''}&end=${end||''}`;
    return get(`/completions/calendar/${childId}?${q}`);
  },
  approve:     (id, data)  => patch(`/completions/${id}/approve`, data),
  reject:      (id, note)  => patch(`/completions/${id}/reject`, { parent_note: note }),
  reactivate:  (taskId, childId) => del(`/completions/reactivate/${taskId}?child_id=${childId}`),
};

const RewardsAPI = {
  list:         ()          => get('/rewards'),
  create:       (data)      => post('/rewards', data),
  update:       (id, data)  => put(`/rewards/${id}`, data),
  remove:       (id)        => del(`/rewards/${id}`),
  claim:        (id)        => post(`/rewards/${id}/claim`),
  give:         (id, childId) => post(`/rewards/${id}/give/${childId}`),
  pendingClaims:()          => get('/rewards/claims/pending'),
  approveClaim: (id)        => patch(`/rewards/claims/${id}/approve`),
  rejectClaim:  (id)        => patch(`/rewards/claims/${id}/reject`),
};

const ReportsAPI = {
  weekly:   (childId)        => get(`/reports/weekly/${childId}`),
  category: (childId)        => get(`/reports/category/${childId}`),
  streak:   (childId)        => get(`/reports/streak/${childId}`),
  summary:  (childId)        => get(`/reports/summary/${childId}`),
  activity: (childId, days=7) => get(`/reports/activity/${childId}?days=${days}`),
};

// ── SOUND ENGINE (Web Audio API - harici dosya gerektirmez) ──
const SoundEngine = {
  ctx: null,
  init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  },
  play(type) {
    try {
      this.init();
      const ctx = this.ctx;
      const g   = ctx.createGain();
      g.connect(ctx.destination);
      const t = ctx.currentTime;

      switch(type) {
        case 'complete': // Görev tamamlama - yükselen iki nota
          this._note(ctx,g, 523, t,      0.15, 0.3);
          this._note(ctx,g, 784, t+0.15, 0.15, 0.3);
          break;
        case 'coin': // Puan kazanma - kısa parlak ses
          this._note(ctx,g, 988, t,      0.08, 0.15);
          this._note(ctx,g,1319, t+0.08, 0.08, 0.15);
          break;
        case 'fanfare': // Büyük başarı - mini fanfar
          [523,659,784,1047].forEach((f,i)=> this._note(ctx,g,f, t+i*0.1, 0.12, 0.25));
          break;
        case 'tick': // Alt görev işareti - hafif tık
          this._note(ctx,g, 880, t, 0.05, 0.1);
          break;
        case 'neutral': // Ceza/uyarı - nötr tık (negatif ses değil)
          this._note(ctx,g, 330, t, 0.08, 0.2, 'triangle');
          break;
        case 'whoosh': // Onaya gönder
          this._sweep(ctx,g, 400, 200, t, 0.3);
          break;
        case 'reward': // Ödül talebi
          [659,784,988,1319].forEach((f,i)=> this._note(ctx,g,f, t+i*0.12, 0.1, 0.2));
          break;
      }
    } catch(e) { /* ses desteklenmiyorsa sessizce devam et */ }
  },
  _note(ctx, gain, freq, start, dur, vol, type='sine') {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(gain.destination || ctx.destination);
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start+0.01);
    g.gain.exponentialRampToValueAtTime(0.001, start+dur);
    o.start(start); o.stop(start+dur+0.05);
  },
  _sweep(ctx, gain, fromF, toF, start, dur) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(gain.destination || ctx.destination);
    o.type = 'sine';
    o.frequency.setValueAtTime(fromF, start);
    o.frequency.linearRampToValueAtTime(toF, start+dur);
    g.gain.setValueAtTime(0.15, start);
    g.gain.exponentialRampToValueAtTime(0.001, start+dur);
    o.start(start); o.stop(start+dur+0.05);
  }
};

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('tr-TR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}
function todayStr() { return new Date().toISOString().split('T')[0]; }

window.Auth = Auth;
window.AuthAPI = AuthAPI;
window.FamilyAPI = FamilyAPI;
window.TasksAPI = TasksAPI;
window.CompletionsAPI = CompletionsAPI;
window.RewardsAPI = RewardsAPI;
window.ReportsAPI = ReportsAPI;
window.SoundEngine = SoundEngine;
window.formatDate = formatDate;
window.todayStr = todayStr;
