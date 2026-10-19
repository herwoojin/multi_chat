// netlify/functions/translate.js
// 감지 + 번역 + (선택) 발음 표기를 한 번의 상류 호출로 처리한다.
// ⚠️ client=gtx 는 비공식 엔드포인트다. 공식 API 로 바꿀 때는 이 파일만 고친다.
import { LANGUAGES } from '../../src/lib/languages.js';

const GTX = 'https://translate.googleapis.com/translate_a/single';
const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad json' }); }

  const text = String(body.text || '').slice(0, 5000);   // 상류 보호
  const tl = String(body.targetLang || '');
  const sl = String(body.sourceLang || 'auto');
  if (!text.trim() || !tl) return json(400, { error: 'text and targetLang required' });
  if (!SUPPORTED.has(tl)) return json(400, { error: `unsupported targetLang: ${tl}` });

  const dt = body.withRomanization ? 'dt=t&dt=rm' : 'dt=t';
  const url = `${GTX}?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&${dt}&q=${encodeURIComponent(text)}`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.status === 429) return json(429, { error: 'rate limited' });
    if (!res.ok) return json(502, { error: `upstream ${res.status}` });

    const data = await res.json();
    const chunks = Array.isArray(data?.[0]) ? data[0] : [];

    // ★ 모든 청크를 이어 붙인다. data[0][0][0] 만 쓰면 긴 글이 잘린다.
    //   dt=rm 을 붙이면 맨 끝에 [null, null, 번역문음차, 원문음차] 조각이 하나 더 붙으므로 c[0] 이 null 인 조각은 건너뛴다.
    const translatedText = chunks.map((c) => (typeof c?.[0] === 'string' ? c[0] : '')).join('');
    const romanization = body.withRomanization
      ? chunks.filter((c) => c && c[0] == null && typeof c[2] === 'string').map((c) => c[2]).join(' ').trim() || null
      : null;
    // c[3] 은 "원문" 음차. 줄바꿈을 그대로 유지하므로 언어 공부 화면이 어절별 발음을 한 번에 받아 간다.
    const sourceRomanization = body.withRomanization
      ? chunks.filter((c) => c && c[0] == null && typeof c[3] === 'string').map((c) => c[3]).join(' ').trim() || null
      : null;

    if (!translatedText) return json(502, { error: 'empty translation' });

    return json(200, {
      translatedText,
      detectedLang: typeof data?.[2] === 'string' ? data[2] : null,   // ★ 감지된 원문 언어
      romanization,
      sourceRomanization,
    });
  } catch (e) {
    return json(502, { error: String(e?.message || e) });
  }
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});
