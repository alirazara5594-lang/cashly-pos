import { api } from '../services/api';

/**
 * Where to load an item's photo from. Photos the server keeps (AI-made or uploaded) come back as
 * "/media/…", which is on the API server, not on this page's own address — the till, the waiter
 * tablet and the QR menu are served from elsewhere. A link to another site is used as it is.
 */
export function mediaUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (!url.startsWith('/media/')) return url;
  const base = (api.defaults.baseURL || '').replace(/\/+$/, '');
  return `${base}${url}`;
}

/** Whether an item is waiting for its AI photo. */
export const isMakingPhoto = (p: { photoStatus?: string | null }) =>
  p.photoStatus === 'pending' || p.photoStatus === 'making';

/**
 * Shrinks a photo in the browser before it is uploaded: at most 1280 px on its longer side, as a
 * JPEG. A phone photo of 4–8 MB becomes 150–300 KB, which uploads fast on a shop's connection and
 * loads fast on the till.
 */
export async function shrinkPhoto(file: File, maxSide = 1280): Promise<Blob> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo this browser can open.')); };
    img.src = url;
  });
  const scale = Math.min(1, maxSide / Math.max(source.naturalWidth, source.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot prepare the photo.');
  // White behind a transparent PNG, which a JPEG cannot keep.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('This browser cannot prepare the photo.'))), 'image/jpeg', 0.85));
}
