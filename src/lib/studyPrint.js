// src/lib/studyPrint.js — "오늘의 공부" A4 학습지 (meet4u GrammarPopup 의 인쇄 기능 이식)
// 새 창에 인쇄용 HTML 을 쓰고 인쇄 대화상자를 띄운다 → 사용자가 "PDF로 저장"을 고른다.

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// 화면의 역할 색을 인쇄용 진한 색으로 (인쇄 창에는 Tailwind 가 없다)
const PRINT_COLORS = {
  blue: '#1d4ed8', green: '#16a34a', red: '#dc2626', purple: '#7c3aed',
  orange: '#ea580c', indigo: '#4338ca', pink: '#db2777', teal: '#0d9488',
  slate: '#475569', rose: '#e11d48', fuchsia: '#c026d3', amber: '#d97706',
  cyan: '#0891b2', lime: '#65a30d', emerald: '#059669', gray: '#374151',
};
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export const studyDateLabel = (d = new Date()) => `${d.getMonth() + 1}월${d.getDate()}일`;

// 빗금 양옆에 공백을 둬야 긴 발음 줄이 그 자리에서 줄바꿈된다
const slashed = (pieces) => pieces.map(escapeHtml).join(' <span class="slash">/</span> ');

/**
 * @param {object} p
 * @param {object} p.analysis   analyzeSentence 결과
 * @param {string[]} p.phrasePron   analysis.phrases 와 같은 순서
 * @param {string[]} p.phraseMeaning
 * @param {string[]} p.clauseMeaning  analysis.chunks 와 같은 순서
 * @param {string} p.translation  내 언어 전체 번역 (없으면 '')
 * @param {string} p.learnerLabel 내 언어 표시명
 * @param {object|null} p.gemini   Gemini 정밀 분석 결과
 */
