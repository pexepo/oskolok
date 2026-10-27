import { describe, expect, it } from 'vitest';
import { foreignReleases, splitPersona, type ReleaseFacts } from '../server/src/services/releaseIdentity.js';

const r = (id: string, title: string, label: string, genres: number[], tracks: Array<[string, string]>, coArtists: Array<{ id: number; name: string }> = []): ReleaseFacts =>
  ({ id, title, label, genres, coArtists, tracks: tracks.map(([t, isrc]) => ({ title: t, isrc })) });

// Shapes taken from Deezer's «Pyrokinesis» page, which also holds an American metal band.
const pyro = [
  r('1', 'mea maxima culpa', 'Moza under exclusive license to S&P Digital', [116], [['моя великая вина', 'RUAGV2500650'], ['её влюбленные глаза', 'RUAGV2500631']]),
  r('2', 'Геометрия тьмы', 'S&P Digital', [116], [['аморе аморе', 'FRX452200001'], ['отказываю небу', 'FRX452200002']]),
  r('3', 'Eclipse', 'S&P Digital', [116], [['Дедлайны', 'FR59R1800001'], ['Kerrigan', 'FR59R1800002']]),
  r('4', 'Ведьмы', 'Ренессанс', [85], [['Ведьмы', 'RUA1D2400001']], [{ id: 11052780, name: 'Овсянкин' }]),
  r('5', 'VIDEOGAMES', 'Some Label', [116], [['VIDEOGAMES', 'FR96X1600001']]),
  r('10', 'A THOUSAND CUTS', 'RPOC LLC', [464], [['A THOUSAND CUTS', 'QZFYX2493274'], ['BLACK SUMMER', 'QZTB52378919']]),
  r('11', 'BLACK SUMMER', 'RPOC LLC', [464], [['BLACK SUMMER', 'QZTB52378919']]),
  r('12', 'Sulphur', 'Bleeding Art Collective', [464], [['Atrophy', 'DGA062572633'], ['Holy Water', 'DGA062572635']]),
];
const ctx = { topAlbums: ['1', '2', '3'], referenceTitles: ['моя великая вина', 'Дедлайны'], relatedNames: ['Три дня дождя', 'МУККА', 'Нервы', 'Pharaoh'] };

describe('namesake releases on one Deezer profile', () => {
  it('drops the other act and keeps every release of the artist, Latin titles included', () => {
    const dropped = foreignReleases(pyro, ctx);
    expect([...dropped].sort()).toEqual(['10', '11', '12']);
  });

  it('keeps a group that shares a title with the known discography', () => {
    const dropped = foreignReleases(pyro, { ...ctx, referenceTitles: [...ctx.referenceTitles, 'Atrophy'] });
    expect(dropped.has('12')).toBe(false);
  });

  it('does nothing without any sign of whose page it is', () => {
    expect(foreignReleases(pyro, { topAlbums: [], referenceTitles: [], relatedNames: [] }).size).toBe(0);
  });

  it('tells self-released «rizza» from «Rizza» by the label spelling and title style', () => {
    const rizza = [
      r('a', 'succubus', 'rizza', [116], [['succubus', 'RUA1D2242840']]),
      r('b', 'limbo', 'rizza', [85], [['welcome to limbo', 'DGA072300001'], ['nosferatu', 'DGA072300002']]),
      r('c', 'плачь', 'Adam Music', [116], [['плачь', 'QZHZ42100001']], [{ id: 104881022, name: 'Sqwore' }]),
      r('d', 'void', 'DNK Music', [116], [['void', 'QMDA62128571']]),
      r('e', 'плохая концовка', 'DNK Music', [116], [['arid', 'QMDA62100002'], ['одуванчик', 'QMDA62100003']]),
      r('p', 'Hanooz Zendeim', 'Rizza', [116], [['Hanooz Zendeim', 'GX4R52677442']]),
      r('q', 'Tehran ta LA', 'Shomare1 Records', [116], [['Tehran ta LA', 'DE1QW2600001']]),
    ];
    const dropped = foreignReleases(rizza, { topAlbums: ['a', 'c'], referenceTitles: ['succubus', 'плачь'], relatedNames: ['Sqwore', 'МЭЙБИ БЭЙБИ', 'Lida'] });
    expect([...dropped].sort()).toEqual(['p', 'q']);
  });
});

