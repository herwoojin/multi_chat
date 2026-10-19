import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ImagePlus, Mic, SendHorizontal, Square, Star } from 'lucide-react';
import QuickPhrases from './QuickPhrases';
import { sendImageMessage, sendTextMessage } from '../../lib/rooms';
import { storage } from '../../lib/firebase';
import { createRecognizer, isSpeechRecognitionSupported } from '../../lib/speech';
import { stopAll } from '../../lib/tts';
import { langName } from '../../lib/languages';
import { friendlyError } from '../../lib/errors';

const MIC_ERRORS = {
  'not-allowed': '마이크 권한이 거부됐어요. 브라우저 설정에서 허용해 주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없어요.',
  'audio-capture': '마이크를 찾을 수 없어요.',
  network: '음성 인식 서버에 연결할 수 없어요.',
};
// 미지원 브라우저(Firefox 등)에서는 마이크 버튼을 아예 숨긴다 — 눌러도 아무 일 없는 버튼을 두지 않는다
const canMic = isSpeechRecognitionSupported();
// 터치 기기에서는 Enter 가 줄바꿈, 전송은 버튼으로
const coarse = typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches);

/** 입력줄 — ⭐ 자주 쓰는 문구 · 입력 · 📷 사진 · 🎤 음성 입력 · ➤ 전송 */
export default function Composer({ roomId, uid, profile, myLang, onError }) {
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [phrases, setPhrases] = useState(false);
  const rootRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const recRef = useRef(null);

  // 우측 하단 신호등이 전송 버튼을 가리지 않게 입력줄 높이만큼 띄운다
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => root.setProperty('--battery-lift', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.setProperty('--battery-lift', '0px'); };
  }, []);

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  // 인식 로케일은 시작할 때 정해지므로, 언어가 바뀌거나 화면을 떠나면 멈춘다
  useEffect(() => () => recRef.current?.abort(), [myLang]);

  const append = (piece) => setText((t) => (t.trim() ? `${t.trimEnd()} ${piece}` : piece));

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    recRef.current?.stop();
    setText(''); // 바로 비워 두 번 눌러도 한 번만 간다
    try {
      await sendTextMessage({ roomId, uid, profile, myLanguage: myLang, text: t });
    } catch (e) {
      setText(t);
      onError(friendlyError(e));
    }
  };

  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || coarse || e.nativeEvent.isComposing) return; // 한글 조합 중 Enter 무시
    e.preventDefault();
    send();
  };

  const toggleMic = () => {
    if (recRef.current) { recRef.current.stop(); return; }
    stopAll(); // 읽어주던 소리가 마이크로 다시 들어가지 않게
    const r = createRecognizer(myLang, {
      onResult: ({ final, interim: it }) => {
        if (final.trim()) append(final.trim());
        setInterim(it);
      },
      onEnd: () => { recRef.current = null; setListening(false); setInterim(''); },
      onError: (err) => { if (MIC_ERRORS[err]) onError(MIC_ERRORS[err]); },
    });
    if (!r) return;
    try {
      r.start();
      recRef.current = r;
      setListening(true);
    } catch {
      onError('음성 인식을 시작하지 못했어요.');
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { onError('사진 파일만 보낼 수 있어요.'); return; }
    setUploading(true);
    try {
      await sendImageMessage({ roomId, uid, profile, myLanguage: myLang, file });
    } catch (err) {
      onError(friendlyError(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div ref={rootRef} className="glass-strong safe-bottom relative z-20 border-x-0 border-b-0">
      {listening && (
        <p className="mx-auto flex max-w-3xl items-center gap-2 px-4 pt-2 text-xs text-aqua-400" aria-live="polite">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-aqua-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-aqua-400" />
          </span>
          듣는 중 · {langName(myLang)}
          <span className="min-w-0 truncate text-slate-400">{interim}</span>
        </p>
      )}
      <form className="relative mx-auto flex max-w-3xl items-end gap-1 px-2 py-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        {phrases && (
          <QuickPhrases
            draft={text}
            onPick={(p) => { append(p); setPhrases(false); taRef.current?.focus(); }}
            onClose={() => setPhrases(false)}
          />
        )}
        <button type="button" className="btn-icon" aria-label="자주 쓰는 문구" aria-expanded={phrases} onClick={() => setPhrases((o) => !o)}>
          <Star size={20} className={phrases ? 'fill-amber-300 text-amber-300' : ''} />
        </button>
        <label htmlFor="composer-input" className="sr-only">메시지</label>
        <textarea
          id="composer-input"
          ref={taRef}
          rows={1}
          value={text}
          maxLength={5000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="메시지 입력"
          className="input min-h-[44px] min-w-0 flex-1 resize-none !py-2.5 leading-snug scrollbar-thin"
        />
        {storage && (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <button type="button" className="btn-icon" aria-label="사진 보내기" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <span className="spinner" /> : <ImagePlus size={20} />}
            </button>
          </>
        )}
        {canMic && (
          <button
            type="button"
            className={`btn-icon ${listening ? 'bg-aqua-500/20 text-aqua-400' : ''}`}
            aria-label={listening ? '음성 입력 멈춤' : '음성으로 입력'}
            aria-pressed={listening}
            onClick={toggleMic}
          >
            {listening ? <Square size={16} /> : <Mic size={20} />}
          </button>
        )}
        <button type="submit" className="btn-primary h-11 w-11 shrink-0 !rounded-xl !p-0" aria-label="보내기" disabled={!text.trim()}>
          <SendHorizontal size={18} />
        </button>
      </form>
    </div>
  );
}
