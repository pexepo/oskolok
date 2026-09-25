export function formatDisplayTitle(title: string, artistName?: string): string {
  if (!title) return '';
  let clean = title.trim();

  // Strip common metadata tags in brackets: [Official Audio], (feat. ...), [Free DL], etc.
  clean = clean.replace(
    /\s*[([][^)\]]*(?:official(?:\s+(?:audio|video|music\s+video|visualizer|clip))?|prod\.?|produced\s+by|free\s+(?:dl|download)|out\s+now|original\s+mix|extended\s+mix|radio\s+edit|sped\s*up|slowed(?:\s*\+\s*reverb)?)[^)\]]*[)\]]/gi,
    ''
  ).trim();

  // If title starts with "Artist - Track" or "Artist : Track", strip the artist prefix
  if (artistName && artistName.trim()) {
    const cleanArtist = artistName.trim();
    const escaped = cleanArtist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const artistPrefixRegex = new RegExp(`^${escaped}\\s*[-—–:]\\s*`, 'i');
    if (artistPrefixRegex.test(clean)) {
      clean = clean.replace(artistPrefixRegex, '').trim();
    }
  }

  // Fallback: If title has pattern "Artist - Song", and the first part matches artist case-insensitively
  const dashMatch = clean.match(/^([^-—–:]+)\s*[-—–:]\s*(.+)$/);
  if (dashMatch && artistName) {
    if (dashMatch[1].trim().toLowerCase() === artistName.trim().toLowerCase()) {
      clean = dashMatch[2].trim();
    }
  }

  return clean || title;
}