export function buildStudyHtml({ analysis, phrasePron, phraseMeaning, clauseMeaning, translation, learnerLabel, gemini }) {
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const idx = new Map(analysis.phrases.map((p, i) => [p, i]));
  const surface = (p) => `${p.text || ''}${p.particle || ''}${p.punct || ''}`;

  const cards = analysis.chunks.map((c, i) => {
    const pron = c.phrases.map((p) => phrasePron[idx.get(p)]).filter(Boolean).join(' ');
    return `
      <div class="card">
        <div class="card-head"><span class="num">${CIRCLED[i] || `(${i + 1})`}</span><span class="struct">${escapeHtml(c.structure || '구조 불명')}</span></div>
        <div class="row"><span class="lbl">문장</span><div class="sent">${slashed(c.phrases.map(surface))}</div></div>
        ${pron ? `<div class="row"><span class="lbl">발음</span><div class="pron">${escapeHtml(pron)}</div></div>` : ''}
        ${clauseMeaning[i] ? `<div class="row"><span class="lbl">뜻</span><div>${escapeHtml(clauseMeaning[i])}</div></div>` : ''}
      </div>`;
  }).join('');

  const phrases = analysis.phrases.map((p, i) => {
    const color = PRINT_COLORS[p.label?.color] || PRINT_COLORS.gray;
    return `
      <div class="phrase" style="border-left-color:${color}">
        <div class="ph-head">
          <span class="surface">${escapeHtml(p.text)}</span>
          ${p.particle ? `<span class="particle" style="color:${color};border-color:${color}">+${escapeHtml(p.particle)}</span>` : ''}
          ${phrasePron[i] ? `<span class="pron-mini">[${escapeHtml(phrasePron[i])}]</span>` : ''}
          ${phraseMeaning[i] ? `<span class="meaning">— <b>${escapeHtml(phraseMeaning[i])}</b></span>` : ''}
        </div>
        ${p.label ? `<div class="role-row"><span class="role" style="background:${color}1a;color:${color}">${escapeHtml(p.label.role)}</span><span class="role-desc">${escapeHtml(p.label.detail)}</span></div>` : ''}
      </div>`;
  }).join('');

  const geminiHtml = gemini ? `
    <div class="section">
      <h2>Gemini 정밀 분석</h2>
      ${gemini.structure ? `<p class="g-struct"><b>구조</b> ${escapeHtml(gemini.structure)}</p>` : ''}
      <div class="phrases">${(gemini.tokens || []).map((t) => `
        <div class="phrase" style="border-left-color:#4338ca">
          <div class="ph-head"><span class="surface">${escapeHtml(t.surface)}</span>
            ${t.reading && t.reading !== t.surface ? `<span class="pron-mini">[${escapeHtml(t.reading)}]</span>` : ''}
            ${t.pos ? `<span class="role" style="background:#4338ca1a;color:#4338ca">${escapeHtml(t.pos)}</span>` : ''}
            ${t.role ? `<span class="role" style="background:#0596691a;color:#059669">${escapeHtml(t.role)}</span>` : ''}</div>
          ${t.meaning ? `<div class="role-desc">${escapeHtml(t.meaning)}</div>` : ''}
          ${t.note ? `<div class="role-desc">💡 ${escapeHtml(t.note)}</div>` : ''}
        </div>`).join('')}</div>
      ${gemini.overall ? `<div class="note">${escapeHtml(gemini.overall)}</div>` : ''}
    </div>` : '';

  const allPron = analysis.phrases.map((_, i) => phrasePron[i]).filter(Boolean);

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>${studyDateLabel(now)} ${escapeHtml(analysis.languageLabel)} 공부</title>
<style>
@page { size: A4; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; padding: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Noto Sans KR', sans-serif; color: #1a1a1a; line-height: 1.55; font-size: 10.5pt; }
.toolbar { position: fixed; top: 12px; right: 12px; display: flex; gap: 8px; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.1); }
.toolbar button { background: #4338ca; color: #fff; border: 0; padding: 8px 14px; border-radius: 6px; font-weight: 700; cursor: pointer; }
.toolbar .secondary { background: #6b7280; }
.header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2.5px solid #4338ca; padding-bottom: 8px; margin-bottom: 14px; }
.header h1 { font-size: 15pt; margin: 0; color: #4338ca; }
.header .date { color: #666; font-size: 9.5pt; }
.section { margin-bottom: 14px; }
.section h2 { font-size: 10.5pt; margin: 0 0 6px; color: #4338ca; border-left: 3px solid #4338ca; padding-left: 6px; }
.overview { background: #f7f7fb; border: 1px solid #e5e7f5; border-radius: 8px; padding: 10px 12px; }
.overview .big { font-size: 13pt; line-height: 1.7; }
.overview .ov-lbl { font-size: 8pt; font-weight: 700; color: #6b7280; margin-top: 6px; }
.overview { overflow-wrap: anywhere; }
.slash { color: #6366f1; font-weight: 700; padding: 0 1px; }
.pron, .pron-mini { color: #4338ca; font-family: Menlo, 'Courier New', monospace; }
.pron-mini { font-size: 8.5pt; }
.note { font-size: 9pt; color: #3730a3; background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 6px; padding: 6px 10px; margin-top: 6px; }
.card { border: 1.5px solid #c7d2fe; border-radius: 8px; margin-bottom: 8px; overflow: hidden; page-break-inside: avoid; }
.card-head { display: flex; gap: 8px; align-items: center; background: #eef2ff; padding: 4px 10px; }
.num { font-weight: 800; color: #4338ca; }
.struct { font-size: 8.5pt; color: #4338ca; font-weight: 600; }
.row { display: flex; gap: 8px; padding: 4px 10px; border-top: 1px solid #f3f4f6; }
.lbl { flex: 0 0 34px; font-size: 7.5pt; font-weight: 700; color: #9ca3af; padding-top: 2px; }
.sent { font-weight: 600; }
.phrases { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
.phrase { border: 1px solid #ddd; border-left: 3px solid #888; border-radius: 3px; padding: 5px 8px; page-break-inside: avoid; }
.ph-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
.surface { font-size: 11pt; font-weight: 700; }
.particle { border: 1px solid; border-radius: 3px; padding: 0 4px; font-size: 8pt; }
.meaning { font-size: 9pt; color: #555; }
.meaning b { color: #be123c; }
.role-row { display: flex; gap: 4px; align-items: baseline; margin-top: 3px; flex-wrap: wrap; }
.role { display: inline-block; padding: 1px 5px; border-radius: 3px; font-size: 8pt; font-weight: 700; }
.role-desc { color: #555; font-size: 9pt; }
.g-struct { margin: 0 0 6px; }
.footer { margin-top: 16px; text-align: center; color: #888; font-size: 8pt; border-top: 1px solid #eee; padding-top: 6px; }
@media print { body { padding: 0; } .toolbar { display: none; } }
</style></head>
<body>
<div class="toolbar"><button onclick="window.print()">📄 PDF로 저장 / 인쇄</button><button class="secondary" onclick="window.close()">닫기</button></div>
<div class="header"><h1>📚 오늘(${studyDateLabel(now)})의 공부 · ${escapeHtml(analysis.languageLabel)}</h1><div class="date">${ymd}</div></div>

<div class="section overview">
  <div class="big">${slashed(analysis.phrases.map(surface))}</div>
  ${allPron.length ? `<div class="ov-lbl">발음</div><div class="pron">${slashed(allPron)}</div>` : ''}
  ${translation ? `<div class="ov-lbl">뜻 (${escapeHtml(learnerLabel)})</div><div>${escapeHtml(translation)}</div>` : ''}
  ${analysis.note ? `<div class="note">${escapeHtml(analysis.note)}</div>` : ''}
</div>

<div class="section"><h2>문장별 학습</h2>${cards}</div>
<div class="section"><h2>어절 분해</h2><div class="phrases">${phrases}</div></div>
${geminiHtml}

<div class="footer">말.통 — 다국어 문장 공부 학습지 (${ymd} 생성)</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 350));</script>
</body></html>`;
}

/** @returns {boolean} 팝업이 차단되면 false */
export function openStudyPrint(args) {
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(buildStudyHtml(args));
  w.document.close();
  return true;
}
