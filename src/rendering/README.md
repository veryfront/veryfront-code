# Rendering runtime

`src/rendering` is Veryfront's internal page-rendering runtime. It resolves page
sources, compiles MDX and script modules, composes layouts, renders React on the
server, assembles the HTML document, and prepares browser hydration data.

Application authors normally use the public server and routing APIs. The
`veryfront/rendering` and `#veryfront/rendering` specifiers are repository
import-map entries used by framework services, builds, and integration tests;
they are not currently package exports.

## Responsibility

The module owns:

- Pages Router and App Router source resolution.
- Request-scoped MDX, layout, SSR, and HTML orchestration.
- React Server Component analysis, payloads, and client hydration support.
- Render-result caching and cache-store adapters.
- Browser navigation, prefetch, and shared-state helpers used by generated
  runtime assets.
- Chunk dependency analysis for authored Markdown and MDX pages.
- Snippet rendering used by internal consumers.

The adjacent modules retain these boundaries:

- `server` admits requests, owns HTTP responses, and maps render failures to
  transport responses.
- `routing` matches routes and owns public routing contracts.
- `build` creates production artifacts and release manifests.
- `html` generates and injects document markup.
- `modules` and `transforms` load, rewrite, and compile source modules.
- `data` resolves page data hooks.

## Runtime flow

1. A server or build consumer creates a renderer with an explicit project,
   mode, adapter, and content-source identity.
2. Page resolution chooses one current source snapshot and returns the matched
   route entity.
3. The pipeline resolves request data, compiles the page, discovers and
   preloads layouts, and snapshots the request identity.
4. The SSR orchestrator validates the React tree and renders a string or
   stream. App Router error components are resolved from the same project and
   content source.
5. The HTML generator combines metadata, CSS, import maps, hydration payloads,
   nonces, and release assets into the final document.
6. Cache persistence occurs only for cacheable, complete render variants.
7. `destroy()` releases renderer-owned resources. Long-lived consumers must
   call it during shutdown.

## Source map

| Area                                                                | Responsibility                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `page-resolution/`, `app-route-resolver.ts`, `entity-resolution.ts` | Bounded route and source discovery                                                |
| `orchestrator/`                                                     | Configuration, lifecycle, page pipeline, layouts, SSR, CSS, and HTML assembly     |
| `layouts/`, `app-reserved.ts`                                       | Layout discovery, compilation, application, and reserved App Router components    |
| `ssr/`, `ssr-renderer.ts`                                           | React SSR and component registration                                              |
| `rsc/`                                                              | RSC analysis, bounded payloads, transport, and browser hydration                  |
| `cache/`, `shared/`                                                 | Render cache coordination, stores, payload validation, and context-aware services |
| `client/`                                                           | Browser router, prefetch, navigation state, and state bridge                      |
| `chunk-optimizer/`                                                  | Deterministic page-import analysis and chunk manifests                            |
| `element-validator/`                                                | React element validation and normalization                                        |
| `renderer.ts`                                                       | Server-owned, request-context renderer used by the HTTP runtime                   |
| `index.ts`                                                          | Internal facade used by builds and direct renderer integration tests              |

## Core invariants

- Project, content-source, release, React-version, import-map, and runtime mode
  are part of the relevant cache and module identities.
- Default standalone renderer project IDs are derived from the full SHA-256
  digest of `projectDir`; callers should still provide the authoritative
  project UUID in multi-tenant production services.
- A request cannot replace the configured project identity while borrowing
  renderer-owned services.
- Mutable inputs and cached outputs are snapshotted at asynchronous boundaries.
- Missing optional files are distinguished from operational filesystem
  failures. Permission, transport, malformed-source, and backend failures
  reject instead of silently producing partial output.
- Discovery, tree processing, serialization, manifests, source bytes, streams,
  queues, and caches are bounded.
- App, layout, reserved-component, RSC, and component-registry exports must be
  valid React component types before use.
