import Dexie, { type Table } from 'dexie';
import type { Product, Category, Tenant, Branch, DiningTable, AppUser } from '../types';
import type { CreateOrderPayload } from './api';

export interface OfflineOrder {
  id?: number;
  localId: string;
  orderData: CreateOrderPayload;
  createdAt: string;
  isSynced: 0 | 1;
  tenantId?: string;
  apiServer?: string;
  syncRetries?: number;
  lastSyncError?: string;
}

export interface OfflineSetting {
  key: string;
  value: any;
}

export class CashlyOfflineDatabase extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  offlineOrders!: Table<OfflineOrder, number>;
  settings!: Table<OfflineSetting, string>;
  tenants!: Table<Tenant, string>;
  branches!: Table<Branch, string>;
  diningTables!: Table<DiningTable, string>;
  users!: Table<AppUser, string>;

  constructor() {
    super('CashlyPosOfflineDB');
    this.version(3).stores({
      products: 'id, barcode, categoryId, name, tenantId',
      categories: 'id, name, sortOrder, tenantId',
      offlineOrders: '++id, localId, isSynced, createdAt, [isSynced+createdAt]',
      settings: 'key',
      tenants: 'id, name',
      branches: 'id, tenantId, isHeadOffice',
      diningTables: 'id, branchId, tableNumber, [branchId+tableNumber]',
      users: 'id, tenantId, username, [tenantId+username]'
    });
  }
}

export const offlineDb = new CashlyOfflineDatabase();

interface CachedCatalog {
  categories: Category[];
  products: Product[];
}

function catalogKey(tenantId: string, branchId: string, apiServer: string) {
  return `catalog:${apiServer}:${tenantId}:${branchId}`;
}

export async function cacheCatalog(tenantId: string, branchId: string, apiServer: string, catalog: CachedCatalog) {
  await saveSetting(catalogKey(tenantId, branchId, apiServer), catalog);
}

export async function getCachedCatalog(tenantId: string, branchId: string, apiServer: string): Promise<CachedCatalog | undefined> {
  return getSetting(catalogKey(tenantId, branchId, apiServer));
}

export async function queueOfflineSale(sale: OfflineOrder) {
  await offlineDb.transaction('rw', offlineDb.offlineOrders, async () => {
    if (!await offlineDb.offlineOrders.where('localId').equals(sale.localId).first()) {
      await offlineDb.offlineOrders.add(sale);
    }
  });
}

// Helper: Cache dining tables for a branch
export async function cacheDiningTables(branchId: string, tables: DiningTable[]) {
  await offlineDb.transaction('rw', offlineDb.diningTables, async () => {
    await offlineDb.diningTables.where('branchId').equals(branchId).delete();
    await offlineDb.diningTables.bulkPut(tables);
  });
}

// Helper: Get cached dining tables
export async function getCachedDiningTables(branchId: string) {
  return offlineDb.diningTables.where('branchId').equals(branchId).toArray();
}

// Helper: Cache app users for offline PIN auth
export async function cacheUsers(users: AppUser[]) {
  await offlineDb.users.clear();
  await offlineDb.users.bulkPut(users);
}

// Helper: Get cached users (for offline PIN validation)
export async function getCachedUsers(tenantId: string) {
  return offlineDb.users.where('tenantId').equals(tenantId).toArray();
}

// Helper: Save a setting
export async function saveSetting(key: string, value: any) {
  await offlineDb.settings.put({ key, value });
}

// Helper: Get a setting
export async function getSetting(key: string): Promise<any> {
  const row = await offlineDb.settings.get(key);
  return row?.value;
}
