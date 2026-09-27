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
- **Transport:** REST, GraphQL, MCP, the TypeScript client, and the Veryfront
  CLI all call the same hosted tools. REST, the TypeScript client, and the CLI
  also read connection inventory and start OAuth. GraphQL and MCP discover and
  call tools but do not list connections.

The hosted API flow is `discover → connect → status → call`. No integration
policy setup is required. Every surface can select an exact connection when a
project has multiple accessible accounts. Framework tool calls inside an agent
run use the connection selected by the hosted runtime, and a `connection_id`
passed inside tool arguments is provider input rather than an account selector.

## Make your first call

This walkthrough reads one Gmail message summary with `gmail__list_emails` and
the arguments `{"q":"in:inbox","maxResults":1}`. Each surface below runs the
same tool with the same arguments against the same connection, so you can pick
the one that fits your application. The tool is read-only.

For other failures and non-OAuth connectors, see
[Recover integration connections](./integrations/recovery.md) and
[Integration credentials and scopes](./integrations/credentials.md).

### Before you start

You need three things. None of them is created implicitly:

- **A platform credential.** A Veryfront API key or login token for a user who
  can read the project. It authenticates you to Veryfront, not to Gmail. Keep
  it server-side and never place it in prompts, tool arguments, or URLs.
- **A project.** Pass the project slug or UUID on every request. Veryfront never
  picks a project for you.
- **The API origin.** Use `https://api.veryfront.com`, or your own API origin
  for a self-hosted or non-production deployment.

The shell examples use `curl` and `jq` and share these variables. The first line
keeps an API origin you already exported:

```bash
export VERYFRONT_API_URL="${VERYFRONT_API_URL:-https://api.veryfront.com}"
export VERYFRONT_API_TOKEN="<TOKEN>"
export VERYFRONT_PROJECT="<PROJECT_SLUG>"
AUTH="Authorization: Bearer $VERYFRONT_API_TOKEN"
PROJECT="x-veryfront-project-slug: $VERYFRONT_PROJECT"
```

The TypeScript client and the CLI refuse API origins that resolve to private
network addresses, such as a VPN or self-hosted API. On a host you control, set
`VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS=1` in the process environment to allow
them. Project environment variables cannot set it.

### Discover the tool

Tool discovery works before any connection exists. The response lists each
tool's `name`, `description`, and `inputSchema`. Its `x-veryfront-project-id`
header carries the project UUID that Veryfront resolved from the slug; the
second command keeps it for the call precondition:

```bash
curl -sS "$VERYFRONT_API_URL/integrations/gmail/tools?name=gmail__list_emails" \
  -H "$AUTH" -H "$PROJECT"
PROJECT_ID=$(curl -sS -o /dev/null -D - \
  "$VERYFRONT_API_URL/integrations/gmail/tools?name=gmail__list_emails" \
  -H "$AUTH" -H "$PROJECT" |
  awk 'tolower($1) == "x-veryfront-project-id:" { print $2 }' | tr -d '\r')
```

The CLI equivalent is
`veryfront integration tools gmail --project "$VERYFRONT_PROJECT" --json`.

### Connect the provider account

The first call without a connection returns a tool result with `isError: true`,
`structuredContent.error` set to `authentication_required`, and a
`structuredContent.connectUrl`. No provider request is sent. Provider consent is
a separate login to Gmail and always needs a person in a browser:

- **CLI:** Run `veryfront integration connect gmail --project "$VERYFRONT_PROJECT"`.
  It opens the browser, waits at most `--timeout` seconds (default 300), and
  confirms the new connection from inventory. Add `--scope project` to create a
  shared connection instead of a personal one.
- **REST:** Open `connectUrl` in a browser that is signed in to Veryfront.
- **Studio:** Use the connect card that appears in the run, or the project's
  integration settings.

The call is not retried for you. After consent, read the connection inventory
and call again. If consent is denied, cancelled, or expires, see
[Recover integration connections](./integrations/recovery.md).

### Select the connection and check readiness

Read the project's Gmail connections. Each row has an `id`, a `scope` (`user` or
`project`), a `status` (`connected`, `expired`, or `disconnected`), and a
`connection_generation_id` that changes when the account is reconnected:

```bash
curl -sS "$VERYFRONT_API_URL/projects/$VERYFRONT_PROJECT/integrations/gmail/connections?limit=100" \
  -H "$AUTH"
```

Copy the `id` and `connection_generation_id` of the `connected` row you want
to use:

```bash
CONNECTION_ID="<CONNECTION_ID>"
CONNECTION_GENERATION_ID="<CONNECTION_GENERATION_ID>"
```

Readiness reports whether that selection can run the tool. It reads metadata
only and never contacts Gmail:

