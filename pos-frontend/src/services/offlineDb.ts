import Dexie, { type Table } from 'dexie';
import type { Product, Category, Tenant, Branch, DiningTable, AppUser } from '../types';

export interface OfflineOrder {
  id?: number;
  localId: string;
  orderData: any;
  createdAt: string;
  isSynced: boolean;
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

// Helper: Cache full catalog (products + categories) for offline use
export async function cacheCatalog(tenantId: string, categories: Category[], products: Product[]) {
  await offlineDb.categories.where('tenantId').equals(tenantId).delete();
  await offlineDb.products.where('tenantId').equals(tenantId).delete();
  await offlineDb.categories.bulkPut(categories);
  await offlineDb.products.bulkPut(products);
}

// Helper: Get cached catalog
export async function getCachedCatalog(tenantId: string) {
  const categories = await offlineDb.categories.where('tenantId').equals(tenantId).toArray();
  const products = await offlineDb.products.where('tenantId').equals(tenantId).toArray();
  return { categories, products };
}

// Helper: Cache dining tables for a branch
export async function cacheDiningTables(tables: DiningTable[]) {
  await offlineDb.diningTables.clear();
  await offlineDb.diningTables.bulkPut(tables);
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
