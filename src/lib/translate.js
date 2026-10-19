// src/lib/translate.js — /api/translate 호출 + 세션 메모리 캐시
import { normalizeLang } from './languages';

const mem = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TranslateError extends Error {
  constructor(status, message) {
    super(message || `translate failed (${status})`);
    this.status = status;
  }
}

/**
 * 감지 + 번역을 한 번에 받는다.
 * @returns {Promise<{translatedText: string, detectedLang: string|null, romanization: string|null}>}
 */
export async function requestTranslate({ text, targetLang, sourceLang = 'auto', withRomanization = false }) {
  const key = `${sourceLang}|${targetLang}|${withRomanization ? 1 : 0}|${text}`;
  if (mem.has(key)) return mem.get(key);

  const call = () => fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang, sourceLang, withRomanization }),
  });

  let res = await call();
  if (res.status === 429) {
    // 지수 백오프 후 1회만 재시도. 실패하면 호출부가 원문을 보여준다.
    await sleep(1200 + Math.random() * 1200);
    res = await call();
  }
  if (!res.ok) throw new TranslateError(res.status);

  const data = await res.json();
  const raw = data.detectedLang;
  const out = {
    translatedText: String(data.translatedText || ''),
    detectedLang: normalizeLang(raw) || (raw ? String(raw) : null),
    romanization: data.romanization || null,
  };
  mem.set(key, out);
  return out;
}
