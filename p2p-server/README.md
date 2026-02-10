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

AgentCore validates JWT bearer tokens at the gateway before requests reach the relay. Configure during deployment:

```json
{
  "authorizerConfiguration": {
    "customJWTAuthorizer": {
      "discoveryUrl": "https://<your-idp>/.well-known/openid-configuration",
      "allowedClients": ["<client-id>"],
      "allowedAudience": ["<audience>"]
    }
  }
}
```

Supported identity providers: Amazon Cognito, Okta, Microsoft Entra ID, or any OIDC-compliant provider.

### Connecting with OAuth

```python
from bedrock_agentcore.runtime import AgentCoreRuntimeClient

client = AgentCoreRuntimeClient(region="us-west-2")
ws_url, headers = client.generate_ws_connection_oauth(
    runtime_arn="<agent-runtime-arn>",
    bearer_token="<your-jwt-token>"
)
# Use ws_url + headers with any WebSocket client
```

From the browser (agi.html/mesh.html), pass the bearer token as a query parameter or in the first message after connecting.

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
