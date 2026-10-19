// src/lib/firebase.js — 앱 초기화. .env 가 비어 있으면 null 을 내보내고 앱은 설정 안내 화면을 띄운다.
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

// 로컬 에뮬레이터 모드 (npm run dev:local) — 실제 프로젝트·키 없이 demo- 프로젝트로 전부 로컬에서 돈다.
export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === 'true';
const DEMO_PROJECT = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-maltong';

const config = usingEmulators ? {
  apiKey: 'demo-key',
  authDomain: `${DEMO_PROJECT}.firebaseapp.com`,
  projectId: DEMO_PROJECT,
  storageBucket: `${DEMO_PROJECT}.appspot.com`,
  messagingSenderId: '0',
  appId: 'demo-app',
} : {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);

export const app = isFirebaseConfigured ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app && config.storageBucket ? getStorage(app) : null;

if (usingEmulators && app) {
  // 휴대폰으로 LAN 주소에 접속해도 에뮬레이터에 닿도록 페이지 호스트를 그대로 쓴다 (포트는 firebase.json)
  const host = window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  if (storage) connectStorageEmulator(storage, host, 9199);
}

// 익명 사용자가 새로고침·재방문해도 같은 사람으로 인식되도록 명시적으로 설정한다.
export const authReady = auth
  ? setPersistence(auth, browserLocalPersistence).catch((e) => console.warn('[auth] persistence', e))
  : Promise.resolve();
