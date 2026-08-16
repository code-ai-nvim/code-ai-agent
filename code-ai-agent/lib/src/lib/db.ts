import * as sqlite3 from 'sqlite3';
import * as fs from 'fs';

export type Database = sqlite3.Database;

export interface SQLiteStore {
  connectToDatabase: () => Promise<sqlite3.Database>;
  getDb: () => sqlite3.Database;
  run: (sql: string, params?: any[]) => Promise<{ lastID: number }>;
  get: <T>(sql: string, params?: any[]) => Promise<T | null>;
  all: <T>(sql: string, params?: any[]) => Promise<T[]>;
  initializeDatabase: () => Promise<void>;
  resetDatabase: () => Promise<void>;
  removeDatabaseFile: () => void;
}

export function createSQLiteStore(dbPath: string): SQLiteStore {
  let db: sqlite3.Database;

  const connectToDatabase = (): Promise<sqlite3.Database> => {
    return new Promise((resolve, reject) => {
      const connection = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Connected to the SQLite database.');
          db = connection;
          resolve(db);
        }
      });
    });
  };

  const getDb = (): sqlite3.Database => {
    if (!db) {
      throw new Error('Database not initialized. Call connectToDatabase first.');
    }
    return db;
  };

  const run = (sql: string, params: any[] = []): Promise<{ lastID: number }> => {
    return new Promise((resolve, reject) => {
      getDb().run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID });
        }
      });
    });
  };

  const get = <T>(sql: string, params: any[] = []): Promise<T | null> => {
    return new Promise((resolve, reject) => {
      getDb().get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as T | null);
        }
      });
    });
  };

  const all = <T>(sql: string, params: any[] = []): Promise<T[]> => {
    return new Promise((resolve, reject) => {
      getDb().all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  };

  const initializeDatabase = async (): Promise<void> => {
    await run(`CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    await run(`CREATE TABLE IF NOT EXISTS data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      file_content TEXT NOT NULL
    )`);
  };

  const resetDatabase = async (): Promise<void> => {
    const tables = await all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`
    );
    for (const table of tables) {
      await run(`DELETE FROM ${table.name};`);
    }
  };

  const removeDatabaseFile = (): void => {
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('Existing database file removed.');
    }
  };

  return {
    connectToDatabase,
    getDb,
    run,
    get,
    all,
    initializeDatabase,
    resetDatabase,
    removeDatabaseFile,
  };
}