it('keeps only the card artist’s groups when the Deezer page’s hits belong to a namesake', () => {
  const band = r('b1', 'Substitute', 'BR Music', [132], [['Substitute', 'NLB120600001'], ['Save Me', 'NLB120600002']]);
  const rapper = r('c1', 'ОКО', 'AC1D', [116], [['Миром правит', 'RUAJF2611461']]);
  const rapper2 = r('c2', 'КИБЕРПСИХОЗ.MP3', 'AC1D', [106], [['ДИЛЕР', 'FRX202514825']]);
  const latin = r('l1', 'La Vida Continua', '12187745 Records DK', [116], [['La Vida Continua', 'QTA7T2653741']]);
  const out = foreignReleases([band, rapper, rapper2, latin], { topAlbums: ['b1'], referenceTitles: ['Substitute', 'ОКО'], relatedNames: ['Smokie'], trustedTitles: ['ОКО'] });
  expect([...out].sort()).toEqual(['b1', 'l1']);
});

it('drops a whole page that shares nothing with a known discography', () => {
  const r = (id: string, title: string) => ({ id, title, genres: [], coArtists: [], tracks: [{ title }] });
  const out = foreignReleases([r('1', 'Notte Viva'), r('2', 'Resta Con Me')], { topAlbums: ['1'], referenceTitles: [], relatedNames: [], trustedTitles: ['Один', 'Два', 'Три', 'Четыре', 'Пять'] });
  expect([...out].sort()).toEqual(['1', '2']);
});

describe('one artist over several same-named Deezer profiles (Deezer «Clout»)', () => {
  // 206095887: the Russian rapper plus Portuguese singles; 11597: a 1978 band, Latin singles and more of the rapper.
  const p = (id: string, title: string, label: string, year: number, profileId: string, tracks: Array<[string, string]>, coArtists: Array<{ id: number; name: string }> = []): ReleaseFacts =>
    ({ ...r(id, title, label, [116], tracks, coArtists), year, profileId });
  const pool = [
    p('kat', 'КАТАРСИС', 'AC1D', 2025, '206095887', [['у тРуПа', 'FRX202500001']]),
    p('xd', 'XD', 'AC1D', 2024, '206095887', [['XD', 'FRX202400001']]),
    p('sue', 'Suécia', 'cloutfilms', 2022, '206095887', [['Suécia', 'BRX202200001']], [{ id: 206095887, name: 'Clout' }, { id: 71974802, name: 'LUKA' }]),
    p('oko', 'ОКО', 'AC1D', 2026, '11597', [['Миром правит', 'RUAJF2611461']], [{ id: 206095887, name: 'Clout' }]),
    p('pro', 'Просыпаться', 'Clout', 2023, '11597', [['Просыпаться', 'FRX202300001']]),
    { ...p('sub', 'Substitute', 'BR Music', 1978, '11597', [['Substitute', 'NLB120600001'], ['Save Me', 'NLB120600002']]), genres: [132] },
    { ...p('uf', 'Under Fire', 'BR Music', 1978, '11597', [['Under Fire', 'NLB120600003']]), genres: [132] },
    { ...p('best', 'The Best Of Clout', 'BR Music', 2018, '11597', [['Substitute', 'NLB120600001']]), genres: [132] },
    p('bel', 'Bellaka (feat. Jeycyn)', '12187745 Records DK', 2026, '11597', [['Bellaka (feat. Jeycyn)', 'QTA7T2600503']], [{ id: 49878452, name: 'Jeycyn' }]),
    p('culo', 'Culo Pa Mi (feat. Jeycyn)', 'Another Level Music Group', 2024, '11597', [['Culo Pa Mi (feat. Jeycyn)', 'QZZ7R2468527']], [{ id: 49878452, name: 'Jeycyn' }]),
  ];
  const ctx = { artistName: 'Clout', relatedNames: [], referenceTitles: [] };
  const rapper = ['kat', 'oko', 'pro', 'xd'];

  it('gathers the rapper from both profiles when opened from his own profile', () => {
    const { own } = splitPersona(pool, { ...ctx, openedId: '206095887', topAlbums: ['kat'] });
    expect([...own].sort()).toEqual(rapper);
  });

  it('gives the same page when opened through the band profile from one of his releases', () => {
    const { own, others } = splitPersona(pool, { ...ctx, openedId: '11597', topAlbums: ['sub', 'bel'], seedAlbum: 'oko' });
    expect([...own].sort()).toEqual(rapper);
    expect(others.map(o => o.profileId).sort()).toEqual(['11597', '206095887']);
  });

  it('keeps the band page to the band: hits of a namesake on the same profile do not vouch for it', () => {
    const { own } = splitPersona(pool, { ...ctx, openedId: '11597', topAlbums: ['sub', 'bel'] });
    expect([...own].sort()).toEqual(['best', 'sub', 'uf']);
  });
});
