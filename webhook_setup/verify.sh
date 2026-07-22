#!/bin/bash

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$SCRIPT_DIR/../.env"
webhooks_response=""
triggers_response=""

# shellcheck source=webhook_setup/auth.sh
source "$SCRIPT_DIR/auth.sh"

# Check if .env file exists in parent directory
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found in parent directory"
    exit 1
fi

# Load environment variables from .env file in parent directory
# shellcheck disable=SC1090
source "$ENV_FILE"

# Check if required variables are set
if [ -z "$ZENDESK_OAUTH_CLIENT_ID" ] || [ -z "$ZENDESK_OAUTH_CLIENT_SECRET" ] || [ -z "$ZENDESK_SUBDOMAIN" ] || [ -z "$AI_PROCESSING_ENDPOINT" ]; then
    echo "Error: ZENDESK_OAUTH_CLIENT_ID, ZENDESK_OAUTH_CLIENT_SECRET, ZENDESK_SUBDOMAIN, and AI_PROCESSING_ENDPOINT must be set in .env file"
    exit 1
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Please install it first:"
    echo "  For Ubuntu/Debian: sudo apt-get install jq"
    echo "  For MacOS: brew install jq"
    exit 1
fi

if ! zendesk_initialize_auth "webhooks:read triggers:read"; then
    exit 1
fi

# First, get all webhooks
echo "Fetching webhooks..."
if ! zendesk_request webhooks_response \
  -X GET "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/webhooks"; then
    echo "Error: Failed to contact Zendesk while fetching webhooks"
    exit 1
fi

# Echo full response for debugging
echo "Full Response:"
echo "$webhooks_response"

# Check HTTP status code
http_status="$ZENDESK_HTTP_STATUS"

if [ "$http_status" != "200" ]; then
    echo "Error: Failed to fetch webhooks. Status code: $http_status"
    echo "Response:"
    echo "$webhooks_response"
    echo "Please verify:"
    echo "1. Your ZENDESK_SUBDOMAIN is correct: $ZENDESK_SUBDOMAIN"
    echo "2. Your API credentials are correct"
    echo "3. You have the necessary permissions to access webhooks"
    exit 1
fi

json_response="$webhooks_response"

# Debug webhook response
echo "Debug - Webhook Response:"
echo "$json_response" | jq '.' || echo "Failed to parse JSON response"

# Check if our endpoint exists as a webhook (fixed to handle proper Zendesk response structure)
matching_webhook=$(echo "$json_response" | jq --arg endpoint "$AI_PROCESSING_ENDPOINT" '.webhooks[] | select(.endpoint == $endpoint)')

if [ -z "$matching_webhook" ]; then
    echo "No webhook found with endpoint: $AI_PROCESSING_ENDPOINT"
    exit 1
else
    webhook_id=$(echo "$matching_webhook" | jq -r '.id')
    echo "Found webhook with ID: $webhook_id"
fi

# Get all active triggers
echo "Fetching triggers..."
if ! zendesk_request triggers_response \
  -X GET "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/triggers/active.json"; then
    echo "Error: Failed to contact Zendesk while fetching triggers"
    exit 1
fi

if [ "$ZENDESK_HTTP_STATUS" != "200" ]; then
    echo "Error: Failed to fetch triggers. Status code: $ZENDESK_HTTP_STATUS"
    echo "$triggers_response"
    exit 1
fi

# Echo raw response
echo "Raw Triggers Response:"
echo "$triggers_response"

# Extract and validate JSON
echo -e "\nParsed Triggers JSON:"
echo "$triggers_response" | jq '.' || echo "Failed to parse triggers JSON response"

# Check for triggers using our webhook
echo "Checking for webhook-trigger pairs..."
matching_triggers=$(echo "$triggers_response" | jq --arg webhook_id "$webhook_id" '
  .triggers[] | 
  select(.actions[] | 
    select(.field == "notification_webhook" and .value[0] == $webhook_id)
  )')

if [ -z "$matching_triggers" ]; then
    echo "No triggers found connected to webhook ID: $webhook_id"
    exit 1
else
    echo "Found the following webhook-trigger pairs:"
    echo "Webhook ID: $webhook_id"
    echo "Connected triggers:"
    echo "$matching_triggers" | jq -r '["Title:", .title, "\nID:", .id, "\nDescription:", .description] | join(" ")'
    echo "Webhook and trigger(s) are properly connected!"
    exit 0
fi
