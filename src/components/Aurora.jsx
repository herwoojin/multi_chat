export default function Aurora() {
  return (
    <div className="aurora" aria-hidden="true">
      <div className="aurora-blob -left-24 top-10 h-72 w-72 bg-brand-500" />
      <div className="aurora-blob right-[-6rem] top-1/3 h-80 w-80 bg-aqua-500" style={{ animationDelay: '-6s' }} />
      <div className="aurora-blob bottom-[-6rem] left-1/4 h-72 w-72 bg-fuchsia-600" style={{ animationDelay: '-12s', opacity: 0.2 }} />
    </div>
  );
}
