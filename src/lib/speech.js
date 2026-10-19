// src/lib/speech.js — Web Speech Recognition 래퍼
import { speechLocale } from './languages';

const getSR = () => (typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null);

/** 미지원 브라우저(Firefox 등)에서는 마이크 버튼을 숨기기 위해 쓴다. */
export const isSpeechRecognitionSupported = () => Boolean(getSR());

export const createRecognizer = (langCode, { onResult, onEnd, onError, continuous = true } = {}) => {
  const SR = getSR();
  if (!SR) return null;

  const r = new SR();
  r.lang = speechLocale(langCode);
  r.continuous = continuous;
  r.interimResults = true;

  r.onresult = (e) => {
    let final = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    onResult?.({ final, interim });
  };
  r.onend = () => onEnd?.();
  r.onerror = (e) => onError?.(e.error);
  return r;
};
