import { Check } from 'lucide-react';
import Sheet from '../Sheet';
import { LANGUAGES } from '../../lib/languages';

/** 감지 결과 수동 교정 (ERD 8.3). 고르면 번역을 전부 비우고 그 언어 기준으로 다시 번역한다. */
export default function LangCorrectSheet({ message, current, onPick, onClose }) {
  return (
    <Sheet title="이 메시지는 어떤 언어인가요?" onClose={onClose} id="lang-correct">
      <p className="line-clamp-2 text-sm text-slate-300">“{message.text}”</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        고르면 이 메시지의 번역을 모두 지우고 그 언어 기준으로 다시 번역해요. 방의 모든 사람에게 적용돼요.
      </p>
      <div className="mt-3 grid max-h-[50vh] grid-cols-2 gap-1.5 overflow-y-auto scrollbar-thin">
        {LANGUAGES.map((l) => {
          const on = l.code === current;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => onPick(l.code)}
              aria-pressed={on}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition ${on ? 'border-brand-400/60 bg-brand-500/15' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.1]'}`}
            >
              <span aria-hidden="true">{l.flag}</span>
              <span className="min-w-0 flex-1 truncate">{l.name}</span>
              {on && <Check size={14} className="shrink-0 text-brand-400" />}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
