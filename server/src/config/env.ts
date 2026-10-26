import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  TELEGRAM_MODE: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[a-zA-Z0-9_]{5,32}$/).default('oskolokplayerbot'),
  // Public application id (not a secret): Discord sign-in on the site and the desktop Rich Presence.
  DISCORD_CLIENT_ID: z.string().regex(/^\d{15,25}$/).default('1563136390177366148'),
  SOUNDCLOUD_CLIENT_ID: z.string().optional().default(''),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional().default(''),
  SPOTIFY_CLIENT_ID: z.string().optional().default(''),
  SPOTIFY_CLIENT_SECRET: z.string().optional().default(''),
  DEEPL_API_KEY: z.string().default(''),
  GENIUS_ACCESS_TOKEN: z.string().optional().default(''),
  SPICY_LYRICS_SECRET_KEY: z.string().optional().default(''),
  // Optional first-party/community lyrics endpoint. It must return the same
  // shape as LyricsData; LRCLIB remains a verified fallback when unset.
  LYRICS_PROVIDER_URL: z.string().default('').refine(v => !v || /^https?:\/\//i.test(v), 'LYRICS_PROVIDER_URL must be an http(s) URL'),
  DATABASE_URL: z.string().default('file:./dev.db'),
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  // Панель разработчика: ключ доступа к /api/admin/* и разрешённый origin панели.
  ADMIN_API_KEY: z.string().default(''),
  ADMIN_PANEL_ORIGIN: z.string().default(''),
  // Куда сообщать о новых заявках на тексты (любой из вариантов, можно оба).
  LYRICS_NOTIFY_WEBHOOK: z.string().default('').refine(v => !v || /^https?:\/\//i.test(v), 'LYRICS_NOTIFY_WEBHOOK must be an http(s) URL'),
  TELEGRAM_ADMIN_CHAT_ID: z.string().default(''),
  // Numeric Telegram user IDs allowed to review beta applications in the bot (comma separated).
  // Usernames are never accepted here: they can be renamed or handed to someone else.
  BETA_ADMIN_IDS: z.string().default('').refine(v => v.split(',').every(id => !id.trim() || /^\d{1,15}$/.test(id.trim())), 'BETA_ADMIN_IDS must be numeric Telegram user IDs'),
  // Public origin used in links sent by the bot and in signed download links.
  PUBLIC_SITE_URL: z.string().default('https://oskolok.lol').refine(v => /^https?:\/\/[^/]+$/.test(v), 'PUBLIC_SITE_URL must be an origin without a path'),
  // Directory with beta-only builds served after an access check (never exposed by Nginx).
  PRIVATE_RELEASES_DIR: z.string().default(''),
  // Google Sheets: URL of the Apps Script web app that appends report rows (docs/google-sheets-reports.md).
  REPORTS_SHEET_WEBHOOK_URL: z.string().default('').refine(v => !v || /^https:\/\//i.test(v), 'REPORTS_SHEET_WEBHOOK_URL must be an https URL'),
  REPORTS_SHEET_SECRET: z.string().default(''),
});

export const env = envSchema.parse(process.env);
