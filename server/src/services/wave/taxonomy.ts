/* Резонанс v2: what a listener can ask for — the music's language, a subgenre and a mood inside that
   language, and a selection mode. Subgenres carry real catalogue anchors (artists, Deezer playlist
   queries, AnimeThemes for anime songs); moods are matched through themed Deezer playlists, because
   no available catalogue exposes audio features (Spotify's endpoint answers 403, Deezer's bpm is 0). */

export const WAVE_LANGS = ['ru', 'en', 'ja'] as const;
export type WaveLang = typeof WAVE_LANGS[number];
export type WaveMode = 'niche' | 'collection';

export interface SubgenreDef {
  id: string;
  ru: string;
  en: string;
  /** Well-known acts: anchors for the default selection. */
  popular: string[];
  /** Smaller acts of the same scene: anchors for «что-то нишевое». */
  niche: string[];
  /** Deezer playlist search phrase for this scene (combined with the mood phrase). */
  query: string;
  /** Anime opening/ending: tracks must be confirmed by AnimeThemes, never inferred from the artist. */
  anime?: 'OP' | 'ED';
}
/** `queries`: synonyms searched as Deezer playlist titles together with the scene phrase. */
export interface MoodDef { id: string; ru: string; en: string; queries: string[] }

const MOODS: Record<WaveLang, MoodDef[]> = {
  ru: [
    { id: 'calm', ru: 'Спокойное', en: 'Calm', queries: ['спокойный', 'чилл', 'расслабляющий'] },
    { id: 'energetic', ru: 'Энергичное', en: 'Energetic', queries: ['энергичный', 'драйв', 'бодрый'] },
    { id: 'melancholic', ru: 'Меланхоличное', en: 'Melancholic', queries: ['грустный', 'меланхолия', 'печальный'] },
    { id: 'bright', ru: 'Светлое', en: 'Bright', queries: ['светлый', 'позитив', 'весёлый'] },
    { id: 'atmospheric', ru: 'Атмосферное', en: 'Atmospheric', queries: ['атмосферный', 'мечтательный', 'ночной'] },
  ],
  en: [
    { id: 'calm', ru: 'Спокойное', en: 'Calm', queries: ['chill', 'calm', 'relax'] },
    { id: 'energetic', ru: 'Энергичное', en: 'Energetic', queries: ['energetic', 'upbeat', 'hype'] },
    { id: 'melancholic', ru: 'Меланхоличное', en: 'Melancholic', queries: ['sad', 'melancholic', 'heartbreak'] },
    { id: 'uplifting', ru: 'Воодушевляющее', en: 'Uplifting', queries: ['uplifting', 'happy', 'feel good'] },
    { id: 'atmospheric', ru: 'Атмосферное', en: 'Atmospheric', queries: ['atmospheric', 'dreamy', 'night'] },
  ],
  ja: [
    { id: 'calm', ru: 'Спокойное', en: 'Calm', queries: ['chill', 'calm', 'relax'] },
    { id: 'energetic', ru: 'Энергичное', en: 'Energetic', queries: ['energetic', 'upbeat', 'hype'] },
    { id: 'melancholic', ru: 'Меланхоличное', en: 'Melancholic', queries: ['sad', 'melancholic', 'heartbreak'] },
    { id: 'inspiring', ru: 'Вдохновляющее', en: 'Inspiring', queries: ['inspiring', 'motivation', 'happy'] },
    { id: 'atmospheric', ru: 'Атмосферное', en: 'Atmospheric', queries: ['atmospheric', 'dreamy', 'night'] },
  ],
};

