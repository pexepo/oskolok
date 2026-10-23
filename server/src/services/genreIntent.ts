import { normalizeMusicText } from './trackRanking.js';

/** A query that names a genre («heavy metal», «фонк») wants that genre's defining artists,
 * not songs that happen to be titled with the genre word. */
export interface GenreIntent { id: string; artists: string[] }

const GENRES: Array<{ id: string; names: string[]; artists: string[] }> = [
  { id: 'heavy-metal', names: ['heavy metal', 'хеви метал', 'хэви метал', 'тяжелый метал', 'metal', 'метал', 'металл'], artists: ['Metallica', 'Iron Maiden', 'Black Sabbath', 'Judas Priest', 'Megadeth', 'Slayer', 'Motörhead', 'Dio', 'Ария'] },
  { id: 'thrash-metal', names: ['thrash metal', 'трэш метал'], artists: ['Metallica', 'Slayer', 'Megadeth', 'Anthrax', 'Testament', 'Kreator', 'Exodus'] },
  { id: 'nu-metal', names: ['nu metal', 'ню метал'], artists: ['Linkin Park', 'Korn', 'Slipknot', 'System of a Down', 'Limp Bizkit', 'Deftones', 'Papa Roach'] },
  { id: 'rock', names: ['rock', 'рок', 'classic rock', 'классический рок'], artists: ['Queen', 'Led Zeppelin', 'AC/DC', 'The Rolling Stones', 'Nirvana', 'Foo Fighters', 'Кино', 'Сплин'] },
  { id: 'russian-rock', names: ['русский рок', 'russian rock'], artists: ['Кино', 'Сплин', 'Би-2', 'Ария', 'Король и Шут', 'ДДТ', 'Наутилус Помпилиус', 'Земфира'] },
  { id: 'punk', names: ['punk', 'панк', 'punk rock', 'панк рок'], artists: ['The Ramones', 'Sex Pistols', 'The Clash', 'Green Day', 'The Offspring', 'Король и Шут', 'Гражданская оборона'] },
  { id: 'phonk', names: ['phonk', 'фонк', 'drift phonk', 'дрифт фонк'], artists: ['Kordhell', 'DVRST', 'INTERWORLD', 'PlayaPhonk', 'Ghostface Playa', 'MoonDeity', 'KSLV Noh'] },
  { id: 'hip-hop', names: ['hip hop', 'хип хоп', 'rap', 'рэп', 'реп'], artists: ['Kendrick Lamar', 'Eminem', 'Drake', 'Travis Scott', 'Kanye West', 'Oxxxymiron', 'Скриптонит', 'Kizaru'] },
  { id: 'russian-rap', names: ['русский рэп', 'russian rap'], artists: ['Oxxxymiron', 'Скриптонит', 'MORGENSHTERN', 'Miyagi & Andy Panda', 'Баста', 'Кровосток', 'Kizaru', 'Слава КПСС'] },
  { id: 'trap', names: ['trap', 'трэп', 'треп'], artists: ['Travis Scott', 'Future', 'Young Thug', 'Playboi Carti', 'Lil Uzi Vert', 'OG Buda', 'Kizaru'] },
  { id: 'jazz', names: ['jazz', 'джаз'], artists: ['Miles Davis', 'John Coltrane', 'Bill Evans', 'Chet Baker', 'Louis Armstrong', 'Ella Fitzgerald', 'Dave Brubeck'] },
  { id: 'blues', names: ['blues', 'блюз'], artists: ['B.B. King', 'Muddy Waters', 'John Lee Hooker', 'Stevie Ray Vaughan', 'Gary Moore', "Howlin' Wolf"] },
  { id: 'techno', names: ['techno', 'техно'], artists: ['Charlotte de Witte', 'Amelie Lens', 'Adam Beyer', 'Jeff Mills', 'Richie Hawtin', 'Boris Brejcha'] },
  { id: 'house', names: ['house', 'хаус', 'deep house', 'дип хаус'], artists: ['Daft Punk', 'Fisher', 'Disclosure', 'Frankie Knuckles', 'Duke Dumont', 'Purple Disco Machine'] },
  { id: 'drum-and-bass', names: ['drum and bass', 'drum n bass', 'dnb', 'днб', 'драм н бейс'], artists: ['Pendulum', 'Noisia', 'Netsky', 'Sub Focus', 'Chase & Status', 'Andy C', 'Wilkinson'] },
  { id: 'dubstep', names: ['dubstep', 'дабстеп'], artists: ['Skrillex', 'Excision', 'Zeds Dead', 'Flux Pavilion', 'Rusko', 'Virtual Riot'] },
  { id: 'synthwave', names: ['synthwave', 'синтвейв', 'retrowave', 'ретровейв', 'outrun'], artists: ['The Midnight', 'Kavinsky', 'FM-84', 'Gunship', 'Perturbator', 'Carpenter Brut', 'Timecop1983'] },
  { id: 'post-punk', names: ['post punk', 'пост панк', 'постпанк'], artists: ['Joy Division', 'Молчат Дома', 'Interpol', 'The Cure', 'Siouxsie and the Banshees', 'Ploho', 'Буерак'] },
  { id: 'pop', names: ['pop', 'поп'], artists: ['Taylor Swift', 'Dua Lipa', 'The Weeknd', 'Billie Eilish', 'Harry Styles', 'Ariana Grande', 'Zivert'] },
  { id: 'k-pop', names: ['k pop', 'kpop', 'кей поп', 'к поп'], artists: ['BTS', 'BLACKPINK', 'Stray Kids', 'TWICE', 'NewJeans', 'SEVENTEEN', 'aespa'] },
  { id: 'indie', names: ['indie', 'инди', 'indie rock', 'инди рок'], artists: ['Arctic Monkeys', 'The Strokes', 'Tame Impala', 'Radiohead', 'Vampire Weekend', 'Pompeya', 'Дайте танк (!)'] },
  { id: 'classical', names: ['classical', 'классика', 'классическая музыка'], artists: ['Ludwig van Beethoven', 'Wolfgang Amadeus Mozart', 'Johann Sebastian Bach', 'Frédéric Chopin', 'Pyotr Ilyich Tchaikovsky', 'Antonio Vivaldi'] },
  { id: 'ambient', names: ['ambient', 'эмбиент'], artists: ['Brian Eno', 'Aphex Twin', 'Stars of the Lid', 'Boards of Canada', 'Hammock', 'Harold Budd'] },
  { id: 'lo-fi', names: ['lofi', 'lo fi', 'лофай', 'лоу фай'], artists: ['Nujabes', 'J Dilla', 'Jinsang', 'idealism', 'Tomppabeats', 'potsu', 'eevee'] },
  { id: 'reggae', names: ['reggae', 'регги'], artists: ['Bob Marley & The Wailers', 'Peter Tosh', 'Jimmy Cliff', 'Damian Marley', 'Toots & The Maytals'] },
  { id: 'soul', names: ['soul', 'соул', 'funk', 'фанк'], artists: ['Marvin Gaye', 'Aretha Franklin', 'Stevie Wonder', 'James Brown', 'Al Green', 'Earth, Wind & Fire'] },
  { id: 'shanson', names: ['шансон', 'chanson'], artists: ['Михаил Круг', 'Владимир Высоцкий', 'Бутырка', 'Сергей Наговицын', 'Александр Розенбаум'] },
];

const INDEX = new Map(GENRES.flatMap(genre => genre.names.map(name => [normalizeMusicText(name), genre] as const)));

/** Only an exact genre phrase (optionally with «music»/«музыка»/«songs») counts, so «metallica» or «metal gear» stay normal searches. */
export function detectGenre(query: string): GenreIntent | null {
  const q = normalizeMusicText(query).replace(/(^|\s)(music|songs|музыка|песни|треки|playlist|плейлист)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  const genre = INDEX.get(q);
  return genre ? { id: genre.id, artists: genre.artists } : null;
}
