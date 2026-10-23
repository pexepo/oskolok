import { Track } from '../types/index.js';
import { prisma } from '../database/client.js';
import { musicCatalogService } from './MusicCatalogService.js';
import { soundCloudService } from './SoundCloudService.js';
import { canonicalizeTracks } from './canonicalRelease.js';
import { spotifyService } from './SpotifyService.js';
import { officialCatalogService } from './OfficialCatalogService.js';
import { normalizeMusicText, trackIdentity, matchesMetadataLanguage, matchesArtistSeed } from './trackRanking.js';
import { logger } from '../utils/logger.js';

/* «Моя волна»: scenario (what you are doing) × mood × character × language.
   Scenario and mood become catalogue constraints (Spotify genre filters,
   SoundCloud tag searches, energy/instrumental/explicit heuristics);
   character sets the familiar / neighbour / fresh mix of every batch. */
export const WAVE_SCENARIOS = ['listen', 'work', 'sleep', 'road', 'road-night', 'road-commute', 'work-focus', 'work-code', 'sleep-ambient', 'sleep-rain', 'workout', 'focus', 'meditate', 'party', 'cooking', 'gaming', 'reading', 'rain'] as const;
export const WAVE_MOODS = ['any', 'energetic', 'fun', 'calm', 'sad', 'romantic', 'dark'] as const;
export const WAVE_CHARACTERS = ['favorite', 'familiar', 'discovery', 'popular'] as const;
export const WAVE_LANGUAGES = ['all', 'ru', 'foreign', 'instrumental'] as const;
export type WaveScenario = typeof WAVE_SCENARIOS[number];
export type WaveMood = typeof WAVE_MOODS[number];
export type WaveCharacter = typeof WAVE_CHARACTERS[number];
export type WaveLanguage = typeof WAVE_LANGUAGES[number];

/** A listening signal sent by the client for the running session. */
export interface WaveSignal { id: string; artist: string; title?: string; reason?: string }

