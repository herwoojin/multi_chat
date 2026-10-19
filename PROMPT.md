# PROMPT — 말.통 (MAL.TONG) 구현 지시서

> **사용법**: 아래 `=== 여기서부터 복사 ===` 부터 끝까지 전체를 복사해서
> AI 코딩 도구(Claude Code, Cursor, Antigravity 등)에 붙여넣으세요.
> 막히는 부분이 생기면 그때 `TRD.md` 의 해당 섹션을 추가로 붙여넣으면 됩니다.

---

=== 여기서부터 복사 ===

# 다국어 실시간 대화 웹앱을 만들어 주세요

## 0. 가장 중요한 요구사항 — 먼저 읽어주세요

이 앱의 존재 이유는 단 하나입니다.

> **메시지 하나하나의 언어를 실제로 감지해서, 보는 사람이 설정한 언어로 번역해
> 보여주고 읽어준다.**

제가 이전에 만든 비슷한 앱은 **보낸 사람의 프로필 언어 설정**을 그 메시지의 원문
언어로 기록했습니다. 그래서 한국어로 설정한 사람이 영어로 "Awesome" 이라고 쓰면
그 메시지에 🇰🇷한국어 라고 표시되고, 한국어 사용자에게는 "원문과 같은 언어" 로
판정되어 번역이 통째로 건너뛰어졌습니다.

**이 실수를 반복하지 마세요.** 원문 언어는 반드시 **문장 자체를 감지**해서 정합니다.
보낸 사람의 설정값은 감지에 실패했을 때의 폴백으로만 씁니다.

구체적으로 이렇게 동작해야 합니다.

```
내 설정이 한국어일 때
  상대가 영어로 말함  → 영어 감지 → 한국어로 번역해 보여주고 한국어로 읽어줌
  상대가 중국어로 말함 → 중국어 감지 → 한국어로 번역해 보여주고 한국어로 읽어줌

내 설정이 영어일 때
  상대가 일본어로 말함 → 일본어 감지 → 영어로 번역해 보여주고 영어로 읽어줌

같은 메시지라도 보는 사람마다 다른 언어로 보여야 합니다.
```

---

## 1. 기술 스택 (이대로 써주세요)

- React 19 + Vite 7 + Tailwind CSS 3
- **react-router-dom v7 의 `HashRouter`** — 초대 링크가 어느 호스팅에서든 404 없이 열려야 함
- Firebase: Auth(**익명 + Google**), Firestore, Storage
- Netlify Functions (ESM, esbuild) — 번역·TTS 프록시
- lucide-react 아이콘
- 배포: Netlify

**유료 API 를 쓰지 마세요.** 번역과 음성은 전부 무료 수단으로 해결합니다.

---

## 2. 언어 목록 — `src/lib/languages.js` 하나에만 둘 것

19개 언어를 지원합니다. 이 배열을 **단일 출처**로 두고, 설정 화면·헤더 셀렉터·
뱃지가 전부 여기서 읽어 쓰게 하세요. 두 군데 이상에 복사해 두면 반드시 어긋납니다.

```js
export const LANGUAGES = [
  { code: 'ko',    name: '한국어',           flag: '🇰🇷', speech: 'ko-KR' },
  { code: 'en',    name: 'English',          flag: '🇺🇸', speech: 'en-US' },
  { code: 'zh-CN', name: '中文',             flag: '🇨🇳', speech: 'zh-CN' },
  { code: 'ja',    name: '日本語',           flag: '🇯🇵', speech: 'ja-JP' },
  { code: 'ru',    name: 'Русский',          flag: '🇷🇺', speech: 'ru-RU' },
  { code: 'es',    name: 'Español',          flag: '🇪🇸', speech: 'es-ES' },
  { code: 'vi',    name: 'Tiếng Việt',       flag: '🇻🇳', speech: 'vi-VN' },
  { code: 'mn',    name: 'Монгол',           flag: '🇲🇳', speech: 'mn-MN' },
  { code: 'ar',    name: 'العربية',           flag: '🇸🇦', speech: 'ar-SA' },
  { code: 'fr',    name: 'Français',         flag: '🇫🇷', speech: 'fr-FR' },
  { code: 'km',    name: 'ភាសាខ្មែរ',          flag: '🇰🇭', speech: 'km-KH' },
  { code: 'bn',    name: 'বাংলা',             flag: '🇧🇩', speech: 'bn-BD' },
  { code: 'uz',    name: 'Oʻzbek',           flag: '🇺🇿', speech: 'uz-UZ' },
  { code: 'si',    name: 'සිංහල',            flag: '🇱🇰', speech: 'si-LK' },
  { code: 'my',    name: 'မြန်မာ',            flag: '🇲🇲', speech: 'my-MM' },
  { code: 'tl',    name: 'Filipino',         flag: '🇵🇭', speech: 'fil-PH' },
  { code: 'th',    name: 'ไทย',              flag: '🇹🇭', speech: 'th-TH' },
  { code: 'id',    name: 'Bahasa Indonesia', flag: '🇮🇩', speech: 'id-ID' },
  { code: 'ne',    name: 'नेपाली',            flag: '🇳🇵', speech: 'ne-NP' },
];
```

