import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, Printer, RefreshCw } from 'lucide-react';

interface QrCodeModalProps {
  title: string;
  subtitle?: string;
  /** The full address the code opens. */
  url: string;
  /** Replaces the code; every copy printed before stops working. */
  onRegenerate?: () => void;
  onClose: () => void;
  /** Shown above the code, e.g. when the shop does not have the ordering add-on yet. */
  warning?: string;
}

/** A printable QR code for a table's ordering link or a shop's pickup link. */
export const QrCodeModal: React.FC<QrCodeModalProps> = ({ title, subtitle, url, onRegenerate, onClose, warning }) => {
  const [image, setImage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'M' })
      .then(data => { if (!cancelled) setImage(data); })
      .catch(() => { if (!cancelled) setImage(null); });
    return () => { cancelled = true; };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the link is on screen to copy by hand */
    }
  };

  // A plain page with only the code and its label, so the printout is just the card for the table.
  const print = () => {
    if (!image) return;
    const win = window.open('', '_blank', 'width=420,height=560');
    if (!win) return;
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    win.document.write(`<!doctype html><html><head><title>${esc(title)}</title>
      <style>body{font-family:system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:22px;margin:0 0 4px}
      p{margin:0 0 16px;color:#475569;font-size:13px}img{width:300px;height:300px}</style></head>
      <body><h1>${esc(title)}</h1><p>${esc(subtitle ?? 'Scan to order')}</p><img src="${image}" alt="QR code" />
      <p style="margin-top:12px">Scan with your phone camera to see the menu and order.</p></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl text-center" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between text-left">
          <div>
            <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-800" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        {warning && (
          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2 text-left">{warning}</p>
        )}

        <div className="flex justify-center">
          {image
            ? <img src={image} alt={`QR code for ${title}`} className="w-60 h-60" />
            : <div className="w-60 h-60 rounded-xl bg-slate-100 animate-pulse" />}
        </div>

        <div className="text-[11px] font-mono text-slate-500 break-all bg-slate-50 rounded-lg p-2">{url}</div>

        <div className="grid grid-cols-2 gap-2">
          <button onClick={copy} className="py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5">
            {copied ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy link'}
          </button>
          <button onClick={print} disabled={!image} className="py-2 rounded-xl bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
        {onRegenerate && (
          <button
            onClick={() => {
              if (window.confirm('Make a new code? Every copy of the old one stops working.')) onRegenerate();
            }}
            className="text-[11px] text-slate-500 hover:text-rose-600 flex items-center justify-center gap-1 mx-auto"
          >
            <RefreshCw className="w-3 h-3" /> Replace this code
          </button>
        )}
      </div>
    </div>
  );
};
