// src/lib/errors.js — Firebase · Functions 오류 코드를 사람이 읽을 문장으로 바꾼다
const AUTH_OFF = '이 로그인 방식이 꺼져 있어요. Firebase 콘솔 > Authentication 에서 익명·Google 로그인을 켜 주세요.';

const MESSAGES = {
  'auth/operation-not-allowed': AUTH_OFF,
  'auth/admin-restricted-operation': AUTH_OFF,
  'auth/popup-blocked': '팝업이 차단됐어요. 브라우저에서 팝업을 허용해 주세요.',
  'auth/credential-already-in-use': '이미 다른 사용자에 연결된 Google 계정이에요.',
  'auth/unauthorized-domain': '이 주소가 Firebase 승인 도메인에 없어요. Authentication > 설정 > 승인된 도메인에 추가해 주세요.',
  'auth/network-request-failed': '네트워크에 연결할 수 없어요.',
  'permission-denied': '권한이 없어요. 방 멤버인지, firestore.rules 가 배포됐는지 확인해 주세요.',
  unavailable: '서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.',
  'storage/unauthorized': '사진 업로드 권한이 없어요. storage.rules 를 확인해 주세요.',
  // joinRoom Function 이 돌려주는 코드
  not_found: '해당 초대 코드의 방이 없어요.',
  closed: '방장이 초대를 닫아 두었어요.',
  bad_code: '초대 코드는 영문 대문자+숫자 8자예요.',
};

// 사용자가 스스로 닫은 경우는 오류로 보여주지 않는다
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

/** @returns {string} 빈 문자열이면 보여줄 필요 없음 */
export const friendlyError = (e) => {
  const code = String(e?.code || '');
  if (SILENT.has(code)) return '';
  return MESSAGES[code] || MESSAGES[code.replace(/^firestore\//, '')] || e?.message || '알 수 없는 오류가 났어요.';
};
