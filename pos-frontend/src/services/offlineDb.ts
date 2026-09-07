import Dexie, { type Table } from 'dexie';
import type { Product, Category } from '../types';


export interface OfflineOrder {
  id?: number;
  localId: string;
  orderData: any;
  createdAt: string;
  isSynced: boolean;
}

export class CashlyOfflineDatabase extends Dexie {
  products!: Table<Product, string>;
  categories!: Table<Category, string>;
  offlineOrders!: Table<OfflineOrder, number>;

  constructor() {
    super('CashlyPosOfflineDB');
    this.version(1).stores({
      products: 'id, barcode, categoryId, name',
      categories: 'id, name, sortOrder',
      offlineOrders: '++id, localId, isSynced, createdAt'
    });
  }
}

export const offlineDb = new CashlyOfflineDatabase();
