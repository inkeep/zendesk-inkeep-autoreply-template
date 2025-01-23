import type { CoreMessage } from 'ai';

export interface ZendeskMessage {
  id: string;
  received: string;
  author: {
    userId?: string;
    displayName?: string;
    avatarUrl?: string;
    type: 'user' | 'business';
  };
  content: {
    type: string;
    text: string;
  };
  source?: {
    integrationId?: string;
    type: string;
  };
}

export function zendeskTicketToAiMessages(messages: ZendeskMessage[]): CoreMessage[] {
  return [
    ...messages.map(
      message =>
        ({
          role: message.author.type === 'user' ? 'user' : 'assistant',
          content: message.content.text,
        }) as CoreMessage,
    ),
  ];
}
