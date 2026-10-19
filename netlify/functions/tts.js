// netlify/functions/tts.js
// 브라우저에서 translate_tts 를 직접 부르면 CORS 로 막히므로 프록시한다.
// 요청당 약 200자 한도 → 클라이언트(src/lib/tts.js)가 180자 이하로 쪼개서 보낸다.
export const handler = async (event) => {
  const { text = '', lang = 'ko' } = event.queryStringParameters || {};
  const q = String(text).slice(0, 200);           // 상류 한도
  if (!q.trim()) return { statusCode: 400, body: 'text required' };

  const url = 'https://translate.googleapis.com/translate_tts'
    + `?ie=UTF-8&client=gtx&tl=${encodeURIComponent(lang)}`
    + `&q=${encodeURIComponent(q)}&textlen=${q.length}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://translate.google.com/' },
    });
    if (!res.ok) return { statusCode: 502, body: `upstream ${res.status}` };

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=86400',   // 같은 문장 재생 시 재요청 안 함
      },
      body: buf.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (e) {
    return { statusCode: 502, body: String(e?.message || e) };
  }
};
