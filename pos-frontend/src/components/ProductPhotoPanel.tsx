import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Upload, Link2, Trash2, RefreshCw, AlertTriangle } from 'lucide-react';
import { posApi, getApiErrorMessage } from '../services/api';
import { getEmoji } from '../utils/productEmoji';
import { isMakingPhoto, mediaUrl, shrinkPhoto } from '../utils/mediaUrl';
import type { Product } from '../types';

const PHOTO_TYPES = 'image/jpeg,image/png,image/webp';

/**
 * A small square of an item's photo for the catalogue lists: the photo, or the item's emoji, with a
 * spinner while AI makes one and a red mark when it could not.
 */
export const ProductThumb: React.FC<{ product: Product; categoryName?: string }> = ({ product, categoryName }) => {
  const making = isMakingPhoto(product);
  return (
    <div className="relative w-10 h-10 shrink-0 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 flex items-center justify-center"
      title={making ? 'Making a photo with AI…' : product.photoStatus === 'failed' ? product.photoError ?? 'No photo could be made' : undefined}>
      {product.imageUrl
        ? <img src={mediaUrl(product.imageUrl)} alt="" loading="lazy" className="w-full h-full object-cover" />
        : <span className="text-lg">{getEmoji(product.name, categoryName)}</span>}
      {making && (
        <span className="absolute inset-0 bg-white/60 flex items-center justify-center">
          <RefreshCw className="w-4 h-4 text-teal-600 animate-spin" />
        </span>
      )}
      {product.photoStatus === 'failed' && (
        <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white" />
      )}
    </div>
  );
};

interface PhotoPanelProps {
  /** The item being edited; null while adding a new one. */
  product: Product | null;
  /** The name typed so far, for the emoji and the hint. */
  name: string;
  categoryName?: string;
  aiAvailable: boolean;
  /** Adding: a photo of the owner's own to upload once the item is saved. */
  pendingFile: File | null;
  onPendingFile: (file: File | null) => void;
  /** Adding: a link to a photo elsewhere, sent with the new item. */
  link: string;
  onLink: (url: string) => void;
  /** Editing: a photo change was saved; the item as it is now. */
  onChanged: (product: Product) => void;
}

/**
 * The photo on the add / edit item window. Adding: leave it, and AI makes a realistic photo once the
 * item is saved — or choose your own, or paste a link. Editing: each button saves straight away,
 * because a photo is not part of the item's form (the server keeps it on its own).
 */
