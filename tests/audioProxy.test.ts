import { createServer, type Server } from 'node:http';
import express, { type Request, type Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { studioMasterService } from '../server/src/services/StudioMasterService.js';

const servers: Server[] = [];
const listen = async (server: Server): Promise<number> => {
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as { port: number }).port;
};

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('audio proxy', () => {
  it('finishes a delayed track after the HTTP request has closed normally', async () => {
    const upstreamPort = await listen(createServer((_req, res) => {
      res.writeHead(206, { 'Content-Type': 'audio/mpeg', 'Content-Length': '6', 'Content-Range': 'bytes 1-6/7' });
      res.write('abc');
      setTimeout(() => res.end('def'), 30);
    }));

    const app = express();
    let requestClosed = false;
    app.get('/stream', (req, res) => {
      req.on('close', () => { requestClosed = true; });
      void (studioMasterService as unknown as {
        proxyStream: (url: string, track: object, diskPath: string, req: Request, res: Response) => Promise<void>;
      }).proxyStream(
        `http://127.0.0.1:${upstreamPort}/audio`,
        { id: 'test:delayed', title: 'Delayed', artist: { name: 'Test' } },
        '/tmp/oskolok-delayed-audio-test.m4a', req, res,
      );
    });
    const proxyPort = await listen(createServer(app));
    const response = await fetch(`http://127.0.0.1:${proxyPort}/stream`, { headers: { Range: 'bytes=1-6' } });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(await response.text()).toBe('abcdef');
    expect(requestClosed).toBe(true);
  });
});
