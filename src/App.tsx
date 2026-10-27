import { isAppShell } from './utils/nativeShell.js';
import {AppUpdates} from './components/common/AppUpdates.js';
import React,{useEffect,lazy,Suspense} from 'react';
import {LoadingState} from './components/common/LoadingState.js';
import {audioManager} from './audio/AudioManager.js';
import {LoginPage} from './pages/LoginPage.js';
import {initDesktopBridge} from './desktop/desktopBridge.js';
import {DesktopUpdateBanner} from './desktop/DesktopUpdateBanner.js';
import {useTelegramStore} from './telegram/runtime.js';
import {useConsentStore} from './telemetry/consent.js';
import './telemetry/wire.js';
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import { LeaveWarning } from './components/common/LeaveWarning.js';


import { useTranslation } from './stores/useLanguageStore.js';
import { APP_BASE } from './routing.js';
import { ToastContainer } from './components/common/ToastContainer.js';
// Rarely opened screens load on demand so the first paint ships less JavaScript.
const SearchPage = lazy(() => import('./pages/SearchPage.js').then(m => ({ default: m.SearchPage })));
const LikedPage = lazy(() => import('./pages/LikedPage.js').then(m => ({ default: m.LikedPage })));
const CollectionPage = lazy(() => import('./pages/CollectionPage.js').then(m => ({ default: m.CollectionPage })));
const PlaylistsPage = lazy(() => import('./pages/PlaylistsPage.js').then(m => ({ default: m.PlaylistsPage })));
const PlaylistImportPage = lazy(() => import('./pages/PlaylistImportPage.js').then(m => ({ default: m.PlaylistImportPage })));
const MixPage = lazy(() => import('./pages/MixPage.js').then(m => ({ default: m.MixPage })));
const PlaylistPage = lazy(() => import('./pages/PlaylistPage.js').then(m => ({ default: m.PlaylistPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage.js').then(m => ({ default: m.HistoryPage })));
const StatsPage = lazy(() => import('./pages/StatsPage.js').then(m => ({ default: m.StatsPage })));
const OfflinePage = lazy(() => import('./pages/OfflinePage.js').then(m => ({ default: m.OfflinePage })));
const QueuePage = lazy(() => import('./pages/QueuePage.js').then(m => ({ default: m.QueuePage })));
const AdminPage = lazy(() => import('./pages/AdminPage.js').then(m => ({ default: m.AdminPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js').then(m => ({ default: m.ProfilePage })));
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage.js').then(m => ({ default: m.PublicProfilePage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage.js').then(m => ({ default: m.FriendsPage })));
const JamJoinRoute = lazy(() => import('./components/connect/JamLayer.js').then(m => ({ default: m.JamJoinRoute })));
const ArtistPage = lazy(() => import('./pages/ArtistPage.js').then(m => ({ default: m.ArtistPage })));
const ReleasePage = lazy(() => import('./pages/ReleasePage.js').then(m => ({ default: m.ReleasePage })));
const TrackPage = lazy(() => import('./pages/TrackPage.js').then(m => ({ default: m.TrackPage })));
const ImportPage = lazy(() => import('./pages/ImportPage.js').then(m => ({ default: m.ImportPage })));
const UnreleasedPage = lazy(() => import('./pages/UnreleasedPage.js').then(m => ({ default: m.UnreleasedPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export const App: React.FC = () => {
  const t = useTranslation();
  const user = useTelegramStore(s=>s.user);
  const betaAllowed = useTelegramStore(s=>s.betaAllowed);
  useEffect(()=>{if(!user||betaAllowed===false)audioManager.pause();},[user,betaAllowed]);
  // Consent decides whether listening events are collected at all; it is read again for every signed-in account.
  useEffect(()=>{if(user&&betaAllowed!==false)void useConsentStore.getState().load();},[user,betaAllowed]);
  // Desktop client: mini-player above other windows and Discord status follow what plays here.
  useEffect(()=>{if(user&&betaAllowed!==false)initDesktopBridge();},[user,betaAllowed]);
  const fileMode = typeof window !== 'undefined' && window.location.protocol === 'file:';
  const body = (<>
        <AppUpdates />
        <DesktopUpdateBanner />
          <Suspense fallback={<LoadingState className="route-loading" label={t('Загружаем…', 'Loading…')}/>}>
          {user && betaAllowed !== false ? <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="collection" element={<CollectionPage />} />
              <Route path="library" element={<CollectionPage />} />
              <Route path="liked" element={<LikedPage />} />
              <Route path="playlists" element={<PlaylistsPage />} />
              <Route path="playlists/import" element={<PlaylistImportPage />} />
              <Route path="mix/:id" element={<MixPage />} />
              <Route path="playlist/:id" element={<PlaylistPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="offline" element={isAppShell() ? <OfflinePage /> : <Navigate to="/collection" replace />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="track/:id" element={<TrackPage />} />
              <Route path="artist/:id" element={<ArtistPage />} />
              <Route path="release/:id" element={<ReleasePage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="unreleased" element={<UnreleasedPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="users/:id" element={<PublicProfilePage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="jam/:id" element={<JamJoinRoute />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes> : <><Routes><Route path="/users/:id" element={<PublicProfilePage />} /><Route path="*" element={<LoginPage />} /></Routes><ToastContainer /></>}
        </Suspense>
        <LeaveWarning />
  </>);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        {/* The player lives under /app; the public site owns «/». File builds keep hash routing. */}
        {fileMode ? <HashRouter>{body}</HashRouter> : <BrowserRouter basename={APP_BASE}>{body}</BrowserRouter>}
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
