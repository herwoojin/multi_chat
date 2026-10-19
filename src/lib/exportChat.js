// src/lib/exportChat.js — 대화 내보내기 (F18): 지금 내 언어로 보이는 그대로 마크다운으로 저장
import { langName } from './languages';
import { toDate } from './format';

const quote = (s) => String(s).split('\n').map((l) => `> ${l}`);

/** @param {{ room: object, messages: Array, view: (m) => object, myLang: string }} p */
export function exportChatMarkdown({ room, messages, view, myLang }) {
  const lines = [
    `# ${room?.name || '대화'}`,
    '',
    `_말.통에서 내보냄 · ${new Date().toLocaleString('ko-KR')} · 표시 언어 ${langName(myLang)}_`,
    '',
  ];
  for (const m of messages) {
    if (m.type === 'system') { lines.push(`*${m.text}*`, ''); continue; }
    const v = view(m);
    const at = toDate(m.createdAt)?.toLocaleString('ko-KR') || '';
    lines.push(`**${m.senderName}** · ${langName(v.srcLang)} · ${at}`);
    if (m.deletedAt) lines.push('> _(삭제된 메시지)_');
    else if (m.type === 'image') lines.push(`![사진](${m.imageUrl})`);
    else {
      lines.push(...quote(v.bodyText));
      if (v.showOrig) lines.push('>', `> 원문: ${m.text.replace(/\n/g, ' ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function downloadText(filename, text, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
