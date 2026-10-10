import React, { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { posApi } from '../services/api';
import type { Announcement } from '../types';

type Shown = Pick<Announcement, 'id' | 'title' | 'body' | 'tone'>;

const DISMISSED_KEY = 'cashly_dismissed_announcements';

const readDismissed = (): string[] => {
  try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]') as string[]; } catch { return []; }
};

const TONE: Record<Announcement['tone'], string> = {
  info: 'bg-sky-50 border-sky-200 text-sky-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  success: 'bg-teal-50 border-teal-200 text-teal-900'
};

/**
 * Messages from Cashly to this business — maintenance tonight, a new feature — shown at the top
 * until read and closed. Closing one hides it on this device only.
 */
export const AnnouncementBanner: React.FC<{ tenantId?: string | null }> = ({ tenantId }) => {
  const [items, setItems] = useState<Shown[]>([]);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    posApi.getActiveAnnouncements()
      .then(rows => { if (!cancelled) setItems(rows); })
      .catch(() => { /* a banner is a nicety; nothing else depends on it */ });
    return () => { cancelled = true; };
  }, [tenantId]);

  const shown = items.filter(a => !dismissed.includes(a.id));
  if (!tenantId || shown.length === 0) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next.slice(-50))); } catch { /* optional */ }
  };

  return (
    <>
      {shown.slice(0, 2).map(a => (
        <div key={a.id} className={`px-4 py-2.5 border-b text-xs flex items-start gap-2.5 ${TONE[a.tone] ?? TONE.info}`} role="status">
          <Megaphone className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed flex-1"><strong>{a.title}</strong> — {a.body}</span>
          <button onClick={() => dismiss(a.id)} className="p-0.5 rounded hover:bg-white/60 shrink-0" title="Close"><X className="w-3.5 h-3.5" /></button>
        </div>
      ))}
    </>
  );
};
