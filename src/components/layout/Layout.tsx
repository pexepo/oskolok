import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Home, Search, Library, Heart, ListMusic } from 'lucide-react';
import { OskolokHeader } from './OskolokHeader.js';
import { CrystalScene } from '../shards/CrystalScene.js';
import { ShardsBackground } from '../shards/ShardsBackground.js';
import { BottomPlayer } from '../player/BottomPlayer.js';
import { FullPlayerModal } from '../player/FullPlayerModal.js';
import { QueueDrawer } from '../player/QueueDrawer.js';
import { ToastContainer } from '../common/ToastContainer.js';
import { SettingsModal } from '../settings/SettingsModal.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { useThemeStore } from '../../stores/useThemeStore.js';

export const Layout: React.FC = () => {
  const { isDark } = useThemeStore();
  const { fetchLiked } = useLibraryStore();
  const { fetchPlaylists } = usePlaylistStore();
  const {
    currentTrack,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    next,
    previous,
    toggleLike,
    currentTime,
    volume,
    isFullPlayerOpen,
    setFullPlayerOpen,
    isSettingsOpen,
    setSettingsOpen,
  } = usePlayerStore() as any;

  useEffect(() => {
    // Initial data hydration
    fetchLiked();
    fetchPlaylists();
  }, [fetchLiked, fetchPlaylists]);

  // Global Keyboard Shortcuts (Space, ArrowLeft/Right, ArrowUp/Down, M, N, P, L)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing inside input or textarea
      const target = e.target as HTMLElement;
      if (
        target.closest('button, a, select, [role=button]') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(currentTime + 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.05));
          break;
        case 'KeyM':
          toggleMute();
          break;
        case 'KeyN':
          next();
          break;
        case 'KeyP':
          previous();
          break;
        case 'KeyL':
          setFullPlayerOpen(!isFullPlayerOpen);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seek, setVolume, toggleMute, next, previous, currentTime, volume, isFullPlayerOpen, setFullPlayerOpen]);

  const location = useLocation();
  const isHomePage = location.pathname === '/';

  // Density variant for shards depending on route (Section 21)
  const shardsDensity = isHomePage
    ? 'full'
    : location.pathname.startsWith('/search')
    ? 'medium'
    : 'subtle';

  return (
    <div className={`oskolok-app flex flex-col h-screen w-screen overflow-hidden font-sans select-none relative transition-colors duration-300 ${
      isDark ? 'bg-[#070c14] text-slate-100' : 'bg-[#f0f4f9] text-[#162b50]'
    }`}>
      {/* Background Animated Shards Layer (Section 17-21) */}
      {isHomePage || location.pathname.startsWith('/search') ? <ShardsBackground density={shardsDensity} showCenterWave={false}/> : <CrystalScene />}

      {/* Top Floating Navigation Bar (Section 2 & 3) */}
      <OskolokHeader onOpenSettings={() => setSettingsOpen(true)} />

      {/* Main Content Area with Page Transitions (Section 22) */}
      <main className={`flex-1 min-h-0 relative z-10 ${isHomePage ? 'original-home-main overflow-hidden p-0' : 'overflow-y-auto overflow-x-hidden custom-scrollbar px-5 sm:px-10 pb-28'}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28, ease: 'easeOut' }}
            className="h-full w-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Docked Bottom Player for Non-Home Pages */}
      <BottomPlayer />

      {/* Slide-out Queue Drawer */}
      <QueueDrawer />

      {/* Fullscreen Now Playing Overlay */}
      <FullPlayerModal />

      {/* Settings Modal (Theme Switcher, Audio, Shards) */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Toast Notification Container */}
      <ToastContainer />
    </div>
  );
};
