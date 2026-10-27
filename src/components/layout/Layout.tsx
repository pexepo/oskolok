import React, { useEffect, useState, lazy, Suspense } from 'react';
import { PageSkeleton } from '../common/Skeleton.js';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion, type Variants } from 'framer-motion';

// Home dissolves toward the viewer (zoom + blur) while the next tab
// condenses out of the haze; regular tabs cross-fade with a softer blur.
// No filter/blur here: pages hold frosted (backdrop-filter) panels, and a filtered or scaled
// ancestor makes them re-composite when the animation ends — the whole page visibly blinked.
const routeVariants: Variants = {
  enter: { opacity: 0, y: 8 },
  center: { opacity: 1, y: 0, transitionEnd: { transform: 'none' } },
  leave: { opacity: 0, y: -4 },
  leaveHome: { opacity: 0 },
};
import { Home, Search, Library, Heart, ListMusic, ArrowLeft } from 'lucide-react';
import {ReportDialog,useReportStore} from '../common/ReportDialog.js';
import {ReportProblemButton} from '../common/ReportProblemButton.js';
import {useTranslation} from '../../stores/useLanguageStore.js';
import { OskolokHeader } from './OskolokHeader.js';
import { GreetingToast } from '../common/GreetingToast.js';
import { PerformanceAdvice } from '../common/PerformanceAdvice.js';
import { LoadingState } from '../common/LoadingState.js';
import { ShardsBackground } from '../shards/ShardsBackground.js';
import { BottomPlayer } from '../player/BottomPlayer.js';
import { AuthorCardOverlay } from '../profile/AuthorCardOverlay.js';
import { CoverViewer } from '../common/CoverViewer.js';
import { QueueDrawer } from '../player/QueueDrawer.js';
import { ToastContainer } from '../common/ToastContainer.js';
import { TelegramPlaybackLayer } from '../telegram/TelegramPlaybackLayer.js';
import { ConnectLayer } from '../connect/ConnectLayer.js';
import { JamLayer } from '../connect/JamLayer.js';
import { OfflineAutomation, OfflineBanner } from '../../offline/OfflineUI.js';
import { initSessionRestore } from '../../audio/sessionRestore.js';
import { usePlayerStore } from '../../stores/usePlayerStore.js';
import { useLibraryStore } from '../../stores/useLibraryStore.js';
import { usePlaylistStore } from '../../stores/usePlaylistStore.js';
import { useThemeStore } from '../../stores/useThemeStore.js';
import { useHoloPointer } from '../../hooks/useHoloPointer.js';
import { usePerformance } from '../../utils/performance.js';
// Heavy overlays (lyrics view, settings) download the first time they are opened, not with every page.
const FullPlayerModal = lazy(() => import('../player/FullPlayerModal.js').then(m => ({ default: m.FullPlayerModal })));
const SettingsModal = lazy(() => import('../settings/SettingsModal.js').then(m => ({ default: m.SettingsModal })));

