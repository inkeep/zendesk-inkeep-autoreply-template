import { z } from 'zod';
import { createClient } from 'node-zendesk';
import { generateQaModeResponse } from '@/lib/intelligent-support/support';
import type { ZendeskMessage } from '@/lib/zendeskConversations';
import type { CreateOrUpdateTicket } from 'node-zendesk/clients/core/tickets';
import { unstable_after as after } from 'next/server';
import type { User } from 'node-zendesk/clients/core/users';
import { encodeImageUrls, extractImageUrls, zendeskTicketToAiMessages } from '@/lib/zendeskConversations';
import { aiTriageTicket, formatTriageComment } from '@/lib/ticket-routing/ai';
import crypto from 'node:crypto';
import type { Messages } from '@inkeep/inkeep-analytics/models/components';
import { logToInkeepAnalytics } from '@/lib/analytics/logToInkeepAnalytics';

// Timeout of the Serverless Function. Increase if adding multiple AI steps. Check your Vercel plan.
export const maxDuration = 60;

// Initialize Zendesk client
const client = createClient({
  username: process.env.ZENDESK_API_USER!,
  token: process.env.ZENDESK_API_TOKEN!,
  subdomain: process.env.ZENDESK_SUBDOMAIN!,
});

// Add these constants at the top of the file
const SIGNING_SECRET = process.env.ZENDESK_WEBHOOK_SECRET!;
const SIGNING_SECRET_ALGORITHM = 'sha256';

function isValidSignature(signature: string, body: string, timestamp: string): boolean {
  const hmac = crypto.createHmac(SIGNING_SECRET_ALGORITHM, SIGNING_SECRET);
  const sig = hmac.update(timestamp + body).digest('base64');
  const isValid = Buffer.compare(Buffer.from(signature), Buffer.from(sig)) === 0;
  console.log(`Webhook signature verification: ${isValid ? 'successful' : 'failed'}`);
  return isValid;
}

const bodySchema = z
  .object({
    ticket_id: z.string().transform(val => Number.parseInt(val, 10)),
    ticket_title: z.string(),
  })
  .passthrough();

