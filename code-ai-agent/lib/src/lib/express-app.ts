import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { RequestBody, handleConfig, handleFile, PromptHandler } from './express-handlers';

export function createApp(handlePrompt: PromptHandler, apiName: string): express.Application {
  const app = express();
  // Increase the body limit to 50mb to handle large file payloads
  app.use(express.json({ limit: '50mb' }));

  app.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { type } = req.body as RequestBody;
      switch (type) {
        case 'api key':
          console.log(`>>>> Request received on ${apiName}`);
          await handleConfig(req, res);
          break;
        case 'system instructions':
        case 'model':
          await handleConfig(req, res);
          break;
        case 'file':
          await handleFile(req, res);
          break;
        case 'prompt':
          await handlePrompt(req, res);
          break;
        default:
          res.status(400).json({ error: `Invalid type specified: ${type}` });
      }
    } catch (error) {
      next(error);
    }
  });

  // Global error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Error processing request:', err);
    if (axios.isAxiosError(err) && err.response) {
      console.error(`Error calling ${apiName} API:`, err.response.data);
      return res.status(500).json({
        error: `Failed to process prompt with ${apiName} API`,
        details: err.response.data
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

