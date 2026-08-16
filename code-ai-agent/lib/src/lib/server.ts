import express from 'express';
import * as db from './db-instance';

export async function startServer(
  app: express.Application,
  port: number,
  removeDatabaseFile?: () => void
): Promise<void> {
  try {
    if (removeDatabaseFile) {
      removeDatabaseFile();
    }
    await db.connectToDatabase();
    await db.initializeDatabase();
    app.listen(port, () => {
      console.log(`[ ready ] http://0.0.0.0:${port}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

