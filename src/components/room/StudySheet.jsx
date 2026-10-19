import { Fragment, useEffect, useMemo, useState } from 'react';
import { BookOpen, Eye, EyeOff, KeyRound, Printer, Save, Sparkles, Trash2, Volume2, X } from 'lucide-react';
import { analyzeSentence, phraseSurface } from '../../lib/grammar';
import { analyzeWithGemini, fetchStudyExtras, getGeminiKey, setGeminiKey } from '../../lib/studyApi';
import { openStudyPrint, studyDateLabel } from '../../lib/studyPrint';
import { langFlag, langName } from '../../lib/languages';
import { speak } from '../../lib/tts';

// 역할 색 (어두운 테마). Tailwind 가 찾을 수 있게 클래스 이름을 통째로 적는다.
const TONE = {
  blue: ['border-blue-400/30 bg-blue-500/10 text-blue-200', 'bg-blue-500/20 text-blue-200'],
  green: ['border-green-400/30 bg-green-500/10 text-green-200', 'bg-green-500/20 text-green-200'],
  red: ['border-red-400/30 bg-red-500/10 text-red-200', 'bg-red-500/20 text-red-200'],
  purple: ['border-purple-400/30 bg-purple-500/10 text-purple-200', 'bg-purple-500/20 text-purple-200'],
  orange: ['border-orange-400/30 bg-orange-500/10 text-orange-200', 'bg-orange-500/20 text-orange-200'],
  indigo: ['border-indigo-400/30 bg-indigo-500/10 text-indigo-200', 'bg-indigo-500/20 text-indigo-200'],
  pink: ['border-pink-400/30 bg-pink-500/10 text-pink-200', 'bg-pink-500/20 text-pink-200'],
  teal: ['border-teal-400/30 bg-teal-500/10 text-teal-200', 'bg-teal-500/20 text-teal-200'],
  slate: ['border-slate-400/30 bg-slate-500/10 text-slate-200', 'bg-slate-500/25 text-slate-200'],
  rose: ['border-rose-400/30 bg-rose-500/10 text-rose-200', 'bg-rose-500/20 text-rose-200'],
  fuchsia: ['border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200', 'bg-fuchsia-500/20 text-fuchsia-200'],
  amber: ['border-amber-400/30 bg-amber-500/10 text-amber-200', 'bg-amber-500/20 text-amber-200'],
  cyan: ['border-cyan-400/30 bg-cyan-500/10 text-cyan-200', 'bg-cyan-500/20 text-cyan-200'],
  lime: ['border-lime-400/30 bg-lime-500/10 text-lime-200', 'bg-lime-500/20 text-lime-200'],
  emerald: ['border-emerald-400/40 bg-emerald-500/10 text-emerald-200', 'bg-emerald-500/20 text-emerald-200'],
  gray: ['border-white/10 bg-white/[0.04] text-slate-200', 'bg-white/10 text-slate-300'],
};
const tone = (c) => TONE[c] || TONE.gray;
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const fullSurface = (p) => `${phraseSurface(p)}${p.punct || ''}`;

/** 원문 + 방에 쌓인 모든 번역을 공부 대상으로 고를 수 있게 한다. 내 언어 번역은 원문 바로 뒤. */
const buildTargets = (m, v, myLang) => {
  const tr = { ...(m.translations || {}) };
  if (v.translated && !tr[myLang]) tr[myLang] = v.translated; // 2000자 초과로 저장 안 된 번역
  const others = Object.keys(tr)
    .filter((l) => l !== v.srcLang && tr[l])
    .sort((a, b) => (b === myLang) - (a === myLang));
  return [{ lang: v.srcLang, text: m.text, original: true }, ...others.map((l) => ({ lang: l, text: tr[l], original: false }))];
};

const geminiMessage = (e) => {
  if (e?.status === 400 || e?.status === 403) return '키가 올바르지 않거나 권한이 없어요. Google AI Studio 에서 키를 다시 확인해 주세요.';
  if (e?.status === 429) return '무료 사용 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.';
  if (e instanceof SyntaxError) return 'Gemini 응답을 읽지 못했어요. 다시 시도해 주세요.';
  return 'Gemini 분석에 실패했어요. 네트워크를 확인해 주세요.';
};