const SUBGENRES: Record<WaveLang, SubgenreDef[]> = {
  ru: [
    { id: 'rock', ru: 'Русский рок', en: 'Russian rock', query: 'русский рок',
      popular: ['Кино', 'Сплин', 'Би-2', 'Земфира', 'Мумий Тролль', 'Король и Шут', 'Агата Кристи', 'ДДТ', 'Пикник', 'Nautilus Pompilius'],
      niche: ['Порнофильмы', 'Кис-кис', 'Lumen', 'Animal ДжаZ', 'Аффинаж', 'Мои ракеты вверх', 'Ssshhhiiittt!', 'Обе-Рек', 'Пасош', 'Наадя'] },
    { id: 'indie', ru: 'Инди и альтернатива', en: 'Indie & alternative', query: 'русское инди',
      popular: ['Дайте танк (!)', 'Сироткин', 'Молчат Дома', 'Хадн Дадн', 'Мальбэк', 'СБПЧ', 'Pompeya', 'Буерак', 'Shortparis', 'АИГЕЛ'],
      niche: ['Ploho', 'Электрофорез', 'Комсомольск', 'Дурной Вкус', 'Хмыров', 'Луна', 'Lucidvox', 'Ушко', 'Нервы', 'Утро'] },
    { id: 'pop', ru: 'Поп', en: 'Pop', query: 'русская поп музыка',
      popular: ['Zivert', 'Монеточка', 'Ёлка', 'NYUSHA', 'ANNA ASTI', 'Полина Гагарина', 'Jony', 'Мот', 'Клава Кока', 'Сергей Лазарев'],
      niche: ['Алёна Швец', 'polnalyubvi', 'Мона', 'ГРЕЧКА', 'Ваня Дмитриенко', 'Мэвл', 'Мари Краймбрери', 'Звонкий', 'Ника Жукова', 'Таня Меженцева'] },
    { id: 'hiphop', ru: 'Хип-хоп и рэп', en: 'Hip-hop & rap', query: 'русский рэп',
      popular: ['Oxxxymiron', 'Скриптонит', 'Баста', 'Miyagi & Andy Panda', 'MORGENSHTERN', 'Pharaoh', 'Big Baby Tape', 'Платина', 'OG Buda', 'Макс Корж'],
      niche: ['Kai Angel', '9mice', 'Pepel Nahudi', 'Хаски', 'Слава КПСС', 'Boulevard Depo', 'Хан Замай', 'Loqiemean', 'Lovv66', 'ЛСП'] },
    { id: 'electronic', ru: 'Электронная музыка', en: 'Electronic', query: 'русская электроника',
      popular: ['IC3PEAK', 'Little Big', 'Cream Soda', 'Tesla Boy', 'Mujuice', 'Хлеб', 'Пошлая Молли', 'Hensy', 'Мохито', 'Нейромонах Феофан'],
      niche: ['Kedr Livanskiy', 'Lapti', 'Moa Pillar', 'Pixelord', 'ГШ', 'Nikita Zabelin', 'Interchain', 'Inturist', 'Volkova', 'Sonic Death'] },
  ],
  en: [
    { id: 'indie', ru: 'Инди и альтернатива', en: 'Indie / alternative', query: 'indie alternative',
      popular: ['Arctic Monkeys', 'The Strokes', 'Tame Impala', 'Phoebe Bridgers', 'The Neighbourhood', 'Mitski', 'Vampire Weekend', 'Cigarettes After Sex', 'Beach House', 'Florence + The Machine'],
      niche: ['Alvvays', 'Big Thief', 'Snail Mail', 'Men I Trust', 'Wet Leg', 'Car Seat Headrest', 'Japanese Breakfast', 'Slowdive', 'Whitney', 'Black Country, New Road'] },
    { id: 'rock', ru: 'Рок', en: 'Rock', query: 'rock',
      popular: ['Nirvana', 'Radiohead', 'Foo Fighters', 'Red Hot Chili Peppers', 'Queens of the Stone Age', 'The Killers', 'Muse', 'Linkin Park', 'Pearl Jam', 'The White Stripes'],
      niche: ['IDLES', 'Fontaines D.C.', 'Turnstile', 'Viagra Boys', 'Shame', 'Wolf Alice', 'Royal Blood', 'The Murder Capital', 'Sprints', 'Gilla Band'] },
    { id: 'pop', ru: 'Поп', en: 'Pop', query: 'pop',
      popular: ['Taylor Swift', 'Dua Lipa', 'The Weeknd', 'Billie Eilish', 'Harry Styles', 'Olivia Rodrigo', 'Ariana Grande', 'Lady Gaga', 'Sabrina Carpenter', 'Chappell Roan'],
      niche: ['Carly Rae Jepsen', 'MUNA', 'Caroline Polachek', 'Remi Wolf', 'girl in red', 'Maggie Rogers', 'Holly Humberstone', 'Tove Lo', 'Jessie Ware', 'Rina Sawayama'] },
    { id: 'hiphop', ru: 'Хип-хоп и R&B', en: 'Hip-hop / R&B', query: 'hip hop r&b',
      popular: ['Kendrick Lamar', 'Drake', 'Travis Scott', 'Frank Ocean', 'SZA', 'Tyler, The Creator', 'J. Cole', 'Daniel Caesar', 'Brent Faiyaz', 'Kanye West'],
      niche: ['JPEGMAFIA', 'Earl Sweatshirt', 'MIKE', 'Saba', 'Smino', 'Mavi', 'Yaya Bey', 'Liv.e', 'redveil', 'Navy Blue'] },
    { id: 'electronic', ru: 'Электронная музыка', en: 'Electronic', query: 'electronic',
      popular: ['Daft Punk', 'Fred again..', 'Disclosure', 'ODESZA', 'Flume', 'Jamie xx', 'Justice', 'The Chemical Brothers', 'Aphex Twin', 'Bonobo'],
      niche: ['Four Tet', 'Floating Points', 'Bicep', 'Caribou', 'Jon Hopkins', 'Overmono', 'Kelly Lee Owens', 'Burial', 'Rival Consoles', 'Logic1000'] },
    { id: 'souljazz', ru: 'Соул и джаз', en: 'Soul / jazz', query: 'soul jazz',
      popular: ['Amy Winehouse', 'Norah Jones', 'Erykah Badu', "D'Angelo", 'Kamasi Washington', 'Leon Bridges', 'Gregory Porter', 'Michael Kiwanuka', 'Thundercat', 'Jorja Smith'],
      niche: ['Moonchild', 'Nubya Garcia', 'BADBADNOTGOOD', 'Cleo Sol', 'Alfa Mist', 'Yussef Dayes', 'Emma-Jean Thackray', 'Sault', 'Ezra Collective', 'Tom Misch'] },
  ],
  ja: [
    { id: 'anime-op', ru: 'Аниме-опенинги', en: 'Anime openings', query: 'anime opening', anime: 'OP', popular: [], niche: [] },
    { id: 'anime-ed', ru: 'Аниме-эндинги', en: 'Anime endings', query: 'anime ending', anime: 'ED', popular: [], niche: [] },
    { id: 'jrock', ru: 'J-rock', en: 'J-rock', query: 'j-rock',
      popular: ['ONE OK ROCK', 'RADWIMPS', 'King Gnu', 'ASIAN KUNG-FU GENERATION', 'BUMP OF CHICKEN', "L'Arc~en~Ciel", 'MAN WITH A MISSION', 'UVERworld', 'Mrs. GREEN APPLE', 'X JAPAN'],
      niche: ['tricot', 'toe', 'Hitsujibungaku', 'NUMBER GIRL', 'Ling tosite sigure', 'ZAZEN BOYS', 'MONO', 'Kinoko Teikoku', 'People In The Box', 'Boris'] },
    { id: 'jpop', ru: 'J-pop', en: 'J-pop', query: 'j-pop',
      popular: ['YOASOBI', 'Kenshi Yonezu', 'Aimyon', 'Official HIGE DANdism', 'Ado', 'Fujii Kaze', 'Vaundy', 'Yorushika', 'Eve', 'Utada Hikaru'],
      niche: ['KIRINJI', 'Lamp', 'Sheena Ringo', 'Haru Nemuri', 'Wednesday Campanella', 'ZUTOMAYO', 'Kaneko Ayano', 'cero', 'Lucky Kilimanjaro', 'Tempalay'] },
    { id: 'citypop', ru: 'Сити-поп', en: 'City pop', query: 'city pop',
      popular: ['Mariya Takeuchi', 'Tatsuro Yamashita', 'Anri', 'Miki Matsubara', 'Taeko Ohnuki', 'Tomoko Aran', 'Junko Yagami', 'Toshiki Kadomatsu', 'Hiroshi Sato', 'Momoko Kikuchi'],
      niche: ['Meiko Nakahara', 'Junko Ohashi', 'Hitomi Tohyama', 'Yurie Kokubu', 'Akiko Yano', 'Eri Ohno', 'Kingo Hamada', 'Masayoshi Takanaka', 'Yasuha', 'Hiromi Iwasaki'] },
    { id: 'jelectronic', ru: 'Японская электроника', en: 'Japanese electronic', query: 'japanese electronic',
      popular: ['Perfume', 'CAPSULE', 'Yellow Magic Orchestra', 'Cornelius', 'Nujabes', 'tofubeats', 'Shinichi Osawa', 'Ryuichi Sakamoto', 'TeddyLoid', 'DAOKO'],
      niche: ['Seiho', 'Ryoji Ikeda', 'Daisuke Tanabe', 'Foodman', 'Yosi Horikawa', 'Ametsub', 'Susumu Hirasawa', 'Kensuke Ushio', 'Hiroshi Yoshimura', 'Ken Ishii'] },
  ],
};