Google 이 `zh`, `zh-Hans`, `fil` 같은 변형 코드를 돌려주므로, 이를 위 코드로 바꾸는
`normalizeLang(raw)` 함수도 같은 파일에 만들어 주세요.

---

## 3. 감지 + 번역 — 한 번의 요청으로 둘 다

Google Translate 의 `client=gtx` 엔드포인트는 `sl=auto` 로 부르면
**번역문과 감지된 원문 언어를 같은 응답에** 돌려줍니다. 감지용 호출을 따로 만들지 마세요.

**요청**
```
GET https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=<인코딩된 텍스트>
```

**응답**
```json
[ [ ["번역문","원문",null,null,10] ], null, "en", null,null,null,null,[] ]
     └ data[0] 청크 배열                      └ data[2] = 감지된 언어
```

**두 가지를 꼭 지켜주세요.**

1. `data[2]` 가 감지된 원문 언어입니다. 이걸 쓰세요.
2. 긴 글은 `data[0]` 에 **여러 조각으로 쪼개져** 옵니다.
   `data[0].map(c => c[0]).join('')` 로 **전부 이어 붙이세요.**
   `data[0][0][0]` 만 읽으면 긴 문장이 중간에 잘립니다.

브라우저에서 직접 호출하면 CORS 로 막히므로 **반드시 Netlify Function 을 경유**합니다.

### `netlify/functions/translate.js`

```
POST /api/translate
{ "text": "...", "targetLang": "ko", "sourceLang": "auto" }
→ 200 { "translatedText": "...", "detectedLang": "en", "romanization": null }
```

상류가 429 를 주면 429 를, 파싱 실패면 502 를 그대로 돌려주세요.
클라이언트는 실패 시 원문을 그대로 보여주면 됩니다(빈칸 금지).

---

## 4. 번역을 언제 요청하고 어디에 저장하나

### 4.1 요청하지 않는 경우 (사전 필터)

호출 전에 걸러냅니다.

- 내가 보낸 메시지
- 이미 `translations[내 언어]` 가 있는 경우 (캐시 적중)
- `detectedLang` 이 이미 내 언어와 같은 경우
- URL 만 있는 메시지
- 숫자·기호·이모지만 있는 메시지
- 공백 제외 길이 0

### 4.2 짧은 문장 규칙

`ㅋㅋ`, `Wow`, `OK` 같은 **공백 제외 4자 미만** 문장은 어떤 감지기도 틀립니다.
감지는 시도하되 `detectionConfidence: 'low'` 를 달고, **보낸 사람의 설정 언어를
우선**하세요. 사용자가 뱃지를 탭해 직접 고칠 수 있게 합니다.

### 4.3 결과를 Firestore 에 되돌려 쓰기 (중요)

번역을 받아오면 그 메시지 문서에 저장하세요. 같은 언어를 쓰는 다른 사람은
번역 요청 없이 그대로 읽습니다. **반드시 점 표기법으로 한 키만** 씁니다.

```js
// ✅ 맞음
await updateDoc(ref, { 'translations.ko': 결과 });

// ❌ 틀림 — 다른 언어 번역이 전부 날아감
await updateDoc(ref, { translations: { ko: 결과 } });
```

같은 탭에서 같은 메시지를 중복 요청하지 않도록 `useRef(new Set())` 로
in-flight 가드를 두세요. 키는 `` `${messageId}:${myLang}` `` 입니다.

---

## 5. 데이터 모델

