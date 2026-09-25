import {
  Track,
  Artist,
  Playlist,
  TrackAccess,
  SoundCloudTrackDTO,
  SoundCloudArtistDTO,
  SoundCloudPlaylistDTO,
} from '../types/index.js';

export class SoundCloudMapper {
  public static mapArtworkUrl(url?: string): string | undefined {
    if (!url) return undefined;
    // SoundCloud artwork default is usually -large.jpg (100x100), convert to -t500x500.jpg for high res
    return url.replace('-large.', '-t500x500.');
  }

  public static cleanArtistName(raw: string): string {
    if (!raw) return 'Unknown Artist';
    return raw
      .replace(/[☆★✦✧✪✰•]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Intelligently extracts the authentic artist name and song title,
   * bypassing random re-uploader usernames (e.g. "Monday.on.the.Moon", "w3st", "RuRap").
   */
  public static extractRealArtistAndTitle(
    rawTitle: string,
    rawUploaderName: string
  ): { title: string; artistName: string } {
    let title = (rawTitle || '').trim();
    let uploader = this.cleanArtistName(rawUploaderName);

    // 1. Strip common video/promo/packaging tags
    const PROMO_TAGS =
      /\s*[([][^)\]]*(?:official(?:\s+(?:audio|video|clip|music\s+video))?|lyrics|lyric\s+video|visualizer|clip|видеоклип|клип|премьера|prod\.?|produced\s+by|free\s+(?:dl|download)|out\s+now|remastered)[^)\]]*[)\]]/gi;
    title = title.replace(PROMO_TAGS, '').replace(/\s{2,}/g, ' ').trim();

    // 2. Check for "Artist - Title" (or "Artist – Title", "Artist — Title", "Artist | Title")
    const separatorMatch = title.match(/^(.*?)\s+[-—–|]\s+(.*)$/);

    if (separatorMatch) {
      const candidateArtist = separatorMatch[1].trim();
      const candidateTitle = separatorMatch[2].trim();

      // Ensure candidateArtist isn't just a generic word or number
      if (candidateArtist.length > 1 && candidateTitle.length > 0 && !/^(track|song|vol\.?|cd)\b/i.test(candidateArtist)) {
        return {
          title: candidateTitle,
          artistName: candidateArtist,
        };
      }
    }

    // 3. If no separator, clean uploader username as artist name
    return {
      title: title || 'Untitled Track',
      artistName: uploader || 'Unknown Artist',
    };
  }

  public static mapArtist(dto: SoundCloudArtistDTO): Artist {
    const cleanedName = this.cleanArtistName(dto.username);
    return {
      id: `soundcloud:${dto.id}`,
      source: 'soundcloud',
      sourceId: String(dto.id),
      name: cleanedName,
      avatarUrl: this.mapArtworkUrl(dto.avatar_url),
      permalinkUrl: dto.permalink_url,
      description: dto.description,
      followersCount: dto.followers_count,
      trackCount: dto.track_count,
    };
  }

  public static mapTrack(dto: SoundCloudTrackDTO): Track {
    const rawUploader = dto.user?.username || 'Unknown Artist';
    const { title, artistName } = this.extractRealArtistAndTitle(dto.title, rawUploader);

    const artist: Artist = {
      id: dto.user ? `soundcloud:${dto.user.id}` : 'soundcloud:unknown',
      source: 'soundcloud',
      sourceId: dto.user ? String(dto.user.id) : 'unknown',
      name: artistName,
      avatarUrl: this.mapArtworkUrl(dto.user?.avatar_url),
      permalinkUrl: dto.user?.permalink_url,
      description: dto.user?.description,
      followersCount: dto.user?.followers_count,
      trackCount: dto.user?.track_count,
    };

    const access: TrackAccess = dto.policy === 'BLOCK' ? 'blocked'
      : dto.policy === 'SNIP' || (dto.media?.transcodings?.length && dto.media.transcodings.every(t => t.snipped)) ? 'preview'
      : dto.streamable === false ? 'unavailable' : 'playable';

    const durationInSeconds = Math.round((dto.duration || 0) / 1000);

    return {
      id: `soundcloud:${dto.id}`,
      source: 'soundcloud',
      sourceId: String(dto.id),
      title: title || dto.title || 'Untitled Track',
      artist,
      artworkUrl: this.mapArtworkUrl(dto.artwork_url || dto.user?.avatar_url),
      duration: durationInSeconds > 0 ? durationInSeconds : 180,
      trackUrl: dto.permalink_url,
      access,
      waveformUrl: dto.waveform_url,
      genre: dto.genre,
      createdAt: dto.created_at,
      downloadable: dto.downloadable ?? false,
    };
  }

  public static mapPlaylist(dto: SoundCloudPlaylistDTO): Playlist {
    const tracks = (dto.tracks || []).map((t, idx) => ({
      id: `sc-pl-item-${dto.id}-${t.id}`,
      playlistId: `soundcloud:${dto.id}`,
      trackId: `soundcloud:${t.id}`,
      position: idx,
      addedAt: dto.created_at || new Date().toISOString(),
      track: this.mapTrack(t),
    }));

    return {
      id: `soundcloud:${dto.id}`,
      userId: dto.user ? `soundcloud:${dto.user.id}` : 'soundcloud',
      title: dto.title || 'SoundCloud Playlist',
      description: dto.description,
      artworkUrl: this.mapArtworkUrl(dto.artwork_url),
      createdAt: dto.created_at || new Date().toISOString(),
      updatedAt: dto.updated_at || new Date().toISOString(),
      trackCount: dto.track_count || tracks.length,
      tracks,
    };
  }
}