export interface WaveOptions {
  userId?: string;
  limit?: number;
  scenario?: WaveScenario;
  mood?: WaveMood;
  character?: WaveCharacter;
  language?: WaveLanguage;
  excludeTrackIds?: string[];
  /** Tracks skipped early (persisted client-side across sessions, newest last). */
  skipped?: WaveSignal[];
  /** Tracks liked during the running wave session. */
  liked?: WaveSignal[];
  /** Artists of the last played wave tracks — kept out of the next batch. */
  recentArtists?: string[];
  /** Refill counter: rotates seeds and catalogue pages between batches. */
  batch?: number;
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

type PoolMood = 'energetic' | 'calm' | 'fun' | 'sad';

interface Vibe {
  reason: string;
  /** 0..1, -1 = no opinion (defer to the other axis). */
  energy: number;
  genres: string[];
  ruGenres: string[];
  queries: string[];
  ruQueries: string[];
  /** 0..1 preference for tracks without vocals. */
  instrumental: number;
  explicit: boolean;
  /** 0..1 how much the user's own artists fit this vibe. */
  personal: number;
  boost?: RegExp;
  avoid?: RegExp;
  minDuration?: number;
  maxDuration?: number;
  pool?: PoolMood;
  /** Real artists whose catalogue tracks define the scenario (no descriptive-query uploads). */
  artists?: string[];
  /** Only sleep may draw anonymous uploads (rain, white noise) from descriptive searches. */
  uploads?: boolean;
}

/* Curated, recognisable artists per niche flavour; the base scenarios use their union. */
const NIGHT_DRIVE = ['The Midnight', 'Kavinsky', 'FM-84', 'Timecop1983', 'Gunship', 'Carpenter Brut', 'Perturbator', 'Lebanon Hanover', 'Молчат Дома', 'Электрофорез', 'Ploho', 'Кино'];
const COMMUTE = ['Arctic Monkeys', 'The Strokes', 'Interpol', 'Tame Impala', 'Radiohead', 'The Smiths', 'Joy Division', 'Буерак', 'Дайте танк (!)', 'Кис-кис', 'Сплин', 'Звери', 'Наутилус Помпилиус'];
const DEEP_FOCUS = ['Nils Frahm', 'Ólafur Arnalds', 'Jon Hopkins', 'Max Richter', 'Bonobo', 'Tycho', 'Hania Rani', 'Rival Consoles', 'Floating Points', 'Four Tet', 'Kiasmos', 'Ludovico Einaudi'];
const CODING = ['Boards of Canada', 'Aphex Twin', 'Burial', 'Moderat', 'Bicep', 'Jamie xx', 'Daft Punk', 'Justice', 'ODESZA', 'Caribou', 'Thom Yorke', 'Kraftwerk'];
const SLEEP_AMBIENT = ['Brian Eno', 'Stars of the Lid', 'Hammock', 'Harold Budd', 'Grouper', 'Julianna Barwick', 'William Basinski', 'Hiroshi Yoshimura', 'Sigur Rós', 'Max Richter', 'Ólafur Arnalds', 'Hania Rani'];

const CALM_AVOID = /\b(remix|phonk|bass ?boosted|hardstyle|drill|sped ?up|nightcore|trap|edm|party|rage|hard ?techno|dubstep)\b|фонк|ремикс/i;

const SCENARIOS: Record<WaveScenario, Vibe> = {
  'road-night': {
    reason: 'Ночная трасса', energy: .6, instrumental: .2, explicit: true, personal: .45, artists: NIGHT_DRIVE,
    genres: ['synthwave', 'darkwave', 'retrowave', 'post-punk'], ruGenres: ['russian post-punk'], queries: [], ruQueries: [],
    boost: /night|drive|neon|midnight|highway|city|ночь|трасс|город/i, avoid: /sleep|lullaby|колыбел/i,
  },
  'road-commute': {
    reason: 'Электричка', energy: .55, instrumental: 0, explicit: true, personal: .6, artists: COMMUTE,
    genres: ['indie rock', 'post-punk', 'alternative rock'], ruGenres: ['russian indie', 'russian rock'], queries: [], ruQueries: [],
    avoid: /sleep|lullaby|колыбел/i,
  },
  'work-focus': {
    reason: 'Глубокий фокус', energy: .3, instrumental: .9, explicit: false, personal: .2, artists: DEEP_FOCUS,
    genres: ['neoclassical', 'ambient', 'downtempo', 'electronica'], ruGenres: [], queries: [], ruQueries: [],
    boost: /piano|ambient|instrumental|strings|focus/i, avoid: CALM_AVOID,
  },
  'work-code': {
    reason: 'Кодинг', energy: .55, instrumental: .75, explicit: true, personal: .35, artists: CODING,
    genres: ['idm', 'electronica', 'minimal techno', 'uk garage'], ruGenres: [], queries: [], ruQueries: [],
    avoid: /\b(phonk|hardstyle|bass ?boosted|nightcore)\b|фонк/i,
  },
  'sleep-ambient': {
    reason: 'Эмбиент для сна', energy: .06, instrumental: .95, explicit: false, personal: .1, minDuration: 150, artists: SLEEP_AMBIENT,
    genres: ['ambient', 'drone', 'new age'], ruGenres: [], queries: [], ruQueries: [],
    boost: /ambient|sleep|drift|calm|night|piano|сон|ночь/i, avoid: CALM_AVOID,
  },
  'sleep-rain': {
    reason: 'Шум дождя', energy: .02, instrumental: 1, explicit: false, personal: 0, minDuration: 240, uploads: true, artists: ['Hiroshi Yoshimura', 'Brian Eno', 'Stars of the Lid'],
    genres: ['ambient'], ruGenres: [], queries: ['rain sounds for sleeping', 'gentle rain on window', 'thunderstorm ambience sleep', 'brown noise sleep'], ruQueries: [],
    boost: /rain|storm|noise|ambience|sleep|дожд|гроз|шум/i, avoid: CALM_AVOID,
  },
  listen: { reason: '', energy: -1, genres: [], ruGenres: [], queries: [], ruQueries: [], instrumental: 0, explicit: true, personal: 1 },
  work: {
    reason: 'Для работы', energy: .45, instrumental: .6, explicit: true, personal: .5, artists: [...DEEP_FOCUS, ...CODING],
    genres: ['lo-fi beats', 'chillhop', 'downtempo', 'deep house', 'jazz rap', 'nu jazz', 'electronica'],
    ruGenres: ['russian indie', 'russian electronic'],
    queries: ['lofi work music', 'deep focus instrumental', 'chillhop beats'], ruQueries: ['русский лоуфай', 'спокойный русский инди'],
    boost: /lo-?fi|chill|instrumental|deep|jazz|ambient|beats?|focus|groove/i, avoid: /\b(phonk|hardstyle|bass ?boosted|drill|nightcore|rage)\b|фонк/i,
  },
  sleep: {
    reason: 'Для сна', energy: .08, instrumental: .85, explicit: false, personal: .15, minDuration: 150, uploads: true, artists: SLEEP_AMBIENT,
    genres: ['ambient', 'sleep', 'new age', 'neoclassical', 'drone'],
    ruGenres: [],
    queries: ['sleep ambient', 'calm piano sleep', 'lofi sleep'], ruQueries: ['спокойная музыка для сна', 'колыбельная'],
    boost: /sleep|ambient|piano|calm|dream|lull|night|drift|сон|колыб|ночь/i, avoid: CALM_AVOID,
  },
  workout: {
    reason: 'Для тренировки', energy: .95, instrumental: .1, explicit: true, personal: .6, artists: ['Kordhell', 'DVRST', 'INTERWORLD', 'Eminem', 'Skrillex', 'Pendulum', 'The Prodigy', 'Скриптонит', 'Miyagi & Andy Panda'], maxDuration: 330,
    genres: ['phonk', 'edm', 'hardstyle', 'trap', 'drum and bass', 'brazilian phonk'],
    ruGenres: ['russian phonk', 'russian hip hop', 'russian trap'],
    queries: ['gym phonk', 'workout motivation', 'drum and bass workout'], ruQueries: ['фонк для тренировки', 'русский рэп для зала'],
    boost: /phonk|workout|gym|bass|hard|remix|sped ?up|energy|run|фонк|зал/i, avoid: /sleep|lullaby|piano|acoustic|ambient|slowed|колыбел/i,
  },
  road: {
    reason: 'В дорогу', energy: .65, instrumental: 0, explicit: true, personal: .8, artists: [...NIGHT_DRIVE, ...COMMUTE],
    genres: ['indie rock', 'synthwave', 'alternative rock', 'pop rock', 'indie pop'],
    ruGenres: ['russian rock', 'russian indie', 'russian pop'],
    queries: ['road trip songs', 'night drive synthwave'], ruQueries: ['музыка в дорогу', 'русский рок в машину'],
    boost: /drive|road|highway|night|ride|car|дорог|трасс|ночь|машин/i, avoid: /sleep|lullaby|колыбел/i,
  },
  focus: {
    reason: 'Для учёбы', energy: .3, instrumental: .9, explicit: false, personal: .25, artists: DEEP_FOCUS,
    genres: ['lo-fi beats', 'neoclassical', 'ambient', 'chillhop', 'classical'],
    ruGenres: [],
    queries: ['study lofi', 'focus music instrumental', 'classical study'], ruQueries: ['музыка для учёбы'],
    boost: /lo-?fi|study|focus|piano|instrumental|ambient|classical|beats?/i, avoid: CALM_AVOID,
  },
  meditate: {
    reason: 'Для медитации', energy: .04, instrumental: .95, explicit: false, personal: .05, artists: SLEEP_AMBIENT, minDuration: 180,
    genres: ['meditation', 'ambient', 'new age', 'drone'],
    ruGenres: [],
    queries: ['meditation music', 'tibetan singing bowls', 'binaural ambient'], ruQueries: ['музыка для медитации'],
    boost: /meditat|zen|calm|healing|ambient|bowl|breath|mantra|медитац|дыхан/i, avoid: CALM_AVOID,
  },
  party: {
    reason: 'Для вечеринки', energy: .9, instrumental: .05, explicit: true, personal: .6, artists: ['Dua Lipa', 'Calvin Harris', 'The Weeknd', 'Daft Punk', 'David Guetta', 'Fred again..', 'Artik & Asti', 'Zivert', 'MACAN'],
    genres: ['dance pop', 'house', 'edm', 'disco', 'tech house'],
    ruGenres: ['russian pop', 'russian dance', 'russian edm'],
    queries: ['party hits', 'club house mix'], ruQueries: ['хиты для вечеринки', 'русские танцевальные хиты'],
    boost: /party|club|dance|remix|edit|house|disco|танц|клуб/i, avoid: /sleep|lullaby|acoustic|piano|колыбел/i,
  },
  cooking: {
    reason: 'Для готовки', energy: .55, instrumental: .3, explicit: true, personal: .7, artists: ['Jamiroquai', 'Vulfpeck', 'Khruangbin', 'Tom Misch', 'Parcels', 'Anderson .Paak', 'FKJ'],
    genres: ['funk', 'soul', 'nu disco', 'jazz', 'bossa nova', 'indie pop'],
    ruGenres: ['russian indie', 'russian pop'],
    queries: ['cooking jazz funk', 'kitchen groove'], ruQueries: ['музыка для готовки'],
    boost: /funk|groove|soul|jazz|bossa|disco|kitchen|cook/i, avoid: /\b(phonk|hardstyle|drill|rage)\b|фонк/i,
  },
  gaming: {
    reason: 'Для игр', energy: .8, instrumental: .5, explicit: true, personal: .5, artists: ['Perturbator', 'Carpenter Brut', 'Pendulum', 'Noisia', 'Kavinsky', 'Daft Punk', 'Hans Zimmer'],
    genres: ['synthwave', 'dubstep', 'drum and bass', 'video game music', 'phonk', 'electro'],
    ruGenres: ['russian phonk'],
    queries: ['gaming music mix', 'synthwave gaming', 'epic gaming phonk'], ruQueries: ['фонк для игр'],
    boost: /game|gaming|synth|cyber|neon|phonk|bass|epic|8.?bit|игр/i, avoid: /lullaby|acoustic|sleep|колыбел/i,
  },
  reading: {
    reason: 'Для чтения', energy: .2, instrumental: .85, explicit: false, personal: .2, artists: ['Ludovico Einaudi', 'Max Richter', 'Yiruma', 'Bill Evans', 'Chet Baker', 'Nils Frahm', 'Erik Satie'],
    genres: ['classical', 'neoclassical', 'jazz', 'ambient', 'chamber music'],
    ruGenres: [],
    queries: ['reading music piano', 'cafe jazz reading'], ruQueries: ['музыка для чтения'],
    boost: /piano|classical|jazz|ambient|reading|cafe|quiet|strings|nocturne|sonata/i, avoid: CALM_AVOID,
  },
  rain: {
    reason: 'Дождливый вечер', energy: .25, instrumental: .3, explicit: true, personal: .6, artists: ['Cigarettes After Sex', 'Beach House', 'Mazzy Star', 'Bon Iver', 'Phoebe Bridgers', 'Молчат Дома', 'Кино'],
    genres: ['indie folk', 'dream pop', 'slowcore', 'bedroom pop', 'lo-fi beats'],
    ruGenres: ['russian indie', 'russian post-punk', 'russian shoegaze'],
    queries: ['rainy day lofi', 'rainy night jazz'], ruQueries: ['дождливый вечер', 'грустный русский инди'],
    boost: /rain|night|cozy|lo-?fi|jazz|dream|blue|autumn|дожд|ночь|осен/i, avoid: /\b(party|hardstyle|phonk|workout|gym)\b|фонк/i,
  },
};

const MOODS: Record<WaveMood, Vibe> = {
  any: { reason: '', energy: -1, genres: [], ruGenres: [], queries: [], ruQueries: [], instrumental: 0, explicit: true, personal: 1 },
  energetic: {
    reason: 'Энергичное', energy: .85, instrumental: 0, explicit: true, personal: 1, pool: 'energetic',
    genres: ['hip hop', 'edm', 'trap', 'dance'], ruGenres: ['russian hip hop', 'russian trap'],
    queries: ['energetic hits'], ruQueries: ['энергичный русский рэп'],
    boost: /remix|bass|hard|energy|fire|run|огонь/i, avoid: /slowed|sleep|lullaby|колыбел/i,
  },
  fun: {
    reason: 'Весёлое', energy: .75, instrumental: 0, explicit: true, personal: 1, pool: 'fun',
    genres: ['dance pop', 'pop', 'disco', 'funk'], ruGenres: ['russian pop', 'russian dance'],
    queries: ['feel good songs'], ruQueries: ['весёлые песни'],
    boost: /happy|fun|party|sun|summer|dance|good|лет|танц|солн/i, avoid: /\b(sad|cry|tears)\b|груст|слёз|слез/i,
  },
  calm: {
    reason: 'Спокойное', energy: .3, instrumental: 0, explicit: true, personal: 1, pool: 'calm',
    genres: ['chill', 'indie pop', 'acoustic', 'bedroom pop'], ruGenres: ['russian indie'],
    queries: ['chill vibes'], ruQueries: ['спокойная музыка'],
    boost: /chill|acoustic|calm|soft|slow|lo-?fi|спокой|тих/i, avoid: /\b(phonk|hardstyle|bass ?boosted|rage)\b|фонк/i,
  },
  sad: {
    reason: 'Грустное', energy: .25, instrumental: 0, explicit: true, personal: 1, pool: 'sad',
    genres: ['sad', 'emo', 'indie folk', 'sad rap'], ruGenres: ['russian post-punk', 'russian indie', 'russian emo'],
    queries: ['sad songs'], ruQueries: ['грустные песни'],
    boost: /sad|cry|tears|alone|lonely|broken|груст|слёз|слез|один|одиноч/i, avoid: /\b(party|happy|dance)\b|танц/i,
  },
  romantic: {
    reason: 'Романтичное', energy: .4, instrumental: 0, explicit: true, personal: 1, pool: 'calm',
    genres: ['r&b', 'soul', 'neo soul'], ruGenres: ['russian pop', 'russian r&b'],
    queries: ['romantic love songs'], ruQueries: ['песни о любви'],
    boost: /love|heart|kiss|baby|darling|люб|сердц|поцел|нежн/i,
  },
  dark: {
    reason: 'Мрачное', energy: .6, instrumental: 0, explicit: true, personal: 1, pool: 'sad',
    genres: ['darkwave', 'post-punk', 'dark trap', 'witch house', 'phonk'], ruGenres: ['russian post-punk', 'russian phonk'],
    queries: ['dark phonk', 'darkwave'], ruQueries: ['мрачный пост-панк'],
    boost: /dark|night|shadow|ghost|death|black|void|тьм|мрак|ночь|смерт/i, avoid: /\b(happy|sun|summer|party)\b|лет/i,
  },
};

export const HIGH_ENERGY = /\b(phonk|hardstyle|bass ?boosted|drill|sped ?up|nightcore|rage|hard ?techno|dubstep|gym|workout)\b|фонк/i;
export const LOW_ENERGY = /\b(sleep|lullaby|ambient|piano|acoustic|calm|meditation|slowed|relax)\b|колыбел|сон\b/i;
export const REMIX_TEXT = /\b(remix|remixed|rework|bootleg|edit|vip mix)\b|ремикс/i;
export const INSTRUMENTAL_TEXT =/\b(instrumental|inst|beats?|lo-?fi|piano|ambient|orchestra|ost|soundtrack|score|chillhop|meditation|sonata|nocturne|etude|concerto|symphony)\b|инструментал/i;
const INSTRUMENTAL_GENRES = ['lo-fi beats', 'ambient', 'neoclassical', 'chillhop', 'post-rock', 'soundtrack', 'classical'];
/** Anonymous channel-style uploads: generic "artist" names and playlist-like titles. */
const GENERIC_ARTIST = /\b(lo-?fi|sleep|relax(ing)?|meditation|study|chill(hop)?|beats|music for|various artists|white noise|ambient music|nature sounds|piano music|spa|yoga|baby|lullab(y|ies)|focus|background|instrumental music|radio|playlist|mix(es)?|compilation)\b|музыка для|расслабляющ|сборник/i;
const JUNK_TITLE = /\b\d+\s*(hours?|hrs?|h)\b|\b(full album|compilation|playlist|megamix|dj mix|mixed by|type beat|non ?stop)\b|(^|\s)(1 )?час(а|ов)?(\s|$)|#\w|\||https?:|www\.|t\.me\/|\.(com|ru|me)\b/i;
export const isJunkUpload = (t: Track) => GENERIC_ARTIST.test(t.artist.name) || JUNK_TITLE.test(t.title);
export const LOW_QUALITY = /\b(cover|karaoke|snippet|preview|live|8d audio|ringtone)\b|кавер|караоке/i;

interface ComposedVibe {
  reason: string; energy: number; genres: string[]; queries: string[]; instrumental: number; explicit: boolean;
  personal: number; boost: RegExp[]; avoid: RegExp[]; minDuration: number; maxDuration: number; pool: PoolMood; strength: number;
  artists: string[]; uploads: boolean;
}

function composeVibe(scenario: WaveScenario, mood: WaveMood, language: WaveLanguage): ComposedVibe {
  const s = SCENARIOS[scenario], m = MOODS[mood];
  // A sleep wave stays a sleep wave even with an «Энергичное» mood selected.
  const conflict = s.energy >= 0 && m.energy >= 0 && Math.abs(s.energy - m.energy) > .5;
  const useMood = mood !== 'any' && !conflict;
  const energy = s.energy < 0 ? (m.energy < 0 ? -1 : m.energy) : useMood ? s.energy * .7 + m.energy * .3 : s.energy;
  const genresOf = (v: Vibe) => language === 'ru' ? (v.ruGenres.length ? v.ruGenres : v.genres) : language === 'foreign' ? v.genres : [...v.genres, ...v.ruGenres];
  const queriesOf = (v: Vibe) => language === 'ru' ? (v.ruQueries.length ? v.ruQueries : v.queries) : language === 'foreign' ? v.queries : [...v.queries, ...v.ruQueries];
  let genres = [...genresOf(s), ...(useMood ? genresOf(m) : [])];
  let queries = [...queriesOf(s), ...(useMood ? queriesOf(m) : [])];
  if (language === 'instrumental') {
    genres = [...s.genres.filter(g => INSTRUMENTAL_GENRES.includes(g)), ...INSTRUMENTAL_GENRES];
    queries = [...s.queries, ...(useMood ? m.queries : [])].filter(q => !/[а-яё]/i.test(q)).map(q => /instrumental/i.test(q) ? q : `${q} instrumental`);
    if (!queries.length) queries = ['chill instrumental', 'instrumental beats'];
  }
  const pool: PoolMood = useMood && m.pool ? m.pool : energy < 0 ? 'energetic' : energy >= .72 ? 'energetic' : energy >= .55 ? 'fun' : mood === 'sad' ? 'sad' : 'calm';
  return {
    reason: [s.reason, useMood ? m.reason.toLowerCase() : ''].filter(Boolean).join(' · ') || (useMood ? m.reason : ''),
    energy, genres: [...new Set(genres)], queries: [...new Set(queries)],
    instrumental: language === 'instrumental' ? 1 : s.instrumental,
    explicit: s.explicit, personal: s.personal * (language === 'instrumental' ? .4 : 1),
    boost: [s.boost, useMood ? m.boost : undefined].filter((r): r is RegExp => !!r),
    avoid: [s.avoid, useMood ? m.avoid : undefined].filter((r): r is RegExp => !!r),
    minDuration: s.minDuration || 45, maxDuration: s.maxDuration || 900, pool,
    strength: scenario !== 'listen' ? 1 : useMood ? .6 : .15,
    artists: [...new Set([...(s.artists || []), ...(useMood ? m.artists || [] : [])])]
      .filter(name => language === 'all' || language === 'instrumental' || (language === 'ru') === /[а-яё]/i.test(name)),
    uploads: !!s.uploads,
  };
}

/* Collaborations count for every listed artist. */
function splitArtists(name: string): { key: string; name: string }[] {
  return name.split(/\s*,\s*|\s+(?:&|x|feat\.?|ft\.?|featuring|with)\s+|\s*[|/]\s*/i)
    .map(part => part.trim()).filter(Boolean).map(part => ({ key: normalizeMusicText(part), name: part })).filter(a => a.key);
}
const looseIdentity = (artist: string, title: string) => `${normalizeMusicText(artist)}:${normalizeMusicText(title)}`;
const rotate = <T,>(items: T[], by: number) => items.length ? [...items.slice(by % items.length), ...items.slice(0, by % items.length)] : items;

type PoolEntry = { lang: 'ru' | 'foreign'; mood: PoolMood };
const POOL_INDEX = new Map<string, PoolEntry[]>();
const POOL_NAMES = new Map<string, string>();
for (const lang of ['ru', 'foreign'] as const) for (const mood of Object.keys(ARTIST_POOLS[lang]) as PoolMood[]) {
  for (const name of [...ARTIST_POOLS[lang][mood].popular, ...ARTIST_POOLS[lang][mood].discovery]) {
    const key = normalizeMusicText(name);
    POOL_INDEX.set(key, [...(POOL_INDEX.get(key) || []), { lang, mood }]);
    POOL_NAMES.set(key, name);
  }
}
export const RUSSIAN_ARTISTS = new Set([...POOL_INDEX.entries()].filter(([, entries]) => entries.some(e => e.lang === 'ru')).map(([key]) => key));

/** Artists sharing a curated mood shelf with the given one. */
function poolNeighbours(key: string): string[] {
  return [...new Set((POOL_INDEX.get(key) || []).flatMap(e => [...ARTIST_POOLS[e.lang][e.mood].popular, ...ARTIST_POOLS[e.lang][e.mood].discovery]))]
    .filter(name => normalizeMusicText(name) !== key);
}

/* SoundCloud «related» per seed track: the closest thing to an artist graph
   without Spotify's retired related-artists API. Cached per seed. */
const neighbourCache = new Map<string, { at: number; tracks: Track[] }>();
const NEIGHBOUR_TTL = 6 * 60 * 60_000;
const UPLOADER_NOISE = /\d{4,}|official|records|music\b|topic|user|channel|tv\b|lyrics|audio/i;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}

