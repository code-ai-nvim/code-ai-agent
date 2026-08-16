import axios, { AxiosResponse } from 'axios';
import * as db from './db';
import {
  setDbStore,
  createApp,
  createPromptHandler,
  startServer,
  buildConversationMessages,
  createGenericProcessPrompt,
  ConversationStep,
} from '@code-ai-agent/lib';

const port = process.env.PORT ? Number(process.env.PORT) : 6010;

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

export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface AnthropicRequestBody {
  max_tokens: number;
  system?: string;
  messages: ConversationStep[];
  model?: string;
  thinking?: {
    type: 'disabled';
  };
  output_config?: {
    effort: 'low' | 'xhigh';
  };
}

export interface AnthropicResponse {
  content: ContentBlock[];
  model: string;
  role: string;
  stop_reason: string;
  type: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

type ClaudeSonnet5Effort = 'low' | 'xhigh';

interface ClaudeSonnet5Config {
  model: string;
  thinking?: { type: 'disabled' };
  effort?: ClaudeSonnet5Effort;
}

function normalizeClaudeSonnet5Model(model: string): ClaudeSonnet5Config {
  const match = model.match(/^claude-sonnet-5(?:-(.+))?$/);
  if (!match) {
    return { model };
  }

  const [, suffix] = match;

  switch (suffix) {
    case 'medium':
      return { model: 'claude-sonnet-5', effort: 'low' };
    case 'high':
      return { model: 'claude-sonnet-5', effort: 'xhigh' };
    case 'low':
    default:
      return { model: 'claude-sonnet-5', thinking: { type: 'disabled' } };
  }
}

async function buildRequestBody(instructions: string, model: string): Promise<AnthropicRequestBody> {
  const messages = await buildConversationMessages();
  const sanitizedInstructions = instructions.trim();
  const normalized = normalizeClaudeSonnet5Model(model);

  const requestBody: AnthropicRequestBody = {
    max_tokens: 64000,
    system: sanitizedInstructions || undefined,
    messages,
  };

  if (normalized.thinking) {
    requestBody.thinking = normalized.thinking;
  }

  if (normalized.effort) {
    requestBody.output_config = { effort: normalized.effort };
  }

  return requestBody;
}

function postToAnthropic(
  requestBody: AnthropicRequestBody,
  apiKey: string,
  model: string
): Promise<AxiosResponse<AnthropicResponse>> {
  const url = 'https://api.anthropic.com/v1/messages';
  const headers = model.startsWith('claude-sonnet')
    ? {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'context-1m-2025-08-07',
      }
    : {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };

  const normalized = normalizeClaudeSonnet5Model(model);
  const body = { ...requestBody, model: normalized.model };

  return axios.post<AnthropicResponse>(url, body, { headers });
}

function createErrorResponse(errorMessage: string, model: string): AnthropicResponse {
  return {
    content: [
      {
        text: errorMessage,
        type: 'text',
      },
    ],
    model: model,
    role: 'assistant',
    stop_reason: 'end_turn',
    type: 'message',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}

function transformSuccessResponse(data: AnthropicResponse): AnthropicResponse {
  if (data && Array.isArray(data.content)) {
    const textBlocks = data.content.filter(
      (block: ContentBlock) => block && block.type === 'text' && typeof block.text === 'string'
    );

    if (textBlocks.length > 0) {
      const combinedText = textBlocks.map((b: ContentBlock) => b.text).join('\n\n');
      data.content = [
        {
          type: 'text',
          text: combinedText,
        },
      ];
    } else {
      data.content = [
        {
          type: 'text',
          text: '',
        },
      ];
    }
  }
  return data;
}

const processPrompt = createGenericProcessPrompt(
  'Anthropic',
  buildRequestBody,
  postToAnthropic,
  createErrorResponse,
  transformSuccessResponse
);

const handlePrompt = createPromptHandler(processPrompt, 'Anthropic');
const app = createApp(handlePrompt, 'Anthropic');

startServer(app, port, db.removeDatabaseFile);

