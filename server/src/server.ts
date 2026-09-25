import path from 'path';
import fs from 'fs';
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
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'X-Audio-Source'],
}));

app.use(express.json({limit:'2mb'}));

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
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Centralized error handler
app.use(errorHandler);

await ensureProfileSchema();
void startTelegramBot();
void expireNowPlaying().catch(err=>logger.warn({message:err instanceof Error?err.message:String(err)},'Telegram status recovery failed'));
const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info(`Oskolok Server is running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});
const expiryTimer=setInterval(()=>{void expireNowPlaying().catch(err=>logger.warn({message:err instanceof Error?err.message:String(err)},'Telegram status expiry failed'));},30000);
expiryTimer.unref();

export default app;
