import { useState, type FormEvent } from 'react';
import type { Rider } from '../types';
import { getApiErrorMessage, posApi } from '../services/api';

type Props = { branchId: string; riders: Rider[]; onClose: () => void; onSaved: () => void };

export function RiderManager({ branchId, riders, onClose, onSaved }: Props) {
  const [id, setId] = useState('');
  const empty = { name: '', phone: '', vehicleNumber: '', isActive: true };
  const [draft, setDraft] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await posApi.saveRider(id || undefined, { ...draft, branchId });
      onSaved();
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save the rider.'));
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
    <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="rider-heading"
      className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-5 text-sm shadow-xl">
      <h2 id="rider-heading" className="font-bold">Manage delivery riders</h2>
      <label className="block">Rider
        <select className="block w-full rounded border p-2" value={id} onChange={e => {
          const rider = riders.find(r => r.id === e.target.value);
          setId(e.target.value);
          setDraft(rider ?? empty);
          setError('');
        }}>
          <option value="">New rider</option>
          {riders.map(r => <option key={r.id} value={r.id}>{r.name}{r.isActive ? '' : ' (inactive)'}</option>)}
        </select>
      </label>
      <label className="block">Name<input required maxLength={100} className="block w-full rounded border p-2"
        value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
      <label className="block">Phone<input type="tel" required maxLength={40} className="block w-full rounded border p-2"
        value={draft.phone} onChange={e => setDraft({ ...draft, phone: e.target.value })} /></label>
      <label className="block">Vehicle number<input maxLength={60} className="block w-full rounded border p-2"
        value={draft.vehicleNumber} onChange={e => setDraft({ ...draft, vehicleNumber: e.target.value })} /></label>
      {id && <label className="flex items-center gap-2"><input type="checkbox" checked={draft.isActive}
        onChange={e => setDraft({ ...draft, isActive: e.target.checked })} /> Active for dispatch</label>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded border px-3 py-2">Cancel</button>
        <button disabled={saving} className="rounded bg-teal-600 px-3 py-2 font-semibold text-white">
          {saving ? 'Saving…' : 'Save rider'}
        </button>
      </div>
    </form>
  </div>;
}