### `users/{uid}`
```
displayName  string
photoURL     string|null
isAnonymous  boolean
myLanguage   string   기본 'ko'   ← 내가 읽고 들을 언어
autoSpeak    boolean  기본 false
speechRate   number   기본 1.0
showOriginal boolean  기본 false
createdAt    timestamp
```

### `rooms/{roomId}`
```
name            string
ownerUid        string
inviteCode      string   8자 A-Z0-9
inviteEnabled   boolean
memberUids      array<string>    ← 보안 규칙이 이걸로 판정
memberCount     number
activeLanguages array<string>
lastMessage     map { text, senderName, detectedLang, at }
createdAt, updatedAt  timestamp
```

### `rooms/{roomId}/messages/{messageId}`
```
senderUid           string
senderName          string
senderPhotoURL      string|null
senderLang          string    ← 작성자 설정값 스냅샷. 폴백 전용. 신뢰도 낮음
type                'text'|'image'|'system'
text                string    ← 원문. 절대 수정 금지
detectedLang        string|null  ← ★ 실제 감지 결과. 첫 번역 때 1회 기록
detectionConfidence 'high'|'low'
detectionSource     'auto'|'manual'
translations        map<langCode, string>
pronunciations      map<langCode, string>
imageUrl            string|null
createdAt           timestamp
deletedAt           timestamp|null
```

**`senderLang` 과 `detectedLang` 을 반드시 분리하세요.** 하나로 합치면 0번 항목의
버그가 그대로 재현됩니다. 읽을 때 우선순위는:

```js
const srcLang = m.detectedLang || m.senderLang || 'ko';
```

**메시지를 보낼 때 `detectedLang` 을 채우지 마세요.** 비워 두고 첫 번역 때 기록합니다.

---

## 6. 보안 규칙에서 빠뜨리기 쉬운 것

이 앱은 **메시지를 읽는 사람이 그 메시지를 수정합니다**(번역을 채워 넣음).
"작성자만 수정 가능" 으로 두면 번역 캐시가 `permission-denied` 로 전부 실패합니다.

```javascript
match /rooms/{roomId}/messages/{messageId} {
  allow read: if isMember(roomId);

  allow create: if isMember(roomId)
    && request.resource.data.senderUid == request.auth.uid
    && request.resource.data.text.size() <= 5000;

  allow update: if isMember(roomId) && (
    // 작성자는 소프트 삭제만
    (resource.data.senderUid == request.auth.uid
     && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['deletedAt']))

    // ★ 누구든 번역 관련 키만은 채울 수 있다
    || request.resource.data.diff(resource.data).affectedKeys().hasOnly([
         'translations','pronunciations',
         'detectedLang','detectionConfidence','detectionSource'
       ])
  );

  allow delete: if false;
}
```

또한 `firestore.indexes.json` 의 `fieldOverrides` 에서 `translations` 와
`pronunciations` 의 **인덱스를 꺼주세요**. 맵 키가 언어마다 늘어나는데 Firestore 가
기본적으로 전부 인덱싱해서 쓰기 비용이 몇 배가 됩니다.

```json
"fieldOverrides": [
  { "collectionGroup": "messages", "fieldPath": "translations",   "indexes": [] },
  { "collectionGroup": "messages", "fieldPath": "pronunciations", "indexes": [] }
]
```

---

## 7. 화면

### 7.1 라우트 (HashRouter)

| 경로 | 화면 |
|---|---|
| `/` | 방 만들기 / 초대코드 입력 |
| `/join/:inviteCode` | 이름 + 내 언어 선택 → 바로 입장 (가입 없음) |
| `/room/:roomId` | 대화방 (메인) |
| `/room/:roomId/f2f` | 대면 통역 모드 |
| `/settings` | 내 언어, 자동 음성, 말 속도, 표시 이름 |

### 7.2 대화방 레이아웃

```
┌──────────────────────────────────────────────┐
│ 💬 방 이름        👥3  🔊  [🇰🇷 한국어 ▾]  ⋮  │  헤더(고정)
├──────────────────────────────────────────────┤
│  ┌─ 🇺🇸 Michael ────────── 오후 2:14          │
│  │ 내일 저녁 7시에 만날 수 있을까요?         │  ← 번역문이 본문(크게)
│  │ ▸ 원문 보기                               │  ← 접힘. 탭하면 펼침
│  │ 🔊 📋                                     │
│  └────────────────────────────────────────   │
│           오후 2:15 ────────── 나 🇰🇷 ─┐      │
│            네 좋아요. 어디서 볼까요?    │      │
│           ─────────────────────────────┘      │
├──────────────────────────────────────────────┤
│ ⭐ [ 메시지를 입력하세요...      ] 📷 🎤 ➤   │  입력줄(고정)
└──────────────────────────────────────────────┘
```

