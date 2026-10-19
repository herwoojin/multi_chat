import { memo, useState } from 'react';
import { ChevronRight, Copy, Square, Trash2, Volume2 } from 'lucide-react';
import LangBadge from './LangBadge';
import { formatTime } from '../../lib/format';

const HUES = [262, 190, 320, 150, 30, 210, 0, 280];
const hueOf = (s = '') => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

function Avatar({ name, photoURL, uid }) {
  if (photoURL) return <img src={photoURL} alt="" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full object-cover" />;
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: `hsl(${hueOf(uid)} 65% 45%)` }} aria-hidden="true">
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

function Action({ label, onClick, active = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10 active:scale-90 ${active ? 'text-aqua-400' : 'text-slate-500 hover:text-slate-200'}`}
    >
      {children}
    </button>
  );
}

/**
 * 말풍선 — ★ 번역문이 본문, 원문은 접어 둔 보조 (PRD 6.2).
 * 번역 대기 중에는 빈칸 대신 흐린 원문 + 스피너를 둔다.
 */
function MessageBubble({ m, v, showOriginal, speaking, onSpeak, onCorrect, onCopy, onDelete }) {
  const [origToggle, setOrigToggle] = useState(null);
  const origOpen = origToggle ?? showOriginal;

  if (m.type === 'system') {
    return <p className="mx-auto max-w-[80%] text-center text-xs text-slate-500">{m.text}</p>;
  }

  const mine = v.isMine;
  const deleted = Boolean(m.deletedAt);
  const isImage = m.type === 'image';
  const time = <time className="shrink-0 tabular-nums text-[11px] text-slate-500">{formatTime(m.createdAt)}</time>;
  const badge = v.isText && !deleted && !v.pre.skip ? <LangBadge v={v} onClick={() => onCorrect(m)} /> : null;

  let body;
  if (deleted) body = <p className="italic text-slate-500">삭제된 메시지입니다</p>;
  else if (isImage) {
    body = (
      <a href={m.imageUrl} target="_blank" rel="noreferrer" className="block">
        <img src={m.imageUrl} alt="보낸 사진" loading="lazy" className="max-h-72 w-auto max-w-full rounded-2xl object-cover" />
      </a>
    );
  } else if (v.isPending) {
    body = (
      <p className="msg-text text-slate-400/70" aria-busy="true">
        {m.text}<span className="spinner ml-2 align-[-2px]" role="status" aria-label="번역 중" />
      </p>
    );
  } else body = <p className="msg-text">{v.bodyText}</p>;

  return (
    <div className={`flex w-full ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${mine ? 'items-end' : 'items-start'}`}>
        <div className="flex max-w-full items-center gap-1.5 px-1">
          {mine ? (
            <>{time}<span className="text-xs font-semibold text-slate-300">나</span>{badge}</>
          ) : (
            <>
              <Avatar name={m.senderName} photoURL={m.senderPhotoURL} uid={m.senderUid} />
              <span className="min-w-0 truncate text-xs font-semibold text-slate-200">{m.senderName}</span>
              {badge}{time}
            </>
          )}
        </div>

        <div className={`${mine ? 'bubble-mine' : 'bubble-other'} max-w-full ${isImage && !deleted ? '!p-1.5' : ''}`}>
          {body}
          {!mine && v.translated && v.pronunciation && !deleted && (
            <p className="mt-1 text-xs leading-relaxed text-aqua-400/80">{v.pronunciation}</p>
          )}
          {v.showOrig && !deleted && (
            <div className="mt-2 border-t border-white/10 pt-1.5">
              <button
                type="button"
                onClick={() => setOrigToggle(!origOpen)}
                aria-expanded={origOpen}
                className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                <ChevronRight size={14} className={`transition-transform ${origOpen ? 'rotate-90' : ''}`} />
                원문 {origOpen ? '접기' : '보기'}
              </button>
              {origOpen && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-400">{m.text}</p>}
            </div>
          )}
        </div>

        {!deleted && (v.isText || mine) && (
          <div className="flex items-center gap-0.5">
            {v.isText && (
              <>
                <Action label={speaking ? '읽기 멈춤' : '읽어주기'} active={speaking} onClick={() => onSpeak(m.id, v.bodyText, v.ttsLang)}>
                  {speaking ? <Square size={14} /> : <Volume2 size={16} />}
                </Action>
                <Action label="복사" onClick={() => onCopy(v.bodyText)}><Copy size={15} /></Action>
              </>
            )}
            {mine && <Action label="삭제" onClick={() => onDelete(m)}><Trash2 size={15} /></Action>}
          </div>
        )}
      </div>
    </div>
  );
}

// 스냅샷마다 메시지 객체가 새로 만들어지므로 화면에 영향을 주는 값만 비교한다 (TRD 8)
const sig = ({ m, v, speaking, showOriginal }) => [
  m.id, m.text, m.type, m.imageUrl, Boolean(m.deletedAt), m.createdAt?.seconds, m.senderName, m.senderPhotoURL,
  m.detectedLang, m.detectionConfidence, m.detectionSource,
  v.bodyText, v.isPending, v.translated, v.pronunciation, v.showOrig, v.hasFailed, v.srcLang,
  speaking, showOriginal,
].join('\u0001');

export default memo(MessageBubble, (a, b) => sig(a) === sig(b));
