// src/hooks/useMyRooms.js — 내가 속한 방 목록, 최근 대화순 (ERD 7)
import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { track } from '../lib/usage';

export function useMyRooms(uid) {
  const [rooms, setRooms] = useState([]);

  useEffect(() => {
    if (!db || !uid) return undefined;
    // memberUids array-contains 조건이 있어야 보안 규칙(멤버만 읽기)을 통과한다
    const q = query(
      collection(db, 'rooms'),
      where('memberUids', 'array-contains', uid),
      orderBy('updatedAt', 'desc'),
      limit(50),
    );
    return onSnapshot(q, (snap) => {
      track('fsReads', snap.docChanges().length || 1);
      setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
    }, (e) => console.error('[rooms]', e));
  }, [uid]);

  // 로그아웃하면 이전 사용자의 목록을 보여주지 않는다
  return { rooms: uid ? rooms : [] };
}
