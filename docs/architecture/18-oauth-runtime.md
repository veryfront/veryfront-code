# OAuth runtime

This page describes OAuth provider configuration, authorization redirects,
callback handling, token exchange, token storage, status checks, and disconnect
handlers. It does not cover integration tool execution.

## Responsibility

OAuth code provides provider configs, OAuth service helpers, route handlers,
state validation, token exchange, refresh support, and token store contracts.

Primary source areas:

- [`src/oauth/`](../../src/oauth/)
- [`src/oauth/providers/`](../../src/oauth/providers/)
- [`src/oauth/handlers/`](../../src/oauth/handlers/)
- [`src/oauth/token-store/`](../../src/oauth/token-store/)
- [`src/oauth/schemas/`](../../src/oauth/schemas/)
- [`src/oauth/types.ts`](../../src/oauth/types.ts)

## Runtime flow

```mermaid
sequenceDiagram
  participant User
  participant Init as Init handler
  participant Store as Token store
  participant Provider as OAuth provider
  participant Callback as Callback handler

  User->>Init: Start OAuth flow
  Init->>Init: Resolve authenticated user id
  Init->>Store: Persist one-shot state with user id, callback URI, and optional PKCE verifier
  Init-->>User: Redirect to provider
  User->>Provider: Authorize
  Provider-->>Callback: code and state
  Callback->>Store: Consume and validate state atomically
  Callback->>Provider: Exchange code for tokens
  Callback->>Store: Store tokens by service id and user id
  Callback-->>User: Redirect to success or error path
```

1. Init handlers require a user id and reject anonymous requests.
2. The init handler creates authorization URLs with generated state and S256
   PKCE values when the provider supports PKCE, then persists a bounded
   one-shot state row. Provider configs that select a non-PKCE client profile
   omit the verifier; callers cannot downgrade PKCE through route options.
3. Callback handlers consume state before processing either success or provider
   error responses. They validate its age, service id, exact callback URI, and
   PKCE verifier before exchanging a code.
4. Token requests have explicit time and response-size bounds. Successful token
   responses require strict UTF-8 JSON, a nonblank control-free access token,
   and valid expiry data. The deadline covers fetch and body consumption even
   when an injected fetch or stream ignores its abort signal; late response
   bodies are cancelled without blocking completion.
5. Tokens are stored under the initiating user. Refresh writes verify that the
   stored token generation has not been disconnected or replaced while the
   provider request was in flight. Shared stores also serialize refresh through
   a bounded, renewable distributed lease.
6. Status and disconnect handlers act on the authenticated user's own token
   slot. Disconnect is a same-origin `POST`; method and origin checks run before
   authentication callbacks or token-store mutation.
7. Provider catalogs supply common service configs, scopes, URLs, and client env
   variable names.

The built-in Slack provider selects Slack's confidential web-app profile. It
uses HTTP Basic client-secret authentication and omits PKCE. Slack public
clients enabled for PKCE must omit the client secret during token exchange and
therefore require a dedicated secretless adapter; the generic runtime's
client-secret contract cannot represent that profile safely.

Provider configuration and handler authorization options are captured from
plain own data properties at construction. Nested parameter, header, mapping,
and scope values are detached before asynchronous work. This prevents a getter
or caller mutation from changing a validated endpoint, credential mode, scope,
or reserved transport field later in the flow.

## Boundaries

- OAuth owns authorization, callback, token exchange, and token storage
  contracts.
- Integration metadata can reference OAuth provider configs, but integration
  tool execution belongs in [integration runtime](./19-integration-runtime.md).
- Public route ownership belongs to the application route that mounts the OAuth
  handlers.
- Persistent token storage is supplied by the application or backing service.
- Deployment stores protect token and state rows with authenticated encryption,
  use transport security, and keep `(serviceId, userId)` inside the storage key.
- State consumption must be an atomic read-and-delete operation. A separate
  read followed by delete permits concurrent callback reuse.
- Optional state metadata must be a data-only JSON object whose serialized
  representation is at most 16 KiB. Accessors, class instances, cycles, sparse
  structures, non-finite numbers, and larger values are rejected before
  persistence so memory and durable stores preserve the same meaning.
- Refresh requires revisioned snapshots, atomic compare-and-set, and a
  crash-recoverable distributed lease. Without all three capabilities, refresh
  fails closed before contacting the provider after actual token expiry. A
  still-valid token remains usable during the proactive refresh window when a
  legacy base store lacks those capabilities.
- One cancelled caller detaches from a shared refresh without cancelling or
  evicting its leader. Refresh leaders are capacity-bounded per store, and the
  distributed lock contract remains responsible for a bounded,
  crash-recoverable lease across workers.
- Provider, redirect, application, callback, and API endpoint text is bounded
  before URL parsing. Raw controls and backslashes are rejected instead of
  relying on WHATWG normalization; API endpoints must retain the configured
  origin.
- Completion redirects remain on the configured application origin. Handler
  responses disable caching and referrer propagation.
- A shared callback dispatcher accepts at most 100 logical services and
  snapshots a dense allowlist before constructing service clients.
- Status reports an expired refreshable row as connected only when the store
  has every safe-refresh capability and provider credentials are currently
  configured.

## Change checks

- Add handler tests for one-shot state validation, user binding, exact callback
  URI checks, redirect behavior, and provider errors.
- Add provider tests when changing auth URL, token URL, scope, PKCE, or token
  exchange behavior.
- Add token-store tests when changing state consumption or token keying.
- Keep tokens, secrets, and provider responses out of public logs and errors.
- Update [OAuth](../guides/oauth.md) when public handler behavior changes.

## Related guides

- [OAuth](../guides/oauth.md)

## Related reference

- [`veryfront/oauth`](../api-reference/veryfront/oauth.md)
