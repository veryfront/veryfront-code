# Local Integration Credentials Design

## Status

Approved product direction from
[`veryfront-issue-inbox#495`](https://github.com/veryfront/veryfront-issue-inbox/issues/495):
provide first-class BYO integration credentials for local and self-hosted Veryfront without a
Veryfront account or control plane.

This document defines the first implementation slice. It is intentionally narrower than the
hosted integration service. The local path must be explicit, least-privilege, and unable to move
provider credentials into model-visible or remotely persisted state.

## Problem

Veryfront agents and delegates already run locally with direct model-provider keys. Native
integration tools do not: `salesforce__*` and other integration tools are listed and executed by
the Veryfront API, which also owns connection lookup and token resolution. A project without a
Veryfront account therefore cannot materialize or execute those tools.

The framework already has the right runtime seam. A `RemoteToolSource` can list definitions and
execute them, and `loadRemoteToolsFromSource()` turns those definitions into ordinary Veryfront
tools. The missing module is a source backed by the local connector catalog and project-owned
credentials.

## Goals

- Let a local or self-hosted project materialize an explicit allowlist of catalog integration
  tools without contacting Veryfront.
- Resolve credentials from project-scoped environment variables by default.
- Allow a caller-supplied credential provider for secret managers without accepting raw secrets
  in the source configuration.
- Support the connector credential modes needed for representative local use:
  - header-based API keys;
  - HTTP Basic authentication;
  - OAuth2 client credentials;
  - Salesforce client-credentials service accounts.
- Preserve canonical tool IDs such as `salesforce__find_customer`.
- Reuse the connector catalog as the source of tool schemas, endpoints, and credential-variable
  names.
- Preserve the hosted API-backed integration path unchanged.
- Keep credentials out of prompts, tool metadata, tool arguments, execution context, logs,
  diagnostics, URLs, persisted artifacts, and Veryfront API requests.

## Non-goals

- General authorization-code OAuth in a headless process.
- Importing or reusing hosted Veryfront connection records.
- Forwarding local credentials to a Veryfront API or hosted tool executor.
- Making `integrations.allow` grant tools or select credentials. It remains a narrowing policy.
- Supporting API-key connectors that put secrets in query parameters or endpoint URL templates.
- Supporting GraphQL, multipart, raw-body, or response-enrichment endpoint contracts in the first
  slice.
- Adding a token cache. Client-credentials tokens are minted for each tool execution initially.
- Reproducing every hosted policy, audit, and connection-binding feature locally.

## Public API

The new source is exported from `veryfront/integrations`:

```ts
import { createLocalIntegrationToolSource } from "veryfront/integrations";
import { loadRemoteToolsFromSource } from "veryfront/tool";

const integrationSource = createLocalIntegrationToolSource({
  tools: [
    "salesforce__find_customer",
    "salesforce__list_cases",
    "salesforce__update_case",
  ],
});

const integrationTools = await loadRemoteToolsFromSource(integrationSource);
```

The public types are:

```ts
export type LocalIntegrationCredentialProvider = (
  environmentVariableName: string,
) => string | undefined | Promise<string | undefined>;

export interface LocalIntegrationToolSourceOptions {
  /** Exact canonical catalog tool IDs granted to this source. */
  tools: readonly string[];

  /** Defaults to the active project-scoped environment. */
  credentialProvider?: LocalIntegrationCredentialProvider;
}

export function createLocalIntegrationToolSource(
  options: LocalIntegrationToolSourceOptions,
): RemoteToolSource;
```

The source ID is stable and framework-owned. Tool order follows the caller's allowlist after
duplicate rejection. The constructor snapshots and validates the options so later caller mutation
cannot widen the source.

The credential provider receives only a validated canonical environment-variable name. It never
receives tool arguments, execution context, provider URLs, connector metadata, or prior credential
values. Returned values remain inside the source closure and request builder.

## Authorization model

Source construction is the grant. Environment-variable presence alone never enables a connector
or tool.

Each configured value must be an exact canonical catalog tool ID in the form
`integration__tool_id`. The source rejects:

- malformed IDs;
- duplicates;
- unknown connectors;
- unknown tools;
- tools without endpoint metadata;
- tools whose endpoint or authentication contract is unsupported locally.

`integrations.allow` and run/source policies continue to narrow the materialized tools through the
existing remote-tool provenance path. They cannot add tools absent from this source.

The source is unavailable in hosted or multi-project proxy mode. This prevents project code from
using the local path to bypass hosted connection ownership, tool binding, or audit rules. Local
development and single-project self-hosted production remain eligible.

## Credential resolution

The default credential provider uses the active project-scoped environment accessor, not a bulk
environment snapshot. A custom provider can bridge a local secret manager.

`listTools()` validates that every configured connector has a complete supported credential set.
It does not mint tokens or contact a provider. Missing configuration fails before model execution
and names only the missing variables.

`executeTool()` resolves the credentials again immediately before the provider request. This
avoids retaining raw secrets or stale credential values between calls.

### Header API key

The connector's `auth.keyName`, `headerName`, `headerPrefix`, and `additionalHeaders` define the
required variables and headers. Query-parameter authentication and `{{auth.token}}` URL templates
are rejected because secrets in URLs can reach access logs, proxies, and diagnostics.

### HTTP Basic

The connector's `usernameKey` and `passwordKey` identify the variables. Optional/default catalog
values retain their current meaning. The source builds the Basic header inside the request
boundary.

### OAuth2 client credentials

Only connectors with `grantType: "client_credentials"` are eligible. Credential names derive from
the existing connector vocabulary: `<NORMALIZED_NAME>_CLIENT_ID` and
`<NORMALIZED_NAME>_CLIENT_SECRET`. The source supports fixed HTTPS token URLs and the catalog's
Basic or request-body client-auth method. Authorization-code connectors remain unsupported.

### Salesforce service account

Salesforce's catalog entry describes interactive OAuth and cannot authorize a headless tool call.
The local source therefore uses the same distinct service-identity vocabulary as the hosted API:

- `SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID`
- `SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET`
- `SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL`

The login URL must be an HTTPS Salesforce My Domain origin without userinfo, port, query, fragment,
or non-root path. The token response must contain a bounded non-empty access token and an HTTPS
Salesforce instance URL. Salesforce endpoint templates may substitute only that validated instance
origin.

## Tool definitions

The model-facing JSON Schema is built from the configured catalog endpoint:

- endpoint path, query, and header parameters become object properties;
- endpoint body fields become object properties;
- required catalog fields become JSON Schema `required` entries;
- safe catalog defaults appear only when `exposeDefault` is true;
- no credential name or value appears in the schema or description.

Execution still applies all catalog defaults, including defaults not exposed to the model.

## Provider request execution

The first slice supports REST endpoints with:

- GET, POST, PUT, PATCH, and DELETE;
- path parameters with encoded substitution;
- query parameters;
- caller-controlled headers declared by the catalog;
- JSON object bodies;
- passthrough JSON object/array bodies;
- dotted response transforms such as `records` and `data`.

The executor validates input against the catalog contract before building a request. Unknown input
fields are rejected. Path values are encoded; query values use `URLSearchParams`; request headers
are constructed independently of caller input.

Every token and provider request uses `guardedEgressFetch()` with:

- `redirect: "error"`;
- a bounded timeout combined with the tool execution abort signal;
- the existing DNS/private-address guard;
- an authorization callback that limits a request to the catalog token endpoint or provider
  endpoint origin;
- no automatic forwarding of authentication headers to another origin.

Static catalog endpoints must be HTTPS and contain no userinfo. Dynamic Salesforce hosts must pass
the Salesforce-domain validator before they can reach the egress guard.

Responses have a bounded byte limit. Non-2xx responses and invalid JSON produce typed Veryfront
errors containing only the connector, tool ID, and HTTP status. Provider bodies, response headers,
URLs with query strings, credentials, and token payloads are never included in public error text,
causes, context, or logs.

## Error behavior

Configuration errors are typed Veryfront errors and can safely name:

- the configured canonical tool ID;
- the connector name;
- unsupported auth or endpoint capability;
- missing environment-variable names.

They cannot include values returned by the credential provider.

Provider failures are typed Veryfront errors with stable generic detail. The original provider
error and response body are not attached as a cause because causes can be logged by callers.

## Hosted compatibility

The current `getRemoteIntegrationToolDefinitions()` and
`executeRemoteIntegrationTool()` implementations are unchanged. The new source has no implicit
registration and is used only when project code constructs and materializes it.

No credential is copied into `ToolExecutionContext.authToken`; that field remains the Veryfront
control-plane credential for the existing remote integration source.

## Test strategy

RED tests precede each implementation slice.

### Admission and metadata

- exact allowlist produces only requested canonical tools;
- duplicate, malformed, unknown, endpoint-less, and unsupported tools fail closed;
- option mutation after construction cannot widen the source;
- hosted and proxy modes reject the local source;
- tool definitions contain no credential names or values;
- source policy still narrows materialized local integration tools.

### Credentials

- missing credentials report only variable names;
- a custom provider receives only expected names;
- API-key, additional-header, Basic, and client-credentials headers are correct;
- client credentials use the correct token-auth method;
- Salesforce uses the three service-account variables;
- malformed Salesforce login and instance URLs fail before provider execution;
- interactive OAuth connectors other than Salesforce fail closed;
- query-string credential connectors fail closed.

### Execution

- Vercel representative GET builds the correct header and query;
- Sendcloud representative Basic request builds the correct header;
- PayPal mints a client-credentials token and executes with the returned bearer token;
- Salesforce mints a service-account token and executes a `salesforce__*` endpoint against the
  returned instance origin;
- path, query, header, JSON body, passthrough body, defaults, and response transforms work;
- unknown input and missing required input fail before transport;
- redirects, private-address destinations, oversized responses, non-2xx responses, invalid JSON,
  and aborts are bounded and safe;
- sentinel credentials and provider response secrets are absent from errors, logs, definitions,
  serialized tool metadata, and request URLs.

### Compatibility

- the API-backed integration source behaves exactly as before when the local source is unused;
- ordinary remote-source materialization and aliases remain unchanged;
- Deno, Node, and Bun package/runtime gates pass.

## Alternatives considered

### Extend `integrations.allow`

Rejected. That configuration is explicitly monotonic and cannot grant capabilities. Making it
select credentials would weaken an established security contract.

### Put credentials in `ToolExecutionContext`

Rejected. The context crosses more runtime boundaries, is extensible by callers, and already
contains a Veryfront API credential. Reusing it would conflate trust domains and increase leak
surface.

### Teach the existing API remote source to fall back to local credentials

Rejected. An implicit fallback makes the transport and credential owner ambiguous. A distinct
source keeps local and hosted execution auditable and prevents accidental secret forwarding.

### Support every catalog endpoint and OAuth flow immediately

Rejected. Authorization-code OAuth needs redirect state, token persistence, user ownership, and
refresh semantics. Complex endpoint bodies and enrichment also need separate bounded contracts.
The first slice covers the account-free service and project credential modes without pretending
to provide hosted parity.

### Copy provider secrets into a project config object

Rejected. Raw secrets in config are easy to serialize, persist, inspect, or accidentally bundle.
The source accepts only a name-based credential-provider closure.

## Rollout and documentation

The public integration guide will add:

- the source/materialization example;
- supported credential modes and unsupported connector behavior;
- the exact Salesforce service-account variables;
- a warning that credentials belong in environment/secret-manager storage, not code;
- a statement that the source is local/self-hosted and does not contact Veryfront.

The Salesforce case-processing sample can then replace its account-free mock tool set with this
source when the three service-account variables are present, while retaining mocks for evaluation
and CI.