export const waveSubgenres = (lang: WaveLang) => SUBGENRES[lang];
export const waveMoods = (lang: WaveLang) => MOODS[lang];
export const subgenreOf = (lang: WaveLang, id?: string | null) => id ? SUBGENRES[lang].find(s => s.id === id) : undefined;
export const moodOf = (lang: WaveLang, id?: string | null) => id ? MOODS[lang].find(m => m.id === id) : undefined;
export const isWaveLang = (value: unknown): value is WaveLang => typeof value === 'string' && (WAVE_LANGS as readonly string[]).includes(value);

/* What the listener is doing — Yandex «Моя волна» calls these agents (rotor-activity-*: wake-up,
   work-background, workout, road-trip, fall-asleep). An activity reshapes the stream around the
   listener's own taste: themed playlists say which artists fit, energy says what to keep out.
   «Засыпаю» is the one strict filter: nothing outside calm, mostly instrumental music. */
export const WAVE_ACTIVITIES = ['wake', 'work', 'workout', 'road', 'sleep'] as const;
export type WaveActivity = typeof WAVE_ACTIVITIES[number];
export interface ActivityDef {
  id: WaveActivity; ru: string; en: string;
  /** Deezer playlist phrases per language; `any` is used for every language and «любой». */
  queries: { ru: string[]; en: string[]; any: string[] };
  /** -1 calm … +1 driving: tracks of the opposite energy are pushed out. */
  energy: number;
  /** 0…1: how strongly instrumental music is preferred. */
  instrumental: number;
  /** Only tracks by artists of the activity's playlists (or plainly instrumental) may play. */
  strict?: boolean;
  /** Share of the listener's own taste kept in the stream (0…1). */
  personal: number;
}
const ACTIVITIES: ActivityDef[] = [
  { id: 'wake', ru: 'Просыпаюсь', en: 'Waking up', energy: 0.3, instrumental: 0, personal: 0.7,
    queries: { ru: ['доброе утро', 'утренний плейлист'], en: ['good morning', 'morning vibes'], any: ['morning'] } },
  { id: 'work', ru: 'Работаю', en: 'Working', energy: -0.2, instrumental: 0.45, personal: 0.6,
    queries: { ru: ['музыка для работы', 'для учебы'], en: ['work focus', 'deep focus'], any: ['focus', 'lofi'] } },
  { id: 'workout', ru: 'Тренируюсь', en: 'Workout', energy: 0.9, instrumental: 0, personal: 0.6,
    queries: { ru: ['для тренировок', 'спортзал'], en: ['workout', 'gym'], any: ['workout', 'gym phonk'] } },
  { id: 'road', ru: 'В дороге', en: 'On the road', energy: 0.4, instrumental: 0, personal: 0.75,
    queries: { ru: ['в дорогу', 'в машину'], en: ['road trip', 'driving'], any: ['road trip'] } },
  { id: 'sleep', ru: 'Засыпаю', en: 'Falling asleep', energy: -0.9, instrumental: 0.8, personal: 0.25, strict: true,
    queries: { ru: ['для сна', 'спокойная музыка'], en: ['sleep', 'calm piano'], any: ['sleep', 'ambient sleep'] } },
];
export const activityOf = (id?: string | null) => id ? ACTIVITIES.find(a => a.id === id) : undefined;

