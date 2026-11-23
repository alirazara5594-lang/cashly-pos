import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage, posApi } from '../services/api';
import { usePosStore } from '../store/posStore';

export function AttachBranchHost({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const setIsInstalled = usePosStore(s => s.setIsInstalled);
  const [form, setForm] = useState({ cloudUrl: '', businessId: '', enrollmentCode: '', fullName: '', username: '', pin: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof posApi.attachBranchHost>> | null>(null);
  const fields = [
    { key: 'cloudUrl', label: 'Headquarters API address', type: 'url' },
    { key: 'businessId', label: 'Business ID from HQ', type: 'text' },
    { key: 'enrollmentCode', label: 'Enrollment code', type: 'password' },
    { key: 'fullName', label: 'Local manager name', type: 'text' },
    { key: 'username', label: 'Local manager username', type: 'text' },
    { key: 'pin', label: 'Local manager six-digit PIN', type: 'password' },
  ] as const;

  return (
    <main className="min-h-screen bg-slate-50 p-5">
      <form className="mx-auto max-w-lg space-y-4 rounded-2xl border bg-white p-6" onSubmit={async e => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
          setResult(await posApi.attachBranchHost(form));
        } catch (err) {
          setError(getApiErrorMessage(err, 'The outlet could not be attached.'));
        } finally {
          setBusy(false);
        }
      }}>
        <h1 className="text-xl font-bold">Attach this server to HQ</h1>
        {result ? (
          <>
            <p role="status">{result.outlet} is enrolled. {result.catalogueSynced ? 'The HQ catalogue is available.' : 'Check the catalogue in the outlet before taking its first sale.'}</p>
            <button type="button" className="rounded-lg bg-teal-700 px-4 py-2 text-white" onClick={() => {
              setIsInstalled(true);
              navigate('/', { replace: true });
            }}>Go to sign in</button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">Ask HQ to issue an enrollment code from Locations. The local manager can sign in and pair tills at this outlet.</p>
            {fields.map(({ key, label, type }) => (
              <label key={key} className="block text-sm font-medium">
                {label}
                <input type={type} required value={form[key]} autoComplete="off"
                  inputMode={key === 'pin' ? 'numeric' : undefined}
                  pattern={key === 'pin' ? '[0-9]{6}' : undefined}
                  onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                  className="mt-1 block w-full rounded-lg border px-3 py-2" />
              </label>
            ))}
            {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            <div className="flex justify-between">
              <button type="button" disabled={busy} onClick={onBack}>Back</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-teal-700 px-4 py-2 text-white disabled:opacity-50">
                {busy ? 'Attaching…' : 'Attach outlet'}
              </button>
            </div>
          </>
        )}
      </form>
    </main>
  );
}
