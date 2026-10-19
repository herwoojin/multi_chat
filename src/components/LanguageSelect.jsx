import { LANGUAGES } from '../lib/languages';

/**
 * 내 언어 셀렉터. 대화방 헤더에 상시 노출하고 설정 화면에도 중복으로 둔다.
 * 네이티브 <select> — 모바일에서 가장 확실하게 열리고 스크린리더가 읽는다.
 */
export default function LanguageSelect({ value, onChange, id = 'lang-select', compact = false, className = '', label = '내 언어' }) {
  return (
    <label className={`relative inline-flex ${className}`}>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`lang-select cursor-pointer rounded-xl border border-white/10 bg-white/[0.07] font-semibold text-slate-100 outline-none transition hover:bg-white/[0.12] focus:border-brand-400/60 ${compact ? 'max-w-[8.5rem] py-2 pl-2.5 text-sm' : 'w-full py-3 pl-4 text-base'}`}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.flag} {l.name}</option>
        ))}
      </select>
    </label>
  );
}
