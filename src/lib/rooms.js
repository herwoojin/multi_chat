// src/lib/rooms.js — 방 생성 / 입장 / 메시지 쓰기
import {
  collection, doc, getDoc, setDoc, updateDoc, writeBatch, serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db, auth } from './firebase';
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

// ── 사진: Storage(유료) 대신 Firestore 에 base64 로 저장한다 ─────────────
// 메시지 문서에 넣으면 200건 구독이 사진까지 매번 내려받으므로 rooms/{roomId}/images/{id} 로 분리하고,
// 메시지에는 imageId 만 둔다. Firestore 문서 한도(1MiB) 안에 들도록 base64 를 700KB 이하로 줄인다.
export const MAX_IMAGE_B64 = 700_000;

/** 사진을 JPEG base64 로 만든다. 한도에 들 때까지 크기 → 화질 순으로 낮춘다. */
async function encodeImage(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw Object.assign(new Error('이 사진 형식은 열 수 없어요. JPEG·PNG 사진으로 보내 주세요.'), { code: 'image/unsupported' });
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    for (const maxSide of [1600, 1280, 1024, 800, 640]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      ctx.fillStyle = '#fff'; // 투명 PNG 가 JPEG 에서 검게 나오지 않게
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.58]) {
        const url = canvas.toDataURL('image/jpeg', quality);
        const data = url.slice(url.indexOf(',') + 1);
        if (data.length <= MAX_IMAGE_B64) return { data, mime: 'image/jpeg', width: canvas.width, height: canvas.height };
      }
    }
  } finally {
    bitmap.close?.();
  }
  throw Object.assign(new Error('사진이 너무 커서 보낼 수 없어요.'), { code: 'image/too-large' });
}

export async function sendImageMessage({ roomId, uid, profile, myLanguage, file }) {
  const img = await encodeImage(file);
  const batch = writeBatch(db);
  const imgRef = doc(collection(db, 'rooms', roomId, 'images'));
  batch.set(imgRef, {
    senderUid: uid,
    mime: img.mime,
    data: img.data,
    width: img.width,
    height: img.height,
    createdAt: serverTimestamp(),
  });
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
    imageId: imgRef.id,
    imageWidth: img.width,   // 사진을 읽기 전에도 자리를 잡아 두어 스크롤이 튀지 않게
    imageHeight: img.height,
    createdAt: serverTimestamp(),
    deletedAt: null,
  });
  batch.update(doc(db, 'rooms', roomId), lastMessagePatch('📷 사진', profile, myLanguage));
  await batch.commit();
  track('fsWrites', 3);
}

// 같은 사진을 탭 안에서 다시 읽지 않는다 (사진 1장 = 읽기 1회)
const imageCache = new Map();

/** @returns {Promise<string|null>} data URL */
export function loadRoomImage(roomId, imageId) {
  const key = `${roomId}/${imageId}`;
  if (!imageCache.has(key)) {
    const p = getDoc(doc(db, 'rooms', roomId, 'images', imageId)).then((s) => {
      track('fsReads');
      const d = s.data();
      return d ? `data:${d.mime};base64,${d.data}` : null;
    });
    p.catch(() => imageCache.delete(key)); // 실패하면 다음에 다시 시도
    imageCache.set(key, p);
  }
  return imageCache.get(key);
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
