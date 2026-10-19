import { useEffect } from 'react';
import { X } from 'lucide-react';

/** 모바일 하단 시트 / 데스크톱 모달. 배경 탭 · Esc 로 닫힌다. */
export default function Sheet({ title, onClose, children, id = 'sheet' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="font-display text-lg font-bold">{title}</h2>
          <button type="button" className="btn-icon -mr-1" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
