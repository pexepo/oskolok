import { beforeEach, describe, expect, it, vi } from 'vitest';

const findSong = vi.hoisted(() => vi.fn());
vi.mock('../server/src/services/GeniusAnnotationService.js', () => ({ findGeniusSong: findSong }));
import { geniusLyrics, parseGeniusLyrics } from '../server/src/services/GeniusLyricsService.js';
import { geniusReferentOrder } from '../server/src/services/geniusPage.js';

beforeEach(() => { vi.restoreAllMocks(); findSong.mockReset(); vi.unstubAllGlobals(); });

describe('Genius lyrics fallback', () => {
  it('retains lines, sections, nested annotation text and decoded entities across containers', () => {
    const html = `<h1>Page heading</h1><div data-lyrics-container="true">[Куплет]<br/>Первый &amp; второй<br><a href="/note"><span>Свет &#x2014; тень</span></a><div>Ещё строка</div></div><aside>Recommendations</aside><div data-lyrics-container='true'>[Припев]<br>Мы &#1089;нова здесь&nbsp;<button>Embed</button></div>`;
    expect(parseGeniusLyrics(html)).toBe('[Куплет]\nПервый & второй\nСвет — тень\nЕщё строка\n\n[Припев]\nМы снова здесь');
  });

  it('accepts the legacy lyrics container and never returns unrelated page copy', () => {
    expect(parseGeniusLyrics('<div class="lyrics"><p>Строка<br>Другая</p></div>')).toBe('Строка\nДругая');
    expect(parseGeniusLyrics('<div class="recommended">Another song</div>')).toBeNull();
    expect(parseGeniusLyrics('<div data-lyrics-container="false">Wrong text</div>')).toBeNull();
    expect(parseGeniusLyrics('<div data-lyrics-container="true"><script>malicious()</script></div>')).toBeNull();
    expect(parseGeniusLyrics('<div data-lyrics-container="true">Unclosed container')).toBeNull();
    expect(parseGeniusLyrics('<div data-exclude-from-selection="true">Unclosed header')).toBeNull();
  });

  it('removes the nested Genius header and ignores container markup inside page scripts', () => {
    const html = `<script>const template='<div data-lyrics-container="true">Wrong text</div>';</script><div data-lyrics-container="true"><div data-exclude-from-selection="true"><button>42 Contributors</button><div><span>Translations</span><div><a>Romanization</a></div></div><h2>Song Lyrics</h2></div>[Verse]<br>Our own lyric<span data-exclude-from-selection="true">Embed</span></div>`;
    expect(parseGeniusLyrics(html)).toBe('[Verse]\nOur own lyric');
  });

  it('returns plain text with the Genius credit and no invented timings', async () => {
    findSong.mockResolvedValue({ id: 7, url: 'https://genius.com/Test-song-lyrics' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<div data-lyrics-container="true">Своя строка<br>Вторая строка</div>')));
    expect(await geniusLyrics('t', 'Artist', 'Song')).toEqual({ trackId: 't', isSynced: false, provider: 'Genius', plainLyrics: 'Своя строка\nВторая строка' });
  });

  it('handles blocked pages and rejects URLs outside Genius', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    findSong.mockResolvedValue({ id: 7, url: 'https://genius.com/Test-song-lyrics' });
    expect(await geniusLyrics('t', 'Artist', 'Song')).toBeNull();
    findSong.mockResolvedValue({ id: 7, url: 'https://example.com/Test-song-lyrics' });
    expect(await geniusLyrics('t', 'Artist', 'Song')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('Genius fragment order', () => {
  it('lists referent ids in lyric order, counting a fragment broken over several lines once', () => {
    const html = `<a href="/999/Skipped-nav">menu</a><div data-lyrics-container="true">[Verse]<br/><a href="/222/Artist-song/First" class="ReferentFragment"><span>one<br/>two</span></a><br/><a href="/111/Artist-song/Second"><span>three</span></a><a href="/222/Artist-song/First"><span>four</span></a><a href="/Artist-other-song-lyrics">song link</a></div><div data-lyrics-container="true"><a href='/333/Artist-song/Third'>five</a></div>`;
    expect(geniusReferentOrder(html)).toEqual([222, 111, 333]);
  });

  it('is empty when the page has no lyric container', () => {
    expect(geniusReferentOrder('<div><a href="/123/Foo">x</a></div>')).toEqual([]);
  });
});
