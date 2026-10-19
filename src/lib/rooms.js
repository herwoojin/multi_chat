// src/lib/rooms.js — 방 생성 / 입장 / 메시지 쓰기
import {
  collection, doc, setDoc, updateDoc, writeBatch, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, auth } from './firebase';
import { track } from './usage';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 8자 A-Z0-9. 36^8 ≈ 2.8조 가지. */
export const generateInviteCode = () => {
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
};

export const inviteLink = (code) => `${window.location.origin}${window.location.pathname}#/join/${code}`;

/**
 * 방 생성.
 * ERD 3.2 는 생성 시 where('inviteCode') 로 중복 확인을 권하지만, 그 쿼리는 보안 규칙상
 * 비멤버 방을 조회하는 것이라 클라이언트에서 거부된다. 2.8조 공간 + 암호학적 난수로 충돌을 무시한다.
 */
export async function createRoom({ name, uid, myLanguage }) {
  const ref = doc(collection(db, 'rooms'));
  const inviteCode = generateInviteCode();
  await setDoc(ref, {
    name: name.trim().slice(0, 60),
    ownerUid: uid,
    inviteCode,
    inviteEnabled: true,
    memberUids: [uid],
    memberCount: 1,
    activeLanguages: [myLanguage],
    lastMessage: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  track('fsWrites');
  return { roomId: ref.id, inviteCode };
}

/** 초대 코드로 입장 — 반드시 joinRoom Function 경유 (비멤버는 방을 조회할 수 없다). */
export async function joinRoomByCode({ inviteCode, myLanguage }) {
  const user = auth.currentUser;
  if (!user) throw new Error('로그인이 필요합니다.');
  const idToken = await user.getIdToken();
  const res = await fetch('/api/joinRoom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ inviteCode, myLanguage }),
  });
  let data = {};
  try { data = await res.json(); } catch { /* noop */ }
  if (!res.ok) {
    const err = new Error(data.message || data.error || `입장 실패 (${res.status})`);
    err.code = data.error;
    throw err;
  }
  return data; // { roomId, name, already }
}

const lastMessagePatch = (text, profile, myLanguage) => ({
  lastMessage: {
    text: text.slice(0, 100),
    senderName: profile.displayName,
    detectedLang: null,                    // 감지 후 채워짐 — 설정값으로 미리 채우지 않는다
    at: serverTimestamp(),
  },
  updatedAt: serverTimestamp(),
  activeLanguages: arrayUnion(myLanguage),
});

/** 텍스트 메시지 전송. ★ detectedLang 은 비워 둔다 (첫 번역 때 실제 감지 결과로 기록). */
export async function sendTextMessage({ roomId, uid, profile, myLanguage, text }) {
  const trimmed = text.trim().slice(0, 5000);
  if (!trimmed) return;
  const batch = writeBatch(db);
  const msgRef = doc(collection(db, 'rooms', roomId, 'messages'));
  batch.set(msgRef, {
    senderUid: uid,
    senderName: profile.displayName || '이름 없음',
    senderPhotoURL: profile.photoURL || null,
    senderLang: myLanguage,                // 폴백 전용 스냅샷. 원문 언어가 아니다.
    type: 'text',
    text: trimmed,
    translations: {},
    pronunciations: {},
    imageUrl: null,
    createdAt: serverTimestamp(),
    deletedAt: null,
  });
  batch.update(doc(db, 'rooms', roomId), lastMessagePatch(trimmed, profile, myLanguage));
  await batch.commit();
  track('fsWrites', 2);
}

/** 브라우저에서 이미지를 축소(최대 1600px, JPEG 0.82)해 업로드 용량을 줄인다. */
async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return blob || file;
}

export async function sendImageMessage({ roomId, uid, profile, myLanguage, file }) {
  if (!storage) throw new Error('Storage 버킷이 설정되지 않았습니다.');
  const blob = await compressImage(file);
  const path = `rooms/${roomId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  const r = sRef(storage, path);
  await uploadBytes(r, blob, { contentType: 'image/jpeg' });
  const imageUrl = await getDownloadURL(r);

  const batch = writeBatch(db);
  const msgRef = doc(collection(db, 'rooms', roomId, 'messages'));
  batch.set(msgRef, {
    senderUid: uid,
    senderName: profile.displayName || '이름 없음',
    senderPhotoURL: profile.photoURL || null,
    senderLang: myLanguage,
    type: 'image',
    text: '',
    translations: {},
    pronunciations: {},
    imageUrl,
    createdAt: serverTimestamp(),
    deletedAt: null,
  });
  batch.update(doc(db, 'rooms', roomId), lastMessagePatch('📷 사진', profile, myLanguage));
  await batch.commit();
  track('fsWrites', 2);
}

/** 작성자 소프트 삭제 (규칙: deletedAt 만 변경 가능). */
export async function softDeleteMessage(roomId, messageId) {
  await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), { deletedAt: serverTimestamp() });
  track('fsWrites');
}

/**
 * 감지 결과 수동 교정 (ERD 8.3). 잘못된 원문 언어로 만든 번역은 전부 틀렸으므로 통째로 비운다.
 * 다음 렌더에서 useAutoTranslate 가 sourceLang=교정값 으로 다시 번역한다.
 */
export async function correctDetectedLang(roomId, messageId, correctedLang) {
  await updateDoc(doc(db, 'rooms', roomId, 'messages', messageId), {
    detectedLang: correctedLang,
    detectionConfidence: 'high',
    detectionSource: 'manual',
    translations: {},
    pronunciations: {},
  });
  track('fsWrites');
}

export async function setInviteEnabled(roomId, enabled) {
  await updateDoc(doc(db, 'rooms', roomId), { inviteEnabled: enabled });
  track('fsWrites');
}