/** Settings as the client sends them; unknown or foreign-language ids fall back to «без ограничения». */
export interface WaveRequestV2 { language: WaveLang | 'all'; subgenre: string | null; mood: string | null; mode: WaveMode | null; activity?: WaveActivity | null }
export function normalizeWaveRequest(input: Record<string, unknown>): WaveRequestV2 {
  const language = isWaveLang(input.language) ? input.language : 'all';
  const subgenre = language !== 'all' && subgenreOf(language, String(input.subgenre || '')) ? String(input.subgenre) : null;
  const mood = language !== 'all' && moodOf(language, String(input.mood || '')) ? String(input.mood) : null;
  const mode = input.mode === 'niche' || input.mode === 'collection' ? input.mode : null;
  const activity = activityOf(String(input.activity || ''))?.id ?? null;
  return { language, subgenre, mood, mode, activity };
}

/** The catalogue for the settings screen, so the client and the server never disagree on ids. */
export function waveOptionsCatalog() {
  return {
    ...Object.fromEntries(WAVE_LANGS.map(lang => [lang, {
      subgenres: SUBGENRES[lang].map(({ id, ru, en, anime }) => ({ id, ru, en, anime: !!anime })),
      moods: MOODS[lang].map(({ id, ru, en }) => ({ id, ru, en })),
    }])),
    activities: ACTIVITIES.map(({ id, ru, en }) => ({ id, ru, en })),
  };
}

/** Every anchored artist of a language: one of the signals for recognising a track's language. */
export const anchorArtists = (lang: WaveLang) => SUBGENRES[lang].flatMap(s => [...s.popular, ...s.niche]);
