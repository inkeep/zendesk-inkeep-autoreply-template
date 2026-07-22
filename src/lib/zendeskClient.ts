import { createClient } from 'node-zendesk';
import { z } from 'zod';
import { getZendeskEnv, type ZendeskEnv } from '@/env';

const ZENDESK_RUNTIME_SCOPE =
  'tickets:read tickets:write users:read organizations:read';
const MAX_TOKEN_RETRIES = 3;
const TOKEN_RETRY_BASE_DELAY_MS = 250;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

type ZendeskClient = ReturnType<typeof createClient>;

function createLegacyClient(env: ZendeskEnv): ZendeskClient | undefined {
  if (!env.ZENDESK_API_USER || !env.ZENDESK_API_TOKEN) {
    return undefined;
  }

  return createClient({
    username: env.ZENDESK_API_USER,
    token: env.ZENDESK_API_TOKEN,
    subdomain: env.ZENDESK_SUBDOMAIN,
    throwOriginalException: true,
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestOAuthAccessToken(env: ZendeskEnv): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.ZENDESK_OAUTH_CLIENT_ID,
    client_secret: env.ZENDESK_OAUTH_CLIENT_SECRET,
    scope: ZENDESK_RUNTIME_SCOPE,
  });
  for (let attempt = 0; attempt <= MAX_TOKEN_RETRIES; attempt += 1) {
    const response = await fetch(`https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/oauth/tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (response.ok) {
      const result = tokenResponseSchema.safeParse(await response.json());
      if (!result.success) {
        throw new Error('Zendesk OAuth token response was invalid');
      }
      return result.data.access_token;
    }

    const isServerError = response.status >= 500 && response.status < 600;
    if (!isServerError || attempt === MAX_TOKEN_RETRIES) {
      throw new Error(`Zendesk OAuth token request failed with status ${response.status}`);
    }

    console.warn(
      `Zendesk OAuth token acquisition failed; retrying (${attempt + 1}/${MAX_TOKEN_RETRIES})`,
    );
    await delay(TOKEN_RETRY_BASE_DELAY_MS * 2 ** attempt);
  }

  throw new Error('Zendesk OAuth token acquisition failed');
}

export async function createZendeskClient(): Promise<ZendeskClient> {
  const env = getZendeskEnv();
  try {
    const accessToken = await requestOAuthAccessToken(env);
    return createClient({
      token: accessToken,
      oauth: true,
      subdomain: env.ZENDESK_SUBDOMAIN,
      throwOriginalException: true,
    });
  } catch (error) {
    const legacyClient = createLegacyClient(env);
    if (!legacyClient) {
      throw error;
    }

    console.warn('Zendesk OAuth token acquisition failed; using deprecated API-token fallback');
    return legacyClient;
  }
}
