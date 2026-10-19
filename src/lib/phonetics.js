// src/lib/phonetics.js — 라틴 문자 문장을 한글 발음 가이드로 바꾼다 (meet4u 에서 이식).
// 한국어 사용자가 영어·프랑스어·베트남어 문장을 소리 내어 읽어 볼 수 있게 하는 용도라 정확도보다 읽기 쉬움을 택한다.
// 비라틴 문자(한·중·일·러…)의 발음은 Google 음차(로마자)를 쓰므로 여기서 다루지 않는다.

const stripDiacritics = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// 언어별 전처리: 한국어 화자가 읽기에 가까운 유사 로마자로 바꿔 둔다.
const PREPROCESSORS = {
  fr: (w) => w
    .replace(/œ/g, 'eu').replace(/æ/g, 'ae')
    .replace(/ç/g, 's')
    .replace(/é|è|ê|ë/g, 'e').replace(/à|â/g, 'a').replace(/î|ï/g, 'i')
    .replace(/ô|ö/g, 'o').replace(/û|ù|ü/g, 'u')
    .replace(/eaux?\b/g, 'o').replace(/aux?\b/g, 'o').replace(/eau/g, 'o')
    .replace(/qu/g, 'k').replace(/gn/g, 'ny')
    .replace(/ch/g, 'sh').replace(/ph/g, 'f')
    .replace(/ill/g, 'iy')
    .replace(/oin/g, 'wang').replace(/oi/g, 'wa')
    .replace(/oui/g, 'wi').replace(/ou/g, 'u')
    .replace(/ai|ei/g, 'e')
    .replace(/eu/g, 'oe')
    .replace(/ent\b/g, 'ang').replace(/(an|en|am|em)/g, 'ang')
    .replace(/(on|om)/g, 'ong').replace(/(in|im|yn|ym)/g, 'eng')
    .replace(/(un|um)/g, 'eong')
    .replace(/j/g, 'zh')
    .replace(/^h/, '').replace(/(?<=[aeiou])h/g, '')
    .replace(/s\b/g, '').replace(/d\b/g, '').replace(/t\b/g, '')
    .replace(/x\b/g, '').replace(/z\b/g, '').replace(/p\b/g, ''),

  es: (w) => w
    .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
    .replace(/ó/g, 'o').replace(/ú|ü/g, 'u')
    .replace(/ñ/g, 'ny')
    .replace(/ll/g, 'y').replace(/rr/g, 'r')
    .replace(/qu/g, 'k').replace(/gu([ei])/g, 'g$1')
    .replace(/c([ei])/g, 's$1').replace(/c/g, 'k')
    .replace(/g([ei])/g, 'h$1')
    .replace(/j/g, 'h')
    .replace(/h/g, '')
    .replace(/z/g, 's')
    .replace(/v/g, 'b'),

  vi: (w) => w
    .replace(/đ/g, 'd')
    .replace(/ơ|ô/g, 'o').replace(/ư/g, 'eu').replace(/ă|â/g, 'a').replace(/ê/g, 'e')
    .replace(/[̀-ͯ]/g, '')
    .replace(/nh\b/g, 'ng')
    .replace(/qu/g, 'kw').replace(/gi/g, 'zi').replace(/ph/g, 'f')
    .replace(/kh/g, 'k').replace(/th/g, 't').replace(/tr/g, 'ch'),

  en: (w) => w
    .replace(/ough\b/g, 'o').replace(/ought\b/g, 'ot')
    .replace(/tion\b/g, 'shun').replace(/sion\b/g, 'shun')
    .replace(/ture\b/g, 'cheo').replace(/qu/g, 'kw')
    .replace(/th/g, 'd').replace(/ph/g, 'f')
    .replace(/ck/g, 'k').replace(/wh/g, 'w')
    .replace(/oo/g, 'u').replace(/ee/g, 'i').replace(/ea/g, 'i').replace(/ai/g, 'ei')
    .replace(/ay\b/g, 'ei').replace(/oy\b/g, 'oi').replace(/ou/g, 'au').replace(/ow/g, 'au')
    .replace(/er\b/g, 'eo').replace(/y\b/g, 'i')
    .replace(/c(?=[ei])/g, 's').replace(/c/g, 'k')
    .replace(/g(?=[ei])/g, 'j').replace(/x/g, 'ks'),
};

