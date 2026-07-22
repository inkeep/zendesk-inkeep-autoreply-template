import { z } from 'zod';

const optionalEnvironmentValue = z.preprocess(
  value => value === '' ? undefined : value,
  z.string().min(1).optional(),
);

const zendeskEnvSchema = z
  .object({
    ZENDESK_SUBDOMAIN: z
      .string()
      .min(1)
      .describe('Zendesk account subdomain used for API requests'),
    ZENDESK_OAUTH_CLIENT_ID: z
      .string()
      .min(1)
      .describe('Required identifier for the confidential Zendesk OAuth client'),
    ZENDESK_OAUTH_CLIENT_SECRET: z
      .string()
      .min(1)
      .describe('Required secret for the confidential Zendesk OAuth client'),
    ZENDESK_API_USER: optionalEnvironmentValue
      .describe('Deprecated Zendesk API user email used only as an OAuth migration fallback'),
    ZENDESK_API_TOKEN: optionalEnvironmentValue
      .describe('Deprecated Zendesk API token used only as an OAuth migration fallback'),
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.ZENDESK_API_USER) !== Boolean(env.ZENDESK_API_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ZENDESK_API_USER and ZENDESK_API_TOKEN must be provided together',
      });
    }
  });

export type ZendeskEnv = z.infer<typeof zendeskEnvSchema>;

export function getZendeskEnv(): ZendeskEnv {
  return zendeskEnvSchema.parse({
    ZENDESK_SUBDOMAIN: process.env.ZENDESK_SUBDOMAIN,
    ZENDESK_OAUTH_CLIENT_ID: process.env.ZENDESK_OAUTH_CLIENT_ID,
    ZENDESK_OAUTH_CLIENT_SECRET: process.env.ZENDESK_OAUTH_CLIENT_SECRET,
    ZENDESK_API_USER: process.env.ZENDESK_API_USER,
    ZENDESK_API_TOKEN: process.env.ZENDESK_API_TOKEN,
  });
}
