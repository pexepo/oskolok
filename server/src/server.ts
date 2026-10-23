import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import apiRouter from './routes/api.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import {expireNowPlaying} from './services/telegramNowPlaying.js';
import {ensureProfileSchema} from './database/ensureProfileSchema.js';
import {startEventRetention} from './services/telemetry.js';
import {seedBetaAccess} from './services/telegramBeta.js';
import {seedPublishedReleases} from './services/releases.js';
import {startTelegramBot} from './services/telegramBot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 'loopback');

app.use(helmet({
  contentSecurityPolicy: false, // Allowed for frontend asset integration
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  crossOriginOpenerPolicy: false,
}));

// Permissive CORS for desktop app & local dev
app.use(cors({
  origin: (origin, callback) => {
    // Allow electron file:// requests (null or undefined), localhost, 127.0.0.1, or configured origin
    if (!origin || origin === 'null' || (env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) || origin.startsWith('file://')) {
      return callback(null, true);
    }
    if (env.CORS_ORIGIN && origin === env.CORS_ORIGIN) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'X-Audio-Source', 'X-Source-Fallback'],
}));

// Avatar and banner may each contain 850 KB encoded as base64.
app.use('/api/profile', express.json({limit:'3mb'}));
// Site forms are small; a tighter limit keeps oversized spam bodies out before parsing.
app.use('/api/site', express.json({limit:'16kb'}));
app.use(express.json({limit:'2mb'}));

// Gzip larger JSON answers: phones on slow links (and tunnels) pay for every byte.
// Audio streams use res.pipe/sendFile and are left untouched.
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return next();
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    const text = JSON.stringify(body);
    if (res.headersSent || text === undefined || text.length < 1400) return json(body);
    res.setHeader('Content-Encoding', 'gzip');
    res.vary('Accept-Encoding');
    res.type('application/json; charset=utf-8');
    return res.send(zlib.gzipSync(text, { level: 6 }));
  };
  next();
});

// Apply rate limiter
app.use('/api', apiRateLimiter);

// Register API Routes
app.use('/api', apiRouter);

// Serve static frontend build if dist folder exists
const distCandidates = [
  path.join(__dirname, '../dist'),
  path.join(__dirname, '../../dist'),
  path.join((process as any).resourcesPath || '', 'app.asar', 'dist'),
  path.join((process as any).resourcesPath || '', 'dist'),
  path.resolve('dist'),
];
const distDir = distCandidates.find((d) => fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html')));

if (distDir) {
  logger.info(`Serving static frontend build from: ${distDir}`);
  const root = distDir;
  const cacheFor = (urlPath: string) => urlPath.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable' // file names carry a content hash
    : /^\/(textures|shards|art)\//.test(urlPath) || /\.(png|svg|ico|webp|jpg)$/.test(urlPath)
      ? 'public, max-age=604800'
      : 'no-cache';
  // Prefer the .br/.gz copies written by scripts/compressDist.mjs at build time.
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !/\.(js|css|svg|html|json|txt)$/.test(req.path)) return next();
    const file = path.join(root, decodeURIComponent(req.path));
    if (!file.startsWith(root + path.sep)) return next();
    const accepted = String(req.headers['accept-encoding'] || '');
    for (const [encoding, suffix] of [['br', '.br'], ['gzip', '.gz']] as const) {
      if (!new RegExp(`\\b${encoding}\\b`).test(accepted) || !fs.existsSync(file + suffix)) continue;
      res.setHeader('Content-Encoding', encoding);
      res.vary('Accept-Encoding');
      res.setHeader('Cache-Control', cacheFor(req.path));
      res.type(path.extname(file));
      return res.sendFile(file + suffix);
    }
    next();
  });
  app.use(express.static(distDir, { setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', cacheFor('/' + path.relative(root, filePath).split(path.sep).join('/')));
  } }));
  // Public pages get their own static HTML (title, description, Open Graph) for crawlers and link previews;
  // /app is the private player shell and is never indexed. Other paths fall back to the SPA, which redirects
  // old player links (/search, /track/…) to /app.
  const sitePages: Record<string, string> = {'/':'index','/beta':'beta','/beta/status':'beta-status','/download':'download','/download/ios':'download-ios','/download/android':'download-android','/download/desktop':'download-desktop','/privacy':'privacy'};
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    const clean = req.path.replace(/\/+$/, '') || '/';
    const isApp = clean === '/app' || clean.startsWith('/app/');
    const page = isApp ? 'app' : sitePages[clean];
    const file = page ? path.join(distDir, 'site-pages', `${page}.html`) : '';
    res.setHeader('Cache-Control', 'no-cache');
    if (isApp || clean === '/beta/status') res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(file && fs.existsSync(file) ? file : path.join(distDir, 'index.html'));
  });
}

// Centralized error handler
app.use(errorHandler);

await ensureProfileSchema();
startEventRetention();
await seedBetaAccess();
await seedPublishedReleases().catch(err=>logger.warn({message:err instanceof Error?err.message:String(err)},'Release catalogue seed failed'));
void startTelegramBot();
void expireNowPlaying().catch(err=>logger.warn({message:err instanceof Error?err.message:String(err)},'Telegram status recovery failed'));
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`Oskolok Server is running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});
const expiryTimer=setInterval(()=>{void expireNowPlaying().catch(err=>logger.warn({message:err instanceof Error?err.message:String(err)},'Telegram status expiry failed'));},30000);
expiryTimer.unref();

export default app;
