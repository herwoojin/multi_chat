// src/lib/grammar.js — 문장을 어절로 쪼개 문법 역할을 붙이는 규칙 기반 분석기 (meet4u 에서 이식·보완)
// API 키·네트워크 없이 즉시 동작한다. 더 정확한 분석은 Gemini 정밀 분석(studyApi.js)이 보완한다.
//
// 결과 모양 (모든 언어 공통):
//   { language, original, phrases: Phrase[], chunks: Chunk[], note, languageLabel }
//   Phrase = { text, particle?, punct?, label?: { role, detail, color } }
//   Chunk  = { phrases: Phrase[], originalChunk: string, structure: string }   ← 문장(절) 단위
import { langFlag, langName } from './languages';

const baseLang = (lang) => String(lang || '').split('-')[0].toLowerCase();

// 절을 끊는 문장부호. 절마다 구조 요약("주제 + 주어 + 술어")을 따로 보여준다.
const CLAUSE_PUNCT_RE = /[、。，．,.!?！？;；]/;
// 띄어쓰기 없이 이어 쓰는 언어. 나머지(한국어 포함)는 절을 다시 이을 때 공백을 넣는다.
const SPACE_JOINED_LANGS = new Set(['ja', 'zh']);

/** 어절의 겉모양 (조사 포함). 발음·뜻을 짝지을 때 키로 쓴다. */
export const phraseSurface = (p) => `${p.text || ''}${p.particle || ''}`;

const chunkPhrases = (phrases, language) => {
  const useSpaces = !SPACE_JOINED_LANGS.has(language);
  const chunks = [];
  let cur = { phrases: [], originalChunk: '' };
  const close = () => {
    cur.structure = cur.phrases.map((x) => x.label?.role).filter(Boolean).join(' + ');
    chunks.push(cur);
    cur = { phrases: [], originalChunk: '' };
  };
  for (const p of phrases) {
    cur.phrases.push(p);
    const piece = phraseSurface(p);
    if (piece) {
      if (useSpaces && cur.originalChunk && !/\s$/.test(cur.originalChunk)) cur.originalChunk += ' ';
      cur.originalChunk += piece;
    }
    if (p.punct) cur.originalChunk += p.punct;
    if (p.punct && CLAUSE_PUNCT_RE.test(p.punct)) close();
  }
  if (cur.phrases.length) close();
  return chunks;
};

const buildResult = (language, original, phrases, note) => ({
  language, original, phrases, chunks: chunkPhrases(phrases, language), note,
});

/**
 * 절마다 조사가 없는 마지막 어절을 술어 후보로 보고, 어미가 술어로 판별될 때만 표시한다.
 * (meet4u 원본은 글 전체에서 하나만 골라 "안녕하세요." 같은 짧은 문장이 '구조 불명'이 됐다)
 */
const markPredicates = (phrases, classify) => {
  let start = 0;
  phrases.forEach((p, i) => {
    const end = i === phrases.length - 1 || (p.punct && CLAUSE_PUNCT_RE.test(p.punct));
    if (!end) return;
    for (let j = i; j >= start; j--) {
      const q = phrases[j];
      if (!q.text || q.particle || q.label) continue;
      const pred = classify(q.text);
      if (pred) q.label = { role: '술어', detail: `${pred.type} · ${pred.detail}`, color: 'emerald' };
      break;
    }
    start = i + 1;
  });
};

const ROLES = {
  subject: { role: '주어', color: 'green' },
  object: { role: '목적어', color: 'red' },
  predicate: { role: '술어', color: 'emerald' },
  adverb: { role: '부사어', color: 'orange' },
  article: { role: '관사', color: 'slate' },
  prep: { role: '전치사', color: 'amber' },
  conj: { role: '접속사', color: 'rose' },
  aux: { role: '조동사', color: 'teal' },
  modifier: { role: '수식어', color: 'lime' },
  classifier: { role: '분류사', color: 'indigo' },
  marker: { role: '시제·상 표지', color: 'fuchsia' },
  word: { role: '어휘', color: 'gray' },
};

const phraseFor = (text, kind, detail) => {
  const base = ROLES[kind] || ROLES.word;
  return { text, label: { role: base.role, detail: detail || base.role, color: base.color } };
};

// 띄어쓰기 언어 공용: 문장부호는 앞 단어에 붙여 두었다가 떼어 낸다
const splitByWord = (text) => text.split(/\s+/).filter(Boolean);
const peelTrailingPunct = (w) => {
  const m = w.match(/^(.*?)(\p{P}*)$/u);
  return m ? [m[1], m[2]] : [w, ''];
};

const analyzeByWord = (lang, text, classify, note) => {
  const phrases = [];
  for (const raw of splitByWord(text)) {
    const [core, trailing] = peelTrailingPunct(raw);
    if (!core) continue;
    const [kind, detail] = classify(core);
    const ph = phraseFor(core, kind, detail);
    if (trailing) ph.punct = trailing;
    phrases.push(ph);
  }
  return buildResult(lang, text, phrases, note);
};