export const POST = async (req: Request) => {
  console.log('Received webhook request');
  // Get the signature headers
  const signature = req.headers.get('x-zendesk-webhook-signature');
  const timestamp = req.headers.get('x-zendesk-webhook-signature-timestamp');

  const isPublicResponsesEnabled = process.env.ENABLE_PUBLIC_RESPONSES === "true";

  // Get the raw body as text
  const rawBody = await req.text();

  // Verify the signature
  if (!signature || !timestamp || !isValidSignature(signature, rawBody, timestamp)) {
    console.log('Webhook request rejected: Invalid signature');
    return new Response(
      JSON.stringify({ error: 'Invalid webhook signature' }),
      { status: 401 }
    );
  }

  // Parse the body as JSON after verification
  let body: z.infer<typeof bodySchema>;
  try {
    body = JSON.parse(rawBody);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON in request body' }), { status: 400 });
  }

  const result = bodySchema.safeParse(body);

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: 'Invalid request parameters',
        details: result.error.issues,
      }),
      { status: 400 },
    );
  }

  const { ticket_id } = result.data;

  try {
    // Fetch ticket details and comments
    const [ticketResponse, commentsResponse] = await Promise.all([
      client.tickets.show(ticket_id),
      client.tickets.getComments(ticket_id),
    ]);

    const messagesToLogToAnalytics: Messages[] = [];
    const ticketProperties = {
      ticketId: ticket_id,
      ticketTitle: ticketResponse.result.subject,
    };

    // Get user and their organization details
    const requesterId = ticketResponse.result.requester_id;
    const [userDetailsResponse, userIdentitiesResponse] = await Promise.all([
      client.users.show(requesterId),
      client.useridentities.list(requesterId),
    ]);

    // If user belongs to an organization, fetch org details
    let orgDetails = null;
    if (userDetailsResponse.result.organization_id) {
      orgDetails = (await client.organizations.show(userDetailsResponse.result.organization_id)) as any;
    }

    // Access user and org metadata
    const userMetadata = userDetailsResponse.result.user_fields;
    const { organization_fields, tags, notes, name } = orgDetails?.result ?? {};

    // Create a cache for author details
    const authorCache = new Map<number, User>();

    // Get unique author IDs from comments
    const authorIds = [...new Set(commentsResponse.map(comment => comment.author_id))];

    // Fetch all unique authors in parallel
    await Promise.all(
      authorIds.map(async authorId => {
        const authorResponse = await client.users.show(authorId);
        authorCache.set(authorId, authorResponse.result);
      }),
    );

    const messagesPromises = await Promise.all(commentsResponse
      .map(async comment => {
        const author = authorCache.get(comment.author_id);
        if (!author) {
          return null;
        }

        const attachmentUrls = comment.attachments
          ?.filter((attachment: { content_type: string }) => attachment.content_type.startsWith('image/'))
          .map((attachment: { content_url: string }) => attachment.content_url) ?? [];

        const inlineImageUrls = extractImageUrls(comment.html_body);

        const imageUrls = [...attachmentUrls, ...inlineImageUrls];

        const images = imageUrls.length > 0 ? await encodeImageUrls(imageUrls) : [];

        const userMessageForAnalytics: Messages = {
          content: comment.body,
          role: 'user',
          userProperties: {
            userId: author.id,
            additionalProperties: {
              name: author.name,
              email: author.email,
              role: author.role,
            },
          },
        }
        messagesToLogToAnalytics.push(userMessageForAnalytics);

        return {
          id: comment.id,
          received: comment.created_at,
          author: {
            type: author.role === 'end-user' ? 'user' : 'business',
            name: author.name,
            email: author.email,
          },
          content: [{
            type: 'text',
            text: comment.body,
          }, ...images],
          source: {
            type: 'zendesk',
          },
        } as ZendeskMessage;
      })
    );

    const messages = messagesPromises.filter((message): message is ZendeskMessage => message !== null);

    const metadata = {
      ...userMetadata,
      organization_fields,
      tags,
      notes,
      name,
    };

    const author_id = process.env.AI_AGENT_USER_ID ? Number(process.env.AI_AGENT_USER_ID) : undefined;

    after(async () => {
      console.log(`Processing ticket ${ticket_id} with AI triage`);

      if ((process.env.AI_TRIAGE_ENABLED ?? false) === 'true') {
        const aiTriageData = await aiTriageTicket(zendeskTicketToAiMessages(messages));

        if (aiTriageData.category === 'account_billing') {
          console.log(`Ticket ${ticket_id}: Identified as billing issue, adding internal note`);

          const triageComment = formatTriageComment(aiTriageData);

          await client.tickets.update(ticket_id, {
            ticket: {
              comment: {
                body: triageComment,
                public: false, // only ever meant to be an internal note (not visible to the customer)
                ...(author_id && { author_id }),
              },
            },
          } as CreateOrUpdateTicket);

          const assistantMessageForAnalytics: Messages = {
            content: triageComment,
            role: 'assistant',
            userProperties: {
              userId: author_id,
              additionalProperties: {}, // This is required, even if empty
            },
            properties: {
              public: false,
            },
          }

          messagesToLogToAnalytics.push(assistantMessageForAnalytics);

          await logToInkeepAnalytics({
            messagesToLogToAnalytics,
            properties: ticketProperties,
          });

          return;
        }
      }

      const response = await generateQaModeResponse({ messages, metadata });
      console.log(`AI response generated for ticket ${ticket_id}`);

      switch (response.aiAnnotations.answerConfidence) {
        case 'very_confident': {
          console.log(`Posting ${isPublicResponsesEnabled ? 'public' : 'internal [ENABLE_PUBLIC_RESPONSES is off]'} comment to ticket ${ticket_id}`);
          await client.tickets.update(ticket_id, {
            ticket: {
              comment: {
                body: response.text,
                public: isPublicResponsesEnabled,
                ...(author_id && { author_id }),
              },
            },
          } as CreateOrUpdateTicket);

          const assistantMessageForAnalytics: Messages = {
            content: response.text,
            role: 'assistant',
            userProperties: {
              userId: author_id,
              additionalProperties: {}, // This is required, even if empty
            },
            properties: {
              public: isPublicResponsesEnabled
            },
          }

          messagesToLogToAnalytics.push(assistantMessageForAnalytics);
          break;
        }

        default: {
          console.log(`Adding low confidence note to ticket ${ticket_id}`);
          const confidenceNote = `AI Agent had ${response.aiAnnotations.answerConfidence} confidence level in its answer`;
          await client.tickets.update(ticket_id, {
            ticket: {
              comment: {
                body: confidenceNote,
                public: false,
                ...(author_id && { author_id }),
              },
            },
          } as CreateOrUpdateTicket);

          const assistantMessageForAnalytics: Messages = {
            content: confidenceNote,
            role: 'assistant',
            userProperties: {
              userId: author_id,
              additionalProperties: {}, // This is required, even if empty
            },
            properties: {
              public: false
            },
          }

          messagesToLogToAnalytics.push(assistantMessageForAnalytics);

          break;
        }
      }

      await logToInkeepAnalytics({
        messagesToLogToAnalytics,
        properties: ticketProperties,
      });
    });

    return Response.json({
      message: 'Ticket processed',
      ticketId: ticket_id,
      ticketTitle: ticketResponse.result.subject,
      commentCount: commentsResponse.length,
      userMetadata,
    });
  } catch (error) {
    console.error('Zendesk API error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process ticket with Zendesk API',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500 },
    );
  }
};
