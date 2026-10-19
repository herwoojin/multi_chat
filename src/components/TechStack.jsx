import data from '../../techstack.json';

/** 설정 > 앱 정보 — 루트의 techstack.json 을 그대로 보여준다 (lazy 로드). */
export default function TechStack() {
  return (
    <div className="mt-3 space-y-4 text-sm">
      <p className="text-xs leading-relaxed text-slate-400">{data.architectureSummary}</p>
      {data.categories.map((c) => (
        <div key={c.name}>
          <p className="label">{c.name}</p>
          <ul className="space-y-1.5">
            {c.items.map((it) => (
              <li key={it.name} className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-200">{it.name}</span>
                  {it.version && <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{it.version}</span>}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{it.purpose}</p>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="text-[11px] text-slate-500">최종 수정 {data.lastUpdated}</p>
    </div>
  );
}
