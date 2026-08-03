# Extension system

This page describes extension contracts and lifecycle. It does not cover project
primitive discovery or integration connector catalogs.

## Responsibility

The extension system loads first-party and compatible extension packages,
validates contracts, resolves capabilities, and runs extension setup and teardown
lifecycle hooks.

Primary source areas:

- [`src/extensions/`](../../src/extensions/)
- [`src/extensions/schema/`](../../src/extensions/schema/)
- [`src/extensions/bundler/`](../../src/extensions/bundler/)
- [`src/extensions/auth/`](../../src/extensions/auth/)
- [`src/extensions/cache/`](../../src/extensions/cache/)
- [`src/extensions/llm/`](../../src/extensions/llm/)
- [`src/extensions/observability/`](../../src/extensions/observability/)
- [`src/extensions/websocket/`](../../src/extensions/websocket/)

## Runtime flow

1. Extension definitions declare capabilities and lifecycle hooks.
2. Validation checks contract shape.
3. Loader code resolves configured extension modules.
4. Orchestration code runs setup and teardown in lifecycle order.
5. Capability-specific contracts provide auth, bundler, cache, database,
   content, CSS, LLM, embedding, sandbox, and observability behavior.

## Node.js WebSocket transport boundary

Core owns the security-sensitive parts of a Node.js WebSocket upgrade: HTTP
request classification, application authorization, request-to-socket
correlation, cancellation, and shutdown ownership. Those responsibilities do
not require a WebSocket protocol package and remain in the runtime adapter.

The wire-protocol implementation is supplied by the default
`@veryfront/ext-node-websocket-ws` package through the dependency-free
`NodeWebSocketServerProvider` contract. Bootstrap snapshots one immutable
provider generation before it starts a listener, so later mutation or extension
reload cannot change the implementation underneath a running server.

The standard npm/CLI distribution installs and auto-activates the extension;
custom service distributions install the package for Node WebSocket support.
Core does not import `ws`, probe for it, or substitute another implementation.
A Node HTTP server can run without the provider, but an authorized WebSocket
upgrade fails closed and identifies the extension needed to restore the feature.

## Boundaries

- Extensions provide framework capabilities. Integrations expose third-party
  service tools.
- Project primitive discovery belongs in
  [discovery and registries](./16-discovery-and-registries.md).
- Provider runtime can consume extension-provided provider contracts, but model
  request translation remains provider runtime work.
- Node runtime adapters own WebSocket upgrade authorization and lifecycle, while
  explicit extensions own third-party WebSocket protocol implementations.

## Change checks

- Add contract tests when changing extension schema or lifecycle semantics.
- Keep missing-extension errors actionable and sanitized.

## Related guides

- [Extensions](../guides/extensions.md)
- [Extension authoring](../guides/extension-authoring.md)

## Related reference

- [`veryfront/extensions`](../api-reference/veryfront/extensions.md)
