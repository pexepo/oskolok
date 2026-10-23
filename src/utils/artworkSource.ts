/** Known catalog CDNs can be served through our origin when a network blocks them. */
export const ARTWORK_HOSTS = ['i.scdn.co','image-cdn-ak.spotifycdn.com','image-cdn-fa.spotifycdn.com','images.genius.com','t2.genius.com','cdn-images.dzcdn.net','e-cdns-images.dzcdn.net','i1.sndcdn.com','i.ytimg.com','is1-ssl.mzstatic.com','is2-ssl.mzstatic.com','is3-ssl.mzstatic.com','is4-ssl.mzstatic.com','is5-ssl.mzstatic.com','avatars.yandex.net','avatars.mds.yandex.net','resources.tidal.com'];
export function artworkSource(source: string): string {
  try {
    const url=new URL(source);
    if(url.protocol==='https:'&&ARTWORK_HOSTS.includes(url.hostname)&&!url.username&&!url.password&&!url.port)
      return `/api/artwork?url=${encodeURIComponent(url.href)}`;
  } catch { /* Local assets and data URLs retain their original address. */ }
  return source;
}

/** The same cover at roughly `px` pixels: a 48-px row thumbnail shouldn't pull a 1000×1000 file through the proxy. Unknown CDNs keep the original. */
export function sizedArtwork(source: string, px: number): string {
  if (!px || !source) return source;
  try {
    const url = new URL(source);
    const host = url.hostname;
    if (/(^|\.)dzcdn\.net$/.test(host)) {
      const size = px <= 120 ? 120 : px <= 250 ? 250 : px <= 500 ? 500 : 1000;
      url.pathname = url.pathname.replace(/\/\d+x\d+-(\d{6}-\d+-\d+-\d+\.(?:jpg|png))$/, `/${size}x${size}-$1`);
    } else if (host === 'i.scdn.co') {
      // Album covers: 64 / 300 / 640. Artist photos: 160 / 320 / 640.
      url.pathname = url.pathname
        .replace(/\/ab67616d0000(?:b273|1e02|4851)/, px <= 64 ? '/ab67616d00004851' : px <= 300 ? '/ab67616d00001e02' : '/ab67616d0000b273')
        .replace(/\/ab676161(?:0000e5eb|00005174|0000f178)/, px <= 160 ? '/ab6761610000f178' : px <= 320 ? '/ab67616100005174' : '/ab6761610000e5eb');
    } else if (host === 'i1.sndcdn.com') {
      url.pathname = url.pathname.replace(/-(?:t500x500|t300x300|large|crop|original)\.(jpg|png)$/, `-${px <= 100 ? 'large' : px <= 300 ? 't300x300' : 't500x500'}.$1`);
    } else if (/^is\d-ssl\.mzstatic\.com$/.test(host)) {
      const size = px <= 160 ? 160 : px <= 300 ? 300 : px <= 600 ? 600 : 1000;
      url.pathname = url.pathname.replace(/\/\d+x\d+(bb|cc)?\.(jpg|png|webp)$/, `/${size}x${size}$1.$2`);
    } else return source;
    return url.href;
  } catch { return source; }
}
