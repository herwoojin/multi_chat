// src/lib/languages.js
// ★ 19개 언어의 단일 출처. 설정 화면·헤더 셀렉터·뱃지·Functions 가 전부 여기서 읽는다.
//   이 파일은 브라우저와 Netlify Functions(Node) 양쪽에서 import 되므로 순수 JS 로만 둔다.
export const LANGUAGES = [
  { code: 'ko',    name: '한국어',           flag: '🇰🇷', speech: 'ko-KR',  latin: false },
  { code: 'en',    name: 'English',          flag: '🇺🇸', speech: 'en-US',  latin: true  },
  { code: 'zh-CN', name: '中文',             flag: '🇨🇳', speech: 'zh-CN',  latin: false },
  { code: 'ja',    name: '日本語',           flag: '🇯🇵', speech: 'ja-JP',  latin: false },
  { code: 'ru',    name: 'Русский',          flag: '🇷🇺', speech: 'ru-RU',  latin: false },
  { code: 'es',    name: 'Español',          flag: '🇪🇸', speech: 'es-ES',  latin: true  },
  { code: 'vi',    name: 'Tiếng Việt',       flag: '🇻🇳', speech: 'vi-VN',  latin: true  },
  { code: 'mn',    name: 'Монгол',           flag: '🇲🇳', speech: 'mn-MN',  latin: false },
  { code: 'ar',    name: 'العربية',           flag: '🇸🇦', speech: 'ar-SA',  latin: false },
  { code: 'fr',    name: 'Français',         flag: '🇫🇷', speech: 'fr-FR',  latin: true  },
  { code: 'km',    name: 'ភាសាខ្មែរ',          flag: '🇰🇭', speech: 'km-KH',  latin: false },
  { code: 'bn',    name: 'বাংলা',             flag: '🇧🇩', speech: 'bn-BD',  latin: false },
  { code: 'uz',    name: 'Oʻzbek',           flag: '🇺🇿', speech: 'uz-UZ',  latin: true  },
  { code: 'si',    name: 'සිංහල',            flag: '🇱🇰', speech: 'si-LK',  latin: false },
  { code: 'my',    name: 'မြန်မာ',            flag: '🇲🇲', speech: 'my-MM',  latin: false },
  { code: 'tl',    name: 'Filipino',         flag: '🇵🇭', speech: 'fil-PH', latin: true  },
  { code: 'th',    name: 'ไทย',              flag: '🇹🇭', speech: 'th-TH',  latin: false },
  { code: 'id',    name: 'Bahasa Indonesia', flag: '🇮🇩', speech: 'id-ID',  latin: true  },
  { code: 'ne',    name: 'नेपाली',            flag: '🇳🇵', speech: 'ne-NP',  latin: false },
];

export const LANG_MAP = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));
export const langName = (code) => LANG_MAP[code]?.name || code || '알 수 없음';
export const langFlag = (code) => LANG_MAP[code]?.flag || '🌐';
export const speechLocale = (code) => LANG_MAP[code]?.speech || 'en-US';
export const isLatin = (code) => LANG_MAP[code]?.latin ?? true;
export const isSupported = (code) => Boolean(LANG_MAP[code]);

// Google 이 돌려주는 코드를 우리 코드로 정규화한다.
// zh / zh-Hans / zh-cn → zh-CN,  fil → tl,  in → id  등
const ALIAS = {
  zh: 'zh-cn', 'zh-hans': 'zh-cn', 'zh-cn': 'zh-cn', 'zh-tw': 'zh-cn', 'zh-hant': 'zh-cn',
  fil: 'tl', in: 'id', iw: 'he',
};
export const normalizeLang = (raw) => {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace('_', '-');
  const aliased = ALIAS[k] || k;
  const hit = LANGUAGES.find((l) => l.code.toLowerCase() === aliased);
  if (hit) return hit.code;
  const base = aliased.split('-')[0];
  return LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base)?.code || null;
};
