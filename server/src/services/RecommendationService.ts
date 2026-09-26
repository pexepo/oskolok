import { Track } from '../types/index.js';
import { prisma } from '../database/client.js';
import { musicCatalogService } from './MusicCatalogService.js';
import { soundCloudService } from './SoundCloudService.js';
import { normalizeMusicText, trackIdentity, matchesMetadataLanguage, matchesArtistSeed } from './trackRanking.js';
import { logger } from '../utils/logger.js';

export interface WaveOptions {
  userId?: string;
  limit?: number;
  mood?: 'energetic' | 'calm' | 'fun' | 'sad';
  character?: 'favorite' | 'discovery' | 'popular';
  language?: 'ru' | 'foreign' | 'all';
  excludeTrackIds?: string[];
}

interface MoodProfile {
  popular: string[];
  discovery: string[];
}

function shuffleArray<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const ARTIST_POOLS: Record<'ru' | 'foreign', Record<'energetic' | 'calm' | 'fun' | 'sad', MoodProfile>> = {
  ru: {
    energetic: {
      popular: [
        'shadowraze',
        'Big Baby Tape',
        'kizaru',
        'Miyagi',
        'Friendly Thug 52',
        'Toxi$',
        'PHARAOH',
        'GSPD',
        'Heronwater',
        'Bushido Zho',
        'ALBLAK 52',
        'Aarne',
        'MACAN',
        'Obladaet',
        'Saluki',
        'Morgenshtern',
        'OG Buda',
        'Платина',
        'MAYOT',
        '163ONMYNECK',
        'FEDUK',
        'Soda Luv',
        'Boulevard Depo',
        'Yanix',
        'Rocket',
        'Lizer',
      ],
      discovery: [
        'Kai Angel',
        '9mice',
        'Pepel Nahudi',
        'Hate Mondays',
        'DVRST',
        'SCIRENA',
        'uglystephan',
        'KUTE',
        'SXMPRA',
        'GHOSTFACE PLAYA',
        'STXRMAN',
        'visxge',
        'cursed',
        'RHODAMINE',
      ],
    },
    calm: {
      popular: [
        'Miyagi',
        'Скриптонит',
        'Saluki',
        'Сироткин',
        'Дайте танк(!)',
        'Баста',
        'Макс Корж',
        'Markul',
        'Zoloto',
        'ЛСП',
        'Хаски',
        'polnalyubvi',
        'JONY',
        'HammAli & Navai',
        'Jah Khalib',
        'Ramil',
        'Andro',
        'The Limba',
        'Navai',
      ],
      discovery: [
        'Деревянные киты',
        'Недры',
        'Бонд с кнопкой',
        'Мы',
        'Папин Олимпос',
        'Комсомольск',
        'тима ищет свет',
        'Свидание',
        'Обе Две',
        'The Retuses',
        'Меджикул',
        'dose',
        'манго буст',
      ],
    },
    fun: {
      popular: [
        'GSPD',
        'Dead Blonde',
        'INSTASAMKA',
        'Big Baby Tape',
        'Sqwoz Bab',
        'Lida',
        'Little Big',
        'CMH',
        'Cream Soda',
        'Пошлая Молли',
        'Кис-Кис',
        'Gayazov$ Brother$',
        'Винтаж',
        'Моя Мишель',
        'Zivert',
        'Клава Кока',
        'ANNA ASTI',
        'Niletto',
      ],
      discovery: [
        'Юра Музыченко',
        'Мэйби Бэйби',
        'Дети RAVE',
        'Мукка',
        'Заточка',
        'Хлеб',
        'Сестры',
        'Френдзона',
        'Дора',
        'МЭЙКЛАВ',
        'Gspd',
      ],
    },
    sad: {
      popular: [
        'Три дня дождя',
        'Кишлак',
        'ssshhhiiittt!',
        'Перемотка',
        'pyrokinesis',
        'ЛСП',
        'Молчат Дома',
        'Дора',
        'Дурной Вкус',
        'найтивыход',
        'Полматери',
        'Валентин Стрыкало',
        'Земфира',
        'Сплин',
        'Мумий Тролль',
        'Дельфин',
      ],
      discovery: [
        'Черная Речка',
        'Буерак',
        'Ploho',
        'источник',
        'Петля Пристрастия',
        'электрофорез',
        'автоспорт',
        'Увула',
        'Пасош',
        'Творожное озеро',
        'Порез на Собаке',
        'Где Фантом?',
      ],
    },
  },
  foreign: {
    energetic: {
      popular: [
        'Travis Scott',
        'Playboi Carti',
        'Drake',
        'Metro Boomin',
        'Ken Carson',
        'Lil Uzi Vert',
        '21 Savage',
        'Yeat',
        'Future',
        'Don Toliver',
        'Kanye West',
        'Kendrick Lamar',
        'A$AP Rocky',
        'Post Malone',
        'Juice WRLD',
        'Trippie Redd',
        'Ski Mask The Slump God',
        'Denzel Curry',
        'Eminem',
        'Lil Baby',
        'Gunna',
        'Young Thug',
        'Central Cee',
      ],
      discovery: [
        'Destroy Lonely',
        'Homixide Gang',
        'Hardrock',
        'Lancey Foux',
        'Lucki',
        'Baby Keem',
        'Fimiguerrero',
        'Osamason',
        'Nettspend',
        'Rich Amiri',
      ],
    },
    calm: {
      popular: [
        'Frank Ocean',
        'The Weeknd',
        'Joji',
        'Steve Lacy',
        'Daniel Caesar',
        'Laufey',
        'Brent Faiyaz',
        'Cigarettes After Sex',
        'Billie Eilish',
        'SZA',
        'Lana Del Rey',
        'Clairo',
        'Lorde',
        'Beach House',
        'TV Girl',
        'Tom Odell',
      ],
      discovery: [
        'Dominic Fike',
        'Rex Orange County',
        'Boy Pablo',
        'Cuco',
        'Mac DeMarco',
        'Men I Trust',
        'Phoebe Bridgers',
        'Omar Apollo',
        'Matt Maltese',
        'Wallows',
        'Faye Webster',
      ],
    },
    fun: {
      popular: [
        'Dua Lipa',
        'Bruno Mars',
        'Doja Cat',
        'Daft Punk',
        'Calvin Harris',
        'The Weeknd',
        'Harry Styles',
        'Olivia Rodrigo',
        'Sabrina Carpenter',
        'Charli XCX',
        'Justin Bieber',
        'Maroon 5',
        'Pitbull',
        'David Guetta',
        'Avicii',
      ],
      discovery: [
        'Oliver Tree',
        'Remi Wolf',
        'Channel Tres',
        'Jungle',
        'Peggy Gou',
        'Thundercat',
        'Genesis Owusu',
        'Franc Moody',
      ],
    },
    sad: {
      popular: [
        'XXXTENTACION',
        'Juice WRLD',
        'Lil Peep',
        'Billie Eilish',
        'Joji',
        'Conan Gray',
        'Radiohead',
        'The Smiths',
        'Lorde',
        'Lana Del Rey',
        'Cigarettes After Sex',
        'Girl in Red',
        'Alec Benjamin',
        'Lewis Capaldi',
        'Dean Lewis',
      ],
      discovery: [
        'Current Joys',
        'd4vd',
        'Beach House',
        'Phoebe Bridgers',
        'Novo Amor',
        'SYML',
        'Ricky Montgomery',
        'Roar',
        'Salvia Palth',
      ],
    },
  },
};

