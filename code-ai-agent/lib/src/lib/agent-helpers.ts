import axios from 'axios';
import * as db from './db-instance';

export type DataEntry = { file_path: string; file_content: string };

export type ConversationStep = {
  role: 'user' | 'assistant';
  content: string;
};

export async function buildConversationMessages(): Promise<ConversationStep[]> {
  const promptRecord = await db.get<{ value: string }>('SELECT value FROM config WHERE key = ?', ['prompt']);
  const prompt = promptRecord?.value?.trim() ?? '';
  const dataEntries = await db.all<DataEntry>('SELECT file_path, file_content FROM data ORDER BY id ASC');

  const messages: ConversationStep[] = [];

  messages.push({
    role: 'user',
    content: 'I need your help on this project.',
  });

  for (const entry of dataEntries) {
    messages.push({
      role: 'assistant',
      content: `Please provide the content of the \`${entry.file_path}\` file.`,
    });
    messages.push({
      role: 'user',
      content: `Here is the content of the \`${entry.file_path}\` file:\n\`\`\`\n${entry.file_content}\n\`\`\`\n`,
    });
  }

  if (!dataEntries.length && !prompt) {
    messages.push({
      role: 'assistant',
      content: 'How would you like to proceed with this project?',
    });
  }

  if (prompt) {
    messages.push({
      role: 'assistant',
      content: 'What would you like to do next?',
    });
    messages.push({
      role: 'user',
      content: prompt,
    });
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') {
    messages.push({
      role: 'user',
      content: 'Please let me know how you would like to proceed.',
    });
  }

  return messages;
}

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      return `API Error (${error.response.status}): ${JSON.stringify(error.response.data)}`;
    } else if (error.request) {
      return 'Network error: No response received from the API.';
    } else {
      return `Request error: ${error.message}`;
    }
  } else if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return 'An unknown error occurred while processing your request.';
}

export function createGenericProcessPrompt<TRequestBody, TResponse>(
  agentName: string,
  buildRequest: (instructions: string, model: string) => Promise<TRequestBody>,
  postToApi: (requestBody: TRequestBody, apiKey: string, model: string) => Promise<{ data: TResponse }>,
  createErrorResponse: (errorMessage: string, model: string) => TResponse,
  transformSuccessResponse?: (data: TResponse) => TResponse
): (apiKey: string, model: string, instructions: string) => Promise<TResponse> {
  return async (apiKey: string, model: string, instructions: string): Promise<TResponse> => {
    try {
      const requestBody = await buildRequest(instructions, model);
      const apiResponse = await postToApi(requestBody, apiKey, model);
      const data = apiResponse.data;

      if (transformSuccessResponse) {
        return transformSuccessResponse(data);
      }

      return data;
    } catch (error) {
      const errorMessage = extractErrorMessage(error);
      console.error(`${agentName} API error:`, errorMessage);
      return createErrorResponse(errorMessage, model);
    }
  };
}