type Origin = 'liked' | 'familiar' | 'neighbour' | 'vibe' | 'pool' | 'fallback';
type Bucket = 'familiar' | 'neighbour' | 'fresh';
/** familiar / neighbour / fresh share of a batch per «Характер». */
const CHARACTER_MIX: Record<WaveCharacter, [number, number, number]> = {
  favorite: [.6, .25, .15],
  familiar: [.5, .32, .18],
  popular: [.3, .25, .45],
  discovery: [.1, .4, .5],
};

/** Deezer's own similarity graph for an artist: its "radio" (tracks by similar artists) and related artists. Cached 6 h. */
const deezerGraph = new Map<string, { at: number; tracks: Track[]; related: string[] }>();
export async function deezerSimilar(artistName: string): Promise<{ tracks: Track[]; related: string[] }> {
  const key = normalizeMusicText(artistName), hit = deezerGraph.get(key);
  if (hit && Date.now() - hit.at < NEIGHBOUR_TTL) return hit;
  const get = (path: string) => fetch(`https://api.deezer.com/${path}`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() as Promise<any> : null).catch(() => null);
  const found = await get(`search/artist?q=${encodeURIComponent(artistName)}&limit=5`);
  const artist = (found?.data || []).filter((a: any) => normalizeMusicText(a.name).replace(/\s/g, '') === key.replace(/\s/g, '')).sort((a: any, b: any) => (b.nb_fan || 0) - (a.nb_fan || 0))[0];
  if (!artist) { deezerGraph.set(key, { at: Date.now(), tracks: [], related: [] }); return { tracks: [], related: [] }; }
  const [radio, related] = await Promise.all([get(`artist/${artist.id}/radio?limit=40`), get(`artist/${artist.id}/related?limit=12`)]);
  const value = { at: Date.now(), tracks: ((radio?.data || []) as any[]).map(t => officialCatalogService.mapTrack(t)), related: ((related?.data || []) as any[]).map(a => String(a.name)) };
  if (deezerGraph.size > 800) deezerGraph.delete(deezerGraph.keys().next().value!);
  deezerGraph.set(key, value);
  return value;
}