// ===========================================================================
// 한국어
// ===========================================================================

const KO_PARTICLE_INFO = {
  '은': { role: '주제', detail: '주제(은)', color: 'blue' },
  '는': { role: '주제', detail: '주제(는)', color: 'blue' },
  '이': { role: '주어', detail: '주어(이)', color: 'green' },
  '가': { role: '주어', detail: '주어(가)', color: 'green' },
  '을': { role: '목적어', detail: '직접 목적어(을)', color: 'red' },
  '를': { role: '목적어', detail: '직접 목적어(를)', color: 'red' },
  '에': { role: '부사어', detail: '장소·시간(~에)', color: 'orange' },
  '에서': { role: '부사어', detail: '장소(~에서)', color: 'orange' },
  '에는': { role: '부사어', detail: '장소·시간 + 주제(~에는)', color: 'orange' },
  '에도': { role: '부사어', detail: '장소·시간 + 역시(~에도)', color: 'orange' },
  '에서는': { role: '부사어', detail: '장소 + 주제(~에서는)', color: 'orange' },
  '에서도': { role: '부사어', detail: '장소 + 역시(~에서도)', color: 'orange' },
  '에게': { role: '부사어', detail: '대상(~에게)', color: 'purple' },
  '한테': { role: '부사어', detail: '대상(~한테)', color: 'purple' },
  '으로': { role: '부사어', detail: '수단·방향(~으로)', color: 'indigo' },
  '로': { role: '부사어', detail: '수단·방향(~로)', color: 'indigo' },
  '으로는': { role: '부사어', detail: '수단·방향 + 주제(~으로는)', color: 'indigo' },
  '으로도': { role: '부사어', detail: '수단·방향 + 역시(~으로도)', color: 'indigo' },
  '의': { role: '연결', detail: '소유·관계(~의)', color: 'slate' },
  '와': { role: '동반', detail: '~와', color: 'pink' },
  '과': { role: '동반', detail: '~과', color: 'pink' },
  '랑': { role: '동반', detail: '~랑(구어)', color: 'pink' },
  '도': { role: '역시', detail: '~도(또한)', color: 'teal' },
  '만': { role: '한정', detail: '~만(한정)', color: 'amber' },
  '마저': { role: '강조', detail: '~마저(마지막까지)', color: 'amber' },
  '조차': { role: '강조', detail: '~조차(뜻밖)', color: 'amber' },
  '까지': { role: '종점', detail: '~까지', color: 'cyan' },
  '부터': { role: '시작', detail: '~부터', color: 'amber' },
  '보다': { role: '비교', detail: '~보다', color: 'lime' },
  '처럼': { role: '비유', detail: '~처럼', color: 'rose' },
  '같이': { role: '비유', detail: '~같이', color: 'rose' },
  '라고': { role: '인용', detail: '~라고', color: 'fuchsia' },
  '이라고': { role: '인용', detail: '~이라고', color: 'fuchsia' },
};
// 긴 조사부터 맞춰야 '에서는' 이 '는' 으로 잘리지 않는다
const KO_PARTICLES = Object.keys(KO_PARTICLE_INFO).sort((a, b) => b.length - a.length);

const KO_INTERJECTIONS = new Set(['네', '예', '응', '아니요', '아니오', '아니', '아', '어', '오', '와', '음', '저기', '여보세요']);
const KO_ADVERBIAL = {
  '대해': '~에 대해(관련)', '대한': '~에 대한(관련)', '위해': '~을 위해(목적)', '통해': '~을 통해(수단)', '함께': '함께(동반)',
  '오늘': '시간(오늘)', '내일': '시간(내일)', '어제': '시간(어제)', '지금': '시간(지금)', '이제': '시간(이제)', '아까': '시간(아까)',
  '정말': '정도(정말)', '너무': '정도(너무)', '아주': '정도(아주)', '매우': '정도(매우)', '조금': '정도(조금)', '다시': '반복(다시)', '같이': '함께',
};

const classifyKoPredicate = (w) => {
  if (/(었|았|였)습니다$/.test(w)) return { type: '동사·정중·과거', detail: '~했습니다' };
  if (/겠습니다$/.test(w)) return { type: '동사·정중·의지/추측', detail: '~하겠습니다' };
  if (/니다$/.test(w)) return { type: '동사·정중', detail: '~합니다' };
  if (/(습니까|니까|까요|나요)$/.test(w)) return { type: '의문', detail: '~까요? / ~나요?' };
  if (/(으세요|세요|십시오)$/.test(w)) return { type: '높임·권유/인사', detail: '~(으)세요' };
  if (/(어요|아요|여요|해요|예요|에요|죠|지요)$/.test(w)) return { type: '동사·해요체', detail: '~해요' };
  if (/(었|았|였)다$/.test(w)) return { type: '동사·과거', detail: '~했다' };
  if (/다$/.test(w)) return { type: '동사·기본형', detail: '~다' };
  return null;
};

