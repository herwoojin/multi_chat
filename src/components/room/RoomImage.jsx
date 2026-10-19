import { useEffect, useRef, useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { loadRoomImage } from '../../lib/rooms';

/**
 * Firestore(rooms/{roomId}/images/{id})에 저장된 사진.
 * 화면 가까이 왔을 때 한 번만 읽고(사진 1장 = 읽기 1회), 탭하면 크게 본다.
 */
export default function RoomImage({ roomId, imageId, width, height }) {
  const box = useRef(null);
  const [near, setNear] = useState(typeof IntersectionObserver === 'undefined');
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (near || !box.current) return undefined;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setNear(true); io.disconnect(); }
    }, { rootMargin: '400px 0px' });
    io.observe(box.current);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return undefined;
    let alive = true;
    loadRoomImage(roomId, imageId)
      .then((s) => { if (alive) { if (s) setSrc(s); else setFailed(true); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [near, roomId, imageId]);

  useEffect(() => {
    if (!zoom) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setZoom(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  return (
    <>
      <button
        ref={box}
        type="button"
        onClick={() => src && setZoom(true)}
        aria-label="사진 크게 보기"
        className="block overflow-hidden rounded-2xl bg-white/5"
        // 읽기 전에도 원래 비율로 자리를 잡아 두어 스크롤이 튀지 않게
        style={{ aspectRatio: width && height ? `${width} / ${height}` : '4 / 3', width: 'min(16rem, 60vw)', maxHeight: '20rem' }}
      >
        {src ? (
          <img src={src} alt="보낸 사진" className="h-full w-full object-cover" />
        ) : failed ? (
          <span className="flex h-full items-center justify-center gap-1.5 px-2 text-xs text-slate-500"><ImageOff size={16} /> 사진을 불러오지 못했어요</span>
        ) : (
          <span className="flex h-full items-center justify-center"><span className="spinner" /></span>
        )}
      </button>
      {zoom && (
        <div role="dialog" aria-modal="true" aria-label="사진" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4" onClick={() => setZoom(false)}>
          <img src={src} alt="보낸 사진" className="max-h-full max-w-full rounded-xl object-contain" />
          <button type="button" className="btn-icon absolute right-3 top-3 !text-white" style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }} aria-label="닫기"><X size={22} /></button>
        </div>
      )}
    </>
  );
}
