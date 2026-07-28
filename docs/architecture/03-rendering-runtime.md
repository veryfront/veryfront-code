# Rendering runtime

This page describes page resolution, layout composition, SSR, RSC, and HTML
assembly. It does not cover server startup or build-time static generation.

## Responsibility

Rendering runtime code resolves page modules, applies layouts and error
boundaries, renders React output, handles RSC paths, and assembles HTML.

Primary source areas:

- [`src/rendering/`](../../src/rendering/)
- [`src/server/services/rendering/`](../../src/server/services/rendering/)
- [`src/server/services/rsc/`](../../src/server/services/rsc/)
- [`src/react/`](../../src/react/)
- [`src/html/`](../../src/html/)

## Runtime flow

1. Page resolution maps the incoming URL to an App Router or Pages Router
   module from one current source snapshot.
2. Data and render context builders prepare request-scoped inputs.
3. Layout discovery and preload capture the project, content-source, React,
   import-map, and runtime-mode identity used by application.
4. SSR or RSC service code validates and renders the page response.
5. HTML helpers attach metadata, styles, scripts, hydration data, nonces, and
   ready release assets.
6. Complete cacheable variants are persisted; request-scoped or streaming
   variants bypass shared HTML persistence.

## Identity and isolation

Rendering caches and module artifacts are scoped by the identities that can
change emitted output. Depending on the layer, that includes project ID,
content source or release, React version, import map, runtime mode, source
hash, and request variant.

Multi-tenant services provide the authoritative project UUID. Standalone
renderers derive a deterministic SHA-256 identity from the project directory
when no project ID is supplied. A request may refine request data, but it
cannot replace the configured project identity while borrowing
renderer-owned services.

Asynchronous boundaries snapshot mutable request metadata, import maps,
manifests, and cached results. Invalidation advances a generation so older
in-flight work cannot republish stale state after a clear.

## Failure and lifecycle semantics

Missing optional sources, such as an absent conventional layout, are distinct
from operational adapter failures. Permission errors, unavailable source
backends, malformed modules, invalid React exports, exhausted safety budgets,
and failed invalidation propagate to the server or build owner instead of
silently producing partial output.

Browser hydration applies the same rule to import maps. An absent import map is
valid and uses the documented CDN resolution path; a present but malformed map
fails before React or router module ownership is selected. It is never treated
as an empty map, because that would silently change which module instances the
page hydrates against.

Renderers own caches, component registries, module artifacts, and background
work. Long-lived consumers clear the appropriate project generation when
source identity changes and call `destroy()` during shutdown. Streaming has
explicit idle and hard deadlines; only its documented timeout path may retain
already-produced bytes.

## Boundaries

- Server runtime decides which request reaches rendering.
- Build pipeline prepares production assets and manifests.
- React public APIs and components are documented in reference and guide pages.
- `src/rendering/index.ts` is an internal facade used by framework builds and
  tests. It is not currently a package export for application code.

## Change checks

- Add tests for page resolution, layout ordering, RSC route behavior, and SSR
  response shape when changing rendering code.
- Keep app-router and pages-router behavior explicit.

## Related guides

- [Pages and routing](../guides/pages-and-routing.md)
- [Head and SEO](../guides/head-and-seo.md)
- [Chat UI](../guides/chat-ui.md)

## Related reference

- [`veryfront/head`](../api-reference/veryfront/head.md)
- [`veryfront/root`](../api-reference/veryfront/index.md)
- [`veryfront/chat`](../api-reference/veryfront/chat.md)
