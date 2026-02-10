# P2P WebSocket Relay Server

WebSocket message broker for agi.diy mesh networking. Deployed to AWS via [Bedrock AgentCore](https://github.com/aws/bedrock-agentcore-starter-toolkit) with OAuth authentication.

## Quick Start

```bash
pip install bedrock-agentcore-starter-toolkit websockets

# Configure
cd p2p-server
agentcore configure --entrypoint relay.py --non-interactive

# Test locally
agentcore launch --local
# → ws://localhost:8080

# Deploy to AWS
agentcore launch
# → Returns agent runtime ARN + WebSocket URL
```

## OAuth Authentication

AgentCore validates JWT bearer tokens at the gateway before requests reach the relay. Any OIDC-compliant provider works (Cognito, Okta, Microsoft Entra ID). Below uses Cognito as an example.

### 1. Create a Cognito User Pool

```bash
# Create user pool
aws cognito-idp create-user-pool \
  --pool-name agi-diy-relay \
  --auto-verified-attributes email \
  --query 'UserPool.Id' --output text
# → us-east-1_XXXXXXXXX

# Create app client (public — for browser use, no secret)
aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_XXXXXXXXX \
  --client-name agi-diy-web \
  --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --supported-identity-providers COGNITO \
  --allowed-o-auth-flows implicit \
  --allowed-o-auth-scopes openid \
  --callback-urls '["https://agi.diy/callback"]' \
  --query 'UserPoolClient.ClientId' --output text
# → YYYYYYYYYYYYYYYYYYYYYYYYYYYY

# Create a domain for the hosted UI
aws cognito-idp create-user-pool-domain \
  --user-pool-id us-east-1_XXXXXXXXX \
  --domain agi-diy-relay

# Create a test user
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username testuser \
  --temporary-password 'TempPass123!' \
  --user-attributes Name=email,Value=you@example.com
```

### 2. Configure AgentCore with OAuth

Run `agentcore configure` interactively and select JWT authorization, or pass the config directly:

```bash
agentcore configure --entrypoint relay.py
# When prompted for authorization, choose "JWT Bearer Token" and provide:
#   Discovery URL: https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX/.well-known/openid-configuration
#   Allowed Clients: YYYYYYYYYYYYYYYYYYYYYYYYYYYY
```

Or create/edit `.bedrock_agentcore.yaml` to include:

```yaml
authorizer_configuration:
  custom_jwt_authorizer:
    discovery_url: https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXXXXXXX/.well-known/openid-configuration
    allowed_clients:
      - YYYYYYYYYYYYYYYYYYYYYYYYYYYY
```

Then deploy:

```bash
agentcore launch
# Note the agent runtime ARN from the output
```

### 3. Connect from the Browser

Get a token from Cognito's hosted UI, then connect to the relay:

```javascript
// Redirect user to Cognito login
const COGNITO_DOMAIN = 'agi-diy-relay.auth.us-east-1.amazoncognito.com';
const CLIENT_ID = 'YYYYYYYYYYYYYYYYYYYYYYYYYYYY';
const CALLBACK = encodeURIComponent('https://agi.diy/callback');
window.location = `https://${COGNITO_DOMAIN}/oauth2/authorize?response_type=token&client_id=${CLIENT_ID}&redirect_uri=${CALLBACK}&scope=openid`;

// After redirect, extract token from URL hash
const token = new URLSearchParams(window.location.hash.substring(1)).get('id_token');

// Connect to relay with token
const ws = new WebSocket(`wss://<runtime-endpoint>/ws?token=${token}`);
```

### 4. Connect from Python

```python
from bedrock_agentcore.runtime import AgentCoreRuntimeClient

client = AgentCoreRuntimeClient(region="us-east-1")
ws_url, headers = client.generate_ws_connection_oauth(
    runtime_arn="<agent-runtime-arn>",
    bearer_token="<your-jwt-token>"
)
# Use ws_url + headers with any WebSocket client
```

## Protocol

Messages are JSON with this base shape:

```json
{
  "type": "presence|heartbeat|broadcast|direct|stream|ack|turn_end|error",
  "from": "<peer-id>",
  "to": "<peer-id>",
  "data": {},
  "timestamp": 1234567890
}
```

| Type | Routing |
|------|---------|
| `presence` | Broadcast to all peers |
| `heartbeat` | Server only (updates last_seen) |
| `broadcast` | All peers except sender |
| `direct` | Single target peer |
| `stream` | All peers except sender |
| `ack` | All peers except sender |
| `turn_end` | All peers except sender |
| `error` | All peers except sender |

Peers that miss heartbeats for 30s are reaped automatically.

## Architecture

```text
Browser A ──ws──┐
Browser B ──ws──┤── AgentCore Gateway (OAuth) ──→ relay.py (port 8080)
Browser C ──ws──┘
```

The relay is stateless between restarts — peers reconnect and re-announce via `presence`.
