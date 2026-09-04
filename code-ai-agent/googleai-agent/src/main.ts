import axios, { AxiosResponse } from 'axios';
import * as db from './db';
import {
  setDbStore,
  createApp,
  createPromptHandler,
  startServer,
  buildConversationMessages,
  createGenericProcessPrompt,
} from '@code-ai-agent/lib';

const port = process.env.PORT ? Number(process.env.PORT) : 5010;

setDbStore({
  connectToDatabase: db.connectToDatabase,
  getDb: db.getDb,
  run: db.run,
  get: db.get,
  all: db.all,
  initializeDatabase: db.initializeDatabase,
  resetDatabase: db.resetDatabase,
  removeDatabaseFile: db.removeDatabaseFile,
});

export interface Part {
  text: string;
}

export interface Content {
  role?: 'user' | 'model';
  parts: Part[];
}

type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface GenerationConfig {
  temperature: number;
  topP: number;
  thinkingConfig?: {
    thinkingLevel: ThinkingLevel;
  };
}

export interface GoogleAIRequestBody {
  contents: Content[];
  generationConfig: GenerationConfig;
  systemInstruction?: Content;
}

export interface Candidate {
  content: Content;
  finishReason?: string;
  index?: number;
}

export interface GoogleAIResponse {
  candidates: Candidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function normalizeGeminiFlashModel(model: string): { model: string; thinkingLevel?: ThinkingLevel } {
  const match = model.match(/^gemini-(3\.[56789])-flash(?:-(minimal|low|medium|high))?$/);
  if (!match) {
    return { model };
  }

  const [, version, level] = match;
  let thinkingLevel: ThinkingLevel = (level as ThinkingLevel | undefined) ?? 'low';

  if (version === '3.7' && thinkingLevel === 'minimal') {
    thinkingLevel = 'low';
  }

  return {
    model: `gemini-${version}-flash`,
    thinkingLevel,
  };
}

async function buildRequestBody(instructions: string, model: string): Promise<GoogleAIRequestBody> {
  const conversationMessages = await buildConversationMessages();

  const contents: Content[] = conversationMessages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  const normalizedModel = normalizeGeminiFlashModel(model);

  const requestBody: GoogleAIRequestBody = {
    contents,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      ...(normalizedModel.thinkingLevel ? { thinkingConfig: { thinkingLevel: normalizedModel.thinkingLevel } } : {}),
    },
  };

  const sanitizedInstructions = instructions.trim();
  if (sanitizedInstructions) {
    requestBody.systemInstruction = { parts: [{ text: sanitizedInstructions }] };
  }

  return requestBody;
}

function postToGoogleAI(
  requestBody: GoogleAIRequestBody,
  apiKey: string,
  model: string
): Promise<AxiosResponse<GoogleAIResponse>> {
  const normalizedModel = normalizeGeminiFlashModel(model).model;
  const url = `https://aiplatform.googleapis.com/v1/publishers/google/models/${normalizedModel}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  return axios.post<GoogleAIResponse>(url, requestBody, {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function createErrorResponse(errorMessage: string): GoogleAIResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: errorMessage }],
        },
      },
    ],
    usageMetadata: {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      totalTokenCount: 0,
    },
  };
}

const processPrompt = createGenericProcessPrompt(
  'Google AI',
  buildRequestBody,
  postToGoogleAI,
  createErrorResponse
);

const handlePrompt = createPromptHandler(processPrompt, 'GoogleAI');
const app = createApp(handlePrompt, 'GoogleAI');

startServer(app, port, db.removeDatabaseFile);

