---
title: "Integrations"
description: "Discover, connect, and call provider integrations through OAuth or connector credentials."
order: 35
---

Veryfront integrations let applications and agents call third-party services on
behalf of users. An integration has four parts: a catalog, a connection, tools,
and transport surfaces.

## The four parts

- **Catalog:** Provider metadata, setup requirements, available tools, input
  schemas, and side-effect information.
- **Connection:** The authenticated provider account used by managed execution.
  A connection can be personal to a user or shared with a project. Local
  connector credentials are resolved by the host for account-free execution and
  are not recorded in connection inventory.
- **Tools:** Provider operations such as `gmail__list_emails` or
  `salesforce__find_customer`. The catalog defines their names and schemas;
  managed connections supply provider access, while local tools use host-
  resolved credentials.
- **Transport:** REST and GraphQL expose the hosted discovery, connection, status,
  and call lifecycle. MCP, the Veryfront framework/TypeScript client, and the
  Veryfront CLI expose integration tools where their current runtime supports
  them; they do not all provide connection-management operations.

The hosted API flow is `discover → connect → status → call`. No integration
policy setup is required. REST and GraphQL calls can include an optional
`connection_id` when a project has multiple accessible accounts; framework
tool calls currently use the connection selected by the hosted runtime, and a
`connection_id` passed inside tool arguments is provider input rather than an
account selector.

## Prerequisites

- A Veryfront project with a configured agent (see [Agents](./agents.md)).
- The integration tool names the agent needs.
- For managed execution, a project token or hosted runtime that can reach the
  Veryfront integration tool endpoints.
- For local execution, provider credentials in the project environment.
- Project environment credentials only for static-credential connectors or an
  explicitly selected custom OAuth app override (see [OAuth](./oauth.md)).

## Run account-free local integration tools

Use the catalog-backed local source to call supported REST integrations from a
local or self-hosted project without a Veryfront account or project token:

```ts
import { agent } from "veryfront/agent";
import { createLocalIntegrationToolSource } from "veryfront/integrations";
import { loadRemoteToolsFromSource } from "veryfront/tool";

const source = createLocalIntegrationToolSource({
  tools: ["salesforce__find_customer"],
});
const integrationTools = await loadRemoteToolsFromSource(source);

export default agent({
  system: "Use Salesforce when the user asks about a customer.",
  tools: integrationTools,
});
```

The exact canonical IDs passed to `tools` are the source's capability grant.
Source configuration is monotonic. It is source-qualified and monotonic:
integrations.allow only narrows that grant
when the source runs inside a Veryfront project runtime. It never enables
another tool or selects a credential. The runtime resolves each credential
immediately before the request and never sends local credentials to Veryfront,
the model, tool arguments, logs, or request URLs.

The host must explicitly allow local credential use. Set
`VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS=1` on a local or dedicated
self-hosted runtime. Leave it unset on shared, hosted, and proxy runtimes.
Project environment variables cannot grant this host-owned capability.
Veryfront does not infer the deployment shape. Setting the exact host variable
authorizes local credential use for the current non-proxy process.

By default, the source reads the credential environment variables declared by
the connector catalog from the active project environment. An application can
instead pass a `credentialProvider` that resolves those names from its own
secret manager. The provider receives credential names only.

This first local execution path supports fixed HTTPS REST endpoints with
header API keys, Basic authentication, OAuth 2.0 client credentials, and the
Salesforce service-account specialization. It rejects authorization-code OAuth,
query-string credentials, GraphQL, response enrichment, multipart bodies, raw
bodies, dynamic endpoint origins, and tools outside the exact grant. Use managed
execution for per-user OAuth and other unsupported connector features.

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
removes it from that agent without changing connections or credentials.

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

This source configuration is local capability selection. The runtime loads it
from the same branch, release, or environment as the agent and intersects it
with the agent declaration and connector catalog. It cannot enable an
integration, select a credential scope, create a connection, or grant access
to an account. The removed `scope`, `perUser`, and `tools` fields are rejected
rather than normalized or silently ignored. Source configuration intentionally
has no credential, provider-configuration, or execution-mode fields.

The project runtime establishes this restriction once per request. Direct
`agent.generate`, `agent.stream`, and `agent.respond` calls made by project
routes inherit it, as do AG-UI handlers and in-process agent delegation. Hosted
or durable child processes receive the already-narrowed manifest explicitly at
their execution boundary. A standalone `agent()` invoked outside a Veryfront
project runtime has no project source configuration to load.

## Connection state

There is no project integration policy or policy setup step. These are the
independent contracts:

- Agent source controls which tools belong to an agent.
- Source configuration can narrow integrations and tools for an exact source
  target.
- Connection inventory records which project or user has authenticated.

The agent source and source configuration select eligible tools from the
catalog. Managed OAuth tools additionally require an authenticated connection
to run. Local static-credential tools resolve their credentials from the host
environment or credential provider and do not use connection inventory. Adding
a tool does not create a connection. Connecting OAuth does not
rewrite agent source or source configuration. If a project has several
accessible accounts, a REST or GraphQL call can provide an optional
`connection_id`; Veryfront validates that it belongs to the project and is
visible to the caller. Framework tool calls use the runtime-selected
connection.

## Authentication flow

When an agent calls an OAuth integration tool and no valid connection exists:

1. The tool returns an `authentication_required` result with a connect URL.
2. The agent surfaces the connect action to the user.
3. The user completes provider consent and the OAuth callback.
4. The control plane stores the connection for the selected project or user scope.
5. The run retries the tool with the new connection.
6. Later calls reuse or refresh that connection according to the provider's
   token lifecycle.

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

## Set up a provider

Use a provider guide when a connector needs provider-specific installation,
permissions, OAuth configuration, or service-account credentials.

| Provider   | Guide                                             |
| ---------- | ------------------------------------------------- |
| GitHub     | [Set up GitHub](./integrations/github.md)         |
| Jira       | [Set up Jira](./integrations/jira.md)             |
| Salesforce | [Set up Salesforce](./integrations/salesforce.md) |

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
   connection independently of agent source and source configuration.

## Next

- [Set up GitHub](./integrations/github.md)
- [Set up Jira](./integrations/jira.md)
- [Set up Salesforce](./integrations/salesforce.md)

## Related

- [veryfront/integrations](../api-reference/veryfront/integrations.md): Connector catalog and helper API.
