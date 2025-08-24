import 'server-only';
import { ProvideAnswerConfidenceToolSchema, ProvideLinksToolSchema } from './schemas';

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
    apiKey: supportApiKey || process.env.AUTO_RESPONDER_INKEEP_API_KEY,
    baseURL: 'https://api.inkeep.com/v1',
  });

  const formattedMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...zendeskTicketToAiMessages(messages),
  ];
  console.dir(formattedMessages, { depth: null });
  const { text, toolCalls } = await generateText({
    model: openai(inkeepModel),
    messages: formattedMessages as CoreMessage[],
    tools: {
      provideRecordsConsidered: {
        parameters: ProvideRecordsConsideredToolSchema,
      },
      provideAnswerConfidence: {
        parameters: ProvideAnswerConfidenceToolSchema,
      },
      provideLinks: {
        parameters: ProvideLinksToolSchema,
      },
    },
    toolChoice: 'auto',
  });

  const answerConfidence = toolCalls.find(toolCall => toolCall.toolName === 'provideAnswerConfidence')?.args
    .answerConfidence as z.infer<typeof ProvideAnswerConfidenceToolSchema>['answerConfidence'];
  const recordsConsidered = toolCalls.find(toolCall => toolCall.toolName === 'provideRecordsConsidered')?.args
    .recordsConsidered as z.infer<typeof ProvideRecordsConsideredToolSchema>['recordsConsidered'];
  const links = toolCalls.find(toolCall => toolCall.toolName === 'provideLinks')?.args.links as z.infer<
    typeof ProvideLinksToolSchema
  >['links'];

  return {
    answerConfidence,
    text,
    recordsConsidered,
    links,
  };
};