// 마지막 단계의 자음+모음 매핑. 긴 조합이 먼저 와야 sh·ch·ng 가 s·c·n 보다 우선한다.
const LATIN_HANGUL_RULES = [
  [/sha/g, '샤'], [/she/g, '셰'], [/shi/g, '시'], [/sho/g, '쇼'], [/shu/g, '슈'],
  [/cha/g, '차'], [/che/g, '체'], [/chi/g, '치'], [/cho/g, '초'], [/chu/g, '추'],
  [/zha/g, '쟈'], [/zhe/g, '제'], [/zhi/g, '지'], [/zho/g, '죠'], [/zhu/g, '쥬'],
  [/nya/g, '냐'], [/nye/g, '녜'], [/nyi/g, '니'], [/nyo/g, '뇨'], [/nyu/g, '뉴'],
  [/kwa/g, '콰'], [/kwe/g, '퀘'], [/kwi/g, '퀴'], [/kwo/g, '쿼'],
  [/wa/g, '와'], [/we/g, '웨'], [/wi/g, '위'], [/wo/g, '워'], [/wu/g, '우'],
  [/ya/g, '야'], [/ye/g, '예'], [/yi/g, '이'], [/yo/g, '요'], [/yu/g, '유'],

  [/ai/g, '아이'], [/ei/g, '에이'], [/oi/g, '오이'], [/au/g, '아우'], [/ou/g, '오우'],
  [/ae/g, '에'], [/oe/g, '외'], [/ie/g, '이에'], [/eo/g, '어'], [/iu/g, '이우'],

  [/ba/g, '바'], [/be/g, '베'], [/bi/g, '비'], [/bo/g, '보'], [/bu/g, '부'],
  [/pa/g, '파'], [/pe/g, '페'], [/pi/g, '피'], [/po/g, '포'], [/pu/g, '푸'],
  [/da/g, '다'], [/de/g, '데'], [/di/g, '디'], [/do/g, '도'], [/du/g, '두'],
  [/ta/g, '타'], [/te/g, '테'], [/ti/g, '티'], [/to/g, '토'], [/tu/g, '투'],
  [/ka/g, '카'], [/ke/g, '케'], [/ki/g, '키'], [/ko/g, '코'], [/ku/g, '쿠'],
  [/ga/g, '가'], [/ge/g, '게'], [/gi/g, '기'], [/go/g, '고'], [/gu/g, '구'],
  [/fa/g, '파'], [/fe/g, '페'], [/fi/g, '피'], [/fo/g, '포'], [/fu/g, '푸'],
  [/va/g, '바'], [/ve/g, '베'], [/vi/g, '비'], [/vo/g, '보'], [/vu/g, '부'],
  [/sa/g, '사'], [/se/g, '세'], [/si/g, '시'], [/so/g, '소'], [/su/g, '수'],
  [/za/g, '자'], [/ze/g, '제'], [/zi/g, '지'], [/zo/g, '조'], [/zu/g, '주'],
  [/ja/g, '자'], [/je/g, '제'], [/ji/g, '지'], [/jo/g, '조'], [/ju/g, '주'],
  [/ha/g, '하'], [/he/g, '헤'], [/hi/g, '히'], [/ho/g, '호'], [/hu/g, '후'],
  [/ma/g, '마'], [/me/g, '메'], [/mi/g, '미'], [/mo/g, '모'], [/mu/g, '무'],
  [/na/g, '나'], [/ne/g, '네'], [/ni/g, '니'], [/no/g, '노'], [/nu/g, '누'],
  [/la/g, '라'], [/le/g, '레'], [/li/g, '리'], [/lo/g, '로'], [/lu/g, '루'],
  [/ra/g, '라'], [/re/g, '레'], [/ri/g, '리'], [/ro/g, '로'], [/ru/g, '루'],

  [/ng\b/g, 'ㅇ'], [/nk\b/g, 'ㅇ크'], [/nt\b/g, 'ㄴ트'], [/nd\b/g, 'ㄴ드'],
  [/m\b/g, 'ㅁ'], [/n\b/g, 'ㄴ'], [/l\b/g, 'ㄹ'], [/r\b/g, '르'],

  [/a/g, '아'], [/e/g, '에'], [/i/g, '이'], [/o/g, '오'], [/u/g, '우'],

  [/b/g, '브'], [/p/g, '프'], [/d/g, '드'], [/t/g, '트'],
  [/k/g, '크'], [/g/g, '그'], [/f/g, '프'], [/v/g, '브'],
  [/s/g, '스'], [/z/g, '즈'], [/j/g, '즈'], [/h/g, '흐'],
  [/m/g, 'ㅁ'], [/n/g, 'ㄴ'], [/l/g, 'ㄹ'], [/r/g, '르'],
  [/c/g, '크'], [/x/g, '크스'], [/y/g, '이'], [/w/g, '우'], [/q/g, '크'],
];

// 남은 낱자음을 앞 글자의 받침으로 합친다: "보ㅇ쥬르" → "봉쥬르"
const JONG_OF_JAMO = {
  'ㄱ': 1, 'ㄲ': 2, 'ㄴ': 4, 'ㄷ': 7, 'ㄹ': 8, 'ㅁ': 16, 'ㅂ': 17,
  'ㅅ': 19, 'ㅆ': 20, 'ㅇ': 21, 'ㅈ': 22, 'ㅊ': 23, 'ㅋ': 24, 'ㅌ': 25, 'ㅍ': 26, 'ㅎ': 27,
};
const composeFinalJamo = (text) => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const next = text[i + 1];
    if (next && JONG_OF_JAMO[next] && code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 0) {
      out += String.fromCharCode(code + JONG_OF_JAMO[next]);
      i++;
      continue;
    }
    out += text[i];
  }
  return out;
};

const transliterateWord = (rawWord, langBase) => {
  const match = rawWord.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}']*)(.*)$/u);
  if (!match || !match[2]) return rawWord;
  const [, leading, core, trailing] = match;
  let w = core.toLowerCase();
  const pre = PREPROCESSORS[langBase];
  if (pre) w = pre(w);
  w = stripDiacritics(w);
  for (const [pat, han] of LATIN_HANGUL_RULES) w = w.replace(pat, han);
  w = composeFinalJamo(w.replace(/[a-z]/g, '')); // 남은 라틴 문자는 흘리지 않는다
  return leading + w + trailing;
};

export const latinToHangul = (text, lang = '') => {
  if (!text) return '';
  const langBase = String(lang).split('-')[0].toLowerCase();
  return text.split(/(\s+)/).map((part) => (!part || /^\s+$/.test(part) ? part : transliterateWord(part, langBase))).join('');
};
