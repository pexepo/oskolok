import math
import sys
import json
import re
import unicodedata
import os
import concurrent.futures
import threading
import urllib.parse
import yt_dlp

# Force UTF-8 on stdin, stdout, and stderr
if hasattr(sys.stdin, 'reconfigure'):
    sys.stdin.reconfigure(encoding='utf-8')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

ydl_opts = {
    'format': 'ba[ext=m4a]/bestaudio/best',
    'quiet': True,
    'skip_download': True,
    'extract_flat': False,
    'noplaylist': True,
    'no_warnings': True,
    'ignoreerrors': True,
    # Some macOS Python installations do not expose the system CA bundle to
    # yt-dlp. Keep the resolver usable locally; remote URLs are still fetched
    # by the app through the normal HTTPS client afterwards.
    'nocheckcertificate': True,
    'js_runtimes': {'node': {'path': 'node'}},
}

if os.environ.get('FFMPEG_PATH'):
    ydl_opts['ffmpeg_location'] = os.environ['FFMPEG_PATH']

flat_opts = {
    'quiet': True,
    'skip_download': True,
    'extract_flat': True,
    'noplaylist': True,
    'no_warnings': True,
    'ignoreerrors': True,
    'nocheckcertificate': True,
}

tls = threading.local()

def get_ydl():
    if not hasattr(tls, 'ydl'):
        tls.ydl = yt_dlp.YoutubeDL(ydl_opts)
    return tls.ydl

def get_flat_ydl():
    if not hasattr(tls, 'ydl_flat'):
        tls.ydl_flat = yt_dlp.YoutubeDL(flat_opts)
    return tls.ydl_flat

print_lock = threading.Lock()

def safe_print(data):
    with print_lock:
        print(json.dumps(data, ensure_ascii=False), flush=True)

def normalize(text):
    if not text:
        return ''
    text = text.lower()
    text = re.sub(r'[^\w\s]', '', text)
    return re.sub(r'\s+', ' ', text).strip()

TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}

def skeleton(word):
    s = ''.join(TRANSLIT.get(c, c) for c in word)
    s = re.sub(r'(?:kh|x)', 'h', s)
    s = re.sub(r'(?:ck|q|c)', 'k', s)
    s = s.replace('ph', 'f')
    s = re.sub(r'(?:dzh|dj|j)', 'g', s)
    s = s.replace('w', 'v')
    s = re.sub(r'(?:iy|yi|ii)', 'i', s)
    s = re.sub(r'[yj]', 'i', s)
    return re.sub(r'(.)\1+', r'\1', s)