```bash
curl -sS -G "$VERYFRONT_API_URL/projects/$VERYFRONT_PROJECT/integrations/gmail" \
  --data-urlencode "tool_name=gmail__list_emails" \
  --data-urlencode "connection_id=$CONNECTION_ID" \
  --data-urlencode "expected_connection_generation_id=$CONNECTION_GENERATION_ID" \
  -H "$AUTH" | jq '.selected_readiness | {selection: .selection.state, local: .local_eligibility.state, blockers: .local_eligibility.blockers}'
```

Continue when `selection` is `selected` and `local` is `eligible`. A `stale`
selection means the account was reconnected after you read inventory: read
inventory again rather than choosing another account.

### Call with REST

Send provider arguments in `arguments`. `connection_id` selects the account and
`expected_connection_generation_id` rejects the call before any provider request
if that account was replaced. `x-veryfront-expected-project-id` rejects the call
if the slug now resolves to a different project. All three are optional; omit
them only when the project has exactly one usable connection.

```bash
curl -sS -X POST "$VERYFRONT_API_URL/integrations/gmail/tools/list_emails/call" \
  -H "$AUTH" -H "$PROJECT" \
  -H "x-veryfront-expected-project-id: $PROJECT_ID" \
  -H "Content-Type: application/json" \
  --data @- <<JSON | jq '{isError, fields: (.structuredContent | keys)}'
{
  "arguments": { "q": "in:inbox", "maxResults": 1 },
  "connection_id": "$CONNECTION_ID",
  "expected_connection_generation_id": "$CONNECTION_GENERATION_ID"
}
JSON
```

### Call with GraphQL

GraphQL has no connection inventory; take the IDs from the REST inventory or
the CLI. The `integration` query returns the tool list and readiness, and the
`executeIntegrationTool` mutation runs the tool. `projectReference` accepts the
slug or UUID:

```bash
QUERY=$(cat <<'GRAPHQL'
query GmailReadiness($input: GetIntegrationInput!) {
  integration(input: $input) {
    error
    integration {
      tools { name }
      selectedReadiness {
        selection { state connectionId connectionGenerationId }
        localEligibility { state blockers }
      }
    }
  }
}
GRAPHQL
)
jq -n --arg query "$QUERY" --arg project "$VERYFRONT_PROJECT" \
  --arg connection "$CONNECTION_ID" --arg generation "$CONNECTION_GENERATION_ID" \
  '{query: $query, variables: {input: {name: "gmail", projectReference: $project,
    toolName: "gmail__list_emails", connectionId: $connection,
    expectedConnectionGenerationId: $generation}}}' |
  curl -sS "$VERYFRONT_API_URL/graphql" -H "$AUTH" -H "Content-Type: application/json" --data @- |
  jq '.data.integration.integration.selectedReadiness'

MUTATION=$(cat <<'GRAPHQL'
mutation ListOneEmail($input: ExecuteIntegrationToolInput!) {
  executeIntegrationTool(input: $input) {
    isError
    structuredContent
  }
}
GRAPHQL
)
jq -n --arg query "$MUTATION" --arg project "$VERYFRONT_PROJECT" \
  --arg connection "$CONNECTION_ID" --arg generation "$CONNECTION_GENERATION_ID" \
  '{query: $query, variables: {input: {projectReference: $project,
    toolName: "gmail__list_emails", connectionId: $connection,
    expectedConnectionGenerationId: $generation,
    args: {q: "in:inbox", maxResults: 1}}}}' |
  curl -sS "$VERYFRONT_API_URL/graphql" -H "$AUTH" -H "Content-Type: application/json" --data @- |
  jq '{errors, isError: .data.executeIntegrationTool.isError, fields: (.data.executeIntegrationTool.structuredContent | keys?)}'
```

`executeIntegrationTool` is a mutation because it can run write tools. A
read-only tool needs only read access to the project. Tool failures return
`isError: true`; request failures such as a stale generation return GraphQL
`errors`.

### Call with TypeScript

`createIntegrationClient` from `veryfront/integrations` takes every credential
explicitly and never reads them from the environment. It sends the project
precondition headers for you. Replace the placeholders with the same values as
the shell variables:

```ts
import { createIntegrationClient, type IntegrationClientConnection } from "veryfront/integrations";

const client = await createIntegrationClient({
  apiBaseUrl: "<API_BASE_URL>",
  authToken: "<TOKEN>",
  projectReference: "<PROJECT_SLUG>",
});

const selectedConnectionId = "<CONNECTION_ID>";
let selected: IntegrationClientConnection | undefined;
for await (const connection of client.listConnections("gmail")) {
  if (connection.id === selectedConnectionId) {
    selected = connection;
    break;
  }
}
if (!selected || selected.status !== "connected") {
  throw new Error("Connect Gmail and select a connected account before calling.");
}

const selection = {
  connectionId: selected.id,
  expectedConnectionGenerationId: selected.connection_generation_id,
};
const readiness = await client.readiness("gmail__list_emails", selection);
if (readiness.local_eligibility.state !== "eligible") {
  throw new Error(`Not ready: ${readiness.local_eligibility.blockers.join(", ")}`);
}

const outcome = await client.call(
  "gmail__list_emails",
  { q: "in:inbox", maxResults: 1 },
  selection,
);
console.log(outcome.status, Object.keys(outcome.result.structuredContent ?? {}));
```

