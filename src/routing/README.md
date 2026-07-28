# Routing module

`src/routing` is Veryfront's internal route-resolution and browser-navigation
infrastructure. It owns route-pattern matching, file-path candidates, API route
execution, and the low-level client navigation helpers used by the rendering
runtime.

Application authors normally use:

- `veryfront/router` for `Link`, `useRouter`, and React navigation;
- `veryfront` for API route types and response helpers; and
- the [Pages and routing guide](../../docs/guides/pages-and-routing.md) and
  [API routes guide](../../docs/guides/api-routes.md) for application-facing
  conventions.

`#veryfront/routing` and its deep paths are workspace-internal imports. The
source barrel is also mapped as `veryfront/routing` inside this repository, but
`./routing` is not a published package export. Do not make application code
depend on an internal deep path.

## Responsibilities and boundaries

The module owns four cohesive areas:

| Area           | Responsibility                                                                  |
| -------------- | ------------------------------------------------------------------------------- |
| `matchers/`    | Compile and rank static, dynamic, and catch-all URL patterns.                   |
| `slug-mapper/` | Normalize slugs and generate portable app/pages file candidates.                |
| `api/`         | Discover, load, isolate, execute, and describe API route modules.               |
| `client/`      | Load bounded navigation data, manage caches, and handle eligible browser links. |

It does not own HTTP listening (`server/`), rendering (`rendering/`), React's
public router (`react/`), middleware composition (`middleware/`), or static
asset serving (`platform/` and `server/`).

## Route grammar

The canonical file-route grammar is:

| Pattern              | Meaning                                         |
| -------------------- | ----------------------------------------------- |
| `/about`             | Static route.                                   |
| `/blog/[slug]`       | One required segment.                           |
| `/docs/[...parts]`   | One or more catch-all segments.                 |
| `/docs/[[...parts]]` | Optional catch-all, including the empty suffix. |
| `/files/[name].json` | Dynamic segment with a literal suffix.          |

Malformed bracket syntax, duplicate parameter names, and more than one
catch-all do not produce a valid match. When two registered routes have equal
structural specificity for the same pathname, collection matchers return
`null` instead of selecting one by registration order.

Route parameters are percent-decoded one segment at a time. For compatibility,
a malformed percent escape is retained as its raw string; it is not interpreted
or allowed to crash matching. Request validation remains responsible for
rejecting malformed application input.

## Matcher reference

`PageRouteMatcher` is the page-route collection:

```ts
import { PageRouteMatcher } from "#veryfront/routing";

const matcher = new PageRouteMatcher();
matcher.addRoute("/blog/[slug]", "/project/app/blog/[slug]/page.tsx");

const match = matcher.match("/blog/hello");
// match?.params.slug === "hello"
// match?.route.page === "/project/app/blog/[slug]/page.tsx"
```

Its relevant methods are:

```ts
addRoute(pattern: string, page: string): void
match(pathname: string): RouteMatch | null
clearCache(): void
getRoutes(): Route[]
```

`addRoute` replaces an existing definition with the same pattern and clears
positive and negative cache entries. Returned routes, matches, parameters, and
catch-all arrays are immutable snapshots; callers do not own matcher state.
The match cache holds at most 500 entries.

The lower-level functions have these signatures:

```ts
parseRoute(pattern: string, page: string): Route
matchRoute(pathname: string, route: Route): RouteMatch | null
normalizePath(path: string): string
getSpecificityScore(route: Route): number
```

`getSpecificityScore` exists for compatibility. New ordering code should use
the structural matcher rather than comparing its numeric projection.

## Slug and path-candidate reference

```ts
normalizeSlug(slug: string): string
slugToPath(slug: string): string
pathToSlug(path: string): string
getSlugFromPath(filePath: string): string
extractParams(pattern: string, slug: string): RouteParams | null
isDynamicRoute(pattern: string): boolean
matchesPattern(pattern: string, slug: string): boolean
getPathCandidates(projectDir: string, slug: string): PathCandidates
getSupportedExtensions(): string[]
```

`getPathCandidates` returns separate `appRouter` and `pagesRouter` arrays and
uses the runtime-compatible path joiner. Candidate slugs reject backslashes,
control characters, `.`/`..` traversal, more than 256 segments, and strings
longer than 4,096 characters. `getSupportedExtensions` returns a copy.

## Browser navigation contracts

`PageLoader` is constructed without arguments:

```ts
import { PageLoader } from "#veryfront/routing";

const loader = new PageLoader();
const page = await loader.loadPage("/about?preview=1");
await loader.prefetch("/pricing");
loader.clearCache();
```

The loader:

- accepts only bounded internal navigation paths;
- deduplicates concurrent requests for the same path;
- keeps separate 50-entry page and SPA caches;
- aborts active work and prevents old requests from repopulating a cleared
  cache;
- falls back from `/_veryfront/data/*.json` to navigation HTML only on a JSON
  endpoint `404`;
- rejects malformed JSON, malformed successful HTML, non-object page data,
  invalid `Content-Length`, and bodies larger than 4 MiB; and
- requires successful fallback HTML to contain `#root`. A page-data script, if
  present, must contain a JSON object.

The exported legacy `parsePageDataFromHTML` helper still returns empty data for
missing or malformed optional fields. Runtime navigation deliberately uses the
strict parser instead.

`NavigationHandlers` intercepts only unhandled primary-button clicks without
modifier keys. `ViewportPrefetch` and hover prefetch use the same eligibility
check. Explicit schemes, fragments, network paths, backslash network-path
variants, downloads, and targets other than `_self` stay under native browser
control.

```ts
const handlers = new NavigationHandlers(100, { hover: true });
const viewport = new ViewportPrefetch(
  (path) => void loader.prefetch(path),
  { viewport: true },
);
viewport.setup(document);
```

Call `handlers.clear()` and `viewport.disconnect()` when their owner is
destroyed.

## API and OpenAPI boundaries

See [api/README.md](./api/README.md) for route module shapes,
`APIRouteHandler`, method resolution, isolation, CORS, and OpenAPI contracts.
Important transport limits include:

| Boundary                          |                            Limit |
| --------------------------------- | -------------------------------: |
| Browser navigation response       |                            4 MiB |
| Isolated-worker response transfer |                           10 MiB |
| Isolated-worker response headers  |   256 entries / 64 Ki code units |
| Serialized OpenAPI document       |                           16 MiB |
| Generated MCP tool response       | 4 MiB by default, 16 MiB maximum |

OpenAPI schema conversion and generated operation-ID uniqueness fail closed.
Generated MCP tools capture their transport configuration, enforce a deadline,
reject redirects, preserve fixed credential precedence, and bound request and
response JSON. Multi-tool registry publication is atomic.

## Verification

Run the complete module gate from the repository root:

```bash
deno fmt --check src/routing
deno lint src/routing
deno check src/routing/index.ts src/routing/api/index.ts
deno test -A --unstable-worker-options --trace-leaks src/routing
```

Changes to `client/` also require regenerating and testing the embedded
production client bundle:

```bash
deno run -A scripts/build/prebundle-client-scripts.ts
deno test -A --trace-leaks src/build/production-build/templates.test.ts
```