function Slashed({ items, slashClass = 'text-brand-400' }) {
  return items.map((s, i) => (
    <Fragment key={i}>
      <span>{s}</span>
      {i < items.length - 1 && <span className={`mx-1.5 select-none font-bold ${slashClass}`} aria-hidden="true">/</span>}
    </Fragment>
  ));
}

function Label({ children }) {
  return <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{children}</p>;
}

function SpeakButton({ text, lang, rate, label }) {
  return (
    <button type="button" onClick={() => speak(text, lang, { rate, id: 'study' })} aria-label={label} title={label}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-aqua-400">
      <Volume2 size={15} />
    </button>
  );
}

/**
 * 메시지 하나로 하는 언어 공부 (meet4u 문법 분석 팝업 이식).
 * 원문·번역 중 하나를 골라 어절 분해 · 역할 · 발음 · 내 언어 뜻 · A4 학습지 · Gemini 정밀 분석을 보여준다.
 */
export default function StudySheet({ message, view, myLang, rate = 1, onClose }) {
  const targets = useMemo(() => buildTargets(message, view, myLang), [message, view, myLang]);
  const [pick, setPick] = useState(null);
  const target = targets.find((t) => t.lang === pick) || targets[0];

  const analysis = useMemo(() => analyzeSentence(target.text, target.lang), [target.text, target.lang]);
  const idx = useMemo(() => new Map(analysis.phrases.map((p, i) => [p, i])), [analysis]);
  const wantMeaning = target.lang !== myLang;
  // 문장 전체의 내 언어 뜻 — 원문이 내 언어면 원문, 아니면 내 언어 번역
  const translation = !wantMeaning ? '' : view.srcLang === myLang ? message.text : (view.translated || '');

  const [extras, setExtras] = useState({ pron: [], meaning: [], loading: true, error: '' });
  const [apiKey, setApiKey] = useState(getGeminiKey);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyInput, setKeyInput] = useState(apiKey);
  const [keyVisible, setKeyVisible] = useState(false);
  const [gemini, setGemini] = useState({ for: '', data: null, loading: false, error: '' });
  const [notice, setNotice] = useState('');
  const gemKey = `${target.lang}|${target.text}`;
  const gem = gemini.for === gemKey ? gemini : { data: null, loading: false, error: '' };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 어절 + 문장을 한 번에 보내 발음·뜻을 받는다 (조각 순서 = 어절들, 그 뒤 문장들)
  useEffect(() => {
    let alive = true;
    const pieces = [...analysis.phrases.map(phraseSurface), ...analysis.chunks.map((c) => c.originalChunk.trim())];
    setExtras({ pron: [], meaning: [], loading: true, error: '' });
    fetchStudyExtras(pieces, target.lang, myLang)
      .then(({ pron, meaning }) => alive && setExtras({ pron, meaning, loading: false, error: '' }))
      .catch(() => alive && setExtras({ pron: [], meaning: [], loading: false, error: '발음·뜻을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.' }));
    return () => { alive = false; };
  }, [analysis, target.lang, myLang]);

  const n = analysis.phrases.length;
  const phrasePron = extras.pron.slice(0, n);
  const phraseMeaning = wantMeaning ? extras.meaning.slice(0, n) : [];
  const clauseMeaning = wantMeaning ? extras.meaning.slice(n) : [];
  const clausePron = (c) => c.phrases.map((p) => phrasePron[idx.get(p)]).filter(Boolean).join(' ');

  const runGemini = async () => {
    setGemini({ for: gemKey, data: null, loading: true, error: '' });
    try {
      const data = await analyzeWithGemini({
        sentence: target.text,
        langLabel: langName(target.lang),
        learnerLabel: langName(myLang),
        apiKey,
      });
      setGemini({ for: gemKey, data, loading: false, error: '' });
    } catch (e) {
      console.warn('[gemini]', e?.detail || e);
      setGemini({ for: gemKey, data: null, loading: false, error: geminiMessage(e) });
    }
  };

  const saveKey = () => {
    const k = keyInput.trim();
    setGeminiKey(k);
    setApiKey(k);
    setKeyOpen(false);
  };
  const clearKey = () => {
    setGeminiKey('');
    setApiKey('');
    setKeyInput('');
  };

  const print = () => {
    const ok = openStudyPrint({
      analysis, phrasePron, phraseMeaning, clauseMeaning, translation,
      learnerLabel: langName(myLang), gemini: gem.data,
    });
    if (!ok) setNotice('팝업이 차단됐어요. 브라우저에서 이 사이트의 팝업을 허용해 주세요.');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-title"
        onClick={(e) => e.stopPropagation()}
        className="glass-strong flex max-h-[92dvh] w-full animate-rise flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-2xl sm:rounded-3xl"
      >
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <BookOpen size={18} className="shrink-0 text-brand-400" />
          <h2 id="study-title" className="min-w-0 flex-1 truncate font-display font-bold">언어 공부 · {analysis.languageLabel}</h2>
          <button type="button" className="btn-icon -mr-1" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </header>

        {targets.length > 1 && (
          <div role="tablist" aria-label="공부할 문장" className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3 scrollbar-thin">
            {targets.map((t) => {
              const on = t.lang === target.lang;
              return (
                <button key={t.lang} type="button" role="tab" aria-selected={on} onClick={() => setPick(t.lang)}
                  className={`chip shrink-0 !px-3 !py-1.5 !text-xs ${on ? '!border-brand-400/60 !bg-brand-500/20 text-white' : ''}`}>
                  {langFlag(t.lang)} {langName(t.lang)}{t.original && <span className="text-slate-400">· 원문</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="px-4 pt-3">
          <button type="button" onClick={print} disabled={!n} className="btn-primary w-full !py-2.5 text-sm" title="A4 인쇄용 학습지로 바꾼 뒤 PDF로 저장">
            <Printer size={16} /> 오늘({studyDateLabel()})의 공부 — A4 PDF로 저장
          </button>
          {notice && <p role="alert" className="mt-2 text-xs text-amber-300">{notice}</p>}
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 scrollbar-thin">
          {/* 문장 전체 · 발음 · 뜻 */}
          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div>
              <Label>문장 (어절은 "/" 로 끊어 표시) <SpeakButton text={target.text} lang={target.lang} rate={rate} label="문장 읽어주기" /></Label>
              <p className="break-words text-lg leading-relaxed">{n ? <Slashed items={analysis.phrases.map(fullSurface)} /> : target.text}</p>
            </div>
            {(extras.loading || phrasePron.some(Boolean)) && (
              <div>
                <Label>발음 {extras.loading && <span className="spinner !h-3 !w-3" />}</Label>
                {phrasePron.some(Boolean) && (
                  <p className="break-words font-mono text-sm leading-relaxed text-aqua-400">
                    <Slashed items={phrasePron.map((s, i) => s || analysis.phrases[i].text)} slashClass="text-aqua-400/40" />
                  </p>
                )}
              </div>
            )}
            {translation && (
              <div>
                <Label>뜻 · {langName(myLang)}</Label>
                <p className="break-words text-sm leading-relaxed text-slate-200">{translation}</p>
              </div>
            )}
          </section>

          {analysis.note && (
            <p className="rounded-xl border border-brand-400/20 bg-brand-500/10 px-3 py-2 text-xs leading-relaxed text-brand-400">{analysis.note}</p>
          )}
          {extras.error && <p role="alert" className="text-xs text-amber-300">{extras.error}</p>}

          {/* 문장별 학습 */}
          {analysis.chunks.length > 0 && (
            <section>
              <Label>문장별 학습</Label>
              <ol className="space-y-2">
                {analysis.chunks.map((c, i) => (
                  <li key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 font-bold text-brand-400">{CIRCLED[i] || `(${i + 1})`}</span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm text-slate-200"><Slashed items={c.phrases.map(fullSurface)} /></p>
                        {clausePron(c) && <p className="mt-0.5 break-words font-mono text-xs text-aqua-400/90">{clausePron(c)}</p>}
                        {clauseMeaning[i] && <p className="mt-1 break-words text-xs text-slate-300">→ {clauseMeaning[i]}</p>}
                        <p className="mt-1 text-xs font-semibold text-slate-400">{c.structure || '(구조 불명)'}</p>
                      </div>
                      <SpeakButton text={c.originalChunk} lang={target.lang} rate={rate} label={`${i + 1}번 문장 읽어주기`} />
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* 어절 분해 */}
          <section>
            <Label>어절 분해</Label>
            {!n ? <p className="text-sm italic text-slate-500">분석할 어절이 없어요.</p> : (
              <div className="grid gap-2 sm:grid-cols-2">
                {analysis.phrases.map((p, i) => {
                  const [box, pill] = tone(p.label?.color);
                  return (
                    <div key={i} className={`rounded-xl border p-2.5 ${box}`}>
                      <div className="flex items-start gap-1">
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="break-words text-base font-semibold">
                              {p.text}
                              {p.particle && <span className="ml-1 rounded border border-current px-1.5 py-0.5 text-xs">+{p.particle}</span>}
                              {p.punct && <span className="ml-0.5 text-slate-500">{p.punct}</span>}
                            </span>
                            {phrasePron[i] && <span className="font-mono text-xs text-aqua-400">[{phrasePron[i]}]</span>}
                          </p>
                          {phraseMeaning[i] && <p className="mt-0.5 break-words text-xs text-slate-200">— <b>{phraseMeaning[i]}</b></p>}
                          {p.label && (
                            <p className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${pill}`}>{p.label.role}</span>
                              <span className="text-xs leading-snug text-slate-400">{p.label.detail}</span>
                            </p>
                          )}
                        </div>
                        <SpeakButton text={phraseSurface(p)} lang={target.lang} rate={rate} label={`${phraseSurface(p)} 읽어주기`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Gemini 정밀 분석 */}
          <section className="border-t border-white/10 pt-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <Sparkles size={15} className="text-amber-300" /> Gemini 정밀 분석
                {apiKey && <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-200">내 키</span>}
              </p>
              <button type="button" onClick={() => setKeyOpen((o) => !o)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-aqua-400">
                <KeyRound size={12} /> {apiKey ? '키 변경' : '내 키 등록'}
              </button>
            </div>

            {keyOpen && (
              <div className="mb-3 space-y-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3">
                <p className="text-xs leading-relaxed text-amber-100">
                  Google AI Studio(aistudio.google.com)에서 무료 Gemini API 키를 발급받아 붙여넣으세요.
                  키는 <b>이 브라우저에만</b> 저장되고 말.통 서버로 보내지지 않아요.
                </p>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="gemini-key" className="sr-only">Gemini API 키</label>
                  <input id="gemini-key" type={keyVisible ? 'text' : 'password'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="AIza…" autoComplete="off" spellCheck={false} className="input min-w-0 flex-1 !py-2 text-sm" />
                  <button type="button" className="btn-icon" onClick={() => setKeyVisible((v) => !v)} aria-label={keyVisible ? '키 숨기기' : '키 보기'}>
                    {keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-primary flex-1 !py-2 text-sm" onClick={saveKey} disabled={!keyInput.trim()}><Save size={14} /> 저장</button>
                  <button type="button" className="btn-ghost !py-2 text-sm" onClick={clearKey}><Trash2 size={14} /> 삭제</button>
                </div>
              </div>
            )}

            {!apiKey && !keyOpen && (
              <p className="text-xs leading-relaxed text-slate-400">무료 API 키를 등록하면 품사·역할·뜻을 {langName(myLang)}(으)로 자세히 풀어 드려요.</p>
            )}

            {apiKey && (
              <button type="button" onClick={runGemini} disabled={gem.loading}
                className="btn w-full !py-2.5 text-sm text-white" style={{ backgroundImage: 'linear-gradient(100deg, #f59e0b, #f43f5e)' }}>
                {gem.loading ? <span className="spinner" /> : <Sparkles size={15} />}
                {gem.loading ? '분석 중…' : gem.data ? '다시 분석' : '정밀 분석 실행'}
              </button>
            )}
            {gem.error && <p role="alert" className="mt-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{gem.error}</p>}

            {gem.data && (
              <div className="mt-3 space-y-2">
                {gem.data.structure && <p className="text-sm text-slate-200"><b>구조</b> {gem.data.structure}</p>}
                {Array.isArray(gem.data.tokens) && gem.data.tokens.map((t, i) => (
                  <div key={i} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                    <p className="flex flex-wrap items-baseline gap-2">
                      <span className="font-bold">{t.surface}</span>
                      {t.reading && t.reading !== t.surface && <span className="font-mono text-xs text-aqua-400">[{t.reading}]</span>}
                      {t.pos && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-200">{t.pos}</span>}
                      {t.role && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-200">{t.role}</span>}
                    </p>
                    {t.meaning && <p className="mt-1 text-xs text-slate-200">{t.meaning}</p>}
                    {t.note && <p className="mt-0.5 text-xs italic text-slate-400">💡 {t.note}</p>}
                  </div>
                ))}
                {gem.data.overall && (
                  <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-100"><b>요약</b> {gem.data.overall}</p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
