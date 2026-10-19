// src/context/AuthContext.jsx — 익명/구글 인증 + users/{uid} 프로필 실시간 구독
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  onAuthStateChanged, signInAnonymously, signInWithPopup, linkWithPopup,
  GoogleAuthProvider, signOut as fbSignOut, updateProfile,
} from 'firebase/auth';
import { doc, onSnapshot, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, authReady, isFirebaseConfigured } from '../lib/firebase';
import { track } from '../lib/usage';

const AuthContext = createContext(null);
const provider = () => new GoogleAuthProvider();

/** 프로필 문서가 없으면 기본값으로 만든다. 있으면 넘겨받은 필드만 갱신. */
async function ensureProfile(user, { displayName, myLanguage } = {}) {
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  track('fsReads');
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      displayName: (displayName || user.displayName || '게스트').slice(0, 30),
      email: user.email || null,
      photoURL: user.photoURL || null,
      isAnonymous: user.isAnonymous,
      myLanguage: myLanguage || 'ko',
      autoSpeak: false,
      speechRate: 1.0,
      showOriginal: false,
      createdAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    });
  } else {
    const patch = { lastSeenAt: serverTimestamp(), isAnonymous: user.isAnonymous };
    if (displayName) patch.displayName = displayName.slice(0, 30);
    if (myLanguage) patch.myLanguage = myLanguage;
    if (user.email) patch.email = user.email;
    if (user.photoURL && !snap.data().photoURL) patch.photoURL = user.photoURL;
    await setDoc(ref, patch, { merge: true });
  }
  track('fsWrites');
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!auth) return undefined;
    let unsubProfile = () => {};
    const unsub = onAuthStateChanged(auth, (u) => {
      unsubProfile();
      setUser(u);
      if (!u) { setProfile(null); setLoading(false); return; }
      unsubProfile = onSnapshot(doc(db, 'users', u.uid), (s) => {
        track('fsReads');
        setProfile(s.exists() ? { id: s.id, ...s.data() } : null);
        setLoading(false);
      }, (e) => { console.error('[profile]', e); setLoading(false); });
    });
    return () => { unsub(); unsubProfile(); };
  }, []);

  /** 게스트 입장: 이름 + 내 언어만 받고 익명 로그인 (가입 없음) */
  const signInGuest = useCallback(async ({ displayName, myLanguage }) => {
    await authReady;
    const cred = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
    if (displayName) await updateProfile(cred.user, { displayName }).catch(() => {});
    await ensureProfile(cred.user, { displayName, myLanguage });
    return cred.user;
  }, []);

  const signInGoogle = useCallback(async ({ myLanguage } = {}) => {
    await authReady;
    const cred = await signInWithPopup(auth, provider());
    await ensureProfile(cred.user, { myLanguage });
    return cred.user;
  }, []);

  /** 익명 → Google 계정 승격. 같은 UID 를 유지하므로 방 멤버십·메시지가 그대로 남는다. */
  const upgradeToGoogle = useCallback(async () => {
    if (!auth.currentUser) throw new Error('로그인 상태가 아닙니다.');
    const cred = await linkWithPopup(auth.currentUser, provider());
    await ensureProfile(cred.user, {});
    return cred.user;
  }, []);

  const updateMyProfile = useCallback(async (patch) => {
    if (!auth?.currentUser) return;
    await setDoc(doc(db, 'users', auth.currentUser.uid), patch, { merge: true });
    track('fsWrites');
  }, []);

  const signOut = useCallback(() => fbSignOut(auth), []);

  const value = useMemo(() => ({
    user, profile, loading, signInGuest, signInGoogle, upgradeToGoogle, updateMyProfile, signOut,
  }), [user, profile, loading, signInGuest, signInGoogle, upgradeToGoogle, updateMyProfile, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
