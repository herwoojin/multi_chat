// src/pages/Join.jsx — 초대 링크 입장: 이름 + 내 언어만 받고 바로 들어간다 (가입 없음, PRD F9·F10)
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DoorOpen, LogIn } from 'lucide-react';
import Brand from '../components/Brand';
import LanguageSelect from '../components/LanguageSelect';
import FullScreenLoader from '../components/FullScreenLoader';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { joinRoomByCode } from '../lib/rooms';
import { friendlyError } from '../lib/errors';

export default function Join() {
  const { inviteCode = '' } = useParams();
  const code = inviteCode.trim().toUpperCase();
  const valid = /^[A-Z0-9]{8}$/.test(code);
  const nav = useNavigate();
  const { user, profile, loading, signInGuest, signInGoogle } = useAuth();
  const { myLanguage, update } = useSettings();
  const [name, setName] = useState(null); // null = 아직 안 건드림 → 프로필 이름을 보여준다
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const shownName = name ?? profile?.displayName ?? '';

  if (loading) return <FullScreenLoader />;

  const enter = async (kind, signIn) => {
    setBusy(kind);
    setError('');
    try {
      await signIn();
      // 입장은 반드시 Function 경유 — 비멤버는 초대 코드로 방을 조회할 수 없다 (ERD 7)
      const r = await joinRoomByCode({ inviteCode: code, myLanguage });
      nav(`/room/${r.roomId}`, { replace: true });
    } catch (e) {
      setError(friendlyError(e));
      setBusy(null);
    }
  };

  const onGuest = (e) => {
    e.preventDefault();
    enter('guest', () => signInGuest({ displayName: shownName.trim() || '게스트', myLanguage }));
  };

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-5 py-10">
      <Brand />
      {!valid ? (
        <section className="card mt-8 animate-rise">
          <h1 className="font-display text-xl font-bold">초대 링크가 올바르지 않아요</h1>
          <p className="mt-2 text-sm text-slate-400">초대 코드는 영문 대문자+숫자 8자예요. 받은 링크를 다시 확인해 주세요.</p>
          <Link to="/" className="btn-ghost mt-4 w-full">처음으로</Link>
        </section>
      ) : (
        <form className="card mt-8 animate-rise" onSubmit={onGuest}>
          <p className="chip w-fit font-display tracking-[0.2em]">{code}</p>
          <h1 className="mt-3 font-display text-2xl font-bold">대화방에 초대받았어요</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">
            상대가 어떤 언어로 말하든, 고른 언어로 번역해 보여주고 읽어 드려요.
          </p>

          <div className="mt-5">
            <label className="label" htmlFor="join-name">내 이름</label>
            <input
              id="join-name"
              className="input"
              maxLength={30}
              value={shownName}
              onChange={(e) => setName(e.target.value)}
              placeholder="상대에게 보일 이름"
              autoComplete="nickname"
              autoFocus={!shownName}
            />
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="join-lang">내 언어</label>
            <LanguageSelect id="join-lang" value={myLanguage} onChange={(c) => update({ myLanguage: c })} />
          </div>

          <button type="submit" className="btn-primary mt-5 w-full" disabled={Boolean(busy)}>
            {busy === 'guest' ? <span className="spinner" /> : <DoorOpen size={18} />} 바로 입장
          </button>
          {!user && (
            <button type="button" className="btn-ghost mt-2 w-full text-sm" disabled={Boolean(busy)} onClick={() => enter('google', () => signInGoogle({ myLanguage }))}>
              {busy === 'google' ? <span className="spinner" /> : <LogIn size={16} />} Google 계정으로 입장
            </button>
          )}

          {error && <p role="alert" className="mt-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}

          <p className="mt-4 text-center text-xs leading-relaxed text-slate-500">
            가입 없이 들어가요. 같은 브라우저로 다시 오면 같은 사람으로 알아봐요.
          </p>
        </form>
      )}
    </main>
  );
}
