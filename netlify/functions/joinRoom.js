// netlify/functions/joinRoom.js
// 초대 코드로 방을 찾는 쿼리는 "아직 멤버가 아닌 사람"이 실행하므로 클라이언트에서는 보안 규칙에 막힌다.
// 규칙을 열면 방 목록 열람 취약점이 되므로, Admin SDK 로 서버에서 조회 + 멤버 추가를 처리한다.
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { LANGUAGES } from '../../src/lib/languages.js';

const SUPPORTED = new Set(LANGUAGES.map((l) => l.code));

const initAdmin = () => {
  if (getApps().length) return true;
  // 로컬 에뮬레이터(npm run dev:local): 자격증명 없이 demo 프로젝트로 붙는다.
  // FIRESTORE_EMULATOR_HOST · FIREBASE_AUTH_EMULATOR_HOST 가 있으면 Admin SDK 가 알아서 에뮬레이터로 간다.
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-maltong' });
    return true;
  }
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (raw) {
    const jsonText = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    initializeApp({ credential: cert(JSON.parse(jsonText)) });
    return true;
  }
  // 키 파일(GOOGLE_APPLICATION_CREDENTIALS) 또는 — 조직 정책으로 키를 못 만들 때의 로컬 개발용 —
  // `gcloud auth application-default login` 으로 만든 ADC. ADC 는 프로젝트 ID 를 따로 알려줘야 한다.
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || projectId) {
    initializeApp({ credential: applicationDefault(), ...(projectId && { projectId }) });
    return true;
  }
  return false;
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    if (!initAdmin()) {
      return json(500, { error: 'not_configured', message: '서버에 FIREBASE_SERVICE_ACCOUNT 가 설정되지 않았습니다.' });
    }
  } catch (e) {
    return json(500, { error: 'bad_credentials', message: String(e?.message || e) });
  }

  const authz = event.headers?.authorization || event.headers?.Authorization || '';
  const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!idToken) return json(401, { error: 'unauthenticated' });

  let uid;
  try { uid = (await getAuth().verifyIdToken(idToken)).uid; }
  catch { return json(401, { error: 'invalid_token' }); }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'bad json' }); }

  const code = String(body.inviteCode || '').trim().toUpperCase();
  const myLanguage = SUPPORTED.has(body.myLanguage) ? body.myLanguage : null;
  if (!/^[A-Z0-9]{8}$/.test(code)) return json(400, { error: 'bad_code', message: '초대 코드는 영문 대문자+숫자 8자입니다.' });

  const db = getFirestore();
  const found = await db.collection('rooms').where('inviteCode', '==', code).limit(1).get();
  if (found.empty) return json(404, { error: 'not_found', message: '해당 초대 코드의 방이 없습니다.' });

  const ref = found.docs[0].ref;
  try {
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.data();
      const members = d.memberUids || [];
      if (members.includes(uid)) return { roomId: ref.id, name: d.name, already: true };
      if (!d.inviteEnabled) throw Object.assign(new Error('초대가 닫혀 있습니다.'), { code: 'closed' });

      const langs = Array.from(new Set([...(d.activeLanguages || []), ...(myLanguage ? [myLanguage] : [])]));
      tx.update(ref, {
        memberUids: FieldValue.arrayUnion(uid),
        memberCount: members.length + 1,
        activeLanguages: langs,
      });
      return { roomId: ref.id, name: d.name, already: false };
    });
    return json(200, result);
  } catch (e) {
    if (e.code === 'closed') return json(403, { error: 'closed', message: e.message });
    return json(500, { error: 'join_failed', message: String(e?.message || e) });
  }
};

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj),
});
