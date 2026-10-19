export default function FullScreenLoader({ label = '불러오는 중…' }) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/10 border-t-brand-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
