// src/hooks/useMessages.js — 방의 최근 메시지 실시간 구독
import { useEffect, useState, useCallback } from 'react';
import { collection, onSnapshot, orderBy, query, limitToLast } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { track } from '../lib/usage';

const PAGE = 200;

export function useMessages(roomId) {
  const [messages, setMessages] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [limitN, setLimitN] = useState(PAGE);

  useEffect(() => {
    if (!db || !roomId) return undefined;
    const q = query(collection(db, 'rooms', roomId, 'messages'), orderBy('createdAt', 'asc'), limitToLast(limitN));
    const unsub = onSnapshot(q, (snap) => {
      // 문서 변경분만큼 읽기가 과금된다
      track('fsReads', snap.docChanges().length || 1);
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
      setLoaded(true);
    }, (e) => { console.error('[messages]', e); setError(e); setLoaded(true); });
    return unsub;
  }, [roomId, limitN]);

  const hasMore = messages.length >= limitN;
  const loadMore = useCallback(() => setLimitN((n) => n + PAGE), []);

  return { messages, loaded, error, hasMore, loadMore };
}