- Production release assets are consumed only from a ready, request-consistent
  manifest.
- Cache invalidation cannot let an older in-flight generation republish stale
  state.

## Internal facade

`src/rendering/index.ts` exports:

- `createRenderer`, `VeryfrontRenderer`, `RendererOptions`, `RenderOptions`,
  `RenderResult`, and `PageDataResponse`.
- Chunk analysis and manifest helpers.
- Cache coordination; core API, filesystem, KV, and memory stores; and the
  provider-neutral distributed-store factory.
- Low-level layout helpers.
- Snippet rendering helpers.

The facade's renderer constructor accepts these options:

| Option            | Meaning                                                          |
| ----------------- | ---------------------------------------------------------------- |
| `projectDir`      | Required project source root                                     |
| `mode`            | Required `development` or `production` runtime mode              |
| `adapter`         | Optional runtime adapter; runtime detection is used when omitted |
| `config`          | Optional already-loaded `VeryfrontConfig`                        |
| `projectId`       | Authoritative cache and module isolation identity                |
| `projectSlug`     | Human-readable logging and HTTP fallback identity                |
| `contentSourceId` | Branch, snapshot, or release identity                            |
| `isLocalProject`  | Whether browser-facing local filesystem module URLs are trusted  |
| `port`            | Dashboard/module-service port used by generated runtime URLs     |
| `moduleServerUrl` | Explicit development module-service base URL                     |
| `directories`     | Compatibility override merged onto `config.directories`          |

An internal consumer owns the complete lifecycle:

```ts
import { createRenderer } from "#veryfront/rendering";

const renderer = await createRenderer({
  projectDir: "/workspace/project",
  mode: "production",
  projectId: "project-uuid",
  projectSlug: "docs",
  contentSourceId: "release-42",
});

try {
  const result = await renderer.renderPage("/about", {
    delivery: "string",
    url: new URL("https://example.com/about"),
  });
  console.log(result.html);
} finally {
  await renderer.destroy();
}
```

`VeryfrontRenderer` also exposes `resolvePageData`, `getAllPages`,
`initializeComponents`, `compileMDX`, `clearCache`, `clearAllState`, and
`getVirtualModuleSystem`. These are framework-internal APIs and must preserve
the same project/content-source identity as the renderer instance.

## Failure semantics

Absence is tolerated only where the contract declares a file optional, such as
an unconfigured global stylesheet or a missing App Router error component.
Operational adapter errors, invalid component exports, malformed cache
payloads, exhausted safety budgets, and failed invalidation propagate to the
owning server or build boundary.

Streaming has separate idle and hard deadlines. A stream may retain already
produced bytes on its documented timeout path, but unrelated render,
compilation, or filesystem failures are not converted into partial success.

## Verification

For a focused change, run the directly affected tests first. The complete
module inventory uses the repository test environment:

```sh
DENO_TESTING=1 \
VF_DISABLE_LRU_INTERVAL=1 \
SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
REVALIDATION_PER_PROJECT_LIMIT=0 \
NODE_ENV=production \
LOG_FORMAT=text \
deno test \
  --preload=src/schemas/_test-setup.ts \
  --no-check \
  --parallel \
  --allow-all \
  --v8-flags=--max-old-space-size=8192 \
  --unstable-worker-options \
  --unstable-net \
  src/rendering
```

Also run `deno task typecheck`, affected integration/browser scenarios, and the
static consumer checks when an export, hydration payload, release asset, or
server boundary changes.

## Related documentation

- [`docs/architecture/03-rendering-runtime.md`](../../docs/architecture/03-rendering-runtime.md)
- [`docs/architecture/02-request-pipeline.md`](../../docs/architecture/02-request-pipeline.md)
- [`docs/guides/pages-and-routing.md`](../../docs/guides/pages-and-routing.md)
- [`src/html/README.md`](../html/README.md)