export class RecommendationService {
  private async relatedFor(seed: WaveSignal): Promise<Track[]> {
    const key = looseIdentity(seed.artist, seed.title || seed.id);
    const hit = neighbourCache.get(key);
    if (hit && Date.now() - hit.at < NEIGHBOUR_TTL) return hit.tracks;
    // Real catalogue similarity first (Deezer artist radio); SoundCloud's related graph only fills gaps.
    const primaryName = splitArtists(seed.artist)[0]?.name || seed.artist;
    const graph = await deezerSimilar(primaryName).catch(() => ({ tracks: [] as Track[], related: [] as string[] }));
    if (graph.tracks.length >= 8) { neighbourCache.set(key, { at: Date.now(), tracks: graph.tracks }); return graph.tracks; }
    let soundCloudId = seed.id.startsWith('soundcloud:') ? seed.id : undefined;
    if (!soundCloudId && seed.title) {
      const primary = splitArtists(seed.artist)[0]?.name || seed.artist;
      const found = await soundCloudService.search(`${primary} ${seed.title}`, { limit: 5, type: 'tracks' });
      soundCloudId = found.tracks.find(t => matchesArtistSeed(t, primary))?.id;
    }
    const tracks = soundCloudId ? await soundCloudService.getRelatedTracks(soundCloudId, 20) : [];
    if (neighbourCache.size > 500) neighbourCache.delete(neighbourCache.keys().next().value!);
    neighbourCache.set(key, { at: Date.now(), tracks });
    return tracks;
  }