export const Layout: React.FC = () => {
  const { isDark } = useThemeStore();
  const { fetchLiked } = useLibraryStore();
  const { fetchPlaylists } = usePlaylistStore();
  // Narrow selectors: subscribing to the whole player store re-rendered the entire layout on every playback tick.
  const currentTrack = usePlayerStore(s => s.currentTrack);
  const isFullPlayerOpen = usePlayerStore(s => s.isFullPlayerOpen);
  const isSettingsOpen = usePlayerStore(s => s.isSettingsOpen);
  const setSettingsOpen = usePlayerStore(s => s.setSettingsOpen);
  const [fullPlayerUsed, setFullPlayerUsed] = useState(false), [settingsUsed, setSettingsUsed] = useState(false);
  useEffect(() => { if (isFullPlayerOpen) setFullPlayerUsed(true); }, [isFullPlayerOpen]);
  useEffect(() => { if (isSettingsOpen) setSettingsUsed(true); }, [isSettingsOpen]);

  useEffect(() => {
    // Initial data hydration
    initSessionRestore();
    fetchLiked();
    fetchPlaylists();
  }, [fetchLiked, fetchPlaylists]);

  // Global Keyboard Shortcuts (Space, ArrowLeft/Right, ArrowUp/Down, M, N, P, L)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing inside input or textarea
      const target = e.target as HTMLElement;
      // A clicked lyric keeps button focus. Space pauses instead of activating
      // the seek button again; Enter retains the accessible seek action.
      if (e.code === 'Space' && target.closest('button.interference-line')) {
        e.preventDefault();
        if (!e.repeat) usePlayerStore.getState().togglePlay();
        return;
      }
      if (
        target.closest('button, a, select, [role=button]') ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const { togglePlay, seek, setVolume, toggleMute, next, previous, currentTime, volume, isFullPlayerOpen, setFullPlayerOpen } = usePlayerStore.getState() as any;
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
  }, []);

  const location = useLocation(),navigate=useNavigate(),t=useTranslation(),reducedMotion=useReducedMotion(),perf=usePerformance(s=>s.level);
  const nested=/^\/(artist|release|track|playlist|profile|users|queue|history|stats|offline|liked|import)(\/|$)/.test(location.pathname);
  const isHomePage = location.pathname === '/';
  const mainRef = React.useRef<HTMLElement>(null);
  // Each tab opens at its top; home is now a scrolling page with collections.
  useEffect(() => { mainRef.current?.scrollTo({ top: 0 }); }, [location.pathname]);
  useHoloPointer();
  useEffect(()=>{if(new URLSearchParams(location.search).has('report'))useReportStore.getState().open();},[location.search]);

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
      <ShardsBackground density={shardsDensity} showCenterWave={false}/>

      {/* Top Floating Navigation Bar (Section 2 & 3) */}
      <OskolokHeader onOpenSettings={() => setSettingsOpen(true)} />

      {/* Main Content Area with Page Transitions (Section 22) */}
      <main ref={mainRef} data-scroll-root className={`flex-1 min-h-0 relative z-10 ${isHomePage ? 'original-home-main overflow-y-auto overflow-x-hidden custom-scrollbar p-0' : 'overflow-y-auto overflow-x-hidden custom-scrollbar px-5 sm:px-10 pb-28'}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            variants={routeVariants}
            initial="enter"
            animate="center"
            exit={isHomePage ? 'leaveHome' : 'leave'}
            transition={{ duration: reducedMotion || perf === 'lite' ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={isHomePage?"h-full w-full":"w-full route-content"}
          >
            {nested&&<button type="button" className="route-back" aria-label={t('Вернуться назад','Go back')} onClick={()=>window.history.state?.idx>0?navigate(-1):navigate(location.pathname.startsWith("/artist")||location.pathname.startsWith("/release")||location.pathname.startsWith("/track")?"/search":"/collection")}><ArrowLeft size={17} aria-hidden="true"/><span>{t("Назад","Back")}</span></button>}
            <React.Suspense fallback={<PageSkeleton hero={false} rows={6} label={t('Загружаем…','Loading…')}/>}><Outlet /></React.Suspense>
          </motion.div>
        </AnimatePresence>
      </main>

      <GreetingToast />
      <PerformanceAdvice />

      {/* Docked Bottom Player for Non-Home Pages */}
      <BottomPlayer />

      {/* Slide-out Queue Drawer */}
      <QueueDrawer />

      {/* Fullscreen Now Playing Overlay */}
      {fullPlayerUsed && <Suspense fallback={null}><FullPlayerModal /></Suspense>}

      {/* Settings Modal (Theme Switcher, Audio, Shards) */}
      {settingsUsed && <Suspense fallback={null}><SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} /></Suspense>}

      {/* Toast Notification Container */}
      <ReportDialog/>
      <ReportProblemButton/>
      <AuthorCardOverlay/>
      <CoverViewer/>
      <TelegramPlaybackLayer />
      <ConnectLayer />
      <JamLayer />
      <OfflineBanner />
      <OfflineAutomation />
      <ToastContainer />
    </div>
  );
};
