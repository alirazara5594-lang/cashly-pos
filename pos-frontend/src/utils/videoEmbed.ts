/**
 * How a demo video link plays inside Cashly: in its provider's own player (YouTube, Vimeo, Google
 * Drive, Loom), or as a plain video file (.mp4, .webm) — including the app's own, under
 * /demo-videos, each with a still of the same name (.jpg). Anything else cannot be played here.
 */
export type VideoSource =
  | { kind: 'embed'; provider: string; src: string; thumbnail?: string }
  | { kind: 'file'; provider: string; src: string; thumbnail?: string };

const VIDEO_FILE = /\.(mp4|webm|ogg|m4v|mov)$/i;

export function videoSource(url: string | null | undefined): VideoSource | null {
  if (!url?.trim()) return null;
  const link = url.trim();
  // A file the app serves itself.
  if (link.startsWith('/') && !link.startsWith('//')) {
    if (!VIDEO_FILE.test(link)) return null;
    return {
      kind: 'file', provider: 'Cashly', src: link,
      thumbnail: link.startsWith('/demo-videos/') ? link.replace(VIDEO_FILE, '.jpg') : undefined
    };
  }
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^(www|m)\./, '');

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = host === 'youtu.be'
      ? u.pathname.split('/')[1]
      : u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
    if (!id || !/^[\w-]{11}$/.test(id)) return null;
    return {
      kind: 'embed', provider: 'YouTube',
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1`,
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.match(/\/(\d{6,})/)?.[1];
    return id ? { kind: 'embed', provider: 'Vimeo', src: `https://player.vimeo.com/video/${id}?autoplay=1` } : null;
  }
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get('id');
    return id ? { kind: 'embed', provider: 'Google Drive', src: `https://drive.google.com/file/d/${id}/preview` } : null;
  }
  if (host === 'loom.com') {
    const id = u.pathname.match(/\/(?:share|embed)\/(\w+)/)?.[1];
    return id ? { kind: 'embed', provider: 'Loom', src: `https://www.loom.com/embed/${id}?autoplay=1` } : null;
  }
  if (VIDEO_FILE.test(u.pathname)) return { kind: 'file', provider: 'a video file', src: u.toString() };
  return null;
}

/** Which links work, for the hint under the box. */
export const VIDEO_LINK_HELP = 'A YouTube (Unlisted is fine), Vimeo, Google Drive (shared: anyone with the link) or Loom link, or a direct .mp4 file.';
