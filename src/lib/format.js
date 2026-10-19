// src/lib/format.js — 시각 표시 (UI 문구가 한국어이므로 ko-KR 로 통일)
export const toDate = (ts) => {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (ts instanceof Date) return ts;
  return typeof ts === 'number' ? new Date(ts) : null;
};

export const formatTime = (ts) => toDate(ts)?.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) || '';

export const formatDay = (ts) => toDate(ts)?.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }) || '';

export const dayKey = (ts) => toDate(ts)?.toDateString() || '';

export const formatRelative = (ts) => {
  const d = toDate(ts);
  if (!d) return '';
  const sec = (Date.now() - d.getTime()) / 1000;
  if (sec < 60) return '방금';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
};
