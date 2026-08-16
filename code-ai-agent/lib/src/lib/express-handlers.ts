import { Request, Response } from 'express';
import * as db from './db-instance';

export interface ConfigPayload {
  type: 'api key' | 'system instructions' | 'model' | 'prompt';
  text: string;
}

export interface FilePayload {
  type: 'file';
  filename: string;
  content: string;
}

export type RequestBody = FilePayload | ConfigPayload;

export const handleConfig = async (req: Request, res: Response): Promise<void> => {
  const { type, text } = req.body as ConfigPayload;
  const keyMap = {
    'api key': 'api_key',
    'system instructions': 'system_instructions',
    'model': 'model',
    'prompt': 'prompt',
  };
  const dbKey = keyMap[type];

  if (!text) {
    res.status(400).json({ error: `Missing text field for ${type}` });
    return;
  }

  if (type === 'api key') {
    await db.resetDatabase();
  }

  try {
    const { lastID } = await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', [dbKey, text]);
    console.log(`    [Agent] Successfully stored config: ${type}`);
    res.json({ message: `${type} stored successfully`, rowId: lastID });
  } catch (error) {
    console.error(`    [Agent] Failed to store config ${type}:`, error);
    res.status(500).json({ error: `Failed to store ${type} in database` });
  }
};

export const handleFile = async (req: Request, res: Response): Promise<void> => {
  const { filename, content } = req.body as FilePayload;
  if (!filename || !content) {
    res.status(400).json({ error: 'Missing filename or content for file' });
    return;
  }

  try {
    const { lastID } = await db.run('INSERT INTO data (file_path, file_content) VALUES (?, ?)', [filename, content]);
    console.log(`    [Agent] Successfully stored file: ${filename} (ID: ${lastID})`);
    res.json({ message: 'File data stored successfully', rowId: lastID });
  } catch (error) {
    console.error(`    [Agent] Failed to store file ${filename}:`, error);
    res.status(500).json({ error: 'Failed to store file in database' });
  }
};

export interface PromptHandler {
  (req: Request, res: Response): Promise<void>;
}

export function createPromptHandler<T = unknown>(
  processPrompt: (apiKey: string, model: string, instructions: string) => Promise<T>,
  agentName = 'Agent'
): PromptHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const { text } = req.body as ConfigPayload;
    if (!text) {
      console.error(`    [${agentName}] Error: Missing text field for prompt`);
      res.status(400).json({ error: 'Missing text field for prompt' });
      return;
    }

    try {
      await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['prompt', text]);
      console.log(`    [${agentName}] Prompt stored. Proceeding to API call...`);
    } catch (error) {
      console.error(`    [${agentName}] Error: Failed to store prompt in database:`, error);
      res.status(500).json({ error: 'Failed to store prompt in database' });
      return;
    }

    let apiKeyRecord: { value: string } | null;
    let modelRecord: { value: string } | null;
    let instructionsRecord: { value: string } | null;

    try {
      apiKeyRecord = await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', ['api_key']);
      modelRecord = await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', ['model']);
      instructionsRecord = await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', ['system_instructions']);
    } catch (error) {
      console.error(`    [${agentName}] Error: Failed to retrieve configuration from database:`, error);
      res.status(500).json({ error: 'Failed to retrieve configuration from database' });
      return;
    }

    const apiKey = apiKeyRecord?.value;
    const model = modelRecord?.value;
    const instructions = instructionsRecord?.value || '';

    if (!apiKey) {
      console.error(`    [${agentName}] Error: API key not set`);
      res.status(400).json({ error: 'API key not set' });
      return;
    }
    if (!model) {
      console.error(`    [${agentName}] Error: Model not set`);
      res.status(400).json({ error: 'Model not set' });
      return;
    }

    console.log(`>>>> Sending request to ${agentName} - ${model}`);
    const startTime = Date.now();

    try {
      const apiResponse = await processPrompt(apiKey, model, instructions);
      const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`<<<< Response received from ${agentName} - ${model} (took ${durationSeconds}s)`);
      res.json(apiResponse);
    } catch (error) {
      const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[${agentName}] Error: Request failed after ${durationSeconds}s:`, error);

      if (error instanceof Error) {
        console.error(`[${agentName}] Error message:`, error.message);
        console.error(`[${agentName}] Error stack:`, error.stack);
      }

      res.status(500).json({
        error: 'Failed to process prompt',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };
}

