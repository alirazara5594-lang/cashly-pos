import { usePosStore } from '../store/posStore';
import { getDeviceSurface } from '../services/deviceLicense';
import type { Branch } from '../types';

/** What a location is. Older rows carry only isHeadOffice. */
export const locationKindOf = (b: Pick<Branch, 'locationType' | 'isHeadOffice'>) =>
  b.locationType ?? (b.isHeadOffice ? 'HeadOffice' : 'Branch');

export interface BusinessShape {
  /** Every location of the business: head office, outlets, warehouses. */
  locations: Branch[];
  /** The locations that sell. */
  outlets: Branch[];
  /** Set up as a head office with outlets (Cashly POS + ERP), however many outlets it has so far. */
  hasHeadOffice: boolean;
  /** This session is the head office: it runs the ERP and sells nothing itself. */
  atHeadOffice: boolean;
  /** More than one place: transfers, branch comparison and "all locations" views make sense. */
  severalLocations: boolean;
}

/**
 * The business's shape, from what the server says it is — not from counting locations. A head
 * office registered before its first outlet is one location, and counting made every screen treat
 * it as a single shop.
 */
export function useBusinessShape(): BusinessShape {
  const { selectedTenant, selectedBranch, packageInfo } = usePosStore();
  const locations = selectedTenant?.branches ?? [];
  const outlets = locations.filter(b => b.canSell !== false && locationKindOf(b) === 'Branch');
  const hasHeadOffice = packageInfo?.deploymentMode === 'HeadOffice'
    || locations.some(b => locationKindOf(b) === 'HeadOffice');
  const atHeadOffice = getDeviceSurface() === 'Erp'
    || packageInfo?.appSurface === 'Erp'
    || (!!selectedBranch && locationKindOf(selectedBranch) === 'HeadOffice' && selectedBranch.canSell === false);
  return {
    locations,
    outlets,
    hasHeadOffice,
    atHeadOffice,
    severalLocations: hasHeadOffice || locations.length > 1
  };
}
