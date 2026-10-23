import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Landing } from './pages/Landing.js';
import { PageShell } from './components/chrome.js';

const BetaPage = lazy(() => import('./pages/BetaPage.js').then(m => ({ default: m.BetaPage })));
const BetaStatusPage = lazy(() => import('./pages/BetaStatusPage.js').then(m => ({ default: m.BetaStatusPage })));
const DownloadPage = lazy(() => import('./pages/DownloadPage.js').then(m => ({ default: m.DownloadPage })));
const IosGuidePage = lazy(() => import('./pages/IosGuidePage.js').then(m => ({ default: m.IosGuidePage })));
const AndroidGuidePage = lazy(() => import('./pages/OtherGuides.js').then(m => ({ default: m.AndroidGuidePage })));
const DesktopGuidePage = lazy(() => import('./pages/OtherGuides.js').then(m => ({ default: m.DesktopGuidePage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.js').then(m => ({ default: m.PrivacyPage })));
const SiteNotFound = lazy(() => import('./pages/PrivacyPage.js').then(m => ({ default: m.SiteNotFound })));

/** New page: start at the top, or at the #anchor (landing sections). */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  React.useEffect(() => {
    if (hash) { const el = document.getElementById(hash.slice(1)); if (el) { el.scrollIntoView(); return; } }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}
const Loading = () => <PageShell><div className="s-wrap s-page" aria-busy="true"><div className="s-skel" style={{ height: 52, width: 'min(520px,80%)' }} /><div className="s-skel" style={{ height: 300, marginTop: 28 }} /></div></PageShell>;

export function SiteApp() {
  return <BrowserRouter>
    <ScrollManager />
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/beta" element={<BetaPage />} />
        <Route path="/beta/status" element={<BetaStatusPage />} />
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/download/ios" element={<IosGuidePage />} />
        <Route path="/download/android" element={<AndroidGuidePage />} />
        <Route path="/download/desktop" element={<DesktopGuidePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<SiteNotFound />} />
      </Routes>
    </Suspense>
  </BrowserRouter>;
}
