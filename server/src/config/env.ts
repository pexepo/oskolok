import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  TELEGRAM_MODE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[a-zA-Z0-9_]{5,32}$/).default('oskolokplayerbot'),
  SOUNDCLOUD_CLIENT_ID: z.string().optional().default(''),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional().default(''),
  SPOTIFY_CLIENT_ID: z.string().optional().default(''),
  SPOTIFY_CLIENT_SECRET: z.string().optional().default(''),
  GENIUS_ACCESS_TOKEN: z.string().optional().default(''),
  SPICY_LYRICS_SECRET_KEY: z.string().optional().default(''),
  // Optional first-party/community lyrics endpoint. It must return the same
  // shape as LyricsData; LRCLIB remains a verified fallback when unset.
  LYRICS_PROVIDER_URL: z.string().default('').refine(v => !v || /^https?:\/\//i.test(v), 'LYRICS_PROVIDER_URL must be an http(s) URL'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.string().transform((val) => parseInt(val, 10)).default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Панель разработчика: ключ доступа к /api/admin/* и разрешённый origin панели.
  ADMIN_API_KEY: z.string().default(''),
  ADMIN_PANEL_ORIGIN: z.string().default(''),
  // Куда сообщать о новых заявках на тексты (любой из вариантов, можно оба).
  LYRICS_NOTIFY_WEBHOOK: z.string().default('').refine(v => !v || /^https?:\/\//i.test(v), 'LYRICS_NOTIFY_WEBHOOK must be an http(s) URL'),
  TELEGRAM_ADMIN_CHAT_ID: z.string().default(''),
});

export const env = envSchema.parse(process.env);
