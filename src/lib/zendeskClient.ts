import { createClient } from 'node-zendesk';
import { z } from 'zod';
import { getZendeskEnv, type ZendeskEnv } from '@/env';

const ZENDESK_RUNTIME_SCOPE =
  'tickets:read tickets:write users:read organizations:read';
const MAX_TOKEN_RETRIES = 3;
const TOKEN_RETRY_BASE_DELAY_MS = 250;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
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

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
  };
  const candidates = [
    value.status,
    value.statusCode,
    value.response?.status,
    value.response?.statusCode,
  ];

  return candidates.find(candidate => typeof candidate === 'number') as number | undefined;
}

function isOAuthAuthorizationError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  return error instanceof Error && /\b(?:401|403)\b/.test(error.message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestOAuthAccessTokenOnce(env: ZendeskEnv): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.ZENDESK_OAUTH_CLIENT_ID,
    client_secret: env.ZENDESK_OAUTH_CLIENT_SECRET,
    scope: ZENDESK_RUNTIME_SCOPE,
  });
  const response = await fetch(`https://${env.ZENDESK_SUBDOMAIN}.zendesk.com/oauth/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const error = new Error(`Zendesk OAuth token request failed with status ${response.status}`);
    Object.assign(error, { status: response.status });
    throw error;
  }

  const result = tokenResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new Error('Zendesk OAuth token response was invalid');
  }

  return result.data.access_token;
}

async function requestOAuthAccessToken(env: ZendeskEnv): Promise<string> {
  for (let attempt = 0; attempt <= MAX_TOKEN_RETRIES; attempt += 1) {
    try {
      return await requestOAuthAccessTokenOnce(env);
    } catch (error) {
      const status = getStatusCode(error);
      const isServerError = status !== undefined && status >= 500 && status < 600;
      if (!isServerError || attempt === MAX_TOKEN_RETRIES) {
        throw error;
      }

      const retryNumber = attempt + 1;
      console.warn(
        `Zendesk OAuth token acquisition failed; retrying (${retryNumber}/${MAX_TOKEN_RETRIES})`,
      );
      await delay(TOKEN_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  throw new Error('Zendesk OAuth token acquisition failed');
}

export interface ZendeskClientProvider {
  run<T>(operation: (client: ZendeskClient) => Promise<T>): Promise<T>;
}

export async function createZendeskClientProvider(): Promise<ZendeskClientProvider> {
  const env = getZendeskEnv();
  const legacyClient = createLegacyClient(env);
  let hasLoggedFallback = false;

  const runWithLegacyFallback = async <T>(
    reason: string,
    operation: (client: ZendeskClient) => Promise<T>,
  ): Promise<T> => {
    if (!legacyClient) {
      throw new Error(`Zendesk OAuth ${reason}, and no legacy fallback is configured`);
    }

    if (!hasLoggedFallback) {
      console.warn(`Zendesk OAuth ${reason}; using deprecated API-token fallback`);
      hasLoggedFallback = true;
    }
    return operation(legacyClient);
  };

  return {
    async run<T>(operation: (zendeskClient: ZendeskClient) => Promise<T>): Promise<T> {
      let accessToken: string;

      try {
        accessToken = await requestOAuthAccessToken(env);
      } catch (error) {
        if (!legacyClient) {
          throw error;
        }
        return runWithLegacyFallback('token acquisition failed', operation);
      }

      const oauthClient = createClient({
        token: accessToken,
        oauth: true,
        subdomain: env.ZENDESK_SUBDOMAIN,
        throwOriginalException: true,
      });

      try {
        return await operation(oauthClient);
      } catch (error) {
        if (isOAuthAuthorizationError(error) && legacyClient) {
          return runWithLegacyFallback('request was rejected', operation);
        }
        throw error;
      }
    },
  };
}
