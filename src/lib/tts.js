// src/lib/tts.js — 청크 분할 + 순차 재생 큐 + 브라우저 음성 폴백
import { speechLocale } from './languages';
import { track } from './usage';

const MAX = 180; // 상류 200자 한도에 여유를 둔다

/** 문장 끝 → 쉼표 → 공백 → 강제 순으로 180자 이하 청크로 쪼갠다. */
export const chunkText = (text) => {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > MAX) {
    let cut = -1;
    for (const re of [/[.!?。！？\n]\s*/g, /[,，、;；]\s*/g, /\s+/g]) {
      let m;
      let last = -1;
      re.lastIndex = 0;
      while ((m = re.exec(rest)) && m.index < MAX) {
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (last > 0 && last <= MAX) { cut = last; break; }
    }
    if (cut <= 0) cut = MAX; // 강제 절단
    const piece = rest.slice(0, cut).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
};

// ── iOS 대응: 하나의 <audio> 요소를 재사용한다. 사용자 제스처로 한 번 재생된 요소는 이후 자동 재생이 허용된다.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
let sharedAudio = null;
const getAudio = () => {
  if (typeof Audio === 'undefined') return null;
  if (!sharedAudio) sharedAudio = new Audio();
  return sharedAudio;
};

/** 자동 음성 토글을 켜는 순간(사용자 제스처 안에서) 호출해 오디오 재생 권한을 열어 둔다. */
export const unlockAudio = () => {
  try {
    const a = getAudio();
    if (a) {
      a.src = SILENT_WAV;
      a.muted = true;
      const p = a.play();
      // 그 사이 실제 음성이 src 를 차지했다면 멈추지 않는다 (해제 직후 바로 speak() 하는 경우)
      p?.then(() => { if (a.src === SILENT_WAV) a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
    }
  } catch { /* noop */ }
  try {
    if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch { /* noop */ }
};

// ── 재생 상태 (어떤 메시지가 재생 중인지 UI 가 구독)
let current = null;          // { id, stop }
const queue = [];            // 자동 낭독 대기열
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(current?.id ?? null));
export const subscribeSpeaking = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const speakingId = () => current?.id ?? null;

const fallbackNative = (text, lang, rate, onDone) => {
  const synth = window.speechSynthesis;
  if (!synth || !text) { onDone(); return () => {}; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechLocale(lang);
  u.rate = rate;
  const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(u.lang.toLowerCase().slice(0, 2)));
  if (voice) u.voice = voice;
  u.onend = onDone;
  u.onerror = onDone;
  synth.speak(u);
  return () => synth.cancel();
};

/** 한 텍스트를 청크 단위로 끝까지 재생한다. */
const createPlayer = (text, lang, rate, onDone) => {
  const chunks = chunkText(text);
  let i = 0;
  let stopped = false;
  let cancelNative = null;
  const audio = getAudio();

  const finish = () => {
    if (stopped) return;
    stopped = true;
    onDone();
  };

  const toNative = () => {
    if (stopped) return;
    const remaining = chunks.slice(Math.max(0, i - 1)).join(' ');
    cancelNative = fallbackNative(remaining, lang, rate, finish);
  };

  const playNext = () => {
    if (stopped) return;
    if (i >= chunks.length || !audio) { if (!audio) toNative(); else finish(); return; }
    const q = encodeURIComponent(chunks[i++]);
    track('fnCalls');
    audio.onended = playNext;
    audio.onerror = toNative;
    audio.muted = false;
    audio.src = `/api/tts?lang=${encodeURIComponent(lang)}&text=${q}`;
    audio.playbackRate = rate;
    audio.play().catch(toNative);
  };

  playNext();
  return {
    stop() {
      stopped = true;
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); }
      cancelNative?.();
      window.speechSynthesis?.cancel();
    },
  };
};

const startItem = (item) => {
  const player = createPlayer(item.text, item.lang, item.rate, () => {
    if (current?.player === player) {
      current = null;
      emit();
      const next = queue.shift();
      if (next) startItem(next);
    }
  });
  current = { id: item.id, player, stop: () => player.stop() };
  emit();
};

/** 즉시 재생 (재생 중이던 것과 대기열은 버린다). 🔊 버튼용. */
export const speak = (text, lang, { rate = 1, id = null } = {}) => {
  stopAll();
  if (!String(text || '').trim()) return;
  startItem({ text, lang, rate, id });
};

/** 대기열에 넣어 순서대로 재생. 자동 낭독용. */
export const enqueueSpeak = (text, lang, { rate = 1, id = null } = {}) => {
  if (!String(text || '').trim()) return;
  const item = { text, lang, rate, id };
  if (current) queue.push(item); else startItem(item);
};

export const stopAll = () => {
  queue.length = 0;
  const c = current;
  current = null;
  c?.stop();
  window.speechSynthesis?.cancel();
  emit();
};

// 탭이 백그라운드로 가면 소리를 멈춘다 (PRD 7.4)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopAll(); });
}
