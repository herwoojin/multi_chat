import { Link } from 'react-router-dom';

export default function Brand({ small = false }) {
  return (
    <Link to="/" className="inline-flex items-center gap-2.5" aria-label="말.통 홈">
      <img src="/favicon.svg" alt="" className={small ? 'h-8 w-8' : 'h-11 w-11 drop-shadow-[0_6px_20px_rgba(124,92,255,.45)]'} />
      <span className={`font-display font-extrabold tracking-tight ${small ? 'text-lg' : 'text-3xl'}`}>
        <span className="text-gradient">말.통</span>
        <span className="ml-1.5 align-middle text-[0.45em] font-bold tracking-[0.25em] text-slate-400">MAL.TONG</span>
      </span>
    </Link>
  );
}
