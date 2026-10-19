import { useEffect, useState } from 'react';
import { getUsage, subscribeUsage } from '../lib/usage';

const COLORS = { ok: '#43a047', warn: '#fbc02d', danger: '#f57c00', critical: '#e53935' };
const MOTION = { ok: '', warn: 'animate-breathe', danger: 'animate-blink-mid', critical: 'animate-blink-fast' };
const LABEL = { ok: '여유', warn: '주의', danger: '위험', critical: '한도 임박' };

/**
 * 서버 용량 신호등 — 우측 하단 배터리.
 * 서버리스라 헬스 엔드포인트 대신 localStorage 카운터로 무료 한도 대비 사용률을 추정한다.
 */
export default function UsageBattery() {
  const [u, setU] = useState(getUsage);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = () => setU(getUsage());
    const off = subscribeUsage(refresh);
    const t = setInterval(refresh, 30000); // 30초 폴링 (날짜 경계 리셋 포함)
    return () => { off(); clearInterval(t); };
  }, []);

  const color = COLORS[u.level];
  const remain = Math.max(4, 100 - u.worst);

  return (
    <div
      className="fixed z-40"
      style={{
        right: 'calc(12px + env(safe-area-inset-right))',
        bottom: 'calc(12px + var(--battery-lift) + env(safe-area-inset-bottom))',
      }}
    >
      {open && (
        <div role="dialog" aria-label="사용량 상세" className="glass-strong absolute bottom-10 right-0 w-64 animate-rise rounded-2xl p-3 text-xs shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-bold text-slate-200">무료 한도 사용률 (추정)</span>
            <span className="rounded-full px-2 py-0.5 font-bold text-black" style={{ background: color }}>{LABEL[u.level]}</span>
          </div>
          <ul className="space-y-2">
            {u.metrics.map((m) => (
              <li key={m.key}>
                <div className="flex justify-between text-slate-300">
                  <span>{m.label}</span>
                  <span className="tabular-nums">{m.used.toLocaleString()} / {m.limit.toLocaleString()}{m.unit}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(1, m.pct)}%`, background: COLORS[m.pct >= 90 ? 'critical' : m.pct >= 70 ? 'danger' : m.pct >= 40 ? 'warn' : 'ok'] }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 leading-relaxed text-slate-500">이 브라우저에서 발생한 호출만 집계한 추정치입니다.</p>
        </div>
      )}
      <button
        id="usage-battery"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`서버 용량 ${LABEL[u.level]} — 사용률 ${Math.round(u.worst)}%`}
        className={`glass flex items-center gap-1 rounded-lg px-1.5 py-1 opacity-80 shadow-lg transition hover:opacity-100 ${MOTION[u.level]}`}
      >
        <span className="relative block h-3 w-6 rounded-[3px] border-[1.5px] p-[1.5px]" style={{ borderColor: color }}>
          <span className="block h-full rounded-[1px] transition-all duration-700" style={{ width: `${remain}%`, background: color }} />
        </span>
        <span className="block h-1.5 w-[2px] rounded-r-sm" style={{ background: color }} />
      </button>
    </div>
  );
}
