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

## Runtime flow

1. Extension definitions declare capabilities and lifecycle hooks.
2. Validation checks contract shape.
3. Loader code resolves configured extension modules.
4. Orchestration code runs setup and teardown in lifecycle order.
5. Capability-specific contracts provide auth, bundler, cache, database,
   content, CSS, LLM, embedding, sandbox, and observability behavior.

## Boundaries

- Extensions provide framework capabilities. Integrations expose third-party
  service tools.
- Project primitive discovery belongs in
  [discovery and registries](./16-discovery-and-registries.md).
- Provider runtime can consume extension-provided provider contracts, but model
  request translation remains provider runtime work.

## Change checks

- Add contract tests when changing extension schema or lifecycle semantics.
- Keep missing-extension errors actionable and sanitized.

## Related guides

- [Extensions](../guides/extensions.md)
- [Extension authoring](../guides/extension-authoring.md)
- [Extension lifecycle](../guides/extension-lifecycle.md)
- [Extension publishing](../guides/extension-publishing.md)
- [Extension testing](../guides/extension-testing.md)

## Related reference

- [`veryfront/extensions`](../api-reference/veryfront/extensions.md)
