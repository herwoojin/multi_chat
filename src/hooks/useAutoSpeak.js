// src/hooks/useAutoSpeak.js — 새 메시지 자동 낭독
import { useEffect, useRef } from 'react';
import { enqueueSpeak } from '../lib/tts';

const MAX_WAIT_MS = 6000; // 번역이 이만큼 늦으면 원문을 원문 언어로 읽는다

/**
 * @param {object} p
 * @param {Array} p.messages
 * @param {boolean} p.loaded   첫 스냅샷 수신 여부 — 이 전에는 아무것도 "새 메시지"로 보지 않는다
 * @param {(m) => object} p.view  computeView 결과를 돌려주는 함수
 */
export function useAutoSpeak({ messages, loaded, myUid, enabled, rate, view }) {
  const spoken = useRef(new Set());
  const ready = useRef(false);        // 첫 로드분은 읽지 않기 위한 플래그
  const waiting = useRef(new Map());  // id → 도착 시각 (번역 대기 중)

  useEffect(() => {
    if (!enabled) { ready.current = false; waiting.current.clear(); return; }
    if (!loaded) return;

    if (!ready.current) {
      // 구독 시작(또는 토글 ON) 시점에 이미 있던 메시지는 "읽은 것"으로 표시만 하고 넘어간다
      messages.forEach((m) => spoken.current.add(m.id));
      ready.current = true;
      return;
    }

    for (const m of messages) {
      if (spoken.current.has(m.id)) continue;
      spoken.current.add(m.id);
      if (m.senderUid === myUid) continue;                     // 남이 보낸 메시지만
      if ((m.type || 'text') !== 'text' || m.deletedAt) continue;
      waiting.current.set(m.id, Date.now());
    }

    if (document.hidden) { waiting.current.clear(); return; }  // 백그라운드면 읽지 않는다

    const byId = new Map(messages.map((m) => [m.id, m]));
    for (const [id, at] of waiting.current) {
      const m = byId.get(id);
      if (!m) { waiting.current.delete(id); continue; }
      const v = view(m);
      if (v.pre.skip) { waiting.current.delete(id); continue; }
      // 번역이 도착할 때까지 기다렸다가 "내 언어"로 읽는다
      if (v.isPending && Date.now() - at < MAX_WAIT_MS) continue;
      waiting.current.delete(id);
      enqueueSpeak(v.bodyText, v.ttsLang, { rate, id });
    }
  }, [messages, loaded, myUid, enabled, rate, view]);

  // 번역이 끝내 안 오는 경우를 위해 대기열을 주기적으로 다시 확인
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setInterval(() => {
      if (!waiting.current.size || document.hidden) return;
      const byId = new Map(messages.map((m) => [m.id, m]));
      for (const [id, at] of waiting.current) {
        if (Date.now() - at < MAX_WAIT_MS) continue;
        const m = byId.get(id);
        waiting.current.delete(id);
        if (!m) continue;
        const v = view(m);
        if (!v.pre.skip) enqueueSpeak(v.bodyText, v.ttsLang, { rate, id });
      }
    }, 1500);
    return () => clearInterval(t);
  }, [enabled, messages, rate, view]);
}
