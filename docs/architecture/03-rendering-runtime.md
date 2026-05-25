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

1. Page resolution maps the incoming URL to an app-router or pages-router module.
2. Layout helpers compose matching layouts and error boundaries.
3. Data and render context builders prepare request-scoped inputs.
4. SSR or RSC service code renders the page response.
5. HTML helpers attach metadata, styles, scripts, hydration data, and error
   fallback output.

## Boundaries

- Server runtime decides which request reaches rendering.
- Build pipeline prepares production assets and manifests.
- React public APIs and components are documented in reference and guide pages.

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
