import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, EllipsisVertical, Mic, Settings, Share2, Users, Volume2, VolumeX } from 'lucide-react';
import LanguageSelect from '../LanguageSelect';

const ITEM = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10';

/**
 * 대화방 헤더 — 방 이름 · 인원 · 자동 음성 · ★ 내 언어 셀렉터 · 메뉴.
 * 언어 셀렉터는 설정 화면에만 두면 모바일에서 접근 경로가 끊기므로 여기 상시 노출한다 (PRD 6.3).
 */
export default function RoomHeader({ room, roomId, myLang, onLangChange, autoSpeak, onToggleAutoSpeak, onInvite, onExport }) {
  const [menu, setMenu] = useState(false);
  const close = () => setMenu(false);

  return (
    <header className="glass-strong safe-top relative z-30 border-x-0 border-t-0">
      <div className="mx-auto flex max-w-3xl items-center gap-1 px-1.5 py-1.5">
        <Link to="/" className="btn-icon" aria-label="대화방 목록으로"><ArrowLeft size={20} /></Link>

        <button
          type="button"
          onClick={onInvite}
          className="min-w-0 flex-1 rounded-xl px-1.5 py-1 text-left transition hover:bg-white/5"
          aria-label={`${room.name} — ${room.memberCount ?? 1}명, 초대하기`}
        >
          <p className="truncate font-bold leading-tight">{room.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400"><Users size={12} /> {room.memberCount ?? 1}명 · 초대</p>
        </button>

        <button
          type="button"
          onClick={onToggleAutoSpeak}
          aria-pressed={autoSpeak}
          aria-label={autoSpeak ? '자동 음성 끄기' : '자동 음성 켜기'}
          title="자동 음성"
          className={`btn-icon ${autoSpeak ? 'bg-aqua-500/15 !text-aqua-400' : ''}`}
        >
          {autoSpeak ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>

        <LanguageSelect id="room-lang" compact value={myLang} onChange={onLangChange} />

        <div className="relative">
          <button type="button" className="btn-icon" aria-label="메뉴" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((o) => !o)}>
            <EllipsisVertical size={20} />
          </button>
          {menu && (
            <>
              <div className="fixed inset-0 z-10" onClick={close} aria-hidden="true" />
              <div role="menu" className="glass-strong absolute right-0 top-12 z-20 w-56 animate-rise rounded-2xl p-1.5 shadow-2xl">
                <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); onInvite(); }}><Share2 size={16} /> 초대 링크 공유</button>
                <Link role="menuitem" className={ITEM} to={`/room/${roomId}/f2f`}><Mic size={16} /> 대면 통역 모드</Link>
                <button type="button" role="menuitem" className={ITEM} onClick={() => { close(); onExport(); }}><Download size={16} /> 대화 내보내기 (.md)</button>
                <Link role="menuitem" className={ITEM} to="/settings"><Settings size={16} /> 설정</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