export const analyzeKorean = (text) => {
  const phrases = [];
  for (const raw of splitByWord(text)) {
    const [core, trailing] = peelTrailingPunct(raw);
    if (!core) continue;
    if (KO_INTERJECTIONS.has(core)) {
      phrases.push({ text: core, punct: trailing, label: { role: '감탄·응답', detail: '대답·부름·감탄', color: 'pink' } });
      continue;
    }
    if (KO_ADVERBIAL[core]) {
      phrases.push({ text: core, punct: trailing, label: { role: '부사어', detail: KO_ADVERBIAL[core], color: 'orange' } });
      continue;
    }
    const particle = KO_PARTICLES.find((p) => core.endsWith(p) && core.length > p.length);
    if (particle) {
      const info = KO_PARTICLE_INFO[particle];
      phrases.push({ text: core.slice(0, -particle.length), particle, punct: trailing, label: { ...info } });
    } else {
      phrases.push({ text: core, punct: trailing });
    }
  }
  markPredicates(phrases, classifyKoPredicate);
  return buildResult('ko', text, phrases, '🇰🇷 한국어 어절은 보통 [체언 + 조사] 또는 [용언 + 어미] 입니다. 어절 끝의 조사가 역할을 결정합니다.');
};

// ===========================================================================
// 일본어
// ===========================================================================

const JA_PARTICLE_INFO = {
  'は': { role: '주제', detail: '주제 표시 (은/는)', color: 'blue' },
  'が': { role: '주어', detail: '주어 표시 (이/가)', color: 'green' },
  'を': { role: '목적어', detail: '직접 목적어 (을/를)', color: 'red' },
  'に': { role: '대상·장소·시간', detail: '도착점·시간·간접목적어 (에/에게)', color: 'purple' },
  'で': { role: '수단·장소', detail: '수단·도구·장소 (에서/로)', color: 'orange' },
  'へ': { role: '방향', detail: '방향 (으로)', color: 'indigo' },
  'と': { role: '동반·인용', detail: '와/과 · 라고', color: 'pink' },
  'も': { role: '역시', detail: '도(또한)', color: 'teal' },
  'の': { role: '연결·소유', detail: '의(소유/연결)', color: 'slate' },
  'や': { role: '예시 나열', detail: '~이나, ~와 같은', color: 'rose' },
  'か': { role: '의문', detail: '의문 (~?) / ~인지', color: 'fuchsia' },
  'から': { role: '시작·원인', detail: '~부터, ~때문에', color: 'amber' },
  'まで': { role: '종점', detail: '~까지', color: 'cyan' },
  'より': { role: '비교 기준', detail: '~보다', color: 'lime' },
  'には': { role: '강조 대상', detail: '~에는 (한정·강조)', color: 'purple' },
  'では': { role: '장소 한정', detail: '~에서는', color: 'orange' },
  'への': { role: '방향+연결', detail: '~로의', color: 'indigo' },
  'ね': { role: '확인', detail: '~지? (동의 구함)', color: 'slate' },
  'よ': { role: '강조', detail: '~야 (강조)', color: 'slate' },
  'な': { role: '금지·감탄', detail: '~지 마 / 감탄', color: 'slate' },
};
const JA_COMPOUND = ['からも', 'までも', 'よりも', 'には', 'では', 'への', 'から', 'まで', 'より'];
const JA_SINGLE = ['は', 'が', 'を', 'に', 'で', 'へ', 'と', 'も', 'の', 'や'];
const JA_END = ['か', 'ね', 'よ', 'な', 'ぞ', 'ぜ'];
const JA_PUNCT = ['、', '。', '！', '？', '「', '」', '『', '』', ',', '.', '!', '?', '·', '；', ';', ':'];

const tokenizeJa = (text) => {
  const tokens = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { tokens.push({ type: 'word', text: buf }); buf = ''; } };
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { flush(); i++; continue; }
    if (JA_PUNCT.includes(ch)) { flush(); tokens.push({ type: 'punct', text: ch }); i++; continue; }
    const compound = buf && JA_COMPOUND.find((p) => text.startsWith(p, i));
    if (compound) { flush(); tokens.push({ type: 'particle', text: compound }); i += compound.length; continue; }
    if (buf && JA_SINGLE.includes(ch)) { flush(); tokens.push({ type: 'particle', text: ch }); i++; continue; }
    if (buf && JA_END.includes(ch)) {
      const nx = text[i + 1];
      if (!nx || JA_PUNCT.includes(nx) || /\s/.test(nx)) { flush(); tokens.push({ type: 'particle', text: ch }); i++; continue; }
    }
    buf += ch;
    i++;
  }
  flush();
  return tokens;
};

