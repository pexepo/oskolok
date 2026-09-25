import React,{useEffect} from 'react';
import {audioManager} from './audio/AudioManager.js';
import {LoginPage} from './pages/LoginPage.js';
import {useTelegramStore} from './telegram/runtime.js';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/layout/Layout.js';
import { HomePage } from './pages/HomePage.js';
import { SearchPage } from './pages/SearchPage.js';
import { LikedPage } from './pages/LikedPage.js';
import { CollectionPage } from './pages/CollectionPage.js';
import { PlaylistsPage } from './pages/PlaylistsPage.js';
import { PlaylistPage } from './pages/PlaylistPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { QueuePage } from './pages/QueuePage.js';
import { TrackPage } from './pages/TrackPage.js';
import { ArtistPage } from './pages/ArtistPage.js';
import { ReleasePage } from './pages/ReleasePage.js';
import { ImportPage } from './pages/ImportPage.js';
import {ProfilePage} from './pages/ProfilePage.js';
import {PublicProfilePage} from './pages/PublicProfilePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export const App: React.FC = () => {
  const user = useTelegramStore(s=>s.user);
  useEffect(()=>{if(!user)audioManager.pause();},[user]);
  const RouterComponent =
    typeof window !== 'undefined' && window.location.protocol === 'file:'
      ? HashRouter
      : BrowserRouter;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterComponent>
          {user ? <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<HomePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="collection" element={<CollectionPage />} />
              <Route path="library" element={<CollectionPage />} />
              <Route path="liked" element={<LikedPage />} />
              <Route path="playlists" element={<PlaylistsPage />} />
              <Route path="playlist/:id" element={<PlaylistPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="queue" element={<QueuePage />} />
              <Route path="track/:id" element={<TrackPage />} />
              <Route path="artist/:id" element={<ArtistPage />} />
              <Route path="release/:id" element={<ReleasePage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="users/:id" element={<PublicProfilePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes> : <Routes><Route path="/users/:id" element={<PublicProfilePage />} /><Route path="*" element={<LoginPage />} /></Routes>}
        </RouterComponent>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
