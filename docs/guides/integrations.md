---
title: "Integrations"
description: "Agent-declared tools with optional source and project policy, first-use OAuth, and remote execution."
order: 35
---

Veryfront integrations let agents call third-party services on behalf of users.
Declare the tools an agent can use in agent source. Optionally narrow those
capabilities in `veryfront.config.ts` and with project policy. Connection
inventory records credential readiness independently of all three.

## Prerequisites for agent tools

- A Veryfront project with a configured agent (see [Agents](./agents.md)).
- The integration tool names the agent needs.
- For managed execution, a project token or hosted runtime that can reach the
  Veryfront integration tool endpoints.
- For local execution, provider credentials in the project environment.
- Project environment credentials only for static-credential connectors or an
  explicitly selected custom OAuth app override (see [OAuth](./oauth.md)).

## Inspect readiness for one tool

Use `readiness` with a canonical tool name to read the server's selected-account
assessment. The client requests fresh metadata for its bound project on every
call; it does not cache readiness or contact the provider. Replace these
placeholders with your trusted API origin, project and selected connection:

```ts
import { createIntegrationClient } from "veryfront/integrations";

const client = await createIntegrationClient({
  apiBaseUrl: "<API_BASE_URL>",
  authToken: "<TOKEN>",
  projectReference: "<PROJECT_ID>",
});
const readiness = await client.readiness("github__get_current_user", {
  connectionId: "<CONNECTION_ID>",
});
console.log(readiness.selection.state);
console.log(readiness.local_eligibility.state);
console.log(readiness.provider_verification.state);
```

The equivalent CLI command is:

```bash
veryfront integration status github --project "<PROJECT_ID>" \
  --tool github__get_current_user --connection "<CONNECTION_ID>" --json
```

With `--tool`, status returns `selected_readiness` from the shared client instead
of deriving readiness from OAuth connectivity. `--scope` is rejected for this
operation: the selected connection determines its scope. An optional
`--expected-generation "<CONNECTION_GENERATION_ID>"` checks a previously observed
generation. A stale observation is returned as a blocked assessment, not repaired
by selecting another account.

`local_eligibility.state === "eligible"` means the evaluated local metadata checks
passed. It does not establish provider permission. Key presence cannot prove usable
credential values, and recorded shared-account metadata is not provider-verified
identity. Inspect `pending_checks` and `blockers`; `provider_verification.state`
remains `not_checked`. A later tool call still requires current authorization.

This method requires the selected-readiness API contract. A missing or malformed
projection, or a response for another project/tool/connection, throws
`IntegrationApiError` with `kind === "invalid_response"` and `outcomeUnknown === false`.
Changing project or platform credentials requires a new bound client. Concurrent
reads return independent results; the client never applies one response to another
selection. The selected account and generation are metadata, not a reusable grant.

## Call the connection generation you observed

For direct client calls, provide platform credentials, an authorized project and
an existing OAuth connection. Project access and provider authorization are
sufficient for this path.

Replace the placeholders below. Use your trusted HTTPS API origin and the exact
connection ID you selected from connection inventory. Read that connection's
current generation, then supply both identifiers to the call:

```ts
import { createIntegrationClient, type IntegrationClientConnection } from "veryfront/integrations";

const client = await createIntegrationClient({
  apiBaseUrl: "<API_BASE_URL>",
  authToken: "<TOKEN>",
  projectReference: "<PROJECT_ID>",
});
const selectedConnectionId = "<CONNECTION_ID>";
let observed: IntegrationClientConnection | undefined;
for await (const connection of client.listConnections("github")) {
  if (connection.id === selectedConnectionId && connection.scope === "user") {
    observed = connection;
    break;
  }
}
if (!observed || observed.status !== "connected") {
  throw new Error("Select a connected personal GitHub connection before calling.");
}
const outcome = await client.call("github__get_current_user", {}, {
  connectionId: observed.id,
  expectedConnectionGenerationId: observed.connection_generation_id,
});
console.log(outcome.status);
```

Use `scope === "project"` when you intentionally select a shared connection. A
reconnect can replace a generation between inventory and execution. The API
rejects a mismatched generation before reading credentials or calling the provider.
A generation match does not establish provider permission or prevent a later
provider-side revocation.

For the equivalent CLI call, copy the selected row's `id` and
`connection_generation_id` from inventory:

```bash
veryfront integration connections github --project "<PROJECT_ID>" --json
veryfront integration call github__get_current_user \
  --project "<PROJECT_ID>" \
  --connection "<CONNECTION_ID>" \
  --expected-generation "<CONNECTION_GENERATION_ID>" \
  --args '{}' --json
```

`--expected-generation` is available for `call` and `status --tool`, and requires
`--connection`.
The API deployment must support the generation precondition. If it does not
advertise support, the client throws `IntegrationApiError` with
`kind === "unsupported_precondition"` and `outcomeUnknown === false` before
sending the call. Update the API deployment before using the option.

If support is no longer confirmed on a successful call response, the error has
`outcomeUnknown === true`: the operation may already have run. Inspect the
provider outcome before retrying. The client never automatically replays the call.
Omit the generation option to retain the existing call behavior, with no
caller-observed generation check. See the
[integration API reference](../api-reference/veryfront/integrations.md) for the
public types.

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
Source configuration is monotonic: integrations.allow only narrows that grant
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
   connection independently of agent source and both policy layers.

## Next

- [Set up GitHub](./integrations/github.md)
- [Set up Jira](./integrations/jira.md)
- [Set up Salesforce](./integrations/salesforce.md)

## Related

- [veryfront/integrations](../api-reference/veryfront/integrations.md): Connector catalog and helper API.
