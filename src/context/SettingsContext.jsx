// src/context/SettingsContext.jsx — myLanguage, autoSpeak, speechRate, showOriginal, 글자 크기
// 로그인 상태면 users/{uid} 가 원본, 아니면 localStorage. 바꾸는 즉시 로컬에 반영(낙관적)하고 Firestore 에 쓴다.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { isSupported } from '../lib/languages';
import { unlockAudio, stopAll } from '../lib/tts';

const KEY = 'maltong.settings.v1';
const DEFAULTS = { myLanguage: 'ko', autoSpeak: false, speechRate: 1.0, showOriginal: false, textScale: 1 };
const PROFILE_KEYS = ['myLanguage', 'autoSpeak', 'speechRate', 'showOriginal'];

const guessLang = () => {
  const nav = (navigator.language || 'ko').toLowerCase();
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('fil')) return 'tl';
  const base = nav.split('-')[0];
  return isSupported(base) ? base : 'ko';
};

const loadLocal = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s) return { ...DEFAULTS, ...s };
  } catch { /* noop */ }
  return { ...DEFAULTS, myLanguage: guessLang() };
};

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const { profile, updateMyProfile } = useAuth() || {};
  const [local, setLocal] = useState(loadLocal);

  // 프로필이 바뀌면(다른 기기에서 수정 포함) 로컬 사본을 맞춘다
  useEffect(() => {
    if (!profile) return;
    setLocal((prev) => {
      const next = { ...prev };
      for (const k of PROFILE_KEYS) if (profile[k] !== undefined) next[k] = profile[k];
      return next;
    });
  }, [profile]);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(local)); } catch { /* noop */ }
    document.documentElement.style.setProperty('--text-scale', String(local.textScale || 1));
  }, [local]);

  const update = useCallback((patch) => {
    // iOS: 자동 음성을 켜는 순간(제스처 안)에 무음을 한 번 재생해 오디오를 해제한다
    if (patch.autoSpeak === true) unlockAudio();
    if (patch.autoSpeak === false) stopAll();
    setLocal((prev) => ({ ...prev, ...patch }));
    const remote = Object.fromEntries(Object.entries(patch).filter(([k]) => PROFILE_KEYS.includes(k) || k === 'displayName'));
    if (profile && Object.keys(remote).length) updateMyProfile?.(remote).catch((e) => console.error('[settings]', e));
  }, [profile, updateMyProfile]);

  const value = useMemo(() => ({ ...local, update }), [local, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
