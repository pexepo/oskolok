import {artworkController} from '../controllers/artworkController.js';
import { telemetryController } from '../controllers/telemetryController.js';
import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';
import { trackController } from '../controllers/trackController.js';
import { playlistController } from '../controllers/playlistController.js';
import { likedController } from '../controllers/likedController.js';
import { historyController } from '../controllers/historyController.js';
import { lyricsController } from '../controllers/lyricsController.js';
import { recommendationController, getDailyMixes, getTrackRadio, getWaveOptions, getReleaseContinuation, postWaveFeedback } from '../controllers/recommendationController.js';
import { chartsController } from '../controllers/chartsController.js';

import { userIdentity, ownPlaylist } from '../middleware/userIdentity.js';
import { telegramController } from '../controllers/TelegramController.js';
import { catalogController } from '../controllers/catalogController.js';
import {loudnessController,mixAnalysisController} from '../controllers/loudnessController.js';

import {musicAccounts,musicAccountCallback} from '../controllers/musicAccounts.js';
import {profileRoutes,telegramLogin} from '../controllers/profileController.js';
import {publicProfileController} from '../controllers/publicProfileController.js';
import {adminRoutes} from '../controllers/adminController.js';
import {requireTrustedMutation} from '../middleware/trustedOrigin.js';
import {userContentRoutes} from '../controllers/userContentController.js';
import {playbackSessionRoutes} from '../controllers/playbackSessionController.js';
import {connectRoutes} from '../controllers/connectController.js';
import {statsRoutes} from '../controllers/statsController.js';
import {communityRoutes,unreleasedCover} from '../controllers/communityController.js';
import {friendsRoutes} from '../controllers/friendsController.js';
import {rewardRoutes} from '../controllers/rewardsController.js';
import {recordingRoutes} from '../controllers/recordingController.js';
import {sitePublicRoutes,siteProtectedRoutes} from '../controllers/siteController.js';
import {trackFactsController} from '../services/trackFacts.js';
const router = Router();
router.use('/admin',adminRoutes);
router.use(requireTrustedMutation);
router.use('/music-accounts',musicAccountCallback);
router.get('/unreleased/:id/cover',unreleasedCover);
router.get('/artwork',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}),artworkController);
// Public site: beta applications, their status and the release catalogue need no Telegram session.
router.use('/site',sitePublicRoutes);
router.use(userIdentity);
router.use('/site',siteProtectedRoutes);
router.use(recordingRoutes);
router.use('/content',userContentRoutes);
router.use(communityRoutes);
router.use(friendsRoutes);
router.use('/telegram/login',telegramLogin);
router.get('/users/:id/summary',publicProfileController.getSummary);
router.get('/users/:id/showcase/:itemId/media',publicProfileController.getShowcaseMedia);
router.get('/users/:id/lyrics',publicProfileController.getLyrics);
router.get('/users/:id',publicProfileController.getPublicProfile);
router.use('/profile/achievements',rewardRoutes);
router.use('/profile',profileRoutes);
router.use('/music-accounts',musicAccounts);
router.post('/imports/preview', catalogController.importPreview);
router.post('/imports/match', catalogController.match);
router.get('/suggestions', catalogController.suggestions);
router.get('/releases/genius', catalogController.geniusRelease);
router.get('/releases/:id', catalogController.release);
router.get('/artists/:id/details', catalogController.artistDetails);
router.post('/artists/popularity', catalogController.trackPopularity);
router.get('/telegram/session', telegramController.session);
router.get('/telegram/health', telegramController.health);
router.use('/playback', playbackSessionRoutes);
router.use('/connect', connectRoutes);
router.use(statsRoutes);
router.post('/telegram/profile-track', telegramController.sendProfileTrack);
router.post('/telegram/profile-music', telegramController.addMusic);
router.get('/telegram/status-template', telegramController.statusTemplate);
router.put('/telegram/status-template', telegramController.saveStatusTemplate);
router.get('/tracks/:id/download', telegramController.download);
router.post('/playlist-imports', playlistController.importPlaylist);
router.post('/playlist-imports/:requestId/chunks', playlistController.importChunk);
router.use('/playlists/:id', ownPlaylist);

// Health check
router.get('/health', healthController.getHealth);

// Search & Tracks
router.get('/search', trackController.search);
router.get('/tracks/:id/playback', trackController.getPlaybackInfo);
router.get('/tracks/:id/loudness',loudnessController);
router.get('/tracks/:id/mix-analysis',mixAnalysisController);
router.post('/tracks/prefetch', trackController.prefetchTrack);
router.post('/tracks/facts', trackFactsController);
router.get('/tracks/:id/stream', trackController.streamAudio);
router.get('/tracks/:id', trackController.getTrack);

// Artists
router.get('/artists/:id/tracks', trackController.getArtistTracks);
router.get('/artists/:id', trackController.getArtist);

// SoundCloud external playlist
router.get('/soundcloud-playlists/:id', trackController.getPlaylist);

// Custom User Playlists
router.get('/playlists', playlistController.getPlaylists);
router.post('/playlists', playlistController.createPlaylist);
router.get('/playlists/:id', playlistController.getPlaylist);
router.patch('/playlists/:id', playlistController.updatePlaylist);
router.delete('/playlists/:id', playlistController.deletePlaylist);
router.post('/playlists/:id/tracks', playlistController.addTrack);
router.delete('/playlists/:id/tracks/:trackId', playlistController.removeTrack);
router.patch('/playlists/:id/reorder', playlistController.reorderTracks);

// Liked Tracks
router.get('/liked', likedController.getLiked);
router.post('/liked', likedController.addLiked);
router.delete('/liked/:trackId', likedController.deleteLiked);

// History
router.get('/history', historyController.getHistory);
router.post('/history', historyController.addHistory);
router.delete('/history', historyController.clearHistory);

// Lyrics
router.get('/lyrics/:trackId', lyricsController.getLyrics);
router.get('/lyrics/:trackId/annotations', lyricsController.getAnnotations);
router.post('/lyrics/translate', lyricsController.translate);

// Recommendations ("Моя волна")
router.get('/consent', telemetryController.getConsent);
router.put('/consent', telemetryController.setConsent);
router.post('/events', rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-7',legacyHeaders:false}), telemetryController.ingest);
router.delete('/events', telemetryController.reset);
router.get('/recommendations/daily-mixes', getDailyMixes);
router.post('/recommendations/radio', getTrackRadio);
router.get('/recommendations/wave/options', getWaveOptions);
router.post('/recommendations/release-continuation', getReleaseContinuation);
router.get('/recommendations', recommendationController.getRecommendations);
router.post('/recommendations/wave', recommendationController.getWave);
router.post('/recommendations/wave/feedback', postWaveFeedback);

// Global charts (VK Музыка / Яндекс Музыка / Spotify)
router.get('/charts', chartsController.getChart);

export default router;
