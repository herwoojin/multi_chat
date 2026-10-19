// src/lib/clipboard.js — LAN 주소(http)로 띄운 개발 서버에서는 navigator.clipboard 가 없으므로 execCommand 로 폴백한다
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 폴백으로 */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* noop */ }
  ta.remove();
  return ok;
}
