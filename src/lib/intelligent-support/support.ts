import 'server-only';
import { ProvideAIAnnotationsToolSchema, ProvideLinksToolSchema } from './schemas';

import type { CoreMessage } from 'ai';
import type { z } from 'zod';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { ProvideRecordsConsideredToolSchema } from './schemas';
import { zendeskTicketToAiMessages, type ZendeskMessage } from '../zendeskConversations';
import { systemPrompt } from './prompts';

const inkeepModel = 'inkeep-qa-expert';

export const generateQaModeResponse = async ({
  messages,
  metadata,
  supportApiKey,
}: {
  messages: ZendeskMessage[];
  metadata?: Record<string, string>;
  supportApiKey?: string;
}) => {
  const openai = createOpenAI({
    apiKey: supportApiKey || process.env.INKEEP_API_KEY,
    baseURL: 'https://api.inkeep.com/v1',
  });

  const formattedMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...zendeskTicketToAiMessages(messages),
  ];
  const { text, toolCalls } = await generateText({
    model: openai(inkeepModel),
    messages: formattedMessages as CoreMessage[],
    tools: {
      provideRecordsConsidered: {
        parameters: ProvideRecordsConsideredToolSchema,
      },
      provideAIAnnotations: {
        parameters: ProvideAIAnnotationsToolSchema,
      },
      provideLinks: {
        parameters: ProvideLinksToolSchema,
      },
    },
    toolChoice: 'auto',
  });

  const aiAnnotations = toolCalls.find(toolCall => toolCall.toolName === 'provideAIAnnotations')?.args
    .aiAnnotations as z.infer<typeof ProvideAIAnnotationsToolSchema>['aiAnnotations'];
  const recordsConsidered = toolCalls.find(toolCall => toolCall.toolName === 'provideRecordsConsidered')?.args
    .recordsConsidered as z.infer<typeof ProvideRecordsConsideredToolSchema>['recordsConsidered'];
  const links = toolCalls.find(toolCall => toolCall.toolName === 'provideLinks')?.args.links as z.infer<
    typeof ProvideLinksToolSchema
  >['links'];

  return {
    aiAnnotations,
    text,
    recordsConsidered,
    links,
  };
};
