"""Small JSON CLI adapter for the community yandex-music package."""
import json
import sys


def as_track(track):
    if track is None:
        return None
    artists = getattr(track, 'artists', None) or []
    return {
        'artist': ', '.join(a.name for a in artists if getattr(a, 'name', None)),
        'title': getattr(track, 'title', '') or '',
        'artworkUrl': track.get_cover_url('400x400') if getattr(track, 'cover_uri', None) else None,
    }


def run(data):
    from yandex_music import Client
    action = data['action']
    if action == 'code':
        code = Client().request_device_code(device_name='Осколок')
        return {'deviceCode': code.device_code, 'userCode': code.user_code,
                'verificationUrl': code.verification_url, 'expiresIn': code.expires_in,
                'interval': code.interval}
    if action == 'poll':
        token = Client().poll_device_token(data['deviceCode'])
        if token is None:
            return {'pending': True}
        return {'access': token.access_token, 'refresh': token.refresh_token,
                'expires': token.expires_in}
    client = Client(data['token']).init()
    if action == 'playlists':
        playlists = client.users_playlists_list() or []
        return [{'id': str(p.kind), 'title': p.title or 'Плейлист',
                 'count': p.track_count or 0,
                 'artworkUrl': p.cover.get_url('400x400') if p.cover else None}
                for p in playlists]
    if action == 'tracks':
        if data['id'] == 'liked':
            likes = client.users_likes_tracks()
            rows = likes.tracks if likes else []
        else:
            playlist = client.users_playlists(data['id'])
            rows = playlist.tracks or playlist.fetch_tracks() if playlist else []
        tracks = []
        for row in rows:
            try:
                t = getattr(row, 'track', None) or row.fetch_track()
                mapped = as_track(t)
                if mapped and mapped['artist'] and mapped['title']:
                    tracks.append(mapped)
            except Exception:
                continue
        return tracks
    raise ValueError('Unknown action')


if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin))
        print(json.dumps({'ok': True, 'data': result}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))
