/** 스위치 — 모양은 index.css 의 .toggle */
export default function Toggle({ on, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(on)}
      aria-label={label}
      data-on={String(Boolean(on))}
      disabled={disabled}
      className="toggle disabled:opacity-50"
      onClick={() => onChange(!on)}
    />
  );
}
