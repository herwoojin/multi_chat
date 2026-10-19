import { useState } from 'react';
import { Plus, X } from 'lucide-react';

// 자주 쓰는 문구 (F17). 이 브라우저에만 저장된다. 보내면 평소처럼 감지·번역되므로 어떤 언어로 둬도 된다.
const KEY = 'maltong.phrases.v1';
const MAX = 20;
const DEFAULTS = ['안녕하세요! 만나서 반가워요', '감사합니다', '잠시만 기다려 주세요', '천천히 말해 주세요', '네, 좋아요 👍'];

const load = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(s)) return s;
  } catch { /* noop */ }
  return DEFAULTS;
};

export default function QuickPhrases({ draft, onPick, onClose }) {
  const [list, setList] = useState(load);
  const save = (next) => {
    setList(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* noop */ }
  };
  const t = draft.trim();

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden="true" />
      <div role="menu" aria-label="자주 쓰는 문구" className="glass-strong absolute bottom-full left-2 right-2 z-20 mb-2 max-h-72 animate-rise overflow-y-auto rounded-2xl p-2 shadow-2xl scrollbar-thin sm:right-auto sm:w-80">
        <p className="px-2 pb-1 text-xs font-semibold text-slate-400">자주 쓰는 문구 — 누르면 입력창에 들어가요</p>
        {list.map((p, i) => (
          <div key={`${i}:${p}`} className="flex items-center gap-1">
            <button type="button" role="menuitem" onClick={() => onPick(p)} className="min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-left text-sm hover:bg-white/10">{p}</button>
            <button type="button" aria-label={`"${p}" 지우기`} onClick={() => save(list.filter((_, j) => j !== i))} className="btn-icon h-8 w-8 text-slate-500"><X size={14} /></button>
          </div>
        ))}
        {!list.length && <p className="px-3 py-2 text-sm text-slate-500">저장된 문구가 없어요.</p>}
        <button
          type="button"
          disabled={!t || list.includes(t)}
          onClick={() => save([...list, t].slice(-MAX))}
          className="mt-1 flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-left text-sm text-aqua-400 hover:bg-white/10 disabled:opacity-40"
        >
          <Plus size={14} /> 지금 입력한 문장 저장
        </button>
      </div>
    </>
  );
}
