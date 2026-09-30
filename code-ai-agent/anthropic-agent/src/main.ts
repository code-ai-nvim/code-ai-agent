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
    type: 'disabled' | 'between_tools';
  };
  output_config?: {
    effort: AnthropicEffort;
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

type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface AnthropicModelConfig {
  model: string;
  thinking?: {
    type: 'disabled' | 'between_tools';
  };
  effort?: AnthropicEffort;
}

// Normalize a model name that may carry a trailing provider-specific suffix.
// The project treats provider suffixes uniformly: split on the last `-`
// separator, keep the base model id, and map the suffix to the provider's valid
// API field when it is recognized. For Anthropic, valid effort values are
// `low`, `medium`, `high`, `xhigh`, and `max`; the `between_tools` thinking
// mode is used as the cheapest safe fallback for `none` or any unrecognized
// suffix. Models without a recognized trailing suffix are passed through
// unchanged, and model existence is validated by the upstream API.
function normalizeAnthropicModel(model: string): AnthropicModelConfig {
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
      return { model: baseModel, effort: suffix };
    case 'none':
    default:
      return { model: baseModel, thinking: { type: 'between_tools' } };
  }
}

async function buildRequestBody(instructions: string, model: string): Promise<AnthropicRequestBody> {
  const messages = await buildConversationMessages();
  const sanitizedInstructions = instructions.trim();
  const normalized = normalizeAnthropicModel(model);

  const requestBody: AnthropicRequestBody = {
    max_tokens: 128000,
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

  const normalized = normalizeAnthropicModel(model);
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