**레이아웃 규칙**

- **번역문이 본문이고 원문이 보조입니다.** 읽는 사람 입장에서 이해되는 문장이 먼저
  와야 합니다. 원문은 아래에 작은 회색 글씨로 접어 두고 탭하면 펼칩니다.
- 언어 뱃지는 이름 옆에 둡니다. **탭하면 감지 결과를 수동으로 고칠 수 있어야 합니다.**
  고치면 `translations` 와 `pronunciations` 를 **전부 비우고** 다시 번역합니다.
  (잘못된 원문 언어로 만든 번역은 전부 틀렸으므로)
- 번역 대기 중에는 **빈칸을 두지 말고** 원문을 흐리게 + 작은 스피너를 겹쳐 보여줍니다.
- 내 메시지는 번역하지 않습니다.
- 뱃지에 국기만 쓰지 말고 언어명을 함께 적습니다(접근성).

### 7.3 헤더의 언어 셀렉터 — 반드시 헤더에

내 언어 셀렉터를 **설정 화면 안에만 두지 마세요.** 이전에 그렇게 했다가 모바일에서
접근 경로가 끊겨 번역 기능 전체가 멈춘 적이 있습니다. 대화방 헤더에 상시 노출하고,
설정 화면에도 중복으로 둡니다.

바꾸는 즉시 이미 떠 있는 메시지들이 새 언어로 다시 렌더되어야 합니다
(`useEffect` 의존성 배열에 `myLang` 을 꼭 넣으세요).

---

## 8. 음성 (TTS)

### 8.1 끝까지 읽기

Google TTS 는 **요청당 약 200자** 제한이 있습니다. 넘기면 중간에 잘립니다.
텍스트를 **문장 끝 → 쉼표 → 공백 → 강제** 순으로 180자 이하 청크로 쪼개고
순서대로 이어 재생하는 큐를 만드세요. `stop()` 으로 중간에 끊을 수 있어야 합니다.

### 8.2 무엇을 어떤 언어로 읽나

- 🔊 버튼은 **원문이 아니라 내 언어 번역문**을 읽습니다.
- 내가 쓴 메시지는 원문을 원문 언어로 읽습니다.

### 8.3 자동 음성

- 기본값 **꺼짐**.
- 켜져 있어도 **남이 보낸 메시지만** 읽습니다.
- `document.hidden` 이면 읽지 않습니다.
- **방에 처음 들어왔을 때 과거 메시지를 몰아서 읽으면 안 됩니다.**
  구독 시작 시점의 메시지들은 "이미 읽은 것"으로 표시만 하고 넘어가는
  `ready` 플래그를 두세요.

### 8.4 iOS 대응

사용자 제스처 없이 `audio.play()` 를 처음 호출하면 iOS Safari 가 차단합니다.
**자동 음성 토글을 켜는 순간 무음 오디오를 한 번 재생**해 오디오 컨텍스트를
해제해 두세요.

### 8.5 폴백

Google TTS 가 실패하면 브라우저 내장 `speechSynthesis` 로 떨어집니다.
`utterance.lang` 에는 `languages.js` 의 `speech` 로케일(`ko-KR` 등)을 넣습니다.

### `netlify/functions/tts.js`

```
GET /api/tts?text=...&lang=ko
→ audio/mpeg 스트림, Cache-Control: public, max-age=86400
```

상류는 `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=<lang>&q=<text>&textlen=<len>` 이며
`User-Agent` 와 `Referer` 헤더가 필요합니다. 응답은 base64 로 돌려주세요
(`isBase64Encoded: true`).

---

## 9. 음성 입력 (STT)

Web Speech Recognition 을 씁니다. `recognition.lang` 에는 **내 언어의 로케일**을
넣습니다. 받아쓴 결과는 입력창에 들어가고, 보낼 때 평소처럼 감지를 거칩니다.

