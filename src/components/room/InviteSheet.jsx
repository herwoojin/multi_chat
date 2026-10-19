import { Copy, Share2 } from 'lucide-react';
import Sheet from '../Sheet';
import Toggle from '../Toggle';
import { inviteLink, setInviteEnabled } from '../../lib/rooms';
import { copyText } from '../../lib/clipboard';
import { langFlag, langName } from '../../lib/languages';
import { friendlyError } from '../../lib/errors';

/** 초대 링크·코드 공유. 방장은 초대를 열고 닫을 수 있다. */
export default function InviteSheet({ room, isOwner, onClose, notify }) {
  const link = inviteLink(room.inviteCode);
  const canShare = typeof navigator.share === 'function';

  const copy = async () => notify((await copyText(link)) ? '초대 링크를 복사했어요' : '복사하지 못했어요 — 링크를 길게 눌러 복사해 주세요');
  const share = () => navigator.share({
    title: `말.통 — ${room.name}`,
    text: `"${room.name}" 대화방에 초대합니다. 각자의 언어로 대화해요.`,
    url: link,
  }).catch(() => {});
  const toggle = (on) => setInviteEnabled(room.id, on).catch((e) => notify(friendlyError(e)));

  return (
    <Sheet title="초대하기" onClose={onClose} id="invite">
      <p className="text-sm text-slate-400">링크를 받은 사람은 가입 없이 이름과 언어만 고르고 바로 들어와요.</p>

      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-center">
        <p className="label !mb-1">초대 코드</p>
        <p className="text-gradient select-all font-display text-3xl font-extrabold tracking-[0.3em]">{room.inviteCode}</p>
        <p className="mt-2 select-all break-all text-xs text-slate-500">{link}</p>
      </div>

      <div className={`mt-3 grid gap-2 ${canShare ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button type="button" className="btn-primary" onClick={copy}><Copy size={16} /> 링크 복사</button>
        {canShare && <button type="button" className="btn-ghost" onClick={share}><Share2 size={16} /> 공유</button>}
      </div>

      {Boolean(room.activeLanguages?.length) && (
        <div className="mt-4">
          <p className="label">이 방에서 쓰는 언어</p>
          <div className="flex flex-wrap gap-1.5">
            {room.activeLanguages.map((c) => <span key={c} className="chip">{langFlag(c)} {langName(c)}</span>)}
          </div>
        </div>
      )}

      {isOwner ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-white/10 p-3">
          <div>
            <p className="text-sm font-semibold">초대 링크 열기</p>
            <p className="mt-0.5 text-xs text-slate-400">끄면 새 사람이 들어올 수 없어요. 이미 들어온 사람은 그대로예요.</p>
          </div>
          <Toggle on={room.inviteEnabled} onChange={toggle} label="초대 링크 열기" />
        </div>
      ) : !room.inviteEnabled && (
        <p className="mt-4 text-sm text-amber-300">방장이 초대를 닫아 두어 지금은 새 사람이 들어올 수 없어요.</p>
      )}
    </Sheet>
  );
}
