---
title: "Integrations"
description: "Agent-declared tools with optional source and project policy, first-use OAuth, and remote execution."
order: 35
---

Veryfront integrations let agents call third-party services on behalf of users.
Declare the tools an agent can use in agent source. Optionally narrow those
capabilities in `veryfront.config.ts` and with project policy. Connection
inventory records credential readiness independently of all three.

## Prerequisites

- A Veryfront project with a configured agent (see [Agents](./agents.md)).
- The integration tool names the agent needs.
- A project token or hosted runtime that can reach the Veryfront integration
  tool endpoints.
- Project environment credentials only for static-credential connectors or an
  explicitly selected custom OAuth app override (see [OAuth](./oauth.md)).

## Declare agent tool access

List integration tools alongside the agent's other tools:

```md
---
name: Knowledge assistant
tools:
  - confluence__search_content
  - confluence__list_spaces
---

Search Confluence when the user asks about internal documentation.
```

The agent source is the capability declaration. Its tool list determines which
remote integration tools the agent can call. Removing a tool from agent source
removes it from that agent without changing project-wide policy or credentials.

## Narrow capabilities in source configuration

`veryfront.config.ts` can apply an optional allowlist to every agent running
from that exact source target:

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  integrations: {
    allow: {
      // Keep every Confluence tool declared by an agent eligible.
      confluence: {},

      // Keep only these connector-local GitHub tool IDs eligible.
      github: { allowedTools: ["list_repos", "get_repo"] },
    },
  },
});
```

Omitting `integrations` applies no source-level restriction. An empty
`integrations.allow` map denies every integration tool while leaving local
project tools unchanged. A listed integration with no `allowedTools` value
keeps all of its tools eligible; an empty array keeps none. Integration keys
must be canonical connector names, and tool entries are exact connector-local
IDs. The `integration__tool` namespace is reserved for integration tools, so
restricted runs treat every name in that namespace as an integration even when
the running framework build does not yet know its connector.

This policy is source-qualified and monotonic. The runtime loads it from the
same branch, release, or environment as the agent and intersects it with the
agent declaration, connector catalog, and control-plane policy. It cannot
enable an integration, select a credential scope, create a connection, or
override a control-plane restriction. The removed `scope`, `perUser`, and
`tools` fields are rejected rather than normalized or silently ignored. Source
policy intentionally has no credential, provider-configuration, or execution-mode
fields because those values do not have a generic monotonic merge rule.

The project runtime establishes this restriction once per request. Direct
`agent.generate`, `agent.stream`, and `agent.respond` calls made by project
routes inherit it, as do AG-UI handlers and in-process agent delegation. Hosted
or durable child processes receive the already-narrowed manifest explicitly at
their execution boundary. A standalone `agent()` invoked outside a Veryfront
project runtime has no project source configuration to load.

## Project policy and connection state

Project integration policy is an optional control-plane guardrail. Use Studio
or the integration policy API when a project must restrict an integration to a
scope or tool subset. An absent policy means there is no extra project-level
override. Deleting a policy returns it to that absent state.

These are four independent contracts:

- Agent source controls which tools belong to an agent.
- Source configuration can narrow integrations and tools for an exact source target.
- Project policy can narrow scope, tools, configuration, or execution mode.
- Connection inventory records which project or user has authenticated.

Adding a tool does not create policy or credentials. Connecting OAuth does not
rewrite agent source, source configuration, or project policy.

## Authentication flow

When an agent calls an OAuth integration tool and no valid connection exists:

1. The tool returns an `authentication_required` result with a connect URL.
2. The agent surfaces the connect action to the user.
3. The user completes provider consent and the OAuth callback.
4. The control plane stores the connection for the selected project or user scope.
5. The run retries the tool with the new connection.
6. Later calls reuse or refresh that connection according to provider policy.

OAuth connection happens during use. Adding a tool to agent source does not
require a connection in advance.

### Managed OAuth and custom app overrides

Managed OAuth connectors do not require project OAuth client credentials. Set
client ID and client secret environment variables only when the connector
supports and the project selects a custom OAuth app override:

```bash
GITHUB_CLIENT_ID=<GITHUB_CLIENT_ID>
GITHUB_CLIENT_SECRET=<GITHUB_CLIENT_SECRET>
```

The integration catalog metadata identifies these variables as OAuth client
overrides and reports whether managed OAuth is available.

### Credential-based integrations

Some connectors use static credentials instead of interactive OAuth. Store
those credentials in project environment variables named by the connector
metadata:

```bash
STRIPE_SECRET_KEY=<STRIPE_SECRET_KEY>
TELEGRAM_BOT_TOKEN=<TELEGRAM_BOT_TOKEN>
PERSONIO_CLIENT_ID=<PERSONIO_CLIENT_ID>
PERSONIO_CLIENT_SECRET=<PERSONIO_CLIENT_SECRET>
```

No OAuth connect step is shown for these connectors. The integration runtime
resolves their credentials during tool execution; agents do not receive raw
secrets.

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

1. Confirm the integration tool name is present in the agent source.
2. Start a new agent run and request an action that uses the tool.
3. If an OAuth connection is absent, complete the connect action and callback.
4. Confirm the run retries the tool and receives a non-error result.
5. Reload the project and confirm connection inventory still reports the
   connection independently of agent source and both policy layers.
