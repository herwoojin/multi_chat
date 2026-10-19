import { Link } from 'react-router-dom';
import { Flame, KeyRound, Languages, ShieldCheck, Mic } from 'lucide-react';
import Brand from './Brand';

const STEPS = [
  { icon: Flame, title: 'Firebase 프로젝트 + 웹 앱 등록', body: '콘솔에서 웹 앱을 추가하고 SDK 설정값 6개를 복사합니다.' },
  { icon: KeyRound, title: '.env 작성', body: '.env.example 을 .env 로 복사해 VITE_FIREBASE_* 값을 채우고, joinRoom 용 FIREBASE_SERVICE_ACCOUNT 도 넣습니다.' },
  { icon: ShieldCheck, title: '인증·DB 켜기', body: 'Authentication 에서 익명 + Google 로그인을 켜고, Firestore·Storage 를 만든 뒤 npm run deploy:rules 로 규칙·인덱스를 배포합니다.' },
];

export default function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-5 py-10">
      <Brand />
      <section className="card mt-8 animate-rise">
        <h1 className="font-display text-2xl font-bold">Firebase 연결만 남았어요</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          대화방·로그인·메시지 저장은 Firebase 가 필요합니다. 아래 3단계를 마치고 개발 서버를 다시 시작하세요.
        </p>
        <p className="mt-2 rounded-xl border border-aqua-400/20 bg-aqua-500/10 px-3 py-2 text-xs leading-relaxed text-aqua-400">
          지금 바로 써보려면 <code className="font-semibold">npm run dev:local</code> — 실제 프로젝트 없이 로컬 에뮬레이터로 전부 동작합니다.
        </p>
        <ol className="mt-5 space-y-4">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/20 text-brand-400">
                <Icon size={18} />
              </span>
              <div>
                <p className="font-semibold text-slate-100">{i + 1}. {title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card mt-4 animate-rise" style={{ animationDelay: '80ms' }}>
        <p className="text-sm font-semibold text-slate-200">지금 바로 써볼 수 있는 것</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link to="/room/solo/f2f" className="btn-primary text-sm"><Mic size={16} /> 대면 통역</Link>
          <Link to="/settings" className="btn-ghost text-sm"><Languages size={16} /> 내 언어 설정</Link>
        </div>
      </section>
    </main>
  );
}