const classifyJaPredicate = (w) => {
  if (/ませんでした$/.test(w)) return { type: '동사·정중·과거부정', detail: '~지 않았습니다' };
  if (/ました$/.test(w)) return { type: '동사·정중·과거', detail: '~했습니다' };
  if (/ません$/.test(w)) return { type: '동사·정중·부정', detail: '~하지 않습니다' };
  if (/ましょう$/.test(w)) return { type: '동사·정중·권유', detail: '~합시다' };
  if (/ます$/.test(w)) return { type: '동사·정중·현재', detail: '~합니다' };
  if (/ではありません$/.test(w)) return { type: '명사·부정', detail: '~이 아닙니다' };
  if (/でした$/.test(w)) return { type: '명사·과거', detail: '~이었습니다' };
  if (/です$/.test(w)) return { type: '명사·서술', detail: '~입니다' };
  if (/だった$/.test(w)) return { type: '명사·과거(반말)', detail: '~이었다' };
  if (/たい$/.test(w)) return { type: '희망', detail: '~하고 싶다' };
  if (/ている$|てる$/.test(w)) return { type: '동사·진행', detail: '~하고 있다' };
  if (/てください$/.test(w)) return { type: '의뢰', detail: '~해 주세요' };
  if (/なかった$/.test(w)) return { type: '동사·과거부정(반말)', detail: '~하지 않았다' };
  if (/くない$/.test(w)) return { type: '형용사·부정', detail: '~지 않다' };
  if (/ない$/.test(w)) return { type: '동사·부정(반말)', detail: '~하지 않다' };
  if (/かった$/.test(w)) return { type: '형용사·과거', detail: '~았다/었다' };
  if (/[^しちじにひびみり]い$/.test(w)) return { type: '형용사(い)', detail: '~한/~다' };
  if (/[うくぐすつぬぶむる]$/.test(w)) return { type: '동사·기본형', detail: '~한다' };
  if (/た$/.test(w)) return { type: '동사·과거(반말)', detail: '~했다' };
  if (/て$/.test(w)) return { type: '동사·て형', detail: '~하고/해서' };
  return null;
};

export const analyzeJapanese = (text) => {
  const phrases = [];
  let cur = { text: '' };
  for (const tok of tokenizeJa(text)) {
    if (tok.type === 'word') cur.text += tok.text;
    else if (tok.type === 'particle') {
      const info = JA_PARTICLE_INFO[tok.text] || { role: '조사', detail: tok.text, color: 'slate' };
      phrases.push({ ...cur, particle: tok.text, label: { ...info } });
      cur = { text: '' };
    } else if (cur.text) {
      phrases.push({ ...cur, punct: tok.text });
      cur = { text: '' };
    } else if (phrases.length) {
      const last = phrases[phrases.length - 1];
      last.punct = (last.punct || '') + tok.text;
    }
  }
  if (cur.text) phrases.push(cur);
  markPredicates(phrases, classifyJaPredicate);
  // 문장 끝 조사(か·ね·よ) 앞이 술어면 술어로 표시하고 종조사 뜻을 덧붙인다: 行きますか → 술어(정중·현재) + 의문
  for (const p of phrases) {
    if (!JA_END.includes(p.particle)) continue;
    const pred = classifyJaPredicate(p.text);
    if (pred) p.label = { role: '술어', detail: `${pred.type} · ${pred.detail} + ${p.label.detail}`, color: 'emerald' };
  }
  return buildResult('ja', text, phrases, '🇯🇵 일본어는 조사가 단어의 역할을 정해 줍니다. 색이 칠해진 표지를 보면 무엇이 주어·목적어·술어인지 한눈에 보입니다.');
};

// ===========================================================================
// 중국어
// ===========================================================================

