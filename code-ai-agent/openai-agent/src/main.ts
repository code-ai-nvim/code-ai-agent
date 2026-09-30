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

const port = process.env.PORT ? Number(process.env.PORT) : 4010;

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

export interface OpenAIInputMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OpenAIRequestBody {
  model?: string;
  input: OpenAIInputMessage[];
  max_output_tokens: number;
  instructions?: string;
  reasoning?: {
    effort: OpenAIReasoningEffort;
  };
}

export interface OpenAIOutputItem {
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
    annotations?: unknown[];
  }>;
}

export interface OpenAIResponse {
  model: string;
  output: OpenAIOutputItem[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

type OpenAIReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface OpenAIModelConfig {
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
}

// Normalize a model name that may carry a trailing provider-specific suffix.
// The project treats provider suffixes uniformly: split on the last `-`
// separator, keep the base model id, and map the suffix to the provider's valid
// API field when it is recognized. For OpenAI, accepted reasoning values are
// `low`, `medium`, `high`, `xhigh`, `max`, and `none` (where supported).
// If the suffix is explicitly `none` or is otherwise unrecognized, we fall back
// to `reasoning.effort = "none"` so the request stays predictable and cheap.
// Models without a recognized trailing suffix are passed through unchanged.
function normalizeOpenAIModel(model: string): OpenAIModelConfig {
  const match = model.match(/^(.*)-(.+)$/);
  if (!match) {
    return { model };
  }

  const [, baseModel, suffix] = match;

  switch (suffix) {
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return { model: baseModel, reasoningEffort: suffix };
    case 'none':
    default:
      return { model: baseModel, reasoningEffort: 'none' };
  }
}

async function buildRequestBody(instructions: string, model: string): Promise<OpenAIRequestBody> {
  const conversationMessages = await buildConversationMessages();
  const normalized = normalizeOpenAIModel(model);
  const sanitizedInstructions = instructions.trim();

  const requestBody: OpenAIRequestBody = {
    input: conversationMessages.map(({ role, content }) => ({
      role,
      content,
    })),
    max_output_tokens: 1024 * 96,
  };

  if (normalized.reasoningEffort) {
    requestBody.reasoning = { effort: normalized.reasoningEffort };
  }

  if (sanitizedInstructions) {
    requestBody.instructions = sanitizedInstructions;
  }

  return requestBody;
}

function postToOpenAI(
  requestBody: OpenAIRequestBody,
  apiKey: string,
  model: string
): Promise<AxiosResponse<OpenAIResponse>> {
  const url = 'https://api.openai.com/v1/responses';
  const normalized = normalizeOpenAIModel(model);

  requestBody.model = normalized.model;

  return axios.post<OpenAIResponse>(url, requestBody, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

function createErrorResponse(errorMessage: string, model: string): OpenAIResponse {
  return {
    model: model,
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: errorMessage,
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  };
}

async function prepareAndPostToOpenAI(requestBody: OpenAIRequestBody, apiKey: string, model: string) {
  return postToOpenAI(requestBody, apiKey, model);
}

const processPrompt = createGenericProcessPrompt(
  'OpenAI',
  buildRequestBody,
  prepareAndPostToOpenAI,
  createErrorResponse
);

const handlePrompt = createPromptHandler(processPrompt, 'OpenAI');
const app = createApp(handlePrompt, 'OpenAI');

startServer(app, port, db.removeDatabaseFile);
