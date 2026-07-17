---
title: "Integrations"
description: "Agent-authorized integration tools with OAuth, token management, and API execution across the built-in connector catalog."
order: 35
---

Veryfront integrations let agents call third-party services on behalf of users.
Integration availability comes from the agent's tool configuration and current
connection state. Veryfront Code does not synchronize integration configuration
to the API or enable and disable integrations from `veryfront.config.ts`.

Remove any top-level `integrations` block from `veryfront.config.ts`. Veryfront
rejects that removed key to prevent a silent no-op. Assign tools to agents and
manage provider connections through Studio or the backing API instead.

## Prerequisites

- A Veryfront project with a configured agent (see [Agents](./agents.md)).
- Provider credentials for each integration you use: either a Veryfront Cloud
  token plus a project reference, or per-user OAuth credentials (see
  [OAuth](./oauth.md)).

## Authentication flow

When an agent calls an integration tool and no valid token exists:

1. Tool returns `{ error: "authentication_required", connectUrl: "..." }`
2. Agent surfaces the connect URL to the user
3. User selects the connect URL and completes the configured OAuth app, provider
   consent screen, and callback flow
4. The backing API layer stores the resulting token according to its configured
   token store
5. Subsequent tool calls can use that token automatically
6. Refresh behavior depends on the provider and the API/service layer you run
   behind these endpoints

### OAuth credentials and deployment model

The open-core repo exposes provider metadata, OAuth handler building blocks, and
integration/runtime helpers. Managed OAuth defaults, shared provider apps, and
token-vault behavior depend on the API/service layer you deploy behind these
endpoints.

### BYO credentials

Enterprise teams can use their own OAuth app credentials by setting environment
variables:

```bash
GITHUB_CLIENT_ID=<GITHUB_CLIENT_ID>
GITHUB_CLIENT_SECRET=<GITHUB_CLIENT_SECRET>
```

When these are set in the backing API environment, the OAuth handlers use them
directly.

### Credential-based integrations

Most catalog connectors authenticate with static credentials instead of a user
OAuth flow: API keys, HTTP Basic pairs, or OAuth client-credentials apps. These
read their secrets from the project's environment variables, named by each
connector's setup guide:

```bash
# .env
STRIPE_SECRET_KEY=sk_test_...
TELEGRAM_BOT_TOKEN=123456789:ABC...
PERSONIO_CLIENT_ID=...
PERSONIO_CLIENT_SECRET=...
```

No connect step is needed; tools work as soon as the variables are set. Each
connector declares how its credential is sent (header, query parameter, Basic
pair, or minted client-credentials token), so agents never handle raw secrets.

## Available integrations

The built-in connector catalog contains 204 connectors. The supported set is
visible by default in the CLI, MCP catalog tools, and runtime connector list:

`airtable`, `asana`, `calendar`, `confluence`, `docs-google`, `drive`, `figma`,
`github`, `gitlab`, `gmail`, `harvest`, `hubspot`, `jira`, `linear`, `notion`,
`onedrive`, `outlook`, `sentry`, `sharepoint`, `sheets`, `slack`, and `teams`.

The rest of the catalog ships as feature-gated integrations: the connector
templates are in the source tree but stay hidden until you expose them with the
`VERYFRONT_EXPERIMENTAL_INTEGRATIONS` environment variable. Set it to a
comma-separated list of connector names such as `salesforce,stripe` (to expose
Salesforce and Stripe), or to `all` for local experimentation.

The supported and feature-gated name lists are defined in
`src/integrations/feature-flags.ts` (`SUPPORTED_INTEGRATION_NAMES` and
`DECLARED_INTEGRATION_NAMES`). Use the generated integration metadata reference
when you need exact exported names or icon metadata:

- [`veryfront/integrations`](../api-reference/veryfront/integrations.md)

## Verify it worked

After an integration is available to an agent:

1. From an agent that includes the integration tools, send a message that
   exercises one tool. The AG-UI stream should include a tool call event with
   the integration's tool id and a non-error result.
2. For per-user OAuth integrations, confirm the user has authorized the provider
   first (see [OAuth](./oauth.md)). Calls fail with `401` if the user has no
   token.
