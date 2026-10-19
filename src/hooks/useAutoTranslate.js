// src/hooks/useAutoTranslate.js — ★ 번역 오케스트레이션 (이 앱의 심장)
// 화면에 보이는 메시지에 내 언어 번역이 없으면 가져와서 Firestore 에 되돌려 쓴다. 다음 사람은 공짜로 읽는다.
import { useEffect, useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { preCheck, MAX_PERSIST_LENGTH } from '../lib/detect';
import { requestTranslate } from '../lib/translate';
import { isLatin } from '../lib/languages';
import { sourceKey, localKey } from '../lib/view';
import { track } from '../lib/usage';

const MAX_CONCURRENT = 3; // gtx 는 짧은 시간에 몰리면 429 를 준다

/**
 * @returns {{ local: Record<string,{text:string,romanization?:string}>, failed: Set<string> }}
 *   local  — 2000자 초과(저장 안 함) 또는 저장 실패한 번역의 세션 메모리
 *   failed — 번역 실패 키. 실패하면 스피너를 멈추고 원문을 보여준다 (빈칸 금지)
 */
export function useAutoTranslate({ roomId, messages, myLang, myUid, visibleIds }) {
  // 같은 탭에서 같은 메시지를 중복 요청하지 않기 위한 in-flight 집합. 키: `${messageId}:${myLang}`
  const inFlight = useRef(new Set());
  const [local, setLocal] = useState({});
  const [failed, setFailed] = useState(() => new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!db || !roomId || !myLang || !myUid) return;

    for (const m of messages) {
      if (inFlight.current.size >= MAX_CONCURRENT) break;
      if (visibleIds && !visibleIds.has(m.id)) continue;           // 보이는 것만
      if ((m.type || 'text') !== 'text' || m.deletedAt || !m.text) continue;

      const pre = preCheck(m.text);
      if (pre.skip) continue;                                       // URL·기호·이모지·빈 문장

      const isMine = m.senderUid === myUid;
      const lk = localKey(m, myLang);
      if (isMine) {
        // 내 글은 번역해서 보여주지 않는다. 다만 아무도 감지하지 않았다면 뱃지가 비므로
        // 감지 1회만 수행한다 (한국어 설정 + 영어 문장 → 🇺🇸 뱃지, PRD 시나리오 C).
        if (m.detectedLang) continue;
      } else {
        if (m.translations?.[myLang]) continue;                     // 캐시 적중
        if (m.detectedLang && m.detectedLang === myLang) continue;  // 이미 내 언어
        if (local[lk]) continue;
      }
      if (failed.has(lk)) continue;

      const flightKey = `${m.id}:${myLang}`;
      if (inFlight.current.has(flightKey)) continue;
      inFlight.current.add(flightKey);

      run(m, pre, isMine, lk).finally(() => {
        inFlight.current.delete(flightKey);
        setTick((t) => t + 1); // 동시성 상한에 걸려 밀린 메시지를 이어서 처리
      });
    }

    async function run(m, pre, isMine, lk) {
      let r;
      try {
        r = await requestTranslate({
          text: m.text,
          targetLang: myLang,
          sourceLang: sourceKey(m),
          withRomanization: !isLatin(myLang),
        });
      } catch (e) {
        console.warn('[translate] failed', m.id, e?.status || e);
        setFailed((prev) => new Set(prev).add(lk));
        return;
      }

      const patch = {};
      // 감지 결과는 처음 번역한 사람이 한 번만 기록한다.
      if (!m.detectedLang && r.detectedLang) {
        // 짧은 문장이면 보낸 사람의 설정 언어를 우선한다 (PRD 7.2) — 사용자가 뱃지로 고칠 수 있다
        patch.detectedLang = pre.confidence === 'low' ? (m.senderLang || r.detectedLang) : r.detectedLang;
        patch.detectionConfidence = pre.confidence;
        patch.detectionSource = 'auto';
      }

      const finalSrc = patch.detectedLang || m.detectedLang;
      const usable = r.translatedText && finalSrc !== myLang && r.translatedText !== m.text;
      const tooLong = m.text.length > MAX_PERSIST_LENGTH;

      if (usable && !tooLong) {
        // ✅ 점 표기법으로 한 키만. 맵 전체를 덮어쓰면 다른 언어 번역이 날아간다.
        patch[`translations.${myLang}`] = r.translatedText;
        if (r.romanization) patch[`pronunciations.${myLang}`] = r.romanization;
      }
      if (usable && tooLong && !isMine) {
        setLocal((prev) => ({ ...prev, [lk]: { text: r.translatedText, romanization: r.romanization } }));
      }
      // 저장할 번역이 없으면(같은 언어·고유명사·내 글) 이 키는 "처리 끝"으로 표시해 재요청 루프를 막는다
      if (!usable || (tooLong && isMine)) setFailed((prev) => new Set(prev).add(lk));

      if (!Object.keys(patch).length) return;
      try {
        await updateDoc(doc(db, 'rooms', roomId, 'messages', m.id), patch);
        track('fsWrites');
      } catch (e) {
        // 저장 실패(규칙 등)해도 화면에는 보여준다
        console.error('[translate] write-back failed — firestore.rules 확인', e);
        if (usable && !isMine) setLocal((prev) => ({ ...prev, [lk]: { text: r.translatedText, romanization: r.romanization } }));
        else setFailed((prev) => new Set(prev).add(lk));
      }
    }
    // ★ myLang 이 의존성에 있어야 언어를 바꾸는 즉시 다시 번역된다
  }, [roomId, messages, myLang, myUid, visibleIds, local, failed, tick]);

  return { local, failed };
}
