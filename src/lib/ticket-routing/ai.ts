import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import type { CoreMessage } from 'ai';
import { generateObject } from 'ai';

export const StructuredLabelsSchema = z.object({
  subject: z
    .string()
    .describe('A concise (max 80 chars) subject line summarizing the main topic or request of the ticket.'),
  summary: z
    .string()
    .describe(
      'A clear, direct internal note capturing the key context and summary of key aks of the ticket. Will be left as an internal note to the support team.',
    ),
  category: z
    .union([
      z.literal('production_issue').describe('Issues affecting production systems or service disruptions'),
      z
        .literal('account_billing')
        .describe('Billing requests related to an existing account, including refunds, cancellations, etc.'),
      z.literal('feature_request').describe('Requests for new features or enhancements'),
      z.literal('other').describe('Any other category that does not fit well with the above categories'),
    ])
    .describe('The primary category of the ticket. Choose only from the valid options.'),
  invoiceId: z
    .string()
    .nullish()
    .describe(
      '(Optional) The invoice ID, if mentioned in the text. Should be undefined or null if no invoice ID is mentioned',
    ),
});

/* Using Inkeep */
const inkeepClient = createOpenAI({
  apiKey: process.env.AUTO_RESPONDER_INKEEP_API_KEY,
  baseURL: 'https://api.inkeep.com/v1',
});

const model = inkeepClient('inkeep-context-expert');

/* Using OpenAI for low-latency */
// const model = openai('gpt-4o');

export async function aiTriageTicket(serializedTicket: CoreMessage[]) {
  const { object } = await generateObject({
    model: model,
    schema: StructuredLabelsSchema,
    maxRetries: 2,
    messages: [
      {
        role: 'system',
        content: "You are a system that classifies and extracts data from a user's support request.",
      },
      ...serializedTicket,
    ],
  });

  return object;
}