const ZH_FUNC_WORDS = {
  '的': { role: '연결', detail: '소유·수식(의)', color: 'slate' },
  '了': { role: '시제·상 표지', detail: '완료·변화(~했다/되었다)', color: 'fuchsia' },
  '吗': { role: '의문', detail: '예/아니오 의문(~?)', color: 'fuchsia' },
  '呢': { role: '의문·여운', detail: '~은?/~는데', color: 'fuchsia' },
  '吧': { role: '청유·추측', detail: '~하자/일 거다', color: 'rose' },
  '也': { role: '부사어', detail: '~도(또한)', color: 'teal' },
  '都': { role: '부사어', detail: '모두', color: 'teal' },
  '还': { role: '부사어', detail: '아직·또', color: 'teal' },
  '就': { role: '부사어', detail: '바로·곧', color: 'teal' },
  '在': { role: '부사어·진행', detail: '~에서/~하고 있다', color: 'fuchsia' },
  '把': { role: '목적어 전치', detail: '把-구문(목적어 강조)', color: 'red' },
  '被': { role: '피동', detail: '~에게 당하다', color: 'purple' },
  '是': { role: '술어(be)', detail: '~이다', color: 'emerald' },
  '不': { role: '부정', detail: '~하지 않다', color: 'orange' },
  '没': { role: '부정·과거', detail: '~하지 않았다', color: 'orange' },
  '有': { role: '술어(have)', detail: '있다·가지다', color: 'emerald' },
  '和': { role: '접속사', detail: '~와/과', color: 'pink' },
  '跟': { role: '접속사', detail: '~와/과', color: 'pink' },
  '与': { role: '접속사', detail: '~와/과', color: 'pink' },
  '或': { role: '접속사', detail: '또는', color: 'pink' },
  '但': { role: '접속사', detail: '그러나', color: 'rose' },
  '可是': { role: '접속사', detail: '하지만', color: 'rose' },
  '所以': { role: '접속사', detail: '그래서', color: 'rose' },
  '因为': { role: '접속사', detail: '왜냐하면', color: 'rose' },
  '如果': { role: '접속사', detail: '만약', color: 'rose' },
  '虽然': { role: '접속사', detail: '비록', color: 'rose' },
  '从': { role: '전치사', detail: '~에서/~로부터', color: 'amber' },
  '对': { role: '전치사', detail: '~에 대해', color: 'amber' },
  '给': { role: '전치사', detail: '~에게', color: 'amber' },
  '比': { role: '전치사', detail: '~보다', color: 'lime' },
  '可以': { role: '조동사', detail: '가능·허가(~해도 된다/할 수 있다)', color: 'teal' },
  '应该': { role: '조동사', detail: '당위(~해야 한다)', color: 'teal' },
  '能够': { role: '조동사', detail: '능력(~할 수 있다)', color: 'teal' },
};
const ZH_MULTI = ['可是', '所以', '因为', '如果', '虽然', '可以', '应该', '能够'];
// 시간 낱말은 문장 앞에 와도 주어·술어가 아니다 (明天 을 술어로 보던 문제)
const ZH_TIME = new Set(['今天', '明天', '昨天', '现在', '晚上', '早上', '上午', '下午', '中午', '刚才', '以后', '以前', '马上', '周末']);
const ZH_PRONOUNS = new Set(['我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '咱们', '自己', '这', '那', '这个', '那个', '哪个', '什么', '谁', '哪里', '怎么']);
const ZH_PUNCT = new Set(['，', '。', '！', '？', '、', '；', '：', '「', '」', '『', '』', '（', '）', '·', ',', '.', '!', '?']);

const tokenizeZh = (text) => {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ZH_PUNCT.has(ch)) { tokens.push({ type: 'punct', text: ch }); i++; continue; }
    const multi = ZH_MULTI.find((w) => text.startsWith(w, i));
    if (multi) { tokens.push({ type: 'func', text: multi }); i += multi.length; continue; }
    if (ZH_FUNC_WORDS[ch]) { tokens.push({ type: 'func', text: ch }); i++; continue; }
    if (ZH_PRONOUNS.has(text.substr(i, 2))) { tokens.push({ type: 'pron', text: text.substr(i, 2) }); i += 2; continue; }
    if (ZH_PRONOUNS.has(ch)) { tokens.push({ type: 'pron', text: ch }); i++; continue; }
    // 대부분의 중국어 단어는 1~2글자 — 기능어·대명사·문장부호 앞에서 끊는 2글자 덩어리
    let chunk = ch;
    const next = text[i + 1];
    if (next && !ZH_PUNCT.has(next) && !ZH_FUNC_WORDS[next] && !/\s/.test(next)
      && !ZH_PRONOUNS.has(next) && !ZH_MULTI.some((w) => text.startsWith(w, i + 1))) chunk += next;
    tokens.push({ type: 'word', text: chunk });
    i += chunk.length;
  }
  return tokens;
};

