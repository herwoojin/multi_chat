// src/lib/detect.js — 번역 전 사전 필터 + 신뢰도 판정
const URL_ONLY = /^\s*(https?:\/\/\S+\s*)+$/i;
// 숫자·기호·이모지(및 이모지 조합 문자)만 있는 문장. \p{Emoji} 는 숫자도 포함하므로 글자 판정에 쓰지 않는다.
const NO_LETTERS = /^[\s\d\p{P}\p{S}\p{Emoji}\p{Emoji_Component}\u200d\ufe0f]*$/u;

export const SHORT_THRESHOLD = 4;
/** 이 길이를 넘는 메시지는 번역을 Firestore 에 저장하지 않고 세션 메모리에만 둔다 (문서 1MB 방어) */
export const MAX_PERSIST_LENGTH = 2000;

/**
 * @returns {{ skip: boolean, reason?: string, confidence: 'high'|'low' }}
 */
export const preCheck = (text) => {
  const t = String(text || '').trim();
  if (!t) return { skip: true, reason: 'empty', confidence: 'low' };
  if (URL_ONLY.test(t)) return { skip: true, reason: 'url', confidence: 'low' };
  if (NO_LETTERS.test(t)) return { skip: true, reason: 'symbols', confidence: 'low' };

  // 4자 미만은 어떤 감지기도 못 맞힌다. 감지는 하되 믿지 않는다.
  const letters = t.replace(/\s/g, '').length;
  return { skip: false, confidence: letters < SHORT_THRESHOLD ? 'low' : 'high' };
};
