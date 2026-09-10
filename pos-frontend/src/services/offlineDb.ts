import Dexie, { type Table } from 'dexie';
import type { Product, Category, Tenant, Branch } from '../types';

export interface OfflineOrder {
  id?: number;
  localId: string;
  orderData: any;
  createdAt: string;
  isSynced: boolean;
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

  constructor() {
    super('CashlyPosOfflineDB');
    this.version(2).stores({
      products: 'id, barcode, categoryId, name',
      categories: 'id, name, sortOrder',
      offlineOrders: '++id, localId, isSynced, createdAt',
      settings: 'key',
      tenants: 'id, name',
      branches: 'id, tenantId, isHeadOffice'
    });
  }
}

export const offlineDb = new CashlyOfflineDatabase();

