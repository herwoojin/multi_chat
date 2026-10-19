import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown } from 'lucide-react';
import MessageBubble from './MessageBubble';
import FullScreenLoader from '../FullScreenLoader';
import { subscribeSpeaking, speakingId } from '../../lib/tts';
import { dayKey, formatDay } from '../../lib/format';

const NEAR_BOTTOM_PX = 120;
const hasIO = typeof IntersectionObserver !== 'undefined';

/**
 * 메시지 목록.
 * - 보이는 메시지만 번역하도록 IntersectionObserver 로 가시성을 판정해 올려 보낸다 (TRD 8)
 * - 바닥에 붙어 있던 사람은 새 메시지·번역 도착으로 높이가 바뀌어도 계속 바닥에 둔다
 */
export default function MessageList({
  messages, loaded, hasMore, onLoadMore, view, showOriginal,
  onVisibleChange, onSpeak, onCorrect, onCopy, onDelete, empty,
}) {
  const scrollerRef = useRef(null);
  const contentRef = useRef(null);
  const stick = useRef(true);
  const prevHeight = useRef(null);
  const lastId = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const speaking = useSyncExternalStore(subscribeSpeaking, speakingId);

  // ── 가시성: 옵저버 하나를 모든 말풍선이 공유한다
  const io = useRef(null);
  const visible = useRef(new Set());
  const lastSig = useRef('');
  const raf = useRef(0);
  const flushRef = useRef(null);
  flushRef.current = () => {
    raf.current = 0;
    const s = [...visible.current].sort().join(',');
    if (s === lastSig.current) return;
    lastSig.current = s;
    onVisibleChange(new Set(visible.current));
  };
  const schedule = () => { if (!raf.current) raf.current = requestAnimationFrame(() => flushRef.current()); };

  // 안정된 ref 콜백이어야 렌더마다 observe/unobserve 가 반복되지 않는다
  const observe = useCallback((el) => {
    if (!el || !hasIO) return undefined;
    if (!io.current) {
      io.current = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.current.add(e.target.dataset.mid);
          else visible.current.delete(e.target.dataset.mid);
        }
        schedule();
      }, { rootMargin: '200px 0px' });
    }
    const o = io.current;
    o.observe(el);
    return () => { o.unobserve(el); visible.current.delete(el.dataset.mid); schedule(); };
  }, []);

  // 미지원 브라우저는 전부 보이는 것으로 본다 (null = 필터 없음)
  useEffect(() => { if (!hasIO) onVisibleChange(null); }, [onVisibleChange]);

  const onScroll = () => {
    const el = scrollerRef.current;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    stick.current = near;
    setAtBottom(near);
  };

  const toBottom = (smooth) => {
    const el = scrollerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // "이전 메시지 더 보기" 뒤에는 보던 위치를 유지한다
    if (prevHeight.current != null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
      return;
    }
    const last = messages[messages.length - 1];
    if (last && last.id !== lastId.current) {
      if (lastId.current === null || view(last).isMine) stick.current = true; // 첫 로드·내가 보낸 직후엔 바닥으로
      lastId.current = last.id;
    }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, view]);

  // 번역 도착·사진 로드·키보드 열림으로 높이가 바뀔 때
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, []);

  let prevDay = '';
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollerRef} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain scrollbar-thin" role="log" aria-label="메시지">
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3 px-3 py-4">
          {hasMore && (
            <button
              type="button"
              className="btn-ghost mx-auto !rounded-full !px-3 !py-1.5 text-xs"
              onClick={() => { prevHeight.current = scrollerRef.current.scrollHeight; onLoadMore(); }}
            >
              이전 메시지 더 보기
            </button>
          )}
          {!loaded && <FullScreenLoader label="메시지를 불러오는 중…" />}
          {loaded && !messages.length && empty}
          {messages.map((m) => {
            const dk = dayKey(m.createdAt);
            const showDay = dk && dk !== prevDay;
            if (dk) prevDay = dk;
            return (
              <Fragment key={m.id}>
                {showDay && (
                  <div className="my-1 flex items-center gap-3 text-[11px] text-slate-500">
                    <span className="h-px flex-1 bg-white/10" />{formatDay(m.createdAt)}<span className="h-px flex-1 bg-white/10" />
                  </div>
                )}
                <div ref={observe} data-mid={m.id}>
                  <MessageBubble
                    m={m}
                    v={view(m)}
                    showOriginal={showOriginal}
                    speaking={speaking === m.id}
                    onSpeak={onSpeak}
                    onCorrect={onCorrect}
                    onCopy={onCopy}
                    onDelete={onDelete}
                  />
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button type="button" onClick={() => toBottom(true)} className="glass-strong pointer-events-auto inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-lg animate-rise">
            <ArrowDown size={14} /> 최근 메시지
          </button>
        </div>
      )}
    </div>
  );
}
