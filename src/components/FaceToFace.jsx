// src/components/FaceToFace.jsx — 대면 통역 모드 (TRD 7)
// 한 기기를 마주 놓고 쓰는 휘발성 화면이다. Firestore 에 저장하지 않고 화면 상태로만 둔다.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowLeftRight, Mic, SendHorizontal, Square, Volume2 } from 'lucide-react';
import LanguageSelect from './LanguageSelect';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { langFlag, langName } from '../lib/languages';
import { requestTranslate } from '../lib/translate';
import { createRecognizer, isSpeechRecognitionSupported } from '../lib/speech';
import { speak, stopAll, unlockAudio } from '../lib/tts';

const PARTNER_KEY = 'maltong.f2f.partner.v1';
const canMic = isSpeechRecognitionSupported();
const other = (side) => (side === 'me' ? 'partner' : 'me');

const loadPartner = (myLang) => {
  let saved = null;
  try { saved = localStorage.getItem(PARTNER_KEY); } catch { /* noop */ }
  if (saved && saved !== myLang) return saved;
  return myLang === 'en' ? 'ko' : 'en';
};

/** 한쪽 영역. 상대가 한 말은 이쪽 언어 번역으로 크게, 이쪽이 한 말은 작게 보여준다. */
function Panel({ who, lang, onLangChange, turn, hearing, interim, rate, flipped }) {
  const toRead = turn && turn.speaker !== who;
  const said = turn && turn.speaker === who;
  return (
    <section className={`flex min-h-0 flex-1 flex-col px-5 py-4 ${flipped ? 'rotate-180' : ''}`} aria-label={`${langName(lang)} 쪽`}>
      <div className="flex items-center justify-between gap-2">
        <LanguageSelect id={`f2f-${who}`} compact value={lang} onChange={onLangChange} label={who === 'me' ? '내 언어' : '상대 언어'} />
        <span className="text-xs text-slate-500">{who === 'me' ? '나' : '상대'}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto py-2 text-center">
        {hearing ? (
          <p className="text-xl text-aqua-400" aria-live="polite">{interim || '…'}</p>
        ) : toRead ? (
          <>
            <p className="whitespace-pre-wrap break-words font-display text-[1.7rem] font-bold leading-snug sm:text-4xl">{turn.translated}</p>
            <p className="mt-3 text-sm text-slate-500">{turn.original}</p>
            <button type="button" className="btn-ghost mt-4 !py-2 text-sm" onClick={() => speak(turn.translated, turn.tgtLang, { rate, id: 'f2f' })} aria-label="다시 듣기">
              <Volume2 size={16} /> {langFlag(turn.tgtLang)}
            </button>
          </>
        ) : said ? (
          <p className="whitespace-pre-wrap break-words text-lg text-slate-400">{turn.original}</p>
        ) : (
          <p className="flex flex-col items-center gap-2 text-slate-500">
            <Mic size={28} aria-hidden="true" />
            <span className="text-lg">{langFlag(lang)} {langName(lang)}</span>
          </p>
        )}
      </div>
    </section>
  );
}