export const analyzeChinese = (text) => {
  const phrases = [];
  let subjectAssigned = false;
  let verbAssigned = false;
  for (const tok of tokenizeZh(text)) {
    if (tok.type === 'punct') {
      if (phrases.length) phrases[phrases.length - 1].punct = (phrases[phrases.length - 1].punct || '') + tok.text;
      // 절이 끝나면 주어·술어 판정을 새로 시작한다
      if (CLAUSE_PUNCT_RE.test(tok.text)) { subjectAssigned = false; verbAssigned = false; }
      continue;
    }
    if (tok.type === 'func') {
      const info = ZH_FUNC_WORDS[tok.text];
      phrases.push({ text: tok.text, label: { ...info } });
      if (info.role.startsWith('술어')) verbAssigned = true;
    } else if (tok.type === 'pron') {
      phrases.push(subjectAssigned
        ? phraseFor(tok.text, 'object', '목적어(대명사) — 동작의 대상')
        : phraseFor(tok.text, 'subject', '주어(대명사) — 동작의 주체'));
      subjectAssigned = true;
    } else if (ZH_TIME.has(tok.text)) {
      phrases.push(phraseFor(tok.text, 'adverb', '시간 — 보통 주어 앞뒤에 온다'));
    } else if (!subjectAssigned) {
      phrases.push(phraseFor(tok.text, 'subject', '주어 — 보통 문장 맨 앞'));
      subjectAssigned = true;
    } else if (!verbAssigned) {
      phrases.push(phraseFor(tok.text, 'predicate', '술어(동사/형용사) — 동작이나 상태'));
      verbAssigned = true;
    } else {
      phrases.push(phraseFor(tok.text, 'object', '목적어 — 동사의 대상'));
    }
  }
  return buildResult('zh', text, phrases, '🇨🇳 중국어는 어순(SVO)이 의미를 결정합니다. 的 (수식), 了 (완료/변화), 吗 (의문), 把/被 (구문 표시) 같은 기능어를 잘 보세요.');
};

// ===========================================================================
// 영어
// ===========================================================================

const EN_ARTICLES = new Set(['the', 'a', 'an']);
const EN_PRONOUNS_SUBJ = new Set(['i', 'you', 'he', 'she', 'it', 'we', 'they', 'who']);
const EN_PRONOUNS_OBJ = new Set(['me', 'him', 'her', 'us', 'them', 'whom']);
const EN_AUX = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must', "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "won't", "wouldn't", "shouldn't", "can't", "couldn't"]);
const EN_PREP = new Set(['in', 'on', 'at', 'to', 'from', 'with', 'by', 'for', 'of', 'about', 'into', 'onto', 'over', 'under', 'between', 'through', 'during', 'before', 'after', 'against', 'within', 'without', 'across', 'around', 'behind']);
const EN_CONJ = new Set(['and', 'but', 'or', 'so', 'because', 'if', 'when', 'while', 'although', 'though', 'since', 'unless', 'until', 'whereas', 'yet']);
const EN_NEG = new Set(['not', 'no', 'never']);
const EN_DET = new Set(['this', 'that', 'these', 'those', 'my', 'your', 'his', 'its', 'our', 'their', 'some', 'any', 'all', 'every', 'each', 'much', 'many', 'few', 'several']);
const EN_TIME = new Set(['today', 'tomorrow', 'yesterday', 'now', 'tonight', 'soon', 'later', 'already', 'always', 'never', 'often']);

const classifyEnWord = (raw) => {
  const w = raw.toLowerCase();
  if (EN_ARTICLES.has(w)) return ['article', '관사 — 명사를 한정'];
  if (EN_AUX.has(w)) return ['aux', '조동사·be동사 — 시제·태·서법'];
  if (EN_PRONOUNS_SUBJ.has(w)) return ['subject', '주격 대명사 — 보통 주어'];
  if (EN_PRONOUNS_OBJ.has(w)) return ['object', '목적격 대명사 — 동사·전치사의 대상'];
  if (EN_NEG.has(w)) return ['adverb', '부정어 — 의미 부정'];
  if (EN_DET.has(w)) return ['modifier', '한정사 — 뒤 명사 수식'];
  if (EN_PREP.has(w)) return ['prep', '전치사 — 뒤 명사구의 관계'];
  if (EN_CONJ.has(w)) return ['conj', '접속사 — 문장·구 연결'];
  if (EN_TIME.has(w)) return ['adverb', '시간·빈도 부사'];
  if (/ly$/.test(w)) return ['adverb', '부사(-ly) — 동사·형용사 수식'];
  if (/(ing|ed)$/.test(w) && w.length > 4) return ['predicate', '동사형(보통 술어)'];
  if (/^[A-Z]/.test(raw)) return ['subject', '고유명사 — 주어/객체로 자주 등장'];
  return ['word', '내용어 — 문맥에서 역할 파악'];
};

export const analyzeEnglish = (text) => {
  const res = analyzeByWord('en', text, classifyEnWord, '🇺🇸 영어는 어순(SVO)이 기본입니다. 관사·조동사·전치사 같은 기능어가 문법 관계를 표시합니다.');
  // 앞 단어로 바로잡는다: 관사·한정사 뒤는 명사("the evening"), 주어·조동사 바로 뒤의 내용어는 동사("we meet")
  res.phrases.forEach((p, i) => {
    const prev = res.phrases[i - 1]?.label.role;
    if (p.label.role === '술어' && (prev === '관사' || prev === '수식어')) p.label = phraseFor(p.text, 'word', '명사 — 관사·한정사 뒤').label;
    else if (p.label.role === '어휘' && (prev === '주어' || prev === '조동사')) p.label = phraseFor(p.text, 'predicate', '동사 — 주어·조동사 뒤').label;
  });
  // 동사를 못 찾았으면 조동사를 술부의 핵심으로 표시한다
  if (!res.phrases.some((p) => p.label.role === '술어')) {
    const aux = res.phrases.find((p) => p.label.role === '조동사');
    if (aux) aux.label = { role: '술어(보조)', detail: '조동사/be — 술부의 핵심', color: 'emerald' };
  }
  res.chunks = chunkPhrases(res.phrases, 'en');
  return res;
};

