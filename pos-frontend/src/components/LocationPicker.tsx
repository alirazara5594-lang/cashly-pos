import React from 'react';
import { Building2 } from 'lucide-react';
import { ALL_LOCATIONS } from '../services/api';
import { locationKindOf } from '../hooks/useBusinessShape';
import type { Branch } from '../types';

interface LocationPickerProps {
  value: string;
  onChange: (branchId: string) => void;
  locations: Branch[];
  /** Offers the whole business first under this label, e.g. "All outlets". */
  allLabel?: string;
  label?: string;
}

/**
 * Which location a head-office screen is looking at. Head office sells nothing itself, so its
 * reports, floors and rotas are about the outlets.
 */
export const LocationPicker: React.FC<LocationPickerProps> = ({ value, onChange, locations, allLabel, label = 'Location' }) => (
  <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-600">
    <Building2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
    <span className="hidden sm:inline">{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-transparent text-slate-900 font-bold focus:outline-none cursor-pointer max-w-[14rem]"
    >
      {allLabel && <option value={ALL_LOCATIONS}>{allLabel}</option>}
      {locations.map(b => {
        const kind = locationKindOf(b);
        return (
          <option key={b.id} value={b.id}>
            {b.name}{kind === 'HeadOffice' ? ' (head office)' : kind === 'Warehouse' ? ' (warehouse)' : ''}
          </option>
        );
      })}
    </select>
  </label>
);
