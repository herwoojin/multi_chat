// src/lib/usage.js — 서버 용량 신호등용 사용량 추정기
// 서버리스라 헬스 엔드포인트가 없으므로 localStorage 의 일/월 카운터로 무료 한도 대비 사용률을 추정한다.
const KEY = 'maltong.usage.v1';
const EVENT = 'maltong-usage';

export const LIMITS = {
  fsReads:  { limit: 50000,  period: 'day',   label: 'Firestore 읽기', unit: '/일' },
  fsWrites: { limit: 20000,  period: 'day',   label: 'Firestore 쓰기', unit: '/일' },
  fnCalls:  { limit: 125000, period: 'month', label: 'Functions 호출', unit: '/월' },
};

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

const load = () => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* noop */ }
  if (s.day !== today()) { s.day = today(); s.fsReads = 0; s.fsWrites = 0; }
  if (s.month !== thisMonth()) { s.month = thisMonth(); s.fnCalls = 0; }
  return s;
};

let saveTimer = null;
let state = typeof localStorage === 'undefined' ? {} : load();

export const track = (metric, n = 1) => {
  if (!n || typeof localStorage === 'undefined') return;
  state = { ...load(), ...pick(state) };
  state[metric] = (state[metric] || 0) + n;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* noop */ }
    window.dispatchEvent(new Event(EVENT));
  }, 300);
};

// 날짜가 바뀌었으면 load() 결과(0으로 초기화된 값)를 우선한다
const pick = (s) => {
  const out = {};
  if (s.day === today()) { out.fsReads = s.fsReads || 0; out.fsWrites = s.fsWrites || 0; }
  if (s.month === thisMonth()) out.fnCalls = s.fnCalls || 0;
  return out;
};

export const getUsage = () => {
  const s = { ...load(), ...pick(state) };
  const metrics = Object.entries(LIMITS).map(([k, cfg]) => {
    const used = s[k] || 0;
    return { key: k, ...cfg, used, pct: Math.min(100, (used / cfg.limit) * 100) };
  });
  const worst = Math.max(...metrics.map((m) => m.pct));
  const level = worst >= 90 ? 'critical' : worst >= 70 ? 'danger' : worst >= 40 ? 'warn' : 'ok';
  return { metrics, worst, level };
};

export const subscribeUsage = (fn) => {
  window.addEventListener(EVENT, fn);
  window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener('storage', fn); };
};

/** window.fetch 를 한 번만 감싸 /api/ 호출을 자동 집계한다 (HMR·이중 import 대비 가드). */
export const installFetchCounter = () => {
  if (typeof window === 'undefined' || window.__maltongFetchPatched) return;
  window.__maltongFetchPatched = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : input?.url || String(input);
      if (url.includes('/api/')) track('fnCalls');
    } catch { /* noop */ }
    return orig(input, init);
  };
};
