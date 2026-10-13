import React, { useRef, useState } from 'react';
import { AlertTriangle, Camera, FileText, Trash2, X } from 'lucide-react';
import { today } from '../utils/expiry';
import { prescriptionProblem, shrinkPhoto } from '../utils/prescription';
import type { PrescriptionInput } from '../types';

interface PrescriptionModalProps {
  initial: PrescriptionInput;
  /** The medicines on this sale sold on prescription, and which of them are controlled. */
  names: string[];
  controlledNames: string[];
  /** "Save and charge 1,250" when the sale goes through as soon as it is saved. */
  saveLabel: string;
  /** Why it opened, when the server refused the sale for it. */
  initialError?: string | null;
  onSave: (rx: PrescriptionInput) => void;
  onClose: () => void;
}

/**
 * The prescription a pharmacy's sale is made against: the patient, the doctor and the date on it, and
 * a photo when there is one. A controlled medicine also needs the patient's CNIC and the doctor's
 * registration number, for the controlled-medicine register.
 */
export const PrescriptionModal: React.FC<PrescriptionModalProps> = ({
  initial, names, controlledNames, saveLabel, initialError, onSave, onClose
}) => {
  const [form, setForm] = useState<PrescriptionInput>(initial);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const controlled = controlledNames.length > 0;

  const set = <K extends keyof PrescriptionInput>(key: K, value: PrescriptionInput[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setError(null);
  };

  const addPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPreparingPhoto(true);
    try {
      set('photoDataUrl', await shrinkPhoto(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that photo.');
    } finally {
      setPreparingPhoto(false);
    }
  };

  const save = () => {
    const problem = prescriptionProblem(form, controlled);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(form);
  };

  const input = (key: 'patientName' | 'patientPhone' | 'patientCnic' | 'doctorName' | 'doctorRegistrationNo',
    label: string, required: boolean, placeholder: string, inputMode?: 'tel' | 'numeric') => (
    <div>
      <label htmlFor={`rx-${key}`} className="block text-xs font-semibold text-slate-500 mb-1">
        {label}{required && <span className="text-rose-500"> *</span>}
      </label>
      <input
        id={`rx-${key}`}
        type="text"
        inputMode={inputMode}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Prescription" className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-teal-600 font-bold text-sm">
              <FileText className="w-4 h-4 shrink-0" />
              <span>Prescription</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {names.map(name => (
                <span key={name} className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-semibold">
                  {name}
                  {controlledNames.includes(name) && <span className="ml-1 text-rose-600">· Controlled</span>}
                </span>
              ))}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {input('patientName', 'Patient', true, 'Full name')}
            {input('patientPhone', 'Patient phone', false, '03xx-xxxxxxx', 'tel')}
            {input('patientCnic', "Patient's CNIC", controlled, '35202-1234567-1', 'numeric')}
            <div>
              <label htmlFor="rx-prescribedOn" className="block text-xs font-semibold text-slate-500 mb-1">
                Date on prescription<span className="text-rose-500"> *</span>
              </label>
              <input
                id="rx-prescribedOn"
                type="date"
                max={today()}
                value={form.prescribedOn}
                onChange={(e) => set('prescribedOn', e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 focus:outline-none"
              />
            </div>
            {input('doctorName', 'Doctor', true, 'e.g. Dr. Ayesha Khan')}
            {input('doctorRegistrationNo', 'Doctor reg. no. (PMDC)', controlled, 'e.g. 12345-P')}
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1">Photo <span className="font-normal text-slate-400">(optional)</span></div>
            <input
              ref={photoInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void addPhoto(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {form.photoDataUrl ? (
              <div className="flex items-center gap-3">
                <img src={form.photoDataUrl} alt="Prescription" className="w-20 h-20 object-cover rounded-lg border border-slate-200" />
                <div className="flex flex-col gap-1.5">
                  <button type="button" onClick={() => photoInput.current?.click()} className="text-xs font-semibold text-teal-600 hover:underline text-left">
                    Take another
                  </button>
                  <button type="button" onClick={() => set('photoDataUrl', undefined)} className="text-xs font-semibold text-rose-600 hover:underline inline-flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                disabled={preparingPhoto}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 text-xs font-semibold text-slate-600 hover:border-teal-400 hover:text-teal-700 transition disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
                {preparingPhoto ? 'Preparing photo…' : 'Take or add a photo'}
              </button>
            )}
          </div>

          {controlled && (
            <p className="text-[11px] text-slate-500">
              Controlled medicines go into the controlled-medicine register with the patient's CNIC and the doctor's registration number.
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 space-y-2">
          {error && (
            <div role="alert" className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 transition">
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={preparingPhoto}
              className="px-5 py-2 rounded-xl bg-teal-500 text-white text-xs font-bold hover:bg-teal-600 transition shadow-lg shadow-teal-500/25 disabled:opacity-50"
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