export const ProductPhotoPanel: React.FC<PhotoPanelProps> = ({
  product, name, categoryName, aiAvailable, pendingFile, onPendingFile, link, onLink, onChanged
}) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');

  // A local preview of the owner's chosen photo while adding, let go of when it changes.
  const preview = useMemo(() => (pendingFile ? URL.createObjectURL(pendingFile) : null), [pendingFile]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const adding = !product;
  const making = !!product && isMakingPhoto(product);
  const shown = product ? mediaUrl(product.imageUrl) ?? null : (preview ?? (link.trim() || null));

  const run = async (label: string, action: () => Promise<Product>) => {
    setBusy(label);
    setError(null);
    try {
      onChanged(await action());
      setLinkOpen(false);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not change the photo.'));
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (!PHOTO_TYPES.split(',').includes(file.type)) {
      setError('Use a JPEG, PNG or WebP photo.');
      return;
    }
    if (!product) {
      setError(null);
      onPendingFile(file);
      onLink('');
      return;
    }
    await run('upload', async () => posApi.uploadProductPhoto(product.id, await shrinkPhoto(file)));
  };

  const saveLink = async () => {
    const url = linkDraft.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setError('Paste a full link to the photo, starting with https://');
      return;
    }
    if (!product) {
      setError(null);
      onLink(url);
      onPendingFile(null);
      setLinkOpen(false);
      return;
    }
    await run('link', () => posApi.setProductPhotoLink(product.id, url));
  };

  const clear = () => {
    if (!product) {
      onPendingFile(null);
      onLink('');
      return;
    }
    run('remove', () => posApi.removeProductPhoto(product.id));
  };

  const badge = !product
    ? (pendingFile ? 'Your photo' : link.trim() ? 'Link' : null)
    : product.photoSource === 'ai' ? 'Made by AI' : product.photoSource === 'upload' ? 'Your photo' : product.imageUrl ? 'Link' : null;

  const hint = !product
    ? (pendingFile || link.trim()
        ? 'This photo is used when you save.'
        : aiAvailable
          ? 'Leave it to AI: a realistic photo is made from the name when you save. It takes about 20 seconds.'
          : 'Add your own photo, or leave it blank to show an emoji.')
    : making
      ? 'AI is making a photo from the name. It appears here when ready.'
      : product.photoStatus === 'failed'
        ? null
        : product.imageUrl
          ? 'Shown on the till, the QR menu and online orders.'
          : 'No photo: the till shows an emoji.';

  const btn = 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex gap-4 p-3 rounded-xl border border-slate-200 bg-slate-50/60">
      <div className="relative w-28 h-28 shrink-0 rounded-xl overflow-hidden bg-white border border-slate-200 flex items-center justify-center">
        {shown
          ? <img src={shown} alt={name || 'Item photo'} className="w-full h-full object-cover" />
          : adding && aiAvailable
            ? <div className="flex flex-col items-center gap-1 text-teal-600"><Sparkles className="w-6 h-6" /><span className="text-[10px] font-semibold">AI photo</span></div>
            : <span className="text-4xl">{getEmoji(name || 'item', categoryName)}</span>}
        {(making || busy === 'upload') && (
          <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center gap-1 text-teal-700">
            <RefreshCw className="w-5 h-5 animate-spin" />
            <span className="text-[10px] font-semibold">{busy === 'upload' ? 'Uploading…' : 'Making photo…'}</span>
          </div>
        )}
        {badge && !making && (
          <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-white/90 border border-slate-200 text-[9px] font-semibold text-slate-600">{badge}</span>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Photo</div>
        {hint && <p className="text-[11px] text-slate-500 leading-relaxed">{hint}</p>}
        {product?.photoStatus === 'failed' && (
          <p className="flex items-start gap-1.5 text-[11px] text-rose-700">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            <span>{product.photoError || 'No photo could be made.'} You can try again or upload your own.</span>
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {product && aiAvailable && (
            <button type="button" disabled={!!busy || making} onClick={() => run('ai', () => posApi.makeAiPhoto(product.id))}
              className={`${btn} bg-teal-500 hover:bg-teal-600 text-white`}>
              <Sparkles className="w-3.5 h-3.5" />
              {product.imageUrl ? 'Make a new AI photo' : 'Make an AI photo'}
            </button>
          )}
          <button type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}
            className={`${btn} bg-white border border-slate-200 text-slate-700 hover:bg-slate-100`}>
            <Upload className="w-3.5 h-3.5" /> Upload my photo
          </button>
          <button type="button" disabled={!!busy} onClick={() => { setLinkOpen(o => !o); setLinkDraft(adding ? link : ''); setError(null); }}
            className={`${btn} bg-white border border-slate-200 text-slate-700 hover:bg-slate-100`}>
            <Link2 className="w-3.5 h-3.5" /> Use a link
          </button>
          {(product ? !!product.imageUrl || making : !!(pendingFile || link.trim())) && (
            <button type="button" disabled={!!busy} onClick={clear}
              className={`${btn} bg-white border border-slate-200 text-slate-500 hover:text-rose-600 hover:bg-rose-50`}>
              <Trash2 className="w-3.5 h-3.5" /> {adding && aiAvailable ? 'Use AI instead' : 'Remove'}
            </button>
          )}
        </div>

        {linkOpen && (
          <div className="flex gap-1.5">
            <input type="url" value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveLink(); } }}
              placeholder="https://…/photo.jpg"
              className="flex-1 min-w-0 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none" />
            <button type="button" disabled={!!busy || !linkDraft.trim()} onClick={saveLink}
              className={`${btn} bg-slate-900 text-white`}>Use</button>
          </div>
        )}

        {error && <p className="text-[11px] font-semibold text-rose-600">{error}</p>}
        <input ref={fileInput} type="file" accept={PHOTO_TYPES} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; chooseFile(f); }} />
      </div>
    </div>
  );
};