def fold(text):
    """Script-independent form ("Slava KPSS" == "Слава КПСС"). Mirrors foldName() in searchQuery.ts."""
    # Letters NFKD keeps whole ("Pharaøh", "Łódź", "Straße").
    text = (text or '').translate(str.maketrans({'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'ß': 'ss', 'ł': 'l', 'Ł': 'L', 'đ': 'd', 'Đ': 'D', 'œ': 'oe', 'Œ': 'OE'}))
    words = normalize(unicodedata.normalize('NFKD', text)).replace('_', ' ')
    words = ''.join(c for c in words if not unicodedata.combining(c))
    return ' '.join(skeleton(w) for w in words.split())

def levenshtein(a, b, limit):
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        row = [i]
        for j in range(1, len(b) + 1):
            row.append(min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        if min(row) > limit:
            return limit + 1
        prev = row
    return prev[-1]

def names_match(artist, channel):
    a, c = fold(artist).replace(' ', ''), fold(channel).replace(' ', '')
    if not a or not c:
        return False
    if a in c or (len(c) >= 4 and c in a):
        return True
    if len(a) >= 6 and levenshtein(a, c[:len(a) + 1], 2) <= (2 if len(a) >= 10 else 1):
        return True
    # Vowels drift most between spellings ("Boulevard Depo" / "Бульвар Депо").
    consonants = lambda x: re.sub(r'(.)\1+', r'\1', re.sub(r'[aeiouy]', '', x))
    ca = consonants(a)
    return len(ca) >= 5 and ca in consonants(c)

def yt_query(q):
    """YouTube reads a word starting with "-" as an exclusion: "Android Girl -Hello ver.-" would hide the very
    upload it looks for. Leading dashes go; the words stay."""
    return re.sub(r'(^|\s)[-\u2013\u2014]+(?=\S)', r'\1', q or '')

VERSION_TAG = re.compile(r'[(\[]([^)\]]+)[)\]]|(?<!\S)-(\S[^-]*?\S)-(?!\S)')
def version_tags(title):
    """Edition marks a release carries in brackets or between dashes ("-Hello ver.-", "(Reloaded)", "(Extended Mix)"):
    an upload without them is another recording of the song. Credits, remasters and "Original Mix" are not editions."""
    tags = [fold(a or b) for a, b in VERSION_TAG.findall(title or '')]
    return [t for t in tags if t and not re.search(r'^(feat|ft|prod|with|from|explicit|clean|original|bonus)\b|remaster|\bmono\b|\bstereo\b|^\d{4}$', t)]

NON_LATIN_TITLE = re.compile(r'[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]')

def has_version(text, version):
    words = lambda s: re.sub(r"[^\w]+", " ", s.lower()).strip()
    return f" {words(version)} " in f" {words(text)} "

def is_pitched(dur_sec, target_dur):
    """A copy more than 1.5% shorter (sped up / pitched up) or 4% longer (slowed) than the release."""
    if not target_dur or target_dur <= 60 or not dur_sec:
        return False
    return (target_dur - dur_sec) / target_dur > 0.015 or (dur_sec - target_dur) / target_dur > 0.04

def reissue_of(info):
    """Auto-generated uploads read "℗ 2026 Label … Released on: 2022-10-21". When the label swaps the audio of an
    older song for a re-release (the 2026 Russian re-releases mute lines), the ℗ year moves past the release year."""
    desc = (info or {}).get('description') or ''
    if 'Provided to YouTube' not in desc:
        return None
    p = re.search(r'℗\s*(\d{4})', desc)
    released = re.search(r'Released on:\s*(\d{4})-(\d{2})-(\d{2})', desc)
    if not p or not released:
        return None
    p_year, r_year = int(p.group(1)), int(released.group(1))
    if p_year >= 2025 and p_year > r_year:
        return {'pYear': p_year, 'released': '-'.join(released.groups())}
    return None

def find_original(req_id, req):
    """The pre-reissue recording: confirm the re-release on the auto-generated upload, then take the most-watched
    exact-length copy uploaded before the re-release went out."""
    clean_title = req.get('cleanTitle', '')
    clean_artist = req.get('cleanArtist', '')
    target_dur = req.get('targetDuration', 0) or 0
    cutoff_hint = (req.get('cutoff') or '').replace('-', '')
    title_fold = fold(clean_title)
    title_tokens = [t for t in title_fold.split(' ') if len(t) >= 2]
    if not title_tokens:
        safe_print({'id': req_id, 'success': False, 'error': 'No title'})
        return
    modifiers = ['cover', 'кавер', 'karaoke', 'караоке', 'nightcore', 'sped up', 'speed up', 'slowed', 'reverb', 'bass boost',
                 '8d', 'remix', 'ремикс', 'mashup', 'live', 'instrumental', 'минус', 'ремейк', 'remake', 'reaction', 'реакция',
                 'clean', 'censored', 'цензур', 'без мата', 'radio edit', 'tiktok', 'mix', 'full album', 'альбом', 'mixtape']
    entries, seen = [], set()
    def search(q):
        try:
            # Each thread keeps its own YoutubeDL instance (see get_flat_ydl).
            return (get_flat_ydl().extract_info(f'ytsearch12:{yt_query(q)}', download=False) or {}).get('entries') or []
        except Exception:
            return []
    queries = [f'{clean_artist} - {clean_title}', f'{clean_artist} {clean_title}', f'{clean_title} {clean_artist}']
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for batch in pool.map(search, queries):
            for e in batch:
                if e and e.get('id') and e['id'] not in seen:
                    seen.add(e['id'])
                    entries.append(e)
    def title_ok(t):
        folded = fold(t)
        return title_fold in folded or sum(1 for tok in title_tokens if tok in folded) / len(title_tokens) >= 0.8
    # 1. The auto-generated upload of the song itself tells whether it was re-released.
    official = [e for e in entries if fold(e.get('title') or '') == title_fold and names_match(clean_artist, (e.get('channel') or e.get('uploader') or '').replace(' - Topic', ''))
                and (not target_dur or abs((e.get('duration') or 0) - target_dur) <= 3)]
    official.sort(key=lambda e: e.get('view_count') or 0, reverse=True)
    reissue = None
    def full(vid):
        try:
            return get_ydl().extract_info(f'https://www.youtube.com/watch?v={vid}', download=False)
        except Exception:
            return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for info in pool.map(full, [e['id'] for e in official[:2]]):
            reissue = reissue or reissue_of(info)
            if reissue and not target_dur:
                target_dur = (info or {}).get('duration') or 0
    ydl = get_ydl()
    if not reissue:
        safe_print({'id': req_id, 'success': True, 'reissue': None})
        return
    cutoff = f"{reissue['pYear']}0101"
    if cutoff_hint and cutoff_hint > cutoff:
        cutoff = cutoff_hint
    official_ids = {e['id'] for e in official}
    # 2. Copies of the original: same title and artist, exact length, no edits, uploaded before the re-release.
    fans = []
    for e in entries:
        t = e.get('title') or ''
        channel = e.get('channel') or e.get('uploader') or ''
        dur = e.get('duration') or 0
        if e['id'] in official_ids or channel.endswith('- Topic') or not title_ok(t):
            continue
        if not (names_match(clean_artist, t) or names_match(clean_artist, channel)):
            continue
        if any(has_version(t.lower(), m) and not has_version(clean_title.lower(), m) for m in modifiers):
            continue
        if not dur or not target_dur or abs(dur - target_dur) > 3:
            continue
        fans.append(e)
    fans.sort(key=lambda e: e.get('view_count') or 0, reverse=True)
    for e in fans[:6]:
        try:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={e['id']}", download=False)
        except Exception:
            continue
        uploaded = (info or {}).get('upload_date') or ''
        if info and info.get('url') and uploaded and uploaded < cutoff:
            safe_print({'id': req_id, 'success': True, 'reissue': reissue, 'cutoff': cutoff, 'candidate': {
                'streamUrl': info['url'], 'duration': info.get('duration') or dur, 'title': info.get('title') or e.get('title'),
                'channel': info.get('channel') or info.get('uploader') or '', 'uploadDate': uploaded}})
            return
    safe_print({'id': req_id, 'success': True, 'reissue': reissue, 'cutoff': cutoff, 'candidate': None})

def ytmusic_song(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, alt_artists=(), album=''):
    """Also asks with the album: a generic title («Ouvertüre») is buried under other works without it."""
    song = ytmusic_song_query(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, alt_artists, '')
    if not song and album and fold(album) != fold(clean_title):
        song = ytmusic_song_query(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, alt_artists, album)
    return song

def ytmusic_song_query(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, alt_artists, album):
    """YouTube Music's song search lists the label's "Artist - Topic" audio even when the video search is empty or full of re-uploads."""
    try:
        q = yt_query(f'{clean_artist} {clean_title} {album}'.strip())
        if not hasattr(tls, 'ydl_music'):
            tls.ydl_music = yt_dlp.YoutubeDL({**flat_opts, 'playlistend': 8})
        info = tls.ydl_music.extract_info('https://music.youtube.com/search?q=' + urllib.parse.quote(q) + '#songs', download=False)
    except Exception:
        return None
    title_fold = fold(clean_title)
    tokens = [t for t in title_fold.split(' ') if len(t) >= 2]
    picked = []
    for entry in (info or {}).get('entries') or []:
        if not entry or not entry.get('id'):
            continue
        cand = fold(entry.get('title') or '')
        # Titles come back transliterated ("Polozheni" for «Положение»): allow a near spelling.
        close = len(title_fold) >= 6 and levenshtein(title_fold.replace(' ', ''), cand.replace(' ', '')[:len(title_fold) + 1], 2) <= 2
        if not cand or not (title_fold in cand or close or (tokens and all(t in cand for t in tokens))):
            continue
        if any(has_version((entry.get('title') or '').lower(), kw) and kw not in allowed_keywords for kw in modifier_keywords):
            continue
        if any(t not in cand for t in version_tags(clean_title)):
            continue
        picked.append(entry['id'])
        if len(picked) >= 3:
            break
    ydl = get_ydl()
    for vid in picked:
        try:
            full = ydl.extract_info(f'https://www.youtube.com/watch?v={vid}', download=False)
        except Exception:
            continue
        if not full or not full.get('url'):
            continue
        channel = full.get('channel') or full.get('uploader') or ''
        artists = ' '.join(full.get('artists') or [full.get('artist') or ''])
        if clean_artist and not any(names_match(a, channel) or names_match(a, artists) or (channel.endswith('- Topic') and names_match(a, channel[:-8])) for a in (clean_artist, *alt_artists)):
            continue
        dur = full.get('duration') or 0
        # The label's own song under the exact title may be a different master a few seconds off (199 s on YouTube,
        # 210 s on Deezer): up to 6% is still that song. Anything else keeps the strict check.
        exact_title = fold(full.get('track') or full.get('title') or '').startswith(title_fold)
        lenient = exact_title and dur and abs(dur - target_dur) <= max(8, target_dur * 0.06)
        if target_dur > 30 and dur and not lenient and (abs(dur - target_dur) > 8 or is_pitched(dur, target_dur)):
            continue
        result = {'streamUrl': full['url'], 'duration': dur or target_dur, 'title': full.get('track') or full.get('title') or clean_title, 'channel': channel or clean_artist, 'score': 1000}
        reissue = reissue_of(full)
        if reissue:
            result['reissue'] = reissue
        return result
    return None

def topic_upload(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, entries=None):
    """A song released today is often missing from both searches for hours, yet already first in the artist's
    "Artist - Topic" uploads playlist (UU + channel id). Find the Topic channel, then read that playlist."""
    try:
        channel_id = None
        for entry in (entries or []):
            ch = (entry or {}).get('channel') or (entry or {}).get('uploader') or ''
            if ch.endswith('- Topic') and names_match(clean_artist, ch[:-8]) and (entry.get('channel_id') or '').startswith('UC'):
                channel_id = entry['channel_id']
                break
        if not channel_id:
            info = get_flat_ydl().extract_info(f'ytsearch8:{clean_artist} topic', download=False)
            for entry in (info or {}).get('entries') or []:
                ch = (entry or {}).get('channel') or ''
                if ch.endswith('- Topic') and names_match(clean_artist, ch[:-8]) and (entry.get('channel_id') or '').startswith('UC'):
                    channel_id = entry['channel_id']
                    break
        if not channel_id:
            return None
        if not hasattr(tls, 'ydl_uploads'):
            tls.ydl_uploads = yt_dlp.YoutubeDL({**flat_opts, 'playlistend': 60})
        uploads = tls.ydl_uploads.extract_info('https://www.youtube.com/playlist?list=UU' + channel_id[2:], download=False)
    except Exception:
        return None
    title_fold = fold(clean_title)
    for entry in (uploads or {}).get('entries') or []:
        if not entry or not entry.get('id'):
            continue
        cand = fold(entry.get('title') or '')
        if cand != title_fold and not (len(title_fold) >= 6 and levenshtein(title_fold, cand, 2) <= 1):
            continue
        if any(has_version((entry.get('title') or '').lower(), kw) and kw not in allowed_keywords for kw in modifier_keywords):
            continue
        dur = entry.get('duration') or 0
        if target_dur > 30 and dur and abs(dur - target_dur) > 3:
            continue
        try:
            full = get_ydl().extract_info(f"https://www.youtube.com/watch?v={entry['id']}", download=False)
        except Exception:
            continue
        if full and full.get('url'):
            return {'streamUrl': full['url'], 'duration': full.get('duration') or dur or target_dur, 'title': full.get('title') or clean_title, 'channel': full.get('channel') or clean_artist, 'score': 1100}
    return None

def handle_request(req):
    req_id = req.get('id')
    action = req.get('action', 'resolve')

    if action == 'original':
        try:
            find_original(req_id, req)
        except Exception as e:
            safe_print({'id': req_id, 'success': False, 'error': str(e)})
        return

    if action == 'ping':
        safe_print({'id': req_id, 'status': 'pong'})
        return

    if action == 'resolve_url':
        url = req.get('url')
        try:
            ydl = get_ydl()
            info = ydl.extract_info(url, download=False)
            if info and info.get('url'):
                safe_print({
                    'id': req_id,
                    'success': True,
                    'candidate': {
                        'streamUrl': info.get('url'),
                        'duration': info.get('duration') or 0,
                        'title': info.get('title') or '',
                        'channel': info.get('channel') or info.get('uploader') or '',
                    }
                })
            else:
                safe_print({'id': req_id, 'success': False, 'error': 'No stream URL found'})
        except Exception as e:
            safe_print({'id': req_id, 'success': False, 'error': str(e)})
        return

    if action == 'search':
        q = req.get('query')
        limit = req.get('limit', 10)
        try:
            ydl_flat = get_flat_ydl()
            info = ydl_flat.extract_info(f'ytsearch{limit}:{q}', download=False)
            entries = info.get('entries', []) if info else []
            items = []
            for e in entries:
                if not e or not e.get('id'):
                    continue
                vid_id = e.get('id')
                title = e.get('title') or ''
                uploader = e.get('uploader') or e.get('channel') or 'Official Artist'
                dur = e.get('duration') or 0
                thumb = f'https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg'
                items.append({
                    'id': vid_id,
                    'title': title,
                    'uploader': uploader,
                    'duration': int(dur),
                    'thumbnail': thumb,
                })
            safe_print({'id': req_id, 'success': True, 'items': items})
        except Exception as e:
            safe_print({'id': req_id, 'success': False, 'error': str(e), 'items': []})
        return


    try:
        query = req.get('query')
        clean_title = req.get('cleanTitle', '')
        clean_artist = req.get('cleanArtist', '')
        target_dur = req.get('targetDuration', 0)
        alt_artists = [a for a in (req.get('altArtists') or []) if isinstance(a, str) and a.strip()][:4]
        any_artist = lambda name: any(names_match(a, name) for a in (clean_artist, *alt_artists))
        tags = version_tags(clean_title)

        # 1. High-speed flat search (fetches up to 6 metadata candidates in ~1.5s)
        search_query = query
        if not search_query.startswith('ytsearch'):
            search_query = f'ytsearch6:{yt_query(query or (clean_artist + " - " + clean_title))}'
        elif search_query.startswith('ytsearch2:'):
            search_query = 'ytsearch6:' + yt_query(search_query[10:])

        ydl_flat = get_flat_ydl()
        info = ydl_flat.extract_info(search_query, download=False)
        if not info:
            safe_print({'id': req_id, 'success': False, 'error': 'No info returned from search'})
            return

        entries = info.get('entries') if 'entries' in info else [info]
        norm_title = normalize(clean_title)
        title_tokens = [t for t in fold(clean_title).split(' ') if len(t) >= 2]
        norm_artist = normalize(clean_artist)
        artist_compact = norm_artist.replace(' ', '')

        target_combined = f"{clean_title} {clean_artist}".lower()
        modifier_keywords = [
            'cover', 'кавер', 'karaoke', 'караоке', 'nightcore', 'sped up', 'slowed', 'reverb',
            'bass boost', '8d audio', 'tribute', 'remix', 'ремикс', 'speed up', 'mashup', 'live', 'instrumental', 'минус', 'ремейк', 'remake'
        ]
        allowed_keywords = {kw for kw in modifier_keywords if has_version(target_combined, kw)}

        # Censored re-releases: never pick them over the original unless asked for.
        censored_keywords = ['clean', 'censored', 'radio edit', 'radio version', 'цензур', 'без мата', 'bleeped', 'edited']
        allowed_censored = any(has_version(target_combined, kw) for kw in censored_keywords)

        promo_keywords = [
            'trailer', 'teaser', 'трейлер', 'тизер', 'реклама', 'cm', 'pv', 'promo', 'промо',
            'commercial', 'announcement', 'анонс', 'превью', 'ノンクレジット'
        ]

        candidates = []
        for entry in (entries or []):
            if not entry or not entry.get('id'):
                continue

            vid_id = entry.get('id')
            cand_title = entry.get('title') or ''
            cand_channel = entry.get('channel') or entry.get('uploader') or ''
            dur_sec = entry.get('duration') or 0

            norm_cand_title = normalize(cand_title)
            cand_title_lower = cand_title.lower()

            # Compare folded so a Cyrillic channel matches a Latin catalogue name.
            artist_channel = any_artist(cand_channel)
            topic_channel = cand_channel.lower().endswith('- topic')
            if artist_compact and not (artist_channel or (topic_channel and any_artist(cand_channel[:-8]))):
                continue

            # Resilient title matching
            score = 200
            if norm_title:
                folded_cand = fold(cand_title)
                matches_count = sum(1 for t in title_tokens if t in folded_cand)
                ratio = matches_count / max(1, len(title_tokens))
                has_match = (fold(clean_title) in folded_cand) or (ratio >= 0.4) or (len(title_tokens) <= 2 and matches_count >= 1)
                if has_match and any(t not in folded_cand for t in tags):
                    continue
                if has_match:
                    score += int(ratio * 150)
                # The artist's own channel titles the song in Japanese or Korean («おねがい！ナニトゾタノムちゃん»)
                # while the catalogue has it romanised: the same length to the second is the match.
                elif not (artist_channel and target_dur > 30 and dur_sec and abs(dur_sec - target_dur) <= 1 and NON_LATIN_TITLE.search(cand_title)):
                    continue

            # Penalize unwanted modifiers if not explicitly part of title or artist
            unwanted_mods = [kw for kw in modifier_keywords if has_version(cand_title_lower, kw) and kw not in allowed_keywords]
            if unwanted_mods:
                continue

            # Heavily penalize anime commercials, trailers, CM and promo clips (which contain speech and ads)
            for pkw in promo_keywords:
                if has_version(cand_title_lower, pkw) and not has_version(target_combined, pkw):
                    score -= 1500
                    break

            dur_diff = abs(dur_sec - target_dur) if target_dur > 0 and dur_sec > 0 else 0
            if target_dur > 30 and dur_sec > 0 and dur_diff > 8:
                continue
            # Sped-up / pitched re-uploads keep the title but run a few percent short.
            if is_pitched(dur_sec, target_dur):
                continue

            if dur_diff <= 3:
                score += 350
            elif dur_diff <= 8:
                score += 200
            elif dur_diff <= 20:
                score += 80
            else:
                score -= dur_diff * 4

            if cand_channel.endswith('- Topic'):
                score += 450
            if '(audio)' in cand_title_lower or '[audio]' in cand_title_lower:
                score += 300
            elif 'official audio' in cand_title_lower:
                score += 350
            elif 'provided to youtube' in cand_title_lower:
                score += 400
            elif 'official lyric' in cand_title_lower or 'lyrics' in cand_title_lower:
                score += 150
            if 'official music video' in cand_title_lower or 'official video' in cand_title_lower:
                score += 100

            if norm_artist and (artist_channel or names_match(clean_artist, cand_title)):
                score += 150

            if not allowed_censored and any(has_version(cand_title_lower, kw) for kw in censored_keywords):
                score -= 900

            # Labels re-upload censored editions under the identical title, duration and channel
            # (e.g. Russian 2026 re-releases). The original is the long-standing upload with the audience,
            # so popularity breaks the tie: ~+220 at 300k views vs ~+70 for a fresh 50-view re-upload.
            views = entry.get('view_count') or 0
            score += int(min(260, 40 * math.log10(views + 1)))

            candidates.append({
                'id': vid_id,
                'title': cand_title,
                'channel': cand_channel,
                'duration': dur_sec,
                'score': score
            })

        candidates.sort(key=lambda x: x['score'], reverse=True)

        # Synced lyrics follow the release to the second: a video with a few seconds of intro makes every line
        # early or late. Copies within 3 s of the release beat any looser match; without one, the label's
        # YouTube Music upload is tried before settling for a longer or shorter video.
        if target_dur > 30:
            exact = [c for c in candidates if c['duration'] and abs(c['duration'] - target_dur) <= 3]
            if exact:
                candidates = exact
            elif req.get('music', True):
                song = ytmusic_song(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, alt_artists, req.get('album') or '')
                if song and abs((song.get('duration') or target_dur) - target_dur) <= 3:
                    safe_print({'id': req_id, 'success': True, 'candidate': song})
                    return

        if not candidates:
            song = ytmusic_song(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, alt_artists, req.get('album') or '') if req.get('music', True) else None
            if not song and req.get('music', True):
                song = topic_upload(clean_title, clean_artist, target_dur, allowed_keywords, modifier_keywords, entries)
            if song:
                safe_print({'id': req_id, 'success': True, 'candidate': song})
            else:
                safe_print({'id': req_id, 'success': False, 'error': 'No matching candidate'})
            return

        # 2. Targeted stream URL extraction for top candidates
        ydl_stream = get_ydl()
        resolved_candidate = None

        for cand in candidates[:4]:
            vid_id = cand['id']
            try:
                stream_info = ydl_stream.extract_info(f'https://www.youtube.com/watch?v={vid_id}', download=False)
                if stream_info and stream_info.get('url'):
                    resolved_candidate = {
                        'streamUrl': stream_info['url'],
                        'duration': cand['duration'] or stream_info.get('duration') or target_dur,
                        'title': cand['title'] or stream_info.get('title') or clean_title,
                        'channel': cand['channel'] or stream_info.get('channel') or clean_artist,
                        'score': cand['score']
                    }
                    reissue = reissue_of(stream_info)
                    if reissue:
                        resolved_candidate['reissue'] = reissue
                    break
            except Exception as extract_err:
                continue

        if resolved_candidate:
            safe_print({'id': req_id, 'success': True, 'candidate': resolved_candidate})
        else:
            safe_print({'id': req_id, 'success': False, 'error': 'Failed to extract stream for candidates'})
    except Exception as e:
        safe_print({'id': req_id, 'success': False, 'error': str(e)})

# Announce ready state to Node.js parent process
safe_print({'status': 'READY'})

executor = concurrent.futures.ThreadPoolExecutor(max_workers=8)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    try:
        req = json.loads(line)
        executor.submit(handle_request, req)
    except Exception as e:
        safe_print({'id': None, 'success': False, 'error': str(e)})
