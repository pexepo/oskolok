import type { Request, Response } from 'express';

/** Pass a remote audio file through with Range support. Nothing is written to
 * disk: used for per-listener streams (TIDAL) that must not enter the shared cache. */
export async function proxyAudio(url: string, req: Request, res: Response, fallbackType = 'audio/flac'): Promise<boolean> {
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  const headers: Record<string, string> = {};
  if (req.headers.range) headers.Range = req.headers.range;
  const upstream = await fetch(url, { headers, signal: abort.signal }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) return false;
  res.status(upstream.status);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', upstream.headers.get('content-type') || fallbackType);
  for (const name of ['content-length', 'content-range']) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise(resolve => res.once('drain', resolve));
    }
    res.end();
  } catch {
    res.destroy();
  }
  return true;
}