The script runs under Deno or Node.js with the `veryfront` package installed.
`client.connect("gmail", { redirectUri })` starts the same OAuth handoff as the
CLI and returns a one-time `connect_url` with an `expires_at` deadline.

### Call with the CLI

The CLI uses your `veryfront login` session or `VERYFRONT_API_TOKEN`, and
`VERYFRONT_API_URL` when it is set in your shell:

```bash
veryfront integration connections gmail --project "$VERYFRONT_PROJECT" --json
veryfront integration status gmail --project "$VERYFRONT_PROJECT" \
  --tool gmail__list_emails --connection "$CONNECTION_ID" \
  --expected-generation "$CONNECTION_GENERATION_ID" --json
veryfront integration call gmail__list_emails --project "$VERYFRONT_PROJECT" \
  --connection "$CONNECTION_ID" --expected-generation "$CONNECTION_GENERATION_ID" \
  --args '{"q":"in:inbox","maxResults":1}' --json
```

`--expected-generation` requires `--connection`. `status --tool` rejects
`--scope` because the selected connection determines its scope.

### Call with MCP

Point MCP clients at the project endpoint `/projects/<PROJECT_SLUG>/mcp`. The
unscoped `/mcp` endpoint serves platform tools but cannot call integration tools
because it has no project. Integration tools are listed by their canonical
names. Select a connection with `_meta`, not with tool arguments. When
`initialize` returns an `Mcp-Session-Id` header, send it on later requests:

```bash
MCP_URL="$VERYFRONT_API_URL/projects/$VERYFRONT_PROJECT/mcp"
MCP_SESSION=""
mcp() {
  curl -sS -X POST "$MCP_URL" -H "$AUTH" -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    ${MCP_SESSION:+-H "Mcp-Session-Id: $MCP_SESSION"} "$@"
}

MCP_SESSION=$(mcp -D - -o /dev/null --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"integration-example","version":"1.0.0"}}}' |
  awk 'tolower($1) == "mcp-session-id:" { print $2 }' | tr -d '\r')
mcp --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' |
  jq '[.result.tools[].name | select(. == "gmail__list_emails")]'
mcp --data "$(jq -n --arg connection "$CONNECTION_ID" --arg generation "$CONNECTION_GENERATION_ID" \
  '{jsonrpc: "2.0", id: 3, method: "tools/call", params: {name: "gmail__list_emails",
    arguments: {q: "in:inbox", maxResults: 1},
    _meta: {connection_id: $connection, expected_connection_generation_id: $generation}}}')" |
  jq '{isError: .result.isError, fields: (.result.structuredContent | keys?)}'
```

An MCP client configuration uses the same URL and bearer token:

```json
{
  "mcpServers": {
    "veryfront": {
      "url": "https://api.veryfront.com/projects/<PROJECT_SLUG>/mcp",
      "headers": { "Authorization": "Bearer <TOKEN>" }
    }
  }
}
```

### Read the result

Every surface returns the same tool result: `content`, `structuredContent`,
`isError`, and optional `_meta`. For `gmail__list_emails`, `structuredContent`
has `messages`, `pagination`, and `summary`. A tool failure keeps the envelope
and sets `isError: true`, with a code in `structuredContent.error`:

| Code                         | Provider effect                                | Next step                                                          |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `authentication_required`    | None. No provider request was sent.            | Connect the account, then call again.                              |
| `reconnect_required`         | None. The stored grant expired or was revoked. | Reconnect the same account, then call again.                       |
| `provider_permission_denied` | None. The provider refused the request.        | Check the account's provider permissions and granted scopes.       |
| `rate_limited`               | None. The provider refused the request.        | Wait `retryAfter` seconds before one new attempt.                  |
| `execution_outcome_unknown`  | Unknown. A write tool may have changed data.   | Inspect the provider before repeating. Never replay automatically. |

Selection and precondition failures, such as a stale generation or a connection
that belongs to another project, are request errors: REST returns an HTTP
problem, GraphQL returns `errors`, and MCP returns an `isError` result with
`_meta.condition.slug`. They fail before credentials are read. See
[Recover integration connections](./integrations/recovery.md) for each case.

## Connection generation preconditions

`local_eligibility.state === "eligible"` means the evaluated local metadata checks
passed. It does not establish provider permission. Key presence cannot prove usable
credential values, and recorded shared-account metadata is not provider-verified
identity. Inspect `pending_checks` and `blockers`; `provider_verification.state`
remains `not_checked`. A later tool call still requires current authorization.

