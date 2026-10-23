"""Small JSON CLI adapter for the community tidalapi package.

Each listener connects their own TIDAL account (device login) and streams
with their own subscription. Quality is LOSSLESS: FLAC 16-bit / 44.1 kHz.
"""
import datetime
import json
import re
import sys
import unicodedata


def norm(value):
    value = unicodedata.normalize('NFKC', value or '').lower().replace('ё', 'е')
    value = re.sub(r'\((?:feat|ft|prod)[^)]*\)|\[(?:feat|ft|prod)[^\]]*\]', ' ', value)
    return re.sub(r'[^\w]+', ' ', value).strip()


def score(track, title, artist, duration):
    t, want = norm(track.name), norm(title)
    if not t or not want or (want not in t and t not in want):
        return -1
    names = [norm(a.name) for a in (track.artists or []) if getattr(a, 'name', None)]
    wanted = [a for a in re.split(r'\s*(?:,|&| feat\.? | ft\.? )\s*', norm(artist)) if a]
    if wanted and not any(w in n or n in w for w in wanted for n in names):
        return -1
    gap = abs((track.duration or 0) - duration) if duration else 0
    if duration and gap > 4:
        return -1
    return 100 - gap * 5 - (0 if t == want else 10)


def session_for(data):
    import tidalapi
    session = tidalapi.Session()
    expiry = datetime.datetime.fromtimestamp(data['expires'] / 1000) if data.get('expires') else None
    if not session.load_oauth_session('Bearer', data['access'], data.get('refresh'), expiry):
        raise ValueError('TIDAL: сессия недействительна, войдите заново')
    return session


def run(data):
    import requests
    import tidalapi
    action = data['action']
    config = tidalapi.Config()
    if action == 'code':
        r = requests.post('https://auth.tidal.com/v1/oauth2/device_authorization',
                          data={'client_id': config.client_id, 'scope': 'r_usr w_usr w_sub'}, timeout=15)
        r.raise_for_status()
        j = r.json()
        url = j.get('verificationUriComplete') or j.get('verificationUri')
        return {'deviceCode': j['deviceCode'], 'userCode': j['userCode'],
                'verificationUrl': url if url.startswith('http') else 'https://' + url,
                'expiresIn': j['expiresIn'], 'interval': j.get('interval', 2)}
    if action == 'poll':
        r = requests.post(config.api_oauth2_token, data={
            'client_id': config.client_id, 'client_secret': config.client_secret,
            'device_code': data['deviceCode'], 'scope': 'r_usr w_usr w_sub',
            'grant_type': 'urn:ietf:params:oauth:grant-type:device_code'}, timeout=15)
        j = r.json()
        if r.status_code == 400 and j.get('error') in ('authorization_pending', 'slow_down'):
            return {'pending': True}
        if not r.ok:
            raise ValueError(j.get('error_description') or 'TIDAL не подтвердил вход')
        return {'access': j['access_token'], 'refresh': j.get('refresh_token'),
                'expires': j.get('expires_in', 3600)}
    if action == 'resolve':
        session = session_for(data)
        candidates = []
        if data.get('isrc'):
            try:
                candidates = session.get_tracks_by_isrc(data['isrc']) or []
            except Exception:
                candidates = []
        if not candidates:
            found = session.search(f"{data['artist']} {data['title']}", models=[tidalapi.media.Track], limit=15)
            candidates = found.get('tracks') or []
        ranked = sorted(((score(t, data['title'], data['artist'], data.get('duration') or 0), t) for t in candidates),
                        key=lambda pair: pair[0], reverse=True)
        best = next((t for s, t in ranked if s >= 0 and getattr(t, 'available', True)), None)
        if best is None:
            return {'found': False}
        session.config.quality = tidalapi.Quality.high_lossless
        url = best.get_url()
        return {'found': True, 'streamUrl': url, 'tidalId': best.id, 'duration': best.duration,
                'quality': getattr(best, 'audio_quality', 'LOSSLESS'),
                'access': session.access_token,
                'expires': int(session.expiry_time.timestamp() * 1000) if session.expiry_time else None}
    raise ValueError('Unknown action')


if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin))
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as exc:  # reported to the server as a readable message
        print(json.dumps({'ok': False, 'error': str(exc) or exc.__class__.__name__}, ensure_ascii=False))