  /** Wave tracks with SoundCloud re-uploads swapped for the official release. */
  public async getRecommendations(options: WaveOptions = {}): Promise<Track[]> {
    return canonicalizeTracks(await this.buildRecommendations(options), { budgetMs: 2000 });
  }

  private async buildRecommendations(options: WaveOptions = {}): Promise<Track[]> {
    const userId = options.userId || 'local-user';
    const limit = Math.max(1, Math.min(40, Math.floor(options.limit || 20)));
    const scenario: WaveScenario = WAVE_SCENARIOS.includes(options.scenario as WaveScenario) ? options.scenario! : 'listen';
    const mood: WaveMood = WAVE_MOODS.includes(options.mood as WaveMood) ? options.mood! : 'any';
    const character: WaveCharacter = WAVE_CHARACTERS.includes(options.character as WaveCharacter) ? options.character! : 'popular';
    const language: WaveLanguage = WAVE_LANGUAGES.includes(options.language as WaveLanguage) ? options.language! : 'all';
    const batch = Math.max(0, Math.min(10_000, Math.floor(options.batch || 0)));
    const vibe = composeVibe(scenario, mood, language);
    const excluded = new Set((options.excludeTrackIds || []).slice(-300));
    const skipped = (options.skipped || []).slice(-80), sessionLikes = (options.liked || []).slice(-40);
    const meta = new Map<string, { origin: Origin; rank: number; instrumental: boolean }>();
    const isInstrumental = (t: Track) => !!meta.get(t.id)?.instrumental || INSTRUMENTAL_TEXT.test(`${t.title} ${t.release?.title || ''} ${t.genre || ''}`);
    const inLanguage = (t: Track) => language === 'instrumental' ? isInstrumental(t) : matchesMetadataLanguage(t, language, RUSSIAN_ARTISTS);
    const parse = (items: { trackData: string }[]): Track[] => items.flatMap(item => {
      try { const t = JSON.parse(item.trackData); return t?.artist?.name && t?.title ? [t as Track] : []; } catch { return []; }
    });
    const [likedRows, historyRows, playlistRows] = await Promise.all([
      prisma.likedTrack.findMany({ where: { userId }, orderBy: { addedAt: 'desc' }, take: 5000 }),
      prisma.historyItem.findMany({ where: { userId }, orderBy: { playedAt: 'desc' }, take: 400 }),
      prisma.playlistTrack.findMany({ where: { playlist: { userId } }, orderBy: { addedAt: 'desc' }, take: 5000 }),
    ]);
    const likes = parse(likedRows), history = parse(historyRows), library = parse(playlistRows);
    const recentCutoff = Date.now() - 6 * 60 * 60_000;
    const recent = new Set(historyRows.flatMap((row, i) => i < 40 || row.playedAt.getTime() > recentCutoff ? parse([row]).map(trackIdentity) : []));
    const heard = new Set(history.map(trackIdentity));
    const liked = new Set([...likes.map(trackIdentity), ...sessionLikes.map(s => looseIdentity(s.artist, s.title || ''))]);

    /* ---------- taste: artist affinity from likes, library, history, feedback ---------- */
    const affinity = new Map<string, { name: string; weight: number }>();
    const addAffinity = (artistName: string, weight: number) => {
      for (const a of splitArtists(artistName).slice(0, 2)) {
        const prev = affinity.get(a.key);
        affinity.set(a.key, { name: prev?.name || a.name, weight: (prev?.weight || 0) + weight });
      }
    };
    likes.forEach((t, i) => addAffinity(t.artist.name, 5 * (1 + Math.exp(-i / 20))));
    library.forEach(t => addAffinity(t.artist.name, 2));
    history.forEach((t, i) => addAffinity(t.artist.name, Math.exp(-i / 35)));
    sessionLikes.forEach(s => addAffinity(s.artist, 12));
    const sessionLikedArtists = new Set(sessionLikes.flatMap(s => splitArtists(s.artist).map(a => a.key)));
    const skipArtist = new Map<string, number>(), skipReason = new Map<string, number>();
    const skippedIds = new Set<string>(), skippedLoose = new Set<string>();
    skipped.forEach((s, i) => {
      // The newest skips speak loudest: they describe this session.
      const w = i >= skipped.length - 15 ? 1.5 : 1;
      skippedIds.add(s.id);
      if (s.title) skippedLoose.add(looseIdentity(s.artist, s.title));
      const primary = splitArtists(s.artist)[0];
      if (primary) skipArtist.set(primary.key, (skipArtist.get(primary.key) || 0) + w);
      if (s.reason) skipReason.set(s.reason, (skipReason.get(s.reason) || 0) + w);
    });
    skipArtist.forEach((count, key) => { const a = affinity.get(key); if (a) a.weight -= 3 * count; });
    const recentArtists = new Set((options.recentArtists || []).slice(-12).flatMap(name => splitArtists(name).map(a => a.key)));
    const favorites = [...affinity.entries()].filter(([, a]) => a.weight > 0).sort((a, b) => b[1].weight - a[1].weight);
    const languageArtists = new Set([...likes, ...history, ...library]
      .filter(t => matchesMetadataLanguage(t, language === 'instrumental' ? 'all' : language, RUSSIAN_ARTISTS))
      .flatMap(t => splitArtists(t.artist.name).map(a => a.key)));
    sessionLikedArtists.forEach(key => languageArtists.add(key));
    // Low-personal scenarios (sleep, meditation…) keep only the user's artists
    // whose curated shelf matches the requested energy.
    const fitsVibe = (key: string) => vibe.personal >= .5 || sessionLikedArtists.has(key) || (POOL_INDEX.get(key) || []).some(e =>
      e.mood === vibe.pool || (vibe.energy >= 0 && vibe.energy < .4 && (e.mood === 'calm' || e.mood === 'sad')) || (vibe.energy > .7 && (e.mood === 'energetic' || e.mood === 'fun')));
    const seedBase = character === 'favorite' ? 6 : character === 'familiar' ? 5 : character === 'popular' ? 3 : 2;
    // Enough distinct artists for a one-per-artist batch of `limit` tracks.
    const breadth = Math.max(1, Math.min(2.5, limit / 12));
    const seedCount = language === 'instrumental' ? 0 : Math.min(8, Math.max(vibe.personal >= .15 ? 1 : 0, Math.round(seedBase * vibe.personal * breadth)));
    const seedPool = favorites.filter(([key]) => (language === 'all' || languageArtists.has(key)) && fitsVibe(key) && (skipArtist.get(key) || 0) < 2 && !recentArtists.has(key)).slice(0, 14);
    const seeds = [...seedPool.filter(([key]) => sessionLikedArtists.has(key)), ...rotate(seedPool.filter(([key]) => !sessionLikedArtists.has(key)), batch * Math.max(1, seedCount))]
      .slice(0, seedCount).map(([, a]) => a.name);

    /* ---------- neighbours: curated shelves + SoundCloud related graph ---------- */
    const neighbours = new Map<string, { name: string; weight: number }>();
    const addNeighbour = (artistName: string, weight: number) => {
      const a = splitArtists(artistName)[0];
      if (!a || (affinity.get(a.key)?.weight || 0) >= 1.5 || (skipArtist.get(a.key) || 0) >= 2) return;
      const prev = neighbours.get(a.key);
      neighbours.set(a.key, { name: prev?.name || a.name, weight: (prev?.weight || 0) + weight });
    };
    favorites.slice(0, 8).forEach(([key, a], i) => {
      const w = (sessionLikedArtists.has(key) ? 3 : 1) * (1 - i / 10);
      poolNeighbours(key).forEach(name => addNeighbour(name, w));
    });
    const relatedSeeds: WaveSignal[] = [];
    const seenSeedArtists = new Set<string>();
    // Seeds walk the WHOLE collection (likes + every playlist), favourite artists first, a different slice each refill.
    const collection = [...likes, ...library];
    const byArtist = new Map<string, Track[]>();
    for (const t of collection) { const k = splitArtists(t.artist.name)[0]?.key; if (k) byArtist.set(k, [...(byArtist.get(k) || []), t]); }
    const collectionSeeds = rotate([...byArtist.entries()].sort((a, b) => (affinity.get(b[0])?.weight || 0) - (affinity.get(a[0])?.weight || 0)), batch * 3)
      .map(([, list]) => list[(batch + list.length) % list.length]).map(t => ({ id: t.id, artist: t.artist.name, title: t.title }));
    for (const seed of [...[...sessionLikes].reverse(), ...collectionSeeds, ...history.slice(0, 12).map(t => ({ id: t.id, artist: t.artist.name, title: t.title }))]) {
      const key = splitArtists(seed.artist)[0]?.key;
      if (!key || seenSeedArtists.has(key) || (skipArtist.get(key) || 0) >= 2) continue;
      if (language !== 'all' && language !== 'instrumental' && !languageArtists.has(key)) continue;
      if (!fitsVibe(key)) continue;
      seenSeedArtists.add(key); relatedSeeds.push(seed);
      if (relatedSeeds.length >= (character === 'discovery' ? 5 : character === 'favorite' ? 3 : 4)) break;
    }
    for (const seed of relatedSeeds) {
      // Deezer's related artists of each seed are the closest "similar" signal we have.
      deezerGraph.get(normalizeMusicText(splitArtists(seed.artist)[0]?.name || seed.artist))?.related.forEach((name, i) => addNeighbour(name, (sessionLikedArtists.has(splitArtists(seed.artist)[0]?.key || '') ? 3 : 1.6) * (1 - i / 16)));
      const cached = neighbourCache.get(looseIdentity(seed.artist, seed.title || seed.id));
      cached?.tracks.forEach(t => { if (!UPLOADER_NOISE.test(t.artist.name)) addNeighbour(t.artist.name, sessionLikedArtists.has(splitArtists(seed.artist)[0]?.key || '') ? 2.5 : 1.2); });
    }

    /* ---------- candidate sources ---------- */
    const candidates: Track[] = [];
    const take = (tracks: Track[], origin: Origin, reason: string, instrumental = false) => tracks.forEach((t, rank) => {
      if (meta.has(t.id)) return;
      meta.set(t.id, { origin, rank, instrumental });
      candidates.push({ ...t, recommendationReason: origin === 'fallback' && t.recommendationReason ? t.recommendationReason : reason });
    });
    const page = 1 + (batch % 3);
    const catalogArtist = (name: string) => musicCatalogService.search(name, { limit: 10 }).then(r => r.tracks.filter(t => matchesArtistSeed(t, name)));
    // The genre filter is Spotify syntax. The Deezer fallback matches words in
    // titles («New Age» songs), so it gets the scenario's descriptive queries
    // instead, and bare genre-word titles are dropped.
    const catalogGenre = async (genre: string, index: number) => {
      // Spotify's genre filter, answered from its database cache while Spotify itself is paused.
      const r = await spotifyService.search(`genre:"${genre}"`, { limit: 10, page }).catch(() => null);
      if (r) return r.tracks;
      // Descriptive searches outside Spotify surface playlist uploads; only sleep may use them.
      if (!vibe.uploads || !vibe.queries.length) return [];
      const fallback = vibe.queries[(index + batch) % vibe.queries.length];
      return (await musicCatalogService.search(fallback, { limit: 10 })).tracks
        .filter(t => !vibe.genres.some(g => normalizeMusicText(t.title).replace(/\s*\(.*$/, '') === normalizeMusicText(g)));
    };
    const poolMoodLists = language === 'ru' ? [ARTIST_POOLS.ru[vibe.pool]] : language === 'foreign' ? [ARTIST_POOLS.foreign[vibe.pool]] : [ARTIST_POOLS.ru[vibe.pool], ARTIST_POOLS.foreign[vibe.pool]];
    const poolNames = poolMoodLists.flatMap(p => character === 'discovery' ? p.discovery : p.popular)
      .filter(name => { const key = normalizeMusicText(name); return !recentArtists.has(key) && (skipArtist.get(key) || 0) < 2 && !seeds.some(s => normalizeMusicText(s) === key); });
    // The generic curated shelves only pad a thin collection; a real library speaks for itself.
    const poolCount = language === 'instrumental' ? 0 : Math.round((character === 'favorite' ? 2 : 4) * (1 - vibe.instrumental * .75) * breadth * (byArtist.size >= 25 ? .25 : byArtist.size >= 10 ? .6 : 1)) + (favorites.length < 6 && vibe.strength < 1 ? 3 : 0);
    const neighbourCount = language === 'instrumental' ? 0 : Math.round((character === 'discovery' ? 4 : character === 'popular' || character === 'familiar' ? 3 : 2) * (.25 + .75 * vibe.personal) * breadth);
    const neighbourNames = [...neighbours.entries()].filter(([key]) => fitsVibe(key) && !recentArtists.has(key))
      .sort((a, b) => b[1].weight - a[1].weight).slice(0, 10).map(([, n]) => n);
    const genreCount = vibe.strength >= .6 ? 3 : vibe.genres.length ? 1 : 0;
    const queryCount = vibe.uploads && vibe.strength >= .6 ? 2 : 0;
    // The scenario's own artists: concrete catalogue tracks rather than descriptive-query uploads.
    const curatedCount = vibe.artists.length ? Math.round((character === 'favorite' ? 3 : character === 'discovery' ? 6 : 5) * breadth) : 0;
    const vibeInstrumental = vibe.instrumental >= .6;
    const tasks: { run: () => Promise<Track[]>; origin: Origin; reason: string; instrumental?: boolean }[] = [];
    if (character === 'favorite') {
      tasks.push({ run: async () => shuffleArray([...likes, ...library]).slice(0, 60), origin: 'liked', reason: 'Из ваших любимых' });
    }
    seeds.forEach(name => tasks.push({ run: () => catalogArtist(name), origin: 'familiar', reason: sessionLikedArtists.has(normalizeMusicText(name)) ? `Вам понравился ${name}` : `Потому что вы слушаете ${name}` }));
    relatedSeeds.forEach(seed => tasks.push({ run: () => this.relatedFor(seed), origin: 'neighbour', reason: `Похоже на «${seed.title || seed.artist}»` }));
    rotate(neighbourNames, batch * neighbourCount).slice(0, neighbourCount).forEach(n => tasks.push({ run: () => catalogArtist(n.name), origin: 'neighbour', reason: `Рядом с вашими артистами · ${n.name}` }));
    shuffleArray(vibe.genres).slice(0, genreCount).forEach((genre, index) => tasks.push({ run: () => catalogGenre(genre, index), origin: 'vibe', reason: vibe.reason || 'Под настроение', instrumental: vibeInstrumental || INSTRUMENTAL_GENRES.includes(genre) }));
    shuffleArray(vibe.queries).slice(0, queryCount).forEach(q => tasks.push({ run: () => soundCloudService.search(q, { limit: 12, type: 'tracks' }).then(r => r.tracks), origin: 'vibe', reason: vibe.reason || 'Под настроение', instrumental: vibeInstrumental || /instrumental|lo-?fi|piano|ambient|meditation/i.test(q) }));
    rotate(shuffleArray(vibe.artists), batch * curatedCount).slice(0, curatedCount).forEach(name => tasks.push({ run: () => catalogArtist(name), origin: 'vibe', reason: vibe.reason ? `${vibe.reason} · ${name}` : name, instrumental: vibeInstrumental }));
    shuffleArray(poolNames).slice(0, vibe.artists.length && vibe.strength >= 1 ? Math.round(poolCount / 2) : poolCount).forEach(name => tasks.push({ run: () => catalogArtist(name), origin: 'pool', reason: character === 'discovery' ? `Новые грани · ${name}` : vibe.reason ? `${vibe.reason} · ${name}` : `Популярное · ${name}` }));
    const results = await Promise.all(tasks.map(task => withTimeout(task.run(), 6500, [] as Track[])));
    results.forEach((tracks, i) => take(tracks, tasks[i].origin, tasks[i].reason, tasks[i].instrumental));
    // A scenario wave must not silently degrade into the user's usual taste when
    // a provider throttles: one more pass of plain scenario queries.
    if (vibe.strength >= 1 && (vibe.artists.length || vibe.queries.length) && candidates.filter(t => meta.get(t.id)?.origin === 'vibe').length < limit / 2) {
      const retry = vibe.artists.length ? rotate(vibe.artists, batch * curatedCount + curatedCount).slice(0, 3).map(name => catalogArtist(name)) : vibe.uploads ? rotate(vibe.queries, batch + 1).slice(0, 2).map(q => musicCatalogService.search(q, { limit: 10, page }).then(r => r.tracks)) : [];
      const extra = await Promise.all(retry.map(run => withTimeout(run, 6500, [] as Track[])));
      extra.forEach(tracks => take(tracks, 'vibe', vibe.reason || 'Под настроение', vibeInstrumental));
    }

    const explicitOk = (t: Track) => vibe.explicit || !t.explicit;
    const eligible = (t: Track) => !excluded.has(t.id) && !skippedIds.has(t.id) && !skippedLoose.has(looseIdentity(t.artist.name, t.title))
      && t.duration >= 45 && t.access === 'playable' && inLanguage(t) && explicitOk(t)
      && (skipArtist.get(splitArtists(t.artist.name)[0]?.key || '') || 0) < 3
      // Channel-style uploads («Lofi Fruits», «10 hours rain») only belong in a sleep wave; the user's own saved tracks always pass.
      && (vibe.uploads || meta.get(t.id)?.origin === 'liked' || meta.get(t.id)?.origin === 'fallback' || !isJunkUpload(t))
      // Sleep and deep-focus waves keep the user's usual (vocal, upbeat) favourites out unless they fit.
      && (vibe.strength < 1 || vibe.personal > .25 || meta.get(t.id)?.origin === 'vibe' || isInstrumental(t));
    // Provider outages must not turn an existing library into an empty screen.
    if (candidates.filter(eligible).length < limit) take([...library, ...likes, ...history], 'fallback', 'Из вашей коллекции');

    /* ---------- scoring ---------- */
    const bucketOf = (t: Track, keys: string[]): Bucket => {
      if (keys.some(k => (affinity.get(k)?.weight || 0) >= 1.5)) return 'familiar';
      if (keys.some(k => neighbours.has(k)) || meta.get(t.id)?.origin === 'neighbour') return 'neighbour';
      return 'fresh';
    };
    const scored = candidates.filter(eligible).map(t => {
      const m = meta.get(t.id)!, keys = splitArtists(t.artist.name).map(a => a.key), identity = trackIdentity(t);
      const known = Math.max(0, ...keys.map(k => affinity.get(k)?.weight || 0));
      const bucket = bucketOf(t, keys);
      const text = `${t.title} ${t.release?.title || ''} ${t.genre || ''}`;
      let score = Math.random() * 8;
      // Character: familiarity vs novelty.
      if (character === 'favorite') score += bucket === 'familiar' ? 40 + Math.min(30, known * 2) : bucket === 'neighbour' ? 15 : 0;
      else if (character === 'popular' || character === 'familiar') score += (bucket === 'familiar' ? Math.min(20, known) + (character === 'familiar' ? 18 : 0) : bucket === 'neighbour' ? 12 : 10) + Math.max(0, 10 - m.rank) * 2.5;
      else score += bucket === 'familiar' ? -10 : bucket === 'neighbour' ? 30 : 22;
      if (liked.has(identity) || liked.has(looseIdentity(t.artist.name, t.title))) score += character === 'favorite' ? 30 : character === 'discovery' ? -60 : -20;
      if (character !== 'favorite' && heard.has(identity)) score -= character === 'discovery' ? 40 : 15;
      if (recent.has(identity)) score -= 100;
      // Session feedback.
      if (keys.some(k => sessionLikedArtists.has(k))) score += 35;
      else if (bucket === 'neighbour' && sessionLikedArtists.size && m.origin === 'neighbour') score += 12;
      score -= 28 * Math.max(0, ...keys.map(k => skipArtist.get(k) || 0));
      score -= 10 * (skipReason.get(t.recommendationReason || '') || 0);
      if (keys.some(k => recentArtists.has(k))) score -= 30;
      // Scenario / mood fit.
      if (m.origin === 'vibe') score += 25 * vibe.strength;
      // Sleep / meditation waves lean on the scenario, not on the user's rap favourites.
      else if (vibe.strength >= 1 && m.origin !== 'liked') score -= (1 - vibe.personal) * 20;
      if (vibe.boost.some(r => r.test(text))) score += 18 * Math.max(.4, vibe.strength);
      if (vibe.avoid.some(r => r.test(text))) score -= 45;
      if (vibe.energy >= 0 && vibe.energy < .35 && HIGH_ENERGY.test(text)) score -= 40;
      if (vibe.energy > .75 && LOW_ENERGY.test(text)) score -= 30;
      if (vibe.instrumental >= .6) score += isInstrumental(t) ? 15 : (m.origin === 'vibe' ? 0 : -vibe.instrumental * 25);
      if (t.duration < vibe.minDuration) score -= 20;
      if (t.duration > vibe.maxDuration) score -= 15;
      // Catalogue quality.
      if (t.artworkUrl) score += 3;
      if (t.source === 'spotify') score += 25;
      else if (t.source === 'deezer' || t.source === 'licensed') score += 18;
      else if (t.source === 'soundcloud') score -= vibe.uploads ? 4 : bucket === 'familiar' ? 10 : 34;
      // «Фонк для тренировки» by «PhonkFit»: SEO uploads named after the search phrase.
      if (vibe.queries.some(q => normalizeMusicText(t.title).startsWith(normalizeMusicText(q)))) score -= 20;
      if (LOW_QUALITY.test(t.title) || (!vibe.boost.some(r => r.test('slowed sped up nightcore')) && /\b(slowed|sped ?up|nightcore)\b/i.test(t.title))) score -= 35;
      // Versions (remix/edit/rework) lose to the original unless the scenario asks for them.
      if (REMIX_TEXT.test(text) && !vibe.boost.some(r => r.test('remix'))) score -= 25;
      return { track: t, score, bucket, keys, identity };
    }).sort((a, b) => b.score - a.score || a.track.id.localeCompare(b.track.id));

    /* ---------- selection: character mix, artist cap, source balance ---------- */
    const mix = CHARACTER_MIX[character];
    const familiarShare = mix[0] * (.3 + .7 * vibe.personal) * (favorites.length ? 1 : 0);
    const target: Record<Bucket, number> = { familiar: Math.round(limit * familiarShare), neighbour: Math.round(limit * mix[1] * (.3 + .7 * vibe.personal)), fresh: 0 };
    target.fresh = Math.max(0, limit - target.familiar - target.neighbour);
    const picked: typeof scored = [];
    const seen = new Set<string>(), artistCounts = new Map<string, number>(), bucketCounts = new Map<Bucket, number>();
    let soundCloudCount = 0;
    const baseCap = character === 'favorite' ? 2 : 1, soundCloudCap = Math.max(1, Math.ceil(limit / 3));
    const titleKey = (t: Track) => normalizeMusicText(t.title.replace(/\s*[([].*$/, ''));
    const seenTitles = new Set<string>();
    const tryAdd = (s: typeof scored[number], cap: number, strict: boolean) => {
      if (seen.has(s.identity) || seen.has(s.track.id) || (strict && seenTitles.has(titleKey(s.track)))) return false;
      if (s.keys.some(k => (artistCounts.get(k) || 0) >= cap)) return false;
      if (strict && s.track.source === 'soundcloud' && soundCloudCount >= soundCloudCap) return false;
      picked.push(s); seen.add(s.identity); seen.add(s.track.id); seenTitles.add(titleKey(s.track));
      s.keys.forEach(k => artistCounts.set(k, (artistCounts.get(k) || 0) + 1));
      bucketCounts.set(s.bucket, (bucketCounts.get(s.bucket) || 0) + 1);
      if (s.track.source === 'soundcloud') soundCloudCount++;
      return true;
    };
    for (const bucket of ['familiar', 'neighbour', 'fresh'] as Bucket[]) {
      for (const s of scored) { if ((bucketCounts.get(bucket) || 0) >= target[bucket]) break; if (s.bucket === bucket) tryAdd(s, baseCap, true); }
    }
    // Diversity is a preference, not an artificial cap when the catalogue is
    // small or temporarily unavailable: relax step by step.
    // Never a wall of one artist: at most baseCap+2 per artist, unless the batch would otherwise stay half empty.
    for (const [cap, strict] of [[baseCap, true], [baseCap + 1, false], [baseCap + 2, false]] as [number, boolean][]) {
      for (const s of scored) { if (picked.length >= limit) break; tryAdd(s, cap, strict); }
    }
    if (picked.length < limit / 2) for (const s of scored) { if (picked.length >= limit) break; tryAdd(s, Infinity, false); }

    // Interleave buckets so the batch flows (no block of «familiar» then «fresh»),
    // opening with the strongest familiar/vibe track.
    const queues: Record<Bucket, typeof scored> = { familiar: [], neighbour: [], fresh: [] };
    picked.forEach(s => queues[s.bucket].push(s));
    const placed: Record<Bucket, number> = { familiar: 0, neighbour: 0, fresh: 0 };
    const ordered: Track[] = [];
    let lastArtist = '';
    while (ordered.length < picked.length) {
      const open = (Object.keys(queues) as Bucket[]).filter(b => queues[b].length);
      open.sort((a, b) => placed[a] / Math.max(1, queues[a].length + placed[a]) - placed[b] / Math.max(1, queues[b].length + placed[b]) || queues[b][0].score - queues[a][0].score);
      const bucket = open.find(b => queues[b][0].keys[0] !== lastArtist) || open[0];
      const next = queues[bucket].shift()!;
      placed[bucket]++; lastArtist = next.keys[0] || '';
      ordered.push(next.track);
    }
    logger.debug({ scenario, mood, character, language, batch, candidates: candidates.length, picked: ordered.length, mix: placed }, 'Wave batch composed');
    return ordered;
  }
}

export const recommendationService = new RecommendationService();
