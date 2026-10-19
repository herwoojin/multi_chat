import { lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { isFirebaseConfigured } from './lib/firebase';
import Landing from './pages/Landing';
import Join from './pages/Join';
import Room from './pages/Room';
import SetupNotice from './components/SetupNotice';
import UsageBattery from './components/UsageBattery';
import Aurora from './components/Aurora';
import FullScreenLoader from './components/FullScreenLoader';

// 번들 분리 (TRD 8)
const Settings = lazy(() => import('./pages/Settings'));
const FaceToFace = lazy(() => import('./components/FaceToFace'));

/** Firebase 가 필요한 화면. 설정 전이면 안내, 로그인 전이면 입장 화면으로. */
function NeedsAuth({ children }) {
  const { user, loading } = useAuth();
  if (!isFirebaseConfigured) return <SetupNotice />;
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <SettingsProvider>
          <Aurora />
          <Suspense fallback={<FullScreenLoader />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/join/:inviteCode" element={isFirebaseConfigured ? <Join /> : <SetupNotice />} />
              <Route path="/room/:roomId" element={<NeedsAuth><Room /></NeedsAuth>} />
              {/* 대면 통역은 Firestore 를 쓰지 않는 휘발성 화면이라 로그인 없이도 열린다 */}
              <Route path="/room/:roomId/f2f" element={<FaceToFace />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <UsageBattery />
        </SettingsProvider>
      </AuthProvider>
    </HashRouter>
  );
}
