import { InkeepAnalytics } from '@inkeep/inkeep-analytics';
import type { CreateOpenAIConversation, Messages, OpenAIConversation, UserProperties } from '@inkeep/inkeep-analytics/models/components';

export async function logToInkeepAnalytics({
  messagesToLogToAnalytics,
  properties,
  userProperties,
}: {
  messagesToLogToAnalytics: Messages[];
  properties?: { [k: string]: any } | null | undefined;
  userProperties?: UserProperties | null | undefined;
}): Promise<(OpenAIConversation & { type: 'openai' }) | undefined> {
  if (!process.env.AUTO_RESPONDER_INKEEP_API_KEY) {
    return undefined;
  }

  const apiIntegrationKey = process.env.AUTO_RESPONDER_INKEEP_API_KEY;
  const inkeepAnalytics = new InkeepAnalytics({ apiIntegrationKey });

  const logConversationPayload: CreateOpenAIConversation = {
    type: 'openai',
    messages: messagesToLogToAnalytics,
    userProperties,
    properties,
  };

  try {
    const loggedConversation = (await inkeepAnalytics.conversations.log(
      {
        apiIntegrationKey,
      },
      logConversationPayload,
    )) as OpenAIConversation;

    return loggedConversation;
  } catch (err) {
    console.error('Error logging conversation', err);
    return undefined;
  }
}