// ===========================================================================
// 프랑스어 · 스페인어 · 베트남어
// ===========================================================================

const FR_ARTICLES = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'aux', "l'", "d'"]);
const FR_PRONOUNS_SUBJ = new Set(['je', "j'", 'tu', 'il', 'elle', 'on', 'nous', 'vous', 'ils', 'elles', 'ce', "c'"]);
const FR_PRONOUNS_OBJ = new Set(['me', 'te', 'lui', 'leur', 'se', 'en', 'y', 'moi', 'toi', 'soi', 'eux']);
const FR_AUX = new Set(['suis', 'es', 'est', 'sommes', 'êtes', 'sont', 'ai', 'as', 'a', 'avons', 'avez', 'ont', 'étais', 'était', 'étions', 'étiez', 'étaient', 'serai', 'seras', 'sera', 'serons', 'serez', 'seront', 'serait']);
const FR_PREP = new Set(['à', 'de', 'dans', 'sur', 'avec', 'par', 'pour', 'sans', 'sous', 'vers', 'chez', 'entre', 'depuis', 'pendant', 'avant', 'après', 'contre', "jusqu'", 'parmi']);
const FR_CONJ = new Set(['et', 'ou', 'mais', 'car', 'donc', 'or', 'ni', 'parce', 'que', "qu'", 'si', 'quand', 'lorsque', 'comme', 'puisque']);
const FR_NEG = new Set(['ne', "n'", 'pas', 'plus', 'jamais', 'rien', 'aucun']);

