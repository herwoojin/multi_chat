// src/lib/view.js — 메시지 하나를 "지금 이 사람에게" 어떻게 보여주고 읽어줄지 결정한다.
// MessageBubble 과 useAutoSpeak 가 같은 결정을 쓰도록 한 곳에 둔다 (TRD 4.5).
import { preCheck } from './detect';

/** 번역 소스 키. 수동 교정된 메시지는 교정 언어를 소스로, 아니면 자동 감지. */
export const sourceKey = (m) => (m.detectionSource === 'manual' && m.detectedLang ? m.detectedLang : 'auto');
export const localKey = (m, myLang) => `${m.id}:${myLang}:${sourceKey(m)}`;

/**
 * @param {object} m 메시지
 * @param {{ myUid: string, myLang: string, local: Record<string, {text:string, romanization?:string}>, failed: Set<string> }} ctx
 */
export function computeView(m, { myUid, myLang, local = {}, failed }) {
  const isMine = m.senderUid === myUid;
  const isText = (m.type || 'text') === 'text';
  const pre = preCheck(m.text);
  const lk = localKey(m, myLang);

  // ★ 원문 언어 우선순위: 실제 감지 → (폴백) 작성자 설정 → 'ko'
  const srcLang = m.detectedLang || m.senderLang || 'ko';
  const detected = Boolean(m.detectedLang);

  const translated = m.translations?.[myLang] || local[lk]?.text || null;
  const pronunciation = m.pronunciations?.[myLang] || local[lk]?.romanization || null;
  const hasFailed = Boolean(failed?.has(lk));

  // 감지 전에는 senderLang 을 믿지 않는다 → 아직 모르면 "번역 필요"로 본다.
  const needsTr = !isMine && isText && !m.deletedAt && !pre.skip && (!detected || m.detectedLang !== myLang);
  const isPending = needsTr && !translated && !hasFailed;

  const bodyText = isMine ? m.text : (translated || m.text);
  const showOrig = !isMine && Boolean(translated) && translated !== m.text;
  const ttsLang = !isMine && translated ? myLang : srcLang;

  return {
    isMine, isText, pre, srcLang, detected, translated, pronunciation,
    hasFailed, needsTr, isPending, bodyText, showOrig, ttsLang,
    lowConfidence: m.detectionConfidence === 'low',
    manual: m.detectionSource === 'manual',
  };
}
