#!/bin/bash

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_FILE="$SCRIPT_DIR/../.env"
RESOURCES_FILE="$SCRIPT_DIR/../.zendesk-resources"
response=""

# shellcheck source=webhook_setup/auth.sh
source "$SCRIPT_DIR/auth.sh"

echo "WARNING: This script will delete Zendesk resources from your instance."
echo "Resources that will be deleted:"
echo "- Webhook for Inkeep AI Response"
echo "- Trigger for sending new tickets to AI processing"
echo ""
echo "Please carefully review this script and consider the impact on your Zendesk environment before proceeding."
echo "This script comes with NO WARRANTY and you run it at your own risk."
echo ""
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "Cleanup cancelled"
    exit 1
fi
# Load environment variables
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found"
    exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

# Check if .zendesk-resources exists
if [ ! -f "$RESOURCES_FILE" ]; then
    echo "Error: .zendesk-resources file not found"
    exit 1
fi

# Validate required environment variables
missing_vars=()
if [ -z "$ZENDESK_OAUTH_CLIENT_ID" ]; then
    missing_vars+=("ZENDESK_OAUTH_CLIENT_ID")
fi
if [ -z "$ZENDESK_OAUTH_CLIENT_SECRET" ]; then
    missing_vars+=("ZENDESK_OAUTH_CLIENT_SECRET")
fi
if [ -z "$ZENDESK_SUBDOMAIN" ]; then
    missing_vars+=("ZENDESK_SUBDOMAIN")
fi

if [ ${#missing_vars[@]} -ne 0 ]; then
    echo "Error: The following required environment variables are missing:"
    printf '%s\n' "${missing_vars[@]}"
    echo "Please ensure these variables are set in your .env file"
    exit 1
fi

if ! zendesk_initialize_auth "webhooks:write triggers:write"; then
    exit 1
fi

# Read and process each line from .zendesk-resources
while IFS='=' read -r key value; do
    # Skip empty lines
    [ -z "$key" ] && continue
    echo "Processing resource: $key"
    case "$key" in
        "WEBHOOK_ID")
            echo "Deleting webhook with ID: $value"
            if ! zendesk_request response \
                -X DELETE "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/webhooks/$value"; then
                echo "Error contacting Zendesk while deleting webhook"
                continue
            fi
            if [[ "$ZENDESK_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
                echo "Successfully deleted webhook"
            else
                echo "Error deleting webhook (status $ZENDESK_HTTP_STATUS): $response"
            fi
            ;;
            
        "TRIGGER_ID")
            echo "Deleting trigger with ID: $value"
            if ! zendesk_request response \
                -X DELETE "https://$ZENDESK_SUBDOMAIN.zendesk.com/api/v2/triggers/$value.json"; then
                echo "Error contacting Zendesk while deleting trigger"
                continue
            fi
            if [[ "$ZENDESK_HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
                echo "Successfully deleted trigger"
            else
                echo "Error deleting trigger (status $ZENDESK_HTTP_STATUS): $response"
            fi
            ;;
            
        *)
            echo "Unknown resource type: $key"
            ;;
    esac
done < "$RESOURCES_FILE"

# Remove the resources file after cleanup
rm "$RESOURCES_FILE"
echo "Cleanup completed"