export default function FaceToFace() {
  const { roomId } = useParams();
  const { user } = useAuth() || {};
  const { myLanguage: myLang, speechRate, update } = useSettings();
  const [partnerLang, setPartnerLangState] = useState(() => loadPartner(myLang));
  const [turn, setTurn] = useState(null);   // { speaker, original, translated, tgtLang }
  const [side, setSide] = useState('me');   // 받아쓰기 로케일 — 기본은 마지막 화자의 반대편
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef(null);
  const finalRef = useRef('');

  const langOf = (s) => (s === 'me' ? myLang : partnerLang);
  const setPartnerLang = (c) => {
    setPartnerLangState(c);
    try { localStorage.setItem(PARTNER_KEY, c); } catch { /* noop */ }
  };

  useEffect(() => () => { recRef.current?.abort(); stopAll(); }, []);

  const handle = async (raw, guess) => {
    const text = raw.trim();
    if (!text) return;
    setBusy(true);
    setError('');
    let speaker = guess;
    try {
      let r = await requestTranslate({ text, targetLang: langOf(other(speaker)) });
      // ★ 응답의 감지 결과로 실제 화자를 판정한다 — 받아쓰기 언어를 잘못 골랐어도 여기서 복구된다
      const actual = r.detectedLang === myLang ? 'me' : r.detectedLang === partnerLang ? 'partner' : speaker;
      if (actual !== speaker) {
        speaker = actual;
        r = await requestTranslate({ text, targetLang: langOf(other(speaker)) });
      }
      const tgtLang = langOf(other(speaker));
      const translated = r.translatedText || text;
      setTurn({ speaker, original: text, translated, tgtLang });
      setSide(other(speaker));
      speak(translated, tgtLang, { rate: speechRate, id: 'f2f' });
    } catch {
      // 빈칸 금지 — 번역이 안 되면 원문이라도 반대편에 띄운다
      setTurn({ speaker, original: text, translated: text, tgtLang: langOf(speaker) });
      setError('번역 서버에 연결하지 못해 원문을 그대로 보여 드려요.');
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (recRef.current) { recRef.current.stop(); return; }
    stopAll();
    unlockAudio(); // iOS: 번역을 기다린 뒤 재생하므로 제스처 안에서 오디오를 열어 둔다
    const guess = side;
    finalRef.current = '';
    // continuous 는 끈다: 켜 두면 번역문을 읽는 소리가 다시 마이크로 들어가 되먹임이 생긴다
    const r = createRecognizer(langOf(guess), {
      continuous: false,
      onResult: ({ final, interim: it }) => {
        if (final) finalRef.current += final;
        setInterim(it);
      },
      onEnd: () => {
        recRef.current = null;
        setListening(false);
        setInterim('');
        const said = finalRef.current;
        finalRef.current = '';
        if (said.trim()) handle(said, guess);
      },
      onError: (err) => {
        if (err === 'not-allowed' || err === 'service-not-allowed') setError('마이크 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요.');
      },
    });
    if (!r) return;
    try {
      r.start();
      recRef.current = r;
      setListening(true);
    } catch {
      setError('음성 인식을 시작하지 못했어요.');
    }
  };

  const onType = (e) => {
    e.preventDefault();
    const t = typed;
    setTyped('');
    unlockAudio();
    handle(t, side);
  };

  const backTo = roomId && roomId !== 'solo' && user ? `/room/${roomId}` : '/';
  const panelProps = { turn, interim, rate: speechRate };

  return (
    <main className="flex h-[100dvh] flex-col">
      <Panel who="partner" flipped lang={partnerLang} onLangChange={setPartnerLang} hearing={listening && side === 'partner'} {...panelProps} />

      <div className="glass-strong relative z-10 border-x-0 px-3 py-3">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <Link to={backTo} className="btn-icon" aria-label="나가기"><ArrowLeft size={20} /></Link>
          {canMic ? (
            <button type="button" onClick={toggleMic} disabled={busy} aria-pressed={listening} className={`btn-primary min-w-0 flex-1 ${listening ? 'animate-pulse' : ''}`}>
              {busy ? <span className="spinner" /> : listening ? <Square size={16} /> : <Mic size={18} />}
              <span className="truncate">{busy ? '번역 중…' : listening ? '듣는 중 · 누르면 멈춤' : `눌러서 말하기 · ${langName(langOf(side))}`}</span>
            </button>
          ) : (
            <form onSubmit={onType} className="flex min-w-0 flex-1 gap-2">
              <label htmlFor="f2f-input" className="sr-only">말할 내용</label>
              <input id="f2f-input" className="input min-w-0 !py-2.5" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="입력해서 통역하기" />
              <button type="submit" className="btn-primary shrink-0 !px-3" aria-label="통역" disabled={!typed.trim() || busy}>
                {busy ? <span className="spinner" /> : <SendHorizontal size={18} />}
              </button>
            </form>
          )}
          <button
            type="button"
            className="btn-icon"
            onClick={() => setSide(other(side))}
            disabled={listening}
            aria-label={`받아쓰기 언어 바꾸기 (지금 ${langName(langOf(side))})`}
            title="받아쓰기 언어 바꾸기"
          >
            <ArrowLeftRight size={20} />
          </button>
        </div>
        {error && <p role="alert" className="mt-2 text-center text-xs text-amber-300">{error}</p>}
        <p className="mt-1.5 text-center text-[11px] text-slate-500">
          {canMic ? '말한 언어를 감지해 반대편에 보여주고 읽어 줘요 · 기록 없음' : '음성 인식 미지원 브라우저 — 입력으로 통역해요 · 기록 없음'}
        </p>
      </div>

      <Panel who="me" lang={myLang} onLangChange={(c) => update({ myLanguage: c })} hearing={listening && side === 'me'} {...panelProps} />
    </main>
  );
}
