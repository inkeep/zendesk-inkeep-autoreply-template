# Zendesk AI Auto Responder

This template repo contains a NextJS app as well as bash scripts that will help you configure your zendesk workspace to use Inkeep to auto-respond to new tickets using your Inkeep project.


## Quick Setup

1. Deploy to Vercel using the button below and provide the required environment variables:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Finkeep%2Fzendesk-inkeep-template&env=ZENDESK_SUBDOMAIN,ZENDESK_API_TOKEN,ZENDESK_API_USER,INKEEP_API_KEY&envDescription=API%20keys%20required%20for%20successful%20deployment&project-name=zendesk-inkeep-autoresponder&repository-name=zendesk-inkeep-autoresponder)

Required environment variables:
- `ZENDESK_SUBDOMAIN`: Your Zendesk subdomain (e.g., if your Zendesk URL is mycompany.zendesk.com, enter 'mycompany')
- `ZENDESK_API_TOKEN`: Generate at [Zendesk API token docs](https://support.zendesk.com/hc/en-us/articles/4408889192858-Generating-a-new-API-token)
- `ZENDESK_API_USER`: Email address of your Zendesk user
- `AUTO_RESPONDER_INKEEP_API_KEY`: Your Inkeep API key

Optional:
- `AI_AGENT_USER_ID`: The User ID you'd like the AI bot to have if leaving internal comments

2. Copy `.env.sample` to `.env` and fill in all required values

3. Run the setup script to create the Zendesk webhook and trigger:
```bash
chmod +x ./setup.sh
./setup.sh
```

## Troubleshooting

### Webhook/Trigger Issues
If you experience problems with the webhook or trigger:

1. Manually deactivate them in Zendesk:
   - Visit `https://YOUR-SUBDOMAIN.zendesk.com/admin/objects-rules/rules/triggers`
   - Replace YOUR-SUBDOMAIN with your Zendesk subdomain

2. Or run the cleanup script to remove the trigger/webhook pair:
```bash
chmod +x ./cleanup.sh
./cleanup.sh
```

## Debug Mode

To run the AI Autoresponder in debug mode:

1. Set the environment variable: `INTERNAL_ONLY=true`
2. Redeploy the application

In debug mode, the AI Auto Responder will only create internal notes (not visible to end-users) when responding to tickets.
