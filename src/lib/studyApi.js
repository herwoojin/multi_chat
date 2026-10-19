// src/lib/studyApi.js — 언어 공부 화면의 네트워크 부분
//   · 어절별 발음·뜻: /api/translate 경유 (브라우저에서 gtx 직접 호출 금지 — CORS·사용량 집계)
//   · Gemini 정밀 분석: 사용자가 등록한 본인 키로 브라우저에서 직접 호출 (키는 이 브라우저에만 저장)
import { requestTranslate } from './translate';
import { isLatin } from './languages';
import { latinToHangul } from './phonetics';

async function translateEach(pieces, sourceLang, targetLang, concurrency = 3) {
  const out = Array(pieces.length).fill('');
  let next = 0;
  const worker = async () => {
    while (next < pieces.length) {
      const i = next++;
      try { out[i] = (await requestTranslate({ text: pieces[i], sourceLang, targetLang })).translatedText; } catch { /* 빈칸으로 둔다 */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pieces.length) }, worker));
  return out;
}

/**
 * 조각(어절·문장)마다 발음과 내 언어 뜻을 구한다. 보통 요청 한 번으로 끝난다.
 * - 조각을 줄바꿈으로 이어 보내면 원문 음차는 줄 구조를 그대로 지켜 돌아오므로 조각과 정확히 짝이 맞는다.
 * - 번역은 짧은 줄을 합쳐 버릴 때가 있어("네," + "안녕하세요." → "hello.") 줄 수가 다르면 조각마다 다시 요청한다.
 * - 라틴 문자 언어는 Google 음차가 없으므로, 한국어 사용자에게만 한글 발음 가이드를 만든다.
 * @returns {Promise<{ pron: string[], meaning: string[] }>} pieces 와 같은 길이 (못 구한 칸은 '')
 */
export async function fetchStudyExtras(pieces, lang, myLang) {
  const n = pieces.length;
  const blank = () => Array(n).fill('');
  const latin = isLatin(lang);
  const wantMeaning = lang !== myLang;
  let pron = latin && myLang === 'ko' ? pieces.map((s) => latinToHangul(s, lang)) : blank();
  let meaning = blank();
  if (!n || (latin && !wantMeaning)) return { pron, meaning };

  const r = await requestTranslate({
    text: pieces.join('\n'),
    sourceLang: lang,
    targetLang: wantMeaning ? myLang : 'en', // 내 언어 문장이면 뜻은 필요 없고 음차만 받는다
    withRomanization: !latin,
  });
  if (!latin && r.sourceRomanization) {
    const rm = r.sourceRomanization.split('\n');
    if (rm.length === n) pron = rm.map((s) => s.trim());
  }
  if (wantMeaning) {
    const tr = r.translatedText.split('\n');
    meaning = tr.length === n ? tr.map((s) => s.trim()) : await translateEach(pieces, lang, myLang);
  }
  return { pron, meaning };
}

// ── Gemini 정밀 분석 (선택) ───────────────────────────────────────────────
// 키는 Firestore 에 두지 않는다: users/{uid} 는 다른 로그인 사용자도 읽을 수 있어 키가 새어 나간다.
const GEMINI_KEY = 'maltong.gemini.v1';
// 모델이 없어지면(404) 다음 후보로 넘어간다
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];

export const getGeminiKey = () => {
  try { return localStorage.getItem(GEMINI_KEY) || ''; } catch { return ''; }
};
export const setGeminiKey = (key) => {
  try {
    if (key) localStorage.setItem(GEMINI_KEY, key.trim());
    else localStorage.removeItem(GEMINI_KEY);
  } catch { /* noop */ }
};

const geminiPrompt = (sentence, langLabel, learnerLabel) => `다음 문장을 언어 학습자를 위해 문법 분석해 주세요.
- 문장의 언어: ${langLabel}
- 학습자의 언어: ${learnerLabel} — structure, pos, role, meaning, note, overall 은 모두 학습자의 언어로 쓰세요.
JSON 으로만 답하세요. 마크다운·코드블록 금지.

문장: """${sentence}"""

형식:
{
  "structure": "문장 구조 한 줄 (예: 주제 + 주어 + 목적어 + 술어)",
  "tokens": [
    {
      "surface": "원문 토큰",
      "reading": "필요하면 발음 표기 (병음·가나·로마자 등)",
      "pos": "품사",
      "role": "문장에서의 역할 (주어/목적어/술어/부사어 등)",
      "meaning": "뜻",
      "note": "초보자를 위한 짧은 설명 (선택)"
    }
  ],
  "overall": "전체 의미와 학습 포인트 2~3문장"
}`;

export class GeminiError extends Error {
  constructor(status, detail) {
    super(`Gemini ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

export async function analyzeWithGemini({ sentence, langLabel, learnerLabel, apiKey }) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: geminiPrompt(sentence, langLabel, learnerLabel) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
  });
  let status = 0;
  let detail = '';
  for (const model of GEMINI_MODELS) {
    // 키는 URL 이 아니라 헤더로 보낸다 (주소창·로그에 남지 않게)
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    });
    if (res.ok) {
      const raw = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return JSON.parse(raw.replace(/^```(?:json)?\s*|```\s*$/g, '').trim());
    }
    status = res.status;
    detail = (await res.text().catch(() => '')).slice(0, 300);
    if (status !== 404) break;
  }
  throw new GeminiError(status, detail);
}