export class RecommendationService {
  public async getRecommendations(options?: WaveOptions): Promise<Track[]> {
    const userId = options?.userId || 'local-user';
    const limit = Math.max(1, Math.min(40, options?.limit || 20));
    const mood = options?.mood && ['energetic','calm','fun','sad'].includes(options.mood) ? options.mood : 'energetic';
    const character = options?.character || 'popular';
    const language = options?.language || 'all';
    const excluded = new Set((options?.excludeTrackIds || []).slice(-120));
    const russianArtists = new Set(Object.values(ARTIST_POOLS.ru).flatMap(pool => [...pool.popular, ...pool.discovery]).map(normalizeMusicText));
    const inLanguage = (track: Track) => matchesMetadataLanguage(track, language, russianArtists);
    const parse = (items: { trackData: string }[]): Track[] => items.flatMap(item => {
      try { const t = JSON.parse(item.trackData); return t?.artist?.name && t?.title ? [t as Track] : []; } catch { return []; }
    });
    const [likedRows, historyRows, playlistRows] = await Promise.all([
      prisma.likedTrack.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, take: 100 }),
      prisma.historyItem.findMany({ where: { userId }, orderBy: { playedAt: 'desc' }, take: 120 }),
      prisma.playlistTrack.findMany({ where: { playlist: { userId } }, orderBy: { addedAt: 'desc' }, take: 80 }),
    ]);
    const likes = parse(likedRows), history = parse(historyRows), library = parse(playlistRows);
    const recent = new Set(history.slice(0, 40).map(trackIdentity));
    const heard = new Set(history.map(trackIdentity));
    const liked = new Set(likes.map(trackIdentity));
    const affinity = new Map<string, { name: string; weight: number }>();
    const addAffinity = (track: Track, weight: number) => {
      const key = normalizeMusicText(track.artist.name), prev = affinity.get(key);
      affinity.set(key, { name: track.artist.name, weight: (prev?.weight || 0) + weight });
    };
    likes.forEach(t => addAffinity(t, 5));
    library.forEach(t => addAffinity(t, 2));
    history.forEach((t, i) => addAffinity(t, Math.exp(-i / 35)));
    const favorites = [...affinity.values()].sort((a,b) => b.weight - a.weight);
    const pool = language === 'ru' ? ARTIST_POOLS.ru[mood] : language === 'foreign' ? ARTIST_POOLS.foreign[mood]
      : { popular: [...ARTIST_POOLS.ru[mood].popular, ...ARTIST_POOLS.foreign[mood].popular], discovery: [...ARTIST_POOLS.ru[mood].discovery, ...ARTIST_POOLS.foreign[mood].discovery] };
    const seedCount = character === 'discovery' ? 3 : 4;
    const languageArtists = new Set([...likes,...history,...library].filter(inLanguage).map(t => normalizeMusicText(t.artist.name)));
    const seeds = favorites.filter(t => language === 'all' || languageArtists.has(normalizeMusicText(t.name))).slice(0, seedCount).map(t => t.name);
    const artists = [...new Set([...seeds, ...shuffleArray(character === 'discovery' ? pool.discovery : pool.popular)])].slice(0, 8);
    const queries = artists.map(async (name) => {
      // Spotify (with its Deezer availability fallback) is the recommendation
      // catalog of record. SoundCloud enters through related tracks below.
      const result = await musicCatalogService.search(name, { limit: 12 });
      return result.tracks.filter(t => matchesArtistSeed(t, name)).map(t => ({ ...t, recommendationReason: seeds.includes(name) ? `Потому что вы слушаете ${name}` : `Новые грани · ${name}` }));
    });
    // Several distinct listening seeds discover adjacent artists while avoiding
    // one related list dominating the whole queue.
    const relatedSeeds:Track[]=[];
    const seenSeedArtists=new Set<string>();
    for(const track of [...likes,...history,...library]){
      const artist=normalizeMusicText(track.artist.name);
      if(track.source!=='soundcloud'||seenSeedArtists.has(artist)||!inLanguage(track))continue;
      seenSeedArtists.add(artist);relatedSeeds.push(track);
      if(relatedSeeds.length===3)break;
    }
    for(const seedTrack of relatedSeeds)queries.push(soundCloudService.getRelatedTracks(seedTrack.id).then(ts => ts.map(t => ({ ...t, recommendationReason: `Рядом с «${seedTrack.title}»` }))));
    const batches = await Promise.allSettled(queries);
    const candidates: Track[] = batches.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (character === 'favorite') candidates.push(...likes.map(t => ({ ...t, recommendationReason: 'Из ваших любимых' })),...library.map(t=>({...t,recommendationReason:'Из вашей коллекции'})));
    // Provider outages must not turn an existing library into an empty screen.
    if (candidates.filter(t => !excluded.has(t.id) && t.duration >= 45 && t.access === 'playable' && inLanguage(t)).length < limit) candidates.push(...library, ...likes, ...history);
    const scored = candidates.filter(t => !excluded.has(t.id) && t.duration >= 45 && t.access === 'playable' && inLanguage(t))
      .map(t => {
        const known = affinity.get(normalizeMusicText(t.artist.name));
        const identity=trackIdentity(t);
        let score=0;
        if(known)score+=character==='discovery'?0:Math.min(40,known.weight*2);
        else if(character==='discovery')score+=30;
        if(liked.has(identity))score+=character==='favorite'?48:-24;
        if(character==='discovery'&&heard.has(identity))score-=35;
        if(recent.has(identity))score-=100;
        if(t.recommendationReason?.startsWith('Рядом'))score+=20;
        if(t.artworkUrl)score+=3;
        if(t.source==='spotify')score+=30;
        else if(t.source==='deezer'||t.source==='licensed')score+=20;
        else if(t.source==='soundcloud')score-=12;
        if(/\b(slowed|sped up|nightcore|cover|karaoke|snippet|preview|live)\b|кавер/i.test(t.title))score-=35;
        return { track: { ...t, recommendationReason: t.recommendationReason || 'Из вашей коллекции' }, score };
      }).sort((a,b) => b.score - a.score||a.track.id.localeCompare(b.track.id));
    const remixPattern=/\b(remix|remixed|rework|bootleg|edit|mix)\b|ремикс|ремастер/i;
    const isRemix=(track:Track)=>remixPattern.test(`${track.title} ${track.release?.title||''}`);
    const sorted=scored.map(t=>t.track);
    const selected:Track[]=[];
    const seenTracks=new Set<string>();
    const artistReleases=new Map<string,Set<string>>();
    const remixCounts=new Map<string,number>();
    const selectedSources=new Map<string,number>();
    const artistKeys=(track:Track)=>track.artist.name.normalize('NFKC').toLowerCase()
      .split(/\s*,\s*|\s+(?:&|and|x|feat(?:uring)?|ft|with)\s+|\s*[|/]\s*/)
      .map(normalizeMusicText).filter(Boolean);
    const releaseKey=(track:Track)=>normalizeMusicText(track.release?.title||track.title);
    const sourceKey=(track:Track)=>track.source==='spotify'||track.source==='deezer'||track.source==='licensed'?'catalog':track.source;
    const addTrack=(track:Track)=>{
      const identity=trackIdentity(track),artists=artistKeys(track),release=releaseKey(track),remix=isRemix(track);
      if(!artists.length||seenTracks.has(identity)||seenTracks.has(track.id))return false;
      const repeatedArtists=artists.filter(artist=>(artistReleases.get(artist)?.size||0)>0);
      if(repeatedArtists.some(artist=>!remix||artistReleases.get(artist)?.has(release)||(remixCounts.get(artist)||0)>=1))return false;
      const source=sourceKey(track),soundCloudCount=selectedSources.get('soundcloud')||0;
      if(source==='soundcloud'&&soundCloudCount>=Math.max(1,Math.floor(limit/3)))return false;
      selected.push(track);seenTracks.add(identity);seenTracks.add(track.id);
      for(const artist of artists){
        const releases=artistReleases.get(artist)||new Set<string>();
        releases.add(release);artistReleases.set(artist,releases);
        if(remix)remixCounts.set(artist,(remixCounts.get(artist)||0)+1);
      }
      selectedSources.set(source,(selectedSources.get(source)||0)+1);
      return true;
    };
    const catalogTarget=Math.min(limit,Math.ceil(limit*2/3));
    for(const track of sorted.filter(t=>sourceKey(t)==='catalog')){if((selectedSources.get('catalog')||0)>=catalogTarget)break;addTrack(track);}
    for(const track of sorted){if(selected.length>=limit)break;addTrack(track);}
    return selected;
  }
}

export const recommendationService = new RecommendationService();
