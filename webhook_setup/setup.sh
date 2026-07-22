#!/bin/bash

# Constants
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WEBHOOK_NAME="Inkeep AI Response Webhook"
TRIGGER_NAME="Inkeep Send New Ticket to AI Processing"
RESOURCES_FILE="$SCRIPT_DIR/../.zendesk-resources"
ENV_FILE="$SCRIPT_DIR/../.env"
webhook_response=""
response=""

# shellcheck source=webhook_setup/auth.sh
source "$SCRIPT_DIR/auth.sh"

echo "Starting Zendesk AutoResponder setup script..."
echo "This script will set up the following resources in your Zendesk account:"
echo ""
echo "1. A webhook that will:"
echo "   - Listen for new ticket events"
echo "   - Send ticket data to: $AI_PROCESSING_ENDPOINT"
echo "   - The webhook handler is responsible for controlling the behavior of the AI responder"
echo ""
echo "2. A trigger that will:"
echo "   - Monitor for new tickets"
echo "   - Invoke the webhook to process tickets"
echo ""
echo "The webhook and trigger will work together to:"
echo "- Detect new support tickets"
echo "- Send ticket details to the AI processing endpoint"
echo "- Generate and post AI responses back to tickets"
echo ""
read -r -p "Press Enter to continue or any other key to exit..." key

if [[ $key != "" ]]; then
    echo "Setup cancelled"
    exit 0
fi

echo "=== Checking for .env file in parent directory ==="
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found in parent directory"
    echo "Please copy .env.sample to .env and populate the required values"
    exit 1
fi

echo "=== Loading environment variables from .env file ==="
# shellcheck disable=SC1090
source "$ENV_FILE"

echo "=== Validating required environment variables ==="
if [ -z "$ZENDESK_OAUTH_CLIENT_ID" ] || [ -z "$ZENDESK_OAUTH_CLIENT_SECRET" ] || [ -z "$ZENDESK_SUBDOMAIN" ] || [ -z "$AI_PROCESSING_ENDPOINT" ]; then
    echo "Error: The following required environment variables must be set in .env file:"
    echo "  - ZENDESK_OAUTH_CLIENT_ID"
    echo "  - ZENDESK_OAUTH_CLIENT_SECRET"
    echo "  - ZENDESK_SUBDOMAIN: $ZENDESK_SUBDOMAIN"
    echo "  - AI_PROCESSING_ENDPOINT: $AI_PROCESSING_ENDPOINT"
    exit 1
fi

if ! zendesk_initialize_auth "webhooks:read webhooks:write triggers:read triggers:write"; then
    exit 1
fi

echo "=== Starting webhook setup process ==="
if [ -n "$AI_RESPONDER_WEBHOOK_ID" ]; then
    echo "=== Verifying existing webhook ==="
    if ! zendesk_request webhook_response \
      -X GET "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/webhooks/$AI_RESPONDER_WEBHOOK_ID.json"; then
        echo "Error: Failed to contact Zendesk while verifying the webhook"
        exit 1
    fi
    
    if [[ ! "$ZENDESK_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] || [[ "$webhook_response" == *"\"error\""* ]]; then
        echo "Error: Provided webhook ID does not exist"
        exit 1
    fi
    echo "Using existing webhook with ID: $AI_RESPONDER_WEBHOOK_ID"
else
    echo "=== Creating new webhook ==="
    webhook_data=$(cat <<EOF
{
  "webhook": {
    "name": "$WEBHOOK_NAME",
    "endpoint": "$AI_PROCESSING_ENDPOINT",
    "http_method": "POST",
    "status": "active",
    "request_format": "json",
    "subscriptions": ["conditional_ticket_events"]
  }
}
EOF
)

    if ! zendesk_request webhook_response \
      -X POST "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/webhooks" \
      -H "Content-Type: application/json" \
      -d "$webhook_data"; then
        echo "Error: Failed to contact Zendesk while creating the webhook"
        exit 1
    fi
      
    if [[ ! "$ZENDESK_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] || [[ "$webhook_response" == *"\"error\""* ]]; then
        echo "Error creating webhook:"
        echo "$webhook_response"
        exit 1
    fi
    
    # Extract webhook ID using jq if available, fallback to grep with modified pattern
    if command -v jq >/dev/null 2>&1; then
        AI_RESPONDER_WEBHOOK_ID=$(echo "$webhook_response" | jq -r '.webhook.id')
    else
        AI_RESPONDER_WEBHOOK_ID=$(echo "$webhook_response" | grep -o '"webhook":{[^}]*"id":[0-9]*' | grep -o '[0-9]*$')
    fi
    
    if [ -z "$AI_RESPONDER_WEBHOOK_ID" ]; then
        echo "Error: Failed to extract webhook ID from response"
        exit 1
    fi
    echo "Webhook created successfully with ID: $AI_RESPONDER_WEBHOOK_ID"

    # Write webhook ID to resources file
    echo "=== Writing webhook ID to resources file ==="
    echo "WEBHOOK_ID=$AI_RESPONDER_WEBHOOK_ID" >> "$RESOURCES_FILE"
fi

echo "=== Preparing trigger configuration ==="
trigger_data=$(cat <<EOF
{
  "trigger": {
    "title": "$TRIGGER_NAME",
    "active": true,
    "position": 0,
    "conditions": {
      "all": [
        {
          "field": "status",
          "operator": "is",
          "value": "new"
        },
        {
          "field": "update_type",
          "operator": "is",
          "value": "Create"
        }
      ]
    },
    "actions": [
      {
        "field": "notification_webhook",
        "value": [
          "$AI_RESPONDER_WEBHOOK_ID",
          "{\"ticket_id\":\"\{\{ticket.id\}\}\",\"ticket_title\":\"\{\{ticket.title\}\}\"}"
        ]
      }
    ]
  }
}
EOF
)

echo "=== Creating Zendesk trigger ==="
if ! zendesk_request response \
  -X POST "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/triggers.json" \
  -H "Content-Type: application/json" \
  -d "$trigger_data"; then
    echo "Error: Failed to contact Zendesk while creating the trigger"
    exit 1
fi

if [[ "$ZENDESK_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]] && [[ "$response" == *"\"id\""* ]]; then
    trigger_id=$(echo "$response" | grep -o '"id":[0-9]*' | cut -d':' -f2)
    echo "Trigger created successfully with ID: $trigger_id"
    
    # Append trigger ID to resources file
    echo "TRIGGER_ID=$trigger_id" >> "$RESOURCES_FILE"
    echo "Resource IDs have been saved to .zendesk-resources file"
else
    echo "Error creating trigger:"
    echo "$response"
    exit 1
fi

echo "Setup complete! You can view your resources at:"
echo "- Trigger: https://$ZENDESK_SUBDOMAIN.zendesk.com/admin/objects-rules/rules/triggers/$trigger_id"
echo "- Webhook: https://$ZENDESK_SUBDOMAIN.zendesk.com/admin/apps-integrations/actions-webhooks/webhooks/$AI_RESPONDER_WEBHOOK_ID/details"
