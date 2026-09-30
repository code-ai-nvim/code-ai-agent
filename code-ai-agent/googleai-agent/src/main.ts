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

export interface GoogleAIModelConfig {
  model: string;
  thinkingLevel?: ThinkingLevel;
}

// Normalize a model name that may carry a trailing provider-specific suffix.
// The project treats provider suffixes uniformly: split on the last `-`
// separator, keep the base model id, and map the suffix to the provider's valid
// API field when it is recognized. For Google AI, valid thinking levels are
// `minimal`, `low`, `medium`, and `high`. If the suffix is explicitly `none` or
// is otherwise unrecognized, we fall back to the cheapest valid level
// (`low` for Gemini 3.7+, otherwise `minimal`) so the request stays predictable
// and low-cost. Models without a recognized trailing suffix are passed through
// unchanged, and model existence is validated by the upstream API.
function normalizeGoogleAIModel(model: string): GoogleAIModelConfig {
  const match = model.match(/^(.*)-(.+)$/);
  if (!match) {
    return { model };
  }

  const [, baseModel, suffix] = match;

  switch (suffix) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
      return { model: baseModel, thinkingLevel: suffix };
    case 'none':
    default: {
      const isGemini37 = baseModel.includes('3.7');
      const thinkingLevel: ThinkingLevel = isGemini37 ? 'low' : 'minimal';
      return { model: baseModel, thinkingLevel };
    }
  }
}

async function buildRequestBody(instructions: string, model: string): Promise<GoogleAIRequestBody> {
  const conversationMessages = await buildConversationMessages();

  const contents: Content[] = conversationMessages.map((msg) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  const normalizedModel = normalizeGoogleAIModel(model);

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
  const normalizedModel = normalizeGoogleAIModel(model).model;
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