const classifyFrWord = (raw) => {
  const w = raw.toLowerCase().replace(/^[«»"']+|[«»"']+$/g, '');
  if (FR_ARTICLES.has(w)) return ['article', '관사(le/la/un…) — 명사 한정'];
  if (FR_AUX.has(w)) return ['aux', '조동사 être/avoir — 시제/태'];
  if (FR_PRONOUNS_SUBJ.has(w)) return ['subject', '주격 대명사'];
  if (FR_PRONOUNS_OBJ.has(w)) return ['object', '목적격 대명사 — 동사 앞/뒤에 위치'];
  if (FR_NEG.has(w)) return ['adverb', '부정 표지(ne…pas)'];
  if (FR_PREP.has(w)) return ['prep', '전치사 — 뒤 명사구의 관계'];
  if (FR_CONJ.has(w)) return ['conj', '접속사 — 절 연결'];
  if (/^(très|bien|trop|peu|aussi|beaucoup|toujours|souvent|déjà|maintenant)$/.test(w)) return ['adverb', '부사 — 정도/시간/빈도'];
  return ['word', '내용어 — 문맥에서 역할 파악'];
};

const ES_ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);
const ES_PRONOUNS = new Set(['yo', 'tú', 'él', 'ella', 'usted', 'nosotros', 'vosotros', 'ellos', 'ellas', 'ustedes', 'me', 'te', 'lo', 'le', 'nos', 'os', 'les', 'se']);
const ES_AUX = new Set(['soy', 'eres', 'es', 'somos', 'sois', 'son', 'fui', 'fuiste', 'fue', 'fuimos', 'fueron', 'estoy', 'estás', 'está', 'estamos', 'están', 'he', 'has', 'ha', 'hemos', 'han', 'había', 'habrá', 'sería']);
const ES_PREP = new Set(['a', 'de', 'en', 'con', 'por', 'para', 'sin', 'sobre', 'entre', 'hasta', 'desde', 'según', 'contra', 'bajo']);
const ES_CONJ = new Set(['y', 'e', 'o', 'u', 'pero', 'sino', 'porque', 'si', 'cuando', 'aunque', 'mientras', 'que']);
const ES_NEG = new Set(['no', 'nunca', 'jamás', 'nada', 'nadie', 'ningún', 'ninguna']);

const classifyEsWord = (raw) => {
  const w = raw.toLowerCase().replace(/^[¿¡]+/, '');
  if (ES_ARTICLES.has(w)) return ['article', '관사 — 명사 한정'];
  if (ES_AUX.has(w)) return ['aux', '동사 ser/estar/haber — 시제·태·계사'];
  if (ES_PRONOUNS.has(w)) return ['subject', '대명사 — 주어/목적어'];
  if (ES_NEG.has(w)) return ['adverb', '부정어'];
  if (ES_PREP.has(w)) return ['prep', '전치사'];
  if (ES_CONJ.has(w)) return ['conj', '접속사'];
  if (/mente$/.test(w)) return ['adverb', '부사(-mente)'];
  return ['word', '내용어'];
};

const VI_MARKERS = {
  'là': ['predicate', '~이다 (be 동사)'], 'của': ['prep', '~의(소유)'],
  'được': ['aux', '~할 수 있다 / 피동'], 'bị': ['aux', '~당하다 (부정적 피동)'],
  'đang': ['marker', '진행(~하고 있다)'], 'đã': ['marker', '과거(~했다)'], 'sẽ': ['marker', '미래(~할 것이다)'],
  'vừa': ['marker', '방금 ~했다'], 'mới': ['marker', '막 ~한'],
  'không': ['adverb', '~지 않다 (부정)'], 'chưa': ['adverb', '아직 ~하지 않다'], 'rất': ['adverb', '매우'],
  'thì': ['conj', '~면, 그렇다면'], 'mà': ['conj', '~인데, 그런데'], 'và': ['conj', '그리고'],
  'hoặc': ['conj', '또는'], 'nhưng': ['conj', '그러나'], 'vì': ['conj', '왜냐하면'], 'nếu': ['conj', '만약'],
  'tôi': ['subject', '나'], 'bạn': ['subject', '너/당신'], 'anh': ['subject', '형/오빠/너(남)'],
  'chị': ['subject', '누나/언니/너(여)'], 'em': ['subject', '동생/너'], 'họ': ['subject', '그들'],
};
const VI_CLASSIFIERS = new Set(['cái', 'con', 'chiếc', 'người', 'quyển', 'cuốn', 'cây', 'tờ', 'bộ']);

const classifyViWord = (raw) => {
  const w = raw.toLowerCase();
  if (VI_MARKERS[w]) return VI_MARKERS[w];
  if (VI_CLASSIFIERS.has(w)) return ['classifier', '분류사(loại từ) — 뒤 명사의 종류'];
  return ['word', '내용어'];
};

export const analyzeFrench = (text) => {
  const res = analyzeByWord('fr', text, classifyFrWord, '🇫🇷 프랑스어는 SVO이며 관사·대명사·전치사가 풍부합니다. 동사 être/avoir 가 시제(복합과거 등)의 보조 역할을 합니다.');
  const aux = res.phrases.find((p) => p.label.role === '조동사');
  if (aux) {
    aux.label = { role: '술어(보조)', detail: '조동사 — 시제·완료', color: 'emerald' };
    res.chunks = chunkPhrases(res.phrases, 'fr');
  }
  return res;
};

export const analyzeSpanish = (text) => analyzeByWord('es', text, classifyEsWord, '🇪🇸 스페인어 동사는 인칭·시제로 활용됩니다. ser/estar 의 차이(영속 vs 상태)에 주목하세요.');

export const analyzeVietnamese = (text) => analyzeByWord('vi', text, classifyViWord, '🇻🇳 베트남어는 어순이 SVO 이며 굴절이 없습니다. đã/đang/sẽ 같은 시제 표지와 분류사(cái/con/chiếc…)에 주목하세요.');

// ===========================================================================
// 그 밖의 언어 — 어휘 단위로만 쪼갠다
// ===========================================================================

export const analyzeGeneric = (text, lang) => {
  const note = '이 언어에는 내장 분석기가 없어 어휘 단위로만 보여 드려요. 아래 Gemini 정밀 분석을 쓰면 품사·역할까지 볼 수 있어요.';
  if (/\s/.test(text.trim())) return analyzeByWord(baseLang(lang) || 'xx', text, () => ['word', '단어 — 문맥에서 역할 파악'], note);
  // 띄어쓰기가 없는 문자(태국어·미얀마어·크메르어 등)는 2글자씩 끊어 읽기 쉽게만 한다
  const phrases = [];
  const t = text.trim();
  for (let i = 0; i < t.length; i += 2) phrases.push(phraseFor(t.slice(i, i + 2), 'word', '글자 단위 — 정확한 분절은 Gemini 필요'));
  return buildResult(baseLang(lang) || 'xx', text, phrases, note);
};

// ===========================================================================
// 진입점
// ===========================================================================

const ANALYZERS = {
  ko: analyzeKorean, ja: analyzeJapanese, zh: analyzeChinese,
  en: analyzeEnglish, fr: analyzeFrench, es: analyzeSpanish, vi: analyzeVietnamese,
};

export const analyzeSentence = (text, lang) => {
  const t = String(text || '');
  const fn = ANALYZERS[baseLang(lang)];
  const res = !t.trim() ? buildResult(baseLang(lang), '', [], '') : fn ? fn(t) : analyzeGeneric(t, lang);
  return { ...res, languageLabel: `${langFlag(lang)} ${langName(lang)}` };
};
