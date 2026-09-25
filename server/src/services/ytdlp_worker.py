import sys
import json
import re
import os
import concurrent.futures
import threading
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

def has_version(text, version):
    words = lambda s: re.sub(r"[^\w]+", " ", s.lower()).strip()
    return f" {words(version)} " in f" {words(text)} "

def handle_request(req):
    req_id = req.get('id')
    action = req.get('action', 'resolve')

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

        # 1. High-speed flat search (fetches up to 6 metadata candidates in ~1.5s)
        search_query = query
        if not search_query.startswith('ytsearch'):
            search_query = f'ytsearch6:{clean_artist} - {clean_title}'
        elif search_query.startswith('ytsearch2:'):
            search_query = 'ytsearch6:' + search_query[10:]

        ydl_flat = get_flat_ydl()
        info = ydl_flat.extract_info(search_query, download=False)
        if not info:
            safe_print({'id': req_id, 'success': False, 'error': 'No info returned from search'})
            return

        entries = info.get('entries') if 'entries' in info else [info]
        norm_title = normalize(clean_title)
        title_tokens = [t for t in norm_title.split(' ') if len(t) >= 2]
        norm_artist = normalize(clean_artist)
        artist_compact = norm_artist.replace(' ', '')

        target_combined = f"{clean_title} {clean_artist}".lower()
        modifier_keywords = [
            'cover', 'кавер', 'karaoke', 'караоке', 'nightcore', 'sped up', 'slowed', 'reverb',
            'bass boost', '8d audio', 'tribute', 'remix', 'ремикс', 'speed up', 'mashup', 'live', 'instrumental', 'минус', 'ремейк', 'remake'
        ]
        allowed_keywords = {kw for kw in modifier_keywords if has_version(target_combined, kw)}

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

            channel_compact = normalize(cand_channel).replace(' ', '')
            official_channel = cand_channel.lower().endswith('- topic') or (artist_compact and artist_compact in channel_compact)
            if artist_compact and not official_channel:
                continue

            if norm_artist and norm_artist not in norm_cand_title and norm_artist not in normalize(cand_channel):
                continue

            # Resilient title matching
            score = 200
            if norm_title:
                matches_count = sum(1 for t in title_tokens if t in norm_cand_title)
                ratio = matches_count / max(1, len(title_tokens))
                has_match = (norm_title in norm_cand_title) or (ratio >= 0.4) or (len(title_tokens) <= 2 and matches_count >= 1)
                if has_match:
                    score += int(ratio * 150)
                else:
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

            if norm_artist and (norm_artist in norm_cand_title or norm_artist in normalize(cand_channel)):
                score += 150

            candidates.append({
                'id': vid_id,
                'title': cand_title,
                'channel': cand_channel,
                'duration': dur_sec,
                'score': score
            })

        candidates.sort(key=lambda x: x['score'], reverse=True)

        if not candidates:
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

executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    try:
        req = json.loads(line)
        executor.submit(handle_request, req)
    except Exception as e:
        safe_print({'id': None, 'success': False, 'error': str(e)})
