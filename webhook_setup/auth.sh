#!/bin/bash
# shellcheck disable=SC2034 # ZENDESK_HTTP_STATUS is consumed by scripts that source this file.

ZENDESK_ACCESS_TOKEN=""
ZENDESK_HTTP_STATUS=""
ZENDESK_OAUTH_SCOPE=""
ZENDESK_HAS_LOGGED_FALLBACK="false"

zendesk_has_legacy_credentials() {
    [ -n "$ZENDESK_API_USER" ] && [ -n "$ZENDESK_API_TOKEN" ]
}

zendesk_use_legacy_fallback() {
    local reason="$1"

    if ! zendesk_has_legacy_credentials; then
        return 1
    fi

    if [ "$ZENDESK_HAS_LOGGED_FALLBACK" != "true" ]; then
        echo "WARNING: Zendesk OAuth $reason; using deprecated API-token fallback" >&2
        ZENDESK_HAS_LOGGED_FALLBACK="true"
    fi
    return 0
}

zendesk_initialize_auth() {
    local scope="$1"

    if [ -z "$ZENDESK_SUBDOMAIN" ] || [ -z "$ZENDESK_OAUTH_CLIENT_ID" ] || [ -z "$ZENDESK_OAUTH_CLIENT_SECRET" ]; then
        echo "Error: ZENDESK_SUBDOMAIN, ZENDESK_OAUTH_CLIENT_ID, and ZENDESK_OAUTH_CLIENT_SECRET are required" >&2
        return 1
    fi

    if { [ -n "$ZENDESK_API_USER" ] && [ -z "$ZENDESK_API_TOKEN" ]; } || \
       { [ -z "$ZENDESK_API_USER" ] && [ -n "$ZENDESK_API_TOKEN" ]; }; then
        echo "Error: ZENDESK_API_USER and ZENDESK_API_TOKEN must be provided together" >&2
        return 1
    fi

    if ! command -v jq >/dev/null 2>&1; then
        echo "Error: jq is required to parse the Zendesk OAuth response" >&2
        return 1
    fi

    ZENDESK_OAUTH_SCOPE="$scope"
}

zendesk_request_access_token() {
    local token_file
    local curl_status

    ZENDESK_ACCESS_TOKEN=""
    token_file=$(mktemp)
    curl_status=$(curl -sS -o "$token_file" -w "%{http_code}" \
        -X POST "https://$ZENDESK_SUBDOMAIN.zendesk.com/oauth/tokens" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        --data-urlencode "grant_type=client_credentials" \
        --data-urlencode "client_id=$ZENDESK_OAUTH_CLIENT_ID" \
        --data-urlencode "client_secret=$ZENDESK_OAUTH_CLIENT_SECRET" \
        --data-urlencode "scope=$ZENDESK_OAUTH_SCOPE")
    local curl_exit=$?

    if [ "$curl_exit" -eq 0 ] && [[ "$curl_status" =~ ^2[0-9][0-9]$ ]]; then
        ZENDESK_ACCESS_TOKEN=$(jq -r '.access_token // empty' "$token_file")
    fi
    rm -f "$token_file"

    if [ -n "$ZENDESK_ACCESS_TOKEN" ]; then
        return 0
    fi

    echo "Zendesk OAuth token acquisition failed with status ${curl_status:-unknown}" >&2
    return 1
}

zendesk_request() {
    local output_variable="$1"
    shift
    local response_file
    local curl_status
    local response_body
    local request_auth_mode="oauth"

    response_file=$(mktemp)
    if ! zendesk_request_access_token; then
        if zendesk_use_legacy_fallback "token acquisition failed"; then
            request_auth_mode="legacy"
        else
            echo "Error: Zendesk OAuth token acquisition failed, and no legacy fallback is configured" >&2
            rm -f "$response_file"
            return 1
        fi
    fi

    if [ "$request_auth_mode" = "oauth" ]; then
        curl_status=$(curl -sS -o "$response_file" -w "%{http_code}" \
            -H "Authorization: Bearer $ZENDESK_ACCESS_TOKEN" "$@")
    else
        curl_status=$(curl -sS -o "$response_file" -w "%{http_code}" \
            -u "$ZENDESK_API_USER/token:$ZENDESK_API_TOKEN" "$@")
    fi
    local curl_exit=$?

    if [ "$curl_exit" -ne 0 ]; then
        rm -f "$response_file"
        return "$curl_exit"
    fi

    if [ "$request_auth_mode" = "oauth" ] && { [ "$curl_status" = "401" ] || [ "$curl_status" = "403" ]; }; then
        if zendesk_use_legacy_fallback "request was rejected"; then
            curl_status=$(curl -sS -o "$response_file" -w "%{http_code}" \
                -u "$ZENDESK_API_USER/token:$ZENDESK_API_TOKEN" "$@")
            curl_exit=$?
            if [ "$curl_exit" -ne 0 ]; then
                rm -f "$response_file"
                return "$curl_exit"
            fi
        fi
    fi

    response_body=$(<"$response_file")
    rm -f "$response_file"
    printf -v "$output_variable" '%s' "$response_body"
    ZENDESK_HTTP_STATUS="$curl_status"
}