A reconnect can replace a generation between inventory and execution. The API
rejects a mismatched generation before reading credentials or calling the provider.
A generation match does not establish provider permission or prevent a later
provider-side revocation. The selected account and generation are metadata, not a
reusable grant.

The TypeScript client requires the API deployment to advertise generation
precondition support in `x-veryfront-tool-preconditions`. If it does not, the
client throws `IntegrationApiError` with `kind === "unsupported_precondition"` and
`outcomeUnknown === false` before sending the call. If support is no longer
confirmed on a successful call response, the error has `outcomeUnknown === true`:
the operation may already have run. Inspect the provider outcome before retrying.
The client never automatically replays the call. A missing or malformed readiness
projection, or a response for another project, tool, or connection, throws
`IntegrationApiError` with `kind === "invalid_response"`. Changing project or
platform credentials requires a new bound client. See the
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

## Prerequisites for agent tools

- A Veryfront project with a configured agent (see [Agents](./agents.md)).
- The integration tool names the agent needs.
- For managed execution, a project token or hosted runtime that can reach the
  Veryfront integration tool endpoints.
- For local execution, provider credentials in the project environment.
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
accessible accounts, a REST, GraphQL, MCP, TypeScript client, or CLI call can
select an exact connection; Veryfront validates that it belongs to the project
and is visible to the caller, and never falls back to another account. Framework
tool calls use the runtime-selected connection.

## Authentication flow

When an agent calls an OAuth integration tool and no valid connection exists:

1. The tool returns an `authentication_required` result with a connect URL.
2. The agent surfaces the connect action to the user.
3. The user completes provider consent and the OAuth callback.
4. The control plane stores the connection for the selected project or user scope.
5. The run calls the tool again with the new connection. This is safe because
   `authentication_required` means no provider request was sent.
6. Later calls reuse or refresh that connection according to the provider's
   token lifecycle.

OAuth connection happens during use. Adding a tool to agent source does not
require a connection in advance. A call that failed with any other error is not
retried automatically. See [Recover integration connections](./integrations/recovery.md).

### Managed OAuth and custom app overrides

Managed OAuth connectors do not require project OAuth client credentials. Set
client ID and client secret environment variables only when the connector
supports and the project selects a custom OAuth app override:

```dotenv
GITHUB_CLIENT_ID=<GITHUB_CLIENT_ID>
GITHUB_CLIENT_SECRET=<GITHUB_CLIENT_SECRET>
```

The integration catalog metadata identifies these variables as OAuth client
overrides and reports whether managed OAuth is available.

### Credential-based integrations

Some connectors use static credentials instead of interactive OAuth. Store
those credentials in project environment variables named by the connector
metadata:

```dotenv
STRIPE_SECRET_KEY=<STRIPE_SECRET_KEY>
TELEGRAM_BOT_TOKEN=<TELEGRAM_BOT_TOKEN>
PERSONIO_CLIENT_ID=<PERSONIO_CLIENT_ID>
PERSONIO_CLIENT_SECRET=<PERSONIO_CLIENT_SECRET>
```

No OAuth connect step is shown for these connectors. The integration runtime
resolves their credentials during tool execution; agents do not receive raw
secrets. See [Integration credentials and scopes](./integrations/credentials.md)
for the setup of each authentication type and where each one runs.

## Test without provider access

Keep local tests and evals provider-free by supplying explicit mock tools. The
mock map replaces the live integration for that run; it does not create a
connection or change hosted behavior. See [mock tools for local evals](./evals.md#mock-tools-for-local-agent-evals).

## Set up a provider

Use a provider guide when a connector needs provider-specific installation,
permissions, OAuth configuration, or service-account credentials.

| Provider   | Guide                                             |
| ---------- | ------------------------------------------------- |
| GitHub     | [Set up GitHub](./integrations/github.md)         |
| Jira       | [Set up Jira](./integrations/jira.md)             |
| Salesforce | [Set up Salesforce](./integrations/salesforce.md) |

For credential types, scopes, and recovery that apply to every provider, see
[Integration credentials and scopes](./integrations/credentials.md) and
[Recover integration connections](./integrations/recovery.md).

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
4. Confirm the next tool call receives a result with `isError` unset or `false`.
5. Reload the project and confirm connection inventory still reports the
   connection independently of agent source and source configuration.

## Next

- [Recover integration connections](./integrations/recovery.md)
- [Integration credentials and scopes](./integrations/credentials.md)
- [Set up GitHub](./integrations/github.md)
- [Set up Jira](./integrations/jira.md)
- [Set up Salesforce](./integrations/salesforce.md)

## Related

- [veryfront/integrations](../api-reference/veryfront/integrations.md): Connector catalog and helper API.
