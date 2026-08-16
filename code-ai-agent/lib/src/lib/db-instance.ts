import { SQLiteStore } from './db';

let currentStore: SQLiteStore | null = null;

export function setDbStore(store: SQLiteStore): void {
  currentStore = store;
}

function getStore(): SQLiteStore {
  if (!currentStore) {
    throw new Error('Database store not initialized. Call setDbStore first.');
  }
  return currentStore;
}

export const connectToDatabase = () => getStore().connectToDatabase();
export const getDb = () => getStore().getDb();
export const run = (sql: string, params?: any[]) => getStore().run(sql, params);
export const get = <T>(sql: string, params?: any[]) => getStore().get<T>(sql, params);
export const all = <T>(sql: string, params?: any[]) => getStore().all<T>(sql, params);
export const initializeDatabase = () => getStore().initializeDatabase();
export const resetDatabase = () => getStore().resetDatabase();
export const removeDatabaseFile = () => getStore().removeDatabaseFile();

