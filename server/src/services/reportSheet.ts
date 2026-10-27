import {env} from '../config/env.js';
import {logger} from '../utils/logger.js';

/** One report as a spreadsheet row. Column order matches the header in docs/google-sheets-reports.md. */
export interface ReportSheetRow {
  id: string; createdAt: string; kind: string; reason: string; description: string;
  user: string; page?: string; track?: string; attachments: number; diagnostics?: string;
}

const KIND_RU: Record<string, string> = { bug: 'Ошибка приложения', playback: 'Не воспроизводится', source: 'Неверный источник', lyrics: 'Текст', timing: 'Тайминг', catalog: 'Не тот артист/релиз', other: 'Своя причина' };

/** Fire-and-forget: a sheet outage must never fail or slow down the report itself. */
export function sendReportToSheet(row: ReportSheetRow): void {
  if (!env.REPORTS_SHEET_WEBHOOK_URL) return;
  const body = JSON.stringify({ secret: env.REPORTS_SHEET_SECRET, ...row, kindLabel: KIND_RU[row.kind] || row.kind });
  // Apps Script answers POST with a 302 to googleusercontent.com; fetch follows it.
  void fetch(env.REPORTS_SHEET_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    .then(async res => { if (!res.ok) logger.warn({ status: res.status, body: (await res.text().catch(() => '')).slice(0, 200) }, 'Report sheet: append failed'); })
    .catch(err => logger.warn({ err: (err as Error).message }, 'Report sheet: unreachable'));
}