**Firefox 는 이 API 를 지원하지 않고, iOS Safari 는 불안정합니다.**
미지원 브라우저에서는 **마이크 버튼을 숨기세요.** 눌러도 아무 일도 안 일어나는 버튼을
두지 마세요.

---

## 10. 대면 통역 모드 (`/room/:roomId/f2f`)

한 기기를 마주 놓고 쓰는 휘발성 화면입니다. Firestore 에 저장하지 않습니다.

```
┌─────────────────────┐
│   English (상대)     │  ← transform: rotate(180deg) 로 뒤집음
│  "Nice to meet you" │
│        🔊           │
├─────────────────────┤
│  [🎤 눌러서 말하기]   │  ← 공용 버튼
├─────────────────────┤
│   한국어 (나)        │
│  "만나서 반갑습니다"  │
└─────────────────────┘
```

마이크로 받아쓴 텍스트를 `sl=auto` 로 번역 요청하고, 응답의 `detectedLang` 으로
**어느 쪽이 말했는지 판정**해서 반대편 영역에 큰 글씨로 띄우고 바로 읽어줍니다.

---

## 11. 게스트 입장

초대 링크를 받은 사람이 **가입 없이** 들어올 수 있어야 합니다.

- Firebase **익명 인증**(`signInAnonymously`)을 씁니다.
- `/join/:inviteCode` 에서 이름과 내 언어만 입력받고 바로 입장시킵니다.
- 같은 브라우저로 다시 오면 같은 사람으로 인식되도록
  `setPersistence(auth, browserLocalPersistence)` 를 **명시적으로 설정**하세요.
- 나중에 Google 계정으로 승격할 수 있게 `linkWithPopup` 경로를 남겨 두세요.

**주의**: 초대 코드로 방을 찾는 쿼리는 아직 멤버가 아닌 사람이 실행합니다.
보안 규칙상 클라이언트에서 직접 조회하면 거부되고, 규칙을 열면 방 목록 열람 취약점이
됩니다. **입장 처리를 `joinRoom` Netlify Function 으로 옮겨** Admin SDK 로 코드를
조회하고 멤버 배열에 추가하세요.

---

## 12. 서버 용량 신호등

화면 우측 하단(`position: fixed; right:12px; bottom:12px;`)에 배터리 모양 인디케이터를
둡니다. 서버리스라 헬스 엔드포인트가 없으므로 `localStorage` 일/월 카운터로 추정합니다.

- 집계: Firestore 읽기/쓰기(일 단위), Functions 호출(월 단위)
- `window.fetch` 를 **한 번만** 감싸 `/api/` 호출을 자동 집계 (이중 패치 가드 필수)
- 임계: 모든 메트릭 사용률 중 worst 기준 40% / 70% / 90%
- 색: ok `#43a047` · warn `#fbc02d` · danger `#f57c00` · critical `#e53935`
- 모션: critical 0.6s 점멸 / danger 1.2s / warn 느린 호흡 / ok 정적
- 클릭하면 상세 메트릭 팝오버
- 모바일에서 `safe-area-inset` 고려

---

## 13. 기술 스택 인벤토리 (필수 산출물)

프로젝트 루트에 **`techstack.json` 과 `TECH_STACK.md` 를 함께** 만들어 주세요.
둘 다 항상 같은 커밋에서 갱신합니다.

- `techstack.json` — 머신 판독용. 최상위 `project`, `description`, `lastUpdated`,
  `architectureSummary`, `repo` + `categories[]`(각 `name`, `items[]`),
  각 item 은 최소 `name` + `purpose`, 가능하면 `version`, `config`
- `TECH_STACK.md` — 사람이 읽는 용도.
  ① 한 줄 요약 + 최종 수정일 ② 아키텍처 다이어그램(Mermaid)
  ③ 카테고리별 표(이름/버전/용도/위치/비고) ④ "왜 이걸 골랐나"
  ⑤ 외부 의존 서비스 헬스·요금 영향 ⑥ 알려진 한계

카테고리에 **"운영 가시성(Observability)"** 항목으로 12번 신호등을 등록하세요.

---

## 14. 피해야 할 함정 모음

구현 중에 이 표를 옆에 두세요. 전부 실제로 겪은 것들입니다.

