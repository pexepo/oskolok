/** Artist link that remembers the Deezer release it was opened from: it names which of several same-named artists is meant. */
export const artistPath = (id: string, releaseId?: string) =>
  `/artist/${encodeURIComponent(id)}${releaseId?.startsWith('deezer:album:') ? `?from=${releaseId.slice(13)}` : ''}`;
