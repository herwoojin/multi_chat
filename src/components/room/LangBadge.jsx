import { Pencil } from 'lucide-react';
import { langFlag, langName } from '../../lib/languages';

/**
 * 원문 언어 뱃지 (PRD F4). 국기만 쓰지 않고 언어명을 함께 적는다(접근성).
 * 탭하면 감지 결과를 고치는 시트가 열린다.
 */
export default function LangBadge({ v, onClick }) {
  const pending = !v.detected && !v.hasFailed;
  const unsure = v.lowConfidence || !v.detected;
  const name = langName(v.srcLang);
  const label = pending
    ? '언어 감지 중'
    : `원문 언어 ${name}${v.lowConfidence ? ' (짧은 문장이라 불확실)' : ''}${!v.detected ? ' (감지 실패 — 보낸 사람 설정값)' : ''} — 탭해서 고치기`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`chip shrink-0 ${unsure ? 'border-dashed' : ''} ${v.manual ? 'border-aqua-400/40' : ''}`}
    >
      {pending ? (
        <><span className="spinner !h-2.5 !w-2.5 !border" /> 감지 중</>
      ) : (
        <>
          <span aria-hidden="true">{langFlag(v.srcLang)}</span>
          <span className="max-w-[6rem] truncate">{name}</span>
          {unsure && <span className="text-amber-300" aria-hidden="true">?</span>}
          {v.manual && <Pencil size={10} className="text-aqua-400" aria-hidden="true" />}
        </>
      )}
    </button>
  );
}