| 증상 | 원인 | 대응 |
|---|---|---|
| 영어로 쓴 글에 🇰🇷 뱃지 | 보낸 사람 설정을 원문 언어로 씀 | 메시지마다 `sl=auto` 로 실제 감지 |
| 긴 문장이 중간에 잘림 | `data[0][0][0]` 만 읽음 | 모든 청크 `join('')` |
| TTS 가 200자에서 멈춤 | 요청당 한도 | 청크 분할 + 순차 재생 |
| iOS 에서 자동 음성 무음 | 제스처 없는 `play()` 차단 | 토글 켤 때 무음 1회 재생 |
| 언어를 바꿔도 화면 그대로 | `useEffect` 의존성에 `myLang` 누락 | 의존성 배열에 추가 |
| 같은 번역이 수십 번 요청됨 | in-flight 가드 없음 | `useRef(new Set())` |
| 번역이 저장 안 됨(permission-denied) | 규칙이 작성자만 수정 허용 | 번역 키만 멤버에게 허용 |
| 들어오자마자 과거 메시지 몰아 읽음 | 첫 스냅샷도 신규로 봄 | `ready` 플래그 |
| `zh` 와 `zh-CN` 이 다른 언어 취급 | 코드 정규화 없음 | `normalizeLang()` |
| 초대 링크 404 | BrowserRouter + rewrite 미설정 | **HashRouter** |
| 익명 사용자가 새로고침하면 남이 됨 | persistence 미설정 | `browserLocalPersistence` |
| Firestore 문서 1MB 초과 | 장문 × 19언어 누적 | 2000자 초과는 번역을 저장하지 않고 메모리에만 |
| 번역 CORS 오류 | 브라우저에서 gtx 직접 호출 | 반드시 Functions 프록시 |
| 이모지만 보냈는데 "번역 중"이 안 끝남 | 사전 필터 없음 | URL·기호·이모지 스킵 |

---

## 15. 완성 후 직접 돌려볼 체크리스트

전부 통과해야 배포합니다.

- [ ] 한국어 설정 계정으로 영어 문장을 보냈을 때 뱃지가 🇺🇸 로 뜬다
- [ ] 같은 메시지가 한국어 사용자와 중국어 사용자에게 각각 다른 언어로 보인다
- [ ] 헤더에서 언어를 바꾸면 이미 떠 있는 메시지가 즉시 새 언어로 바뀐다
- [ ] 두 번째 사용자가 같은 언어로 들어와도 번역 요청이 추가로 나가지 않는다
      (네트워크 탭에서 확인)
- [ ] 🔊 버튼이 원문이 아니라 번역문을 읽는다
- [ ] 300자 이상 문장이 끊기지 않고 끝까지 읽힌다
- [ ] 뱃지를 탭해 언어를 고치면 번역이 다시 계산된다
- [ ] 초대 링크를 시크릿 창에서 열어 가입 없이 입장된다
- [ ] 360px 폭에서 가로 스크롤이 생기지 않는다
- [ ] 자동 음성이 켜진 채 탭을 백그라운드로 보내면 소리가 멈춘다
- [ ] 방에 속하지 않은 계정으로 메시지를 직접 읽으면 거부된다

---

## 16. 진행 방식

한 번에 전부 만들지 말고 이 순서로 가주세요. 각 단계가 끝날 때마다
**실제로 돌려서 확인**한 뒤 다음으로 넘어갑니다.

1. **뼈대** — Vite + React + Tailwind + HashRouter + Firebase 초기화
2. **인증** — 익명 로그인 + `users/{uid}` 프로필 생성 + `myLanguage` 설정 화면
3. **방** — 생성 / 초대코드 / `joinRoom` Function / 멤버 배열
4. **메시지** — 전송 + `onSnapshot` 실시간 수신 + 기본 말풍선
5. **★ 번역** — `/api/translate` Function → 자동 감지 → 캐시 되쓰기 → 뱃지
   (여기가 이 앱의 핵심입니다. 가장 공들여 주세요)
6. **음성** — `/api/tts` + 청크 큐 + 자동 낭독 + iOS 해제
7. **보안 규칙 + 인덱스** — `firestore.rules`, `firestore.indexes.json`
8. **신호등 + techstack.json + TECH_STACK.md**
9. **2차 기능** — 음성 입력, 대면 통역 모드, 이미지 전송

각 단계에서 막히면 멈추고 무엇이 막혔는지 알려주세요.
추측으로 넘어가지 말아 주세요.

=== 여기까지 복사 ===
