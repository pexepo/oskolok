import { Router } from 'express';
import { healthController } from '../controllers/healthController.js';
import { trackController } from '../controllers/trackController.js';
import { playlistController } from '../controllers/playlistController.js';
import { likedController } from '../controllers/likedController.js';
import { historyController } from '../controllers/historyController.js';
import { lyricsController } from '../controllers/lyricsController.js';
import { recommendationController } from '../controllers/recommendationController.js';

import { userIdentity, ownPlaylist } from '../middleware/userIdentity.js';
import { telegramController } from '../controllers/TelegramController.js';
import { catalogController } from '../controllers/catalogController.js';

import {musicAccounts,musicAccountCallback} from '../controllers/musicAccounts.js';
import {profileRoutes,telegramLogin} from '../controllers/profileController.js';
import {publicProfileController} from '../controllers/publicProfileController.js';
import {adminRoutes} from '../controllers/adminController.js';
import {requireTrustedMutation} from '../middleware/trustedOrigin.js';
const router = Router();
router.use('/admin',adminRoutes);
router.use(requireTrustedMutation);
router.use('/music-accounts',musicAccountCallback);
router.use(userIdentity);
router.use('/telegram/login',telegramLogin);
router.get('/users/:id/summary',publicProfileController.getSummary);
router.get('/users/:id',publicProfileController.getPublicProfile);
router.use('/profile',profileRoutes);
router.use('/music-accounts',musicAccounts);
router.post('/imports/preview', catalogController.importPreview);
router.post('/imports/match', catalogController.match);
router.get('/suggestions', catalogController.suggestions);
router.get('/releases/:id', catalogController.release);
router.get('/artists/:id/details', catalogController.artistDetails);
router.get('/telegram/session', telegramController.session);
router.post('/telegram/profile-track', telegramController.sendProfileTrack);
router.post('/telegram/profile-music', telegramController.addMusic);
router.get('/tracks/:id/download', telegramController.download);
router.use('/playlists/:id', ownPlaylist);

// Health check
router.get('/health', healthController.getHealth);

// Search & Tracks
router.get('/search', trackController.search);
router.get('/tracks/:id/playback', trackController.getPlaybackInfo);
router.post('/tracks/prefetch', trackController.prefetchTrack);
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

// Recommendations ("Моя волна")
router.get('/recommendations', recommendationController.getRecommendations);

export default router;
