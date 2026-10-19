// src/pages/Room.jsx — 대화방 (메인). 구독 → 보이는 메시지 번역 → 렌더 결정 → 자동 낭독을 여기서 엮는다.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { Lock, MessagesSquare, UserPlus } from 'lucide-react';
import RoomHeader from '../components/room/RoomHeader';
import MessageList from '../components/room/MessageList';
import Composer from '../components/room/Composer';
import LangCorrectSheet from '../components/room/LangCorrectSheet';
import InviteSheet from '../components/room/InviteSheet';
import FullScreenLoader from '../components/FullScreenLoader';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useMessages } from '../hooks/useMessages';
import { useAutoTranslate } from '../hooks/useAutoTranslate';
import { useAutoSpeak } from '../hooks/useAutoSpeak';
import { db } from '../lib/firebase';
import { computeView } from '../lib/view';
import { correctDetectedLang, softDeleteMessage } from '../lib/rooms';
import { speak, speakingId, stopAll } from '../lib/tts';
import { langName } from '../lib/languages';
import { copyText } from '../lib/clipboard';
import { downloadText, exportChatMarkdown } from '../lib/exportChat';
import { friendlyError } from '../lib/errors';
import { track } from '../lib/usage';

// 언어 공부 화면은 분석기·학습지 코드가 커서 열 때 불러온다
const StudySheet = lazy(() => import('../components/room/StudySheet'));

