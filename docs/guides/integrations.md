---
title: "Integrations"
description: "Config-driven integration tools with OAuth, token management, and API execution across the built-in connector catalog."
order: 35
---

Veryfront integrations let agents call third-party services on behalf of users.
Enable an integration by adding it to `integrations` in `veryfront.config.ts`.

## Prerequisites

- A Veryfront project with a configured agent (see [Agents](./agents.md)).
- Provider credentials for each integration you enable: either a Veryfront Cloud
  token plus a project reference, or per-user OAuth credentials (see
  [OAuth](./oauth.md)).
- `veryfront.config.ts` is editable in your repo.

## Configuration

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  integrations: {
    // All tools, project-level token
    github: {},

    // Only specific tools
    slack: {
      tools: ["send-message", "list-channels"],
    },

    // Per-user tokens (each end-user authenticates individually)
    linear: {
      perUser: true,
    },
  },
});
```

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

## Available integrations

The built-in connector catalog shows the supported end-user surface by default:
Google Workspace (including Google Calendar), Microsoft 365, Atlassian, Slack,
GitHub, GitLab, Asana, Linear, Notion, Figma, Airtable, and Sentry.

Additional connector templates remain in the source tree but are hidden from the
CLI, MCP catalog tools, and runtime connector list unless they are explicitly
enabled with `VERYFRONT_EXPERIMENTAL_INTEGRATIONS`. Set it to a comma-separated
list such as `salesforce,stripe`, or to `all` for local experimentation. These
feature-gated templates are Anthropic, AWS, Bitbucket, Mixpanel, Neon, PostHog,
Salesforce, ServiceNow, Shopify, Snowflake, Stripe, Supabase, Trello, and
Twilio.

Use the generated integration metadata reference when you need exact exported
names or icon metadata:

- [`veryfront/integrations`](../api-reference/veryfront/integrations.md)

## Verify it worked

After enabling an integration:

1. Restart `veryfront dev`. The dev log lists the integration tools that were
   registered.
2. From an agent that includes the integration tools, send a message that
   exercises one tool. The AG-UI stream should include a tool call event with
   the integration's tool id and a non-error result.
3. For per-user OAuth integrations, confirm the user has authorized the provider
   first (see [OAuth](./oauth.md)). Calls fail with `401` if the user has no
   token.
