// src/pages/Landing.jsx — 방 만들기 / 초대코드로 들어가기 / 내 대화방
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, LogIn, Mic, Plus, Settings as SettingsIcon, Users } from 'lucide-react';
import Brand from '../components/Brand';
import LanguageSelect from '../components/LanguageSelect';
import SetupNotice from '../components/SetupNotice';
import FullScreenLoader from '../components/FullScreenLoader';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useMyRooms } from '../hooks/useMyRooms';
import { isFirebaseConfigured } from '../lib/firebase';
import { createRoom } from '../lib/rooms';
import { friendlyError } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { langFlag } from '../lib/languages';

const CODE_RE = /^[A-Z0-9]{8}$/;

/** 초대 링크를 통째로 붙여넣어도 코드만 뽑아낸다 */
const extractCode = (raw) => {
  const s = String(raw || '').toUpperCase();
  return s.match(/JOIN\/([A-Z0-9]{8})/)?.[1] || s.replace(/[^A-Z0-9]/g, '');
};

export default function Landing() {
  return isFirebaseConfigured ? <Home /> : <SetupNotice />;
}

function Home() {
  const nav = useNavigate();
  const { user, profile, loading, signInGuest, signInGoogle } = useAuth();
  const { myLanguage, update } = useSettings();
  const { rooms } = useMyRooms(user?.uid);
  const [name, setName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null); // 'create' | 'google'
  const [error, setError] = useState('');

  if (loading) return <FullScreenLoader />;

  const displayName = profile?.displayName || name.trim() || '게스트';

  const onCreate = async (e) => {
    e.preventDefault();
    setBusy('create');
    setError('');
    try {
      const u = profile ? user : await signInGuest({ displayName, myLanguage });
      const { roomId } = await createRoom({ name: roomName.trim() || `${displayName}의 대화방`, uid: u.uid, myLanguage });
      nav(`/room/${roomId}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(null);
    }
  };

  const onJoin = (e) => {
    e.preventDefault();
    const c = extractCode(code);
    if (!CODE_RE.test(c)) { setError('초대 코드는 영문 대문자+숫자 8자예요.'); return; }
    nav(`/join/${c}`);
  };

  const onGoogle = async () => {
    setBusy('google');
    setError('');
    try { await signInGoogle({ myLanguage }); } catch (err) { setError(friendlyError(err)); }
    setBusy(null);
  };

  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col px-5 pb-24 pt-8">
      <div className="flex items-center justify-between">
        <Brand />
        <Link to="/settings" className="btn-icon" aria-label="설정"><SettingsIcon size={20} /></Link>
      </div>

      <h1 className="mt-8 font-display text-[1.75rem] font-extrabold leading-tight">
        각자의 언어로 말해도<br /><span className="text-gradient">모두가 알아듣는 대화방</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-400">
        메시지마다 언어를 자동으로 감지해, 보는 사람의 언어로 번역해 보여주고 읽어 드려요.
      </p>

      <section className="card mt-7 animate-rise">
        <label className="label" htmlFor="home-lang">내 언어 — 읽고 들을 언어</label>
        <LanguageSelect id="home-lang" value={myLanguage} onChange={(c) => update({ myLanguage: c })} />
      </section>

      <form className="card mt-3 animate-rise" style={{ animationDelay: '60ms' }} onSubmit={onCreate}>
        <h2 className="font-bold">새 대화방 만들기</h2>
        {!profile && (
          <div className="mt-3">
            <label className="label" htmlFor="home-name">내 이름</label>
            <input id="home-name" className="input" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="상대에게 보일 이름" autoComplete="nickname" />
          </div>
        )}
        <div className="mt-3">
          <label className="label" htmlFor="home-room">방 이름</label>
          <input id="home-room" className="input" maxLength={60} value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder={`${displayName}의 대화방`} />
        </div>
        <button type="submit" className="btn-primary mt-4 w-full" disabled={Boolean(busy)}>
          {busy === 'create' ? <span className="spinner" /> : <Plus size={18} />} 방 만들고 초대 링크 받기
        </button>
      </form>

      <form className="card mt-3 animate-rise" style={{ animationDelay: '120ms' }} onSubmit={onJoin}>
        <h2 className="font-bold">초대 코드로 들어가기</h2>
        <div className="mt-3 flex gap-2">
          <label htmlFor="home-code" className="sr-only">초대 코드 또는 링크</label>
          <input
            id="home-code"
            className="input min-w-0 flex-1 font-display uppercase tracking-[0.2em]"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD1234"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="btn-ghost shrink-0" disabled={!code.trim()}><LogIn size={18} /> 입장</button>
        </div>
      </form>

      {error && <p role="alert" className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

      {rooms.length > 0 && (
        <section className="mt-7">
          <h2 className="label">내 대화방</h2>
          <ul className="space-y-2">
            {rooms.map((r) => (
              <li key={r.id}>
                <Link to={`/room/${r.id}`} className="glass flex items-center gap-3 rounded-2xl px-4 py-3 transition hover:bg-white/[0.09]">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-semibold">{r.name}</span>
                      <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-slate-500"><Users size={11} />{r.memberCount}</span>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-400">
                      {r.lastMessage ? `${r.lastMessage.senderName}: ${r.lastMessage.text}` : '아직 메시지가 없어요'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-slate-500">{formatRelative(r.updatedAt)}</span>
                    <span className="text-xs" aria-hidden="true">{(r.activeLanguages || []).slice(0, 4).map(langFlag).join('')}</span>
                  </div>
                  <ChevronRight size={16} className="shrink-0 text-slate-600" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7 grid grid-cols-2 gap-2">
        <Link to="/room/solo/f2f" className="btn-ghost text-sm"><Mic size={16} /> 대면 통역</Link>
        {/* 익명 사용자는 popup 로그인 대신 설정의 "Google 계정 연결"로 승격해야 방 멤버십이 유지된다 */}
        {user ? (
          <Link to="/settings" className="btn-ghost text-sm"><SettingsIcon size={16} /> 설정</Link>
        ) : (
          <button type="button" className="btn-ghost text-sm" onClick={onGoogle} disabled={Boolean(busy)}>
            {busy === 'google' ? <span className="spinner" /> : <LogIn size={16} />} Google 로그인
          </button>
        )}
      </section>
      {profile && (
        <p className="mt-4 text-center text-xs text-slate-500">
          {profile.displayName} 님으로 접속 중{user?.isAnonymous ? ' · 게스트' : ''}
        </p>
      )}
    </main>
  );
}