export default function Room() {
  const { roomId } = useParams();
  const { user, profile } = useAuth();
  const { myLanguage: myLang, autoSpeak, speechRate, showOriginal, update } = useSettings();
  const myUid = user.uid;

  const [room, setRoom] = useState(null);
  const [roomError, setRoomError] = useState(null);
  // 빈 집합으로 시작 — 옵저버가 첫 판정을 올려 보내기 전에 오래된 메시지부터 번역하지 않도록
  const [visibleIds, setVisibleIds] = useState(() => new Set());
  const [correcting, setCorrecting] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [studyId, setStudyId] = useState(null); // id 로 들고 있어야 번역이 도착하면 공부 화면도 갱신된다
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);

  useEffect(() => onSnapshot(doc(db, 'rooms', roomId), (s) => {
    track('fsReads');
    if (s.exists()) { setRoom({ id: s.id, ...s.data() }); setRoomError(null); } else setRoomError('missing');
  }, (e) => { console.error('[room]', e); setRoomError(e.code || 'error'); }), [roomId]);

  const { messages, loaded, hasMore, loadMore } = useMessages(roomId);
  const { local, failed } = useAutoTranslate({ roomId, messages, myLang, myUid, visibleIds });
  // ★ myLang 이 바뀌면 view 가 바뀌고, 떠 있는 모든 말풍선이 새 언어로 다시 렌더된다
  const view = useCallback((m) => computeView(m, { myUid, myLang, local, failed }), [myUid, myLang, local, failed]);
  useAutoSpeak({ messages, loaded, myUid, enabled: autoSpeak, rate: speechRate, view });

  useEffect(() => () => stopAll(), [roomId]); // 방을 떠나면 읽던 소리를 멈춘다

  const notify = useCallback((msg) => {
    if (!msg) return;
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2400);
  }, []);

  const onSpeak = useCallback((id, text, lang) => {
    if (speakingId() === id) stopAll();
    else speak(text, lang, { rate: speechRate, id });
  }, [speechRate]);

  const onCopy = useCallback(async (text) => {
    notify((await copyText(text)) ? '복사했어요' : '복사하지 못했어요');
  }, [notify]);

  const onDelete = useCallback((m) => {
    if (!window.confirm('이 메시지를 삭제할까요? 모든 사람에게서 사라져요.')) return;
    softDeleteMessage(roomId, m.id).catch((e) => notify(friendlyError(e)));
  }, [roomId, notify]);

  const onCorrect = useCallback((m) => setCorrecting(m), []);
  const closeCorrect = useCallback(() => setCorrecting(null), []);
  const closeInvite = useCallback(() => setInviteOpen(false), []);
  const onStudy = useCallback((m) => setStudyId(m.id), []);
  const closeStudy = useCallback(() => setStudyId(null), []);
  const studyMsg = studyId ? messages.find((x) => x.id === studyId) : null;

  const pickLang = async (code) => {
    const m = correcting;
    setCorrecting(null);
    if (!m || (code === m.detectedLang && m.detectionSource === 'manual')) return;
    try {
      await correctDetectedLang(roomId, m.id, code);
      notify(`${langName(code)} 기준으로 다시 번역해요`);
    } catch (e) {
      notify(friendlyError(e));
    }
  };

  const toggleAutoSpeak = () => {
    update({ autoSpeak: !autoSpeak }); // 클릭(제스처) 안에서 호출돼야 iOS 오디오 해제가 먹는다
    notify(autoSpeak ? '자동 음성 꺼짐' : '자동 음성 켜짐 — 새 메시지를 내 언어로 읽어 드려요');
  };

  const onExport = () => {
    const md = exportChatMarkdown({ room, messages, view, myLang });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`${(room?.name || 'maltong').replace(/[\\/:*?"<>|]+/g, '_')}-${stamp}.md`, md);
  };

  if (roomError) return <RoomBlocked code={roomError} />;
  if (!room) return <FullScreenLoader label="대화방을 여는 중…" />;

  return (
    <div className="flex h-[100dvh] flex-col">
      <RoomHeader
        room={room}
        roomId={roomId}
        myLang={myLang}
        onLangChange={(c) => update({ myLanguage: c })}
        autoSpeak={autoSpeak}
        onToggleAutoSpeak={toggleAutoSpeak}
        onInvite={() => setInviteOpen(true)}
        onExport={onExport}
      />
      <MessageList
        roomId={roomId}
        messages={messages}
        loaded={loaded}
        hasMore={hasMore}
        onLoadMore={loadMore}
        view={view}
        showOriginal={showOriginal}
        onVisibleChange={setVisibleIds}
        onSpeak={onSpeak}
        onCorrect={onCorrect}
        onCopy={onCopy}
        onDelete={onDelete}
        onStudy={onStudy}
        empty={<EmptyRoom onInvite={() => setInviteOpen(true)} />}
      />
      <Composer
        roomId={roomId}
        uid={myUid}
        profile={profile || { displayName: user.displayName || '게스트', photoURL: user.photoURL || null }}
        myLang={myLang}
        onError={notify}
      />

      {correcting && <LangCorrectSheet message={correcting} current={correcting.detectedLang} onPick={pickLang} onClose={closeCorrect} />}
      {inviteOpen && <InviteSheet room={room} isOwner={room.ownerUid === myUid} onClose={closeInvite} notify={notify} />}
      {studyMsg && (
        <Suspense fallback={null}>
          <StudySheet message={studyMsg} view={view(studyMsg)} myLang={myLang} rate={speechRate} onClose={closeStudy} />
        </Suspense>
      )}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
          <div role="status" className="glass-strong animate-rise rounded-full px-4 py-2 text-sm shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}

function EmptyRoom({ onInvite }) {
  return (
    <div className="mx-auto mt-10 max-w-sm animate-rise text-center">
      <MessagesSquare className="mx-auto text-brand-400" size={36} />
      <p className="mt-3 font-semibold">첫 메시지를 보내 보세요</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-400">
        어떤 언어로 써도 괜찮아요. 메시지마다 언어를 감지해 상대에게는 그 사람의 언어로 보여 드려요.
      </p>
      <button type="button" className="btn-ghost mt-4 text-sm" onClick={onInvite}><UserPlus size={16} /> 친구 초대하기</button>
    </div>
  );
}

function RoomBlocked({ code }) {
  // 없는 방도 규칙상 permission-denied 로 온다 (resource 가 null 이라 멤버 판정 실패)
  const denied = code === 'permission-denied' || code === 'missing';
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
      <Lock size={36} className="text-slate-500" />
      <h1 className="font-display text-xl font-bold">이 대화방에 들어갈 수 없어요</h1>
      <p className="text-sm leading-relaxed text-slate-400">
        {denied
          ? '아직 멤버가 아니거나 없는 방이에요. 받은 초대 링크로 다시 들어와 주세요.'
          : '대화방을 불러오지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.'}
      </p>
      <Link to="/" className="btn-primary">처음으로</Link>
    </main>
  );
}
