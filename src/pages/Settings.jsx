// src/pages/Settings.jsx — 내 언어 · 자동 음성 · 말 속도 · 표시 · 계정 · 기술 스택
// 내 언어 셀렉터는 대화방 헤더에도 있다. 여기에는 중복으로 둔다 (PRD 6.3).
import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Link2, LogOut, Play } from 'lucide-react';
import LanguageSelect from '../components/LanguageSelect';
import Toggle from '../components/Toggle';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { isFirebaseConfigured } from '../lib/firebase';
import { requestTranslate } from '../lib/translate';
import { speak, unlockAudio } from '../lib/tts';
import { friendlyError } from '../lib/errors';

const TechStack = lazy(() => import('../components/TechStack'));
const SAMPLE = '안녕하세요. 말.통이 이 속도로 읽어 드릴게요.';

function Row({ title, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-100">{title}</p>
        {desc && <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

export default function Settings() {
  const nav = useNavigate();
  const { user, profile, updateMyProfile, upgradeToGoogle, signOut } = useAuth();
  const s = useSettings();
  const [name, setName] = useState(null);
  const [rateDraft, setRateDraft] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [msg, setMsg] = useState('');
  const [showStack, setShowStack] = useState(false);

  const shownName = name ?? profile?.displayName ?? '';
  const rate = rateDraft ?? s.speechRate;
  const back = () => (window.history.state?.idx > 0 ? nav(-1) : nav('/'));

  // 슬라이더를 끄는 동안 Firestore 에 매번 쓰지 않도록 손을 뗄 때 한 번만 저장한다
  const commitRate = () => {
    if (rateDraft == null) return;
    s.update({ speechRate: rateDraft });
    setRateDraft(null);
  };

  const preview = async () => {
    setPreviewing(true);
    let text = SAMPLE;
    let lang = 'ko';
    if (s.myLanguage !== 'ko') {
      unlockAudio(); // iOS: 번역을 기다리는 사이 제스처가 끊기므로 먼저 오디오를 열어 둔다
      try {
        const r = await requestTranslate({ text: SAMPLE, targetLang: s.myLanguage, sourceLang: 'ko' });
        if (r.translatedText) { text = r.translatedText; lang = s.myLanguage; }
      } catch { /* 한국어 원문으로 들려준다 */ }
    }
    speak(text, lang, { rate, id: 'settings-preview' });
    setPreviewing(false);
  };

  const saveName = async () => {
    const n = shownName.trim().slice(0, 30);
    if (!n || n === profile?.displayName) return;
    try {
      await updateMyProfile({ displayName: n });
      setName(null);
      setMsg('이름을 바꿨어요. 새로 보내는 메시지부터 적용돼요.');
    } catch (e) { setMsg(friendlyError(e)); }
  };

  const upgrade = async () => {
    try {
      await upgradeToGoogle();
      setMsg('Google 계정에 연결했어요. 다른 기기에서도 같은 사람으로 들어올 수 있어요.');
    } catch (e) { setMsg(friendlyError(e)); }
  };

  const logout = async () => {
    if (user?.isAnonymous && !window.confirm('게스트 계정은 로그아웃하면 지금까지의 대화방에 다시 들어올 수 없어요. 계속할까요?')) return;
    await signOut();
    nav('/');
  };

  return (
    <main className="mx-auto max-w-lg px-5 pb-24 pt-4">
      <header className="flex items-center gap-2">
        <button type="button" onClick={back} className="btn-icon -ml-2" aria-label="뒤로"><ArrowLeft size={20} /></button>
        <h1 className="font-display text-xl font-bold">설정</h1>
      </header>

      <section className="card mt-4">
        <label className="label" htmlFor="settings-lang">내 언어</label>
        <LanguageSelect id="settings-lang" value={s.myLanguage} onChange={(c) => s.update({ myLanguage: c })} />
        <p className="mt-2 text-xs leading-relaxed text-slate-400">상대가 어떤 언어로 말하든 이 언어로 번역해 보여주고 읽어 드려요.</p>
      </section>

      <section className="card mt-3 divide-y divide-white/5 !py-2">
        <Row title="자동 음성" desc="남이 보낸 새 메시지를 내 언어로 읽어 줘요. 탭이 백그라운드로 가면 멈춰요.">
          <Toggle on={s.autoSpeak} onChange={(on) => s.update({ autoSpeak: on })} label="자동 음성" />
        </Row>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="settings-rate" className="text-sm font-semibold">말 속도</label>
            <span className="tabular-nums text-sm text-slate-300">{rate.toFixed(1)}×</span>
          </div>
          <input
            id="settings-rate"
            type="range"
            className="range mt-3"
            min={0.5}
            max={2}
            step={0.1}
            value={rate}
            onChange={(e) => setRateDraft(Number(e.target.value))}
            onPointerUp={commitRate}
            onKeyUp={commitRate}
            onBlur={commitRate}
          />
          <button type="button" className="btn-ghost mt-3 !py-2 text-sm" onClick={preview} disabled={previewing}>
            {previewing ? <span className="spinner" /> : <Play size={14} />} 들어보기
          </button>
        </div>
      </section>

      <section className="card mt-3 divide-y divide-white/5 !py-2">
        <Row title="원문 항상 펼치기" desc="번역문 아래 원문을 접지 않고 보여줘요.">
          <Toggle on={s.showOriginal} onChange={(on) => s.update({ showOriginal: on })} label="원문 항상 펼치기" />
        </Row>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="settings-scale" className="text-sm font-semibold">글자 크기</label>
            <span className="tabular-nums text-sm text-slate-300">{Math.round((s.textScale || 1) * 100)}%</span>
          </div>
          <input
            id="settings-scale"
            type="range"
            className="range mt-3"
            min={0.9}
            max={1.3}
            step={0.05}
            value={s.textScale || 1}
            onChange={(e) => s.update({ textScale: Number(e.target.value) })}
          />
        </div>
      </section>

      {isFirebaseConfigured && user && (
        <section className="card mt-3">
          <label className="label" htmlFor="settings-name">표시 이름</label>
          <div className="flex gap-2">
            <input id="settings-name" className="input min-w-0 flex-1" maxLength={30} value={shownName} onChange={(e) => setName(e.target.value)} />
            <button type="button" className="btn-ghost shrink-0" onClick={saveName} disabled={!shownName.trim() || shownName.trim() === profile?.displayName}>저장</button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{user.isAnonymous ? '게스트로 접속 중' : (user.email || 'Google 계정')}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {user.isAnonymous ? 'Google 계정을 연결하면 다른 기기에서도 같은 사람으로 들어와요.' : '계정이 연결되어 있어요.'}
              </p>
            </div>
            {user.isAnonymous && <button type="button" className="btn-primary !py-2 text-sm" onClick={upgrade}><Link2 size={14} /> Google 연결</button>}
          </div>
          <button type="button" className="btn-ghost mt-3 w-full text-sm text-red-200" onClick={logout}><LogOut size={14} /> 로그아웃</button>
        </section>
      )}

      {msg && <p role="status" className="mt-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-slate-200">{msg}</p>}

      <section className="card mt-3">
        <button type="button" className="flex w-full items-center justify-between text-left" aria-expanded={showStack} onClick={() => setShowStack((o) => !o)}>
          <span className="text-sm font-semibold">앱 정보 · 기술 스택</span>
          <span className="text-xs text-slate-400">{showStack ? '접기' : '보기'}</span>
        </button>
        {showStack && (
          <Suspense fallback={<p className="mt-3 text-xs text-slate-500">불러오는 중…</p>}>
            <TechStack />
          </Suspense>
        )}
      </section>
    </main>
  );
}
