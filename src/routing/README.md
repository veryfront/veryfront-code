# Routing Module

## Purpose

The routing module provides pattern-based URL matching, dynamic route handling, API route processing, and client-side navigation for file-based routing systems.

## Scope

### What this module does:

- Route pattern matching with dynamic segments (`/blog/:slug`)
- File path to URL slug mapping and normalization
- API route handling with request/response helpers
- Client-side page loading and prefetching
- Path parameter extraction
- Route specificity scoring for conflict resolution
- CORS handling for API routes

### What this module does NOT do:

- Static file serving (see `platform/`)
- SSR/RSC rendering (see `rendering/`)
- HTTP server implementation (see `server/`)
- Middleware pipeline execution (see `middleware/`)

## Architecture

```
routing/
├── matchers/              # Route pattern matching
│   ├── router.ts         # PageRouteMatcher implementation
│   ├── matcher.ts        # Pattern matching logic
│   └── types.ts          # Route types
├── slug-mapper/          # Path/slug conversion
│   ├── normalizer.ts     # Path normalization
│   ├── mapper.ts         # Slug to path mapping
│   └── types.ts          # Mapper types
├── api/                  # API route handling
│   ├── handler.ts        # APIRouteHandler
│   ├── context.ts        # Request context
│   ├── responses.ts      # Response helpers
│   └── cors.ts           # CORS utilities
├── client/               # Client-side routing
│   ├── page-loader.ts    # Page data loading
│   ├── prefetch.ts       # Link prefetching
│   ├── navigation.ts     # Navigation handlers
│   └── types.ts          # Client types
└── registry/             # Route registry
    ├── registry.ts       # Route storage
    └── types.ts          # Registry types
```

## Key Exports

### Route Matching

- `PageRouteMatcher` - Main router class
- `matchRoute(pattern, path)` - Match URL to pattern
- `parseRoute(pattern)` - Parse route pattern
- `getSpecificityScore(pattern)` - Calculate route priority
- `normalizePath(path)` - Normalize URL path

### Slug Mapping

- `pathToSlug(path)` - Convert file path to URL slug
- `slugToPath(slug)` - Convert URL slug to file path
- `normalizeSlug(slug)` - Normalize slug format
- `extractParams(pattern, path)` - Extract route parameters
- `getPathCandidates(slug)` - Get possible file paths for slug
- `isDynamicRoute(path)` - Check if route has dynamic segments
- `matchesPattern(path, pattern)` - Test if path matches pattern

### API Routes

- `APIRouteHandler` - API route handler class
- `createContext(request, params)` - Create API context
- `json(data, status?)` - JSON response helper
- `redirect(url, status?)` - Redirect response
- `notFound(message?)` - 404 response
- `badRequest(message?)` - 400 response
- `unauthorized(message?)` - 401 response
- `forbidden(message?)` - 403 response
- `serverError(message?)` - 500 response
- `applyCORSHeaders(response, config)` - Add CORS headers
- `handleCORSPreflight(config)` - Handle OPTIONS requests

### Client-Side Routing

- `PageLoader` - Load page data client-side
- `PageTransition` - Handle page transitions
- `NavigationHandlers` - Navigation event handlers
- `ViewportPrefetch` - Auto-prefetch visible links
- `extractPageDataFromScript()` - Parse SSR page data

## Dependencies

### Internal

- `#veryfront/types` - TypeScript types
- `#veryfront/security` - Input validation, CORS

### External

None (zero external dependencies)

## Usage Examples

### Route Matching

```typescript
import { normalizePath, PageRouteMatcher } from "#veryfront/routing";

// Create router
const router = new PageRouteMatcher();

// Add routes
router.addRoute({
  pattern: "/blog/:slug",
  filePath: "pages/blog/[slug].tsx",
});

router.addRoute({
  pattern: "/blog/:category/:slug",
  filePath: "pages/blog/[category]/[slug].tsx",
});

// Match URL
const match = router.match("/blog/hello-world");
console.log(match);
// {
//   params: { slug: 'hello-world' },
//   filePath: 'pages/blog/[slug].tsx',
//   pattern: '/blog/:slug'
// }
```

### Dynamic Route Parameters

```typescript
import { extractParams, matchRoute } from "#veryfront/routing";

const pattern = "/api/users/:id/posts/:postId";
const path = "/api/users/123/posts/456";

const match = matchRoute(pattern, path);
if (match) {
  console.log(match.params);
  // { id: '123', postId: '456' }
}
```

### Slug Mapping

```typescript
import { normalizeSlug, pathToSlug, slugToPath } from "#veryfront/routing";

// File path → URL slug
const slug = pathToSlug("pages/blog/[category]/[slug].tsx");
console.log(slug); // "/blog/:category/:slug"

// URL slug → File path candidates
const paths = slugToPath("/blog/react/hooks");
console.log(paths);
// [
//   'pages/blog/[category]/[slug].tsx',
//   'pages/blog/react/[slug].tsx',
//   'pages/blog/react/hooks.tsx'
// ]

// Normalize slug
const normalized = normalizeSlug("/blog//post/");
console.log(normalized); // "/blog/post"
```

### API Routes

```typescript
import { type APIContext, badRequest, json, notFound } from "#veryfront/routing";

// GET /api/users/:id
export async function GET(ctx: APIContext) {
  const { params, query } = ctx;

  if (!params.id) {
    return badRequest("User ID is required");
  }

  const user = await db.users.findById(params.id);

  if (!user) {
    return notFound("User not found");
  }

  return json(user);
}

// POST /api/users
export async function POST(ctx: APIContext) {
  const body = await ctx.request.json();

  const user = await db.users.create(body);

  return json(user, 201);
}

// DELETE /api/users/:id
export async function DELETE(ctx: APIContext) {
  await db.users.delete(ctx.params.id);

  return new Response(null, { status: 204 });
}
```

### API CORS Configuration

```typescript
import { applyCORSHeaders, handleCORSPreflight } from "#veryfront/routing";

export async function OPTIONS() {
  return handleCORSPreflight({
    origin: ["https://app.example.com"],
    methods: ["GET", "POST", "DELETE"],
    credentials: true,
  });
}

export async function GET(ctx: APIContext) {
  const response = json({ data: "example" });

  return applyCORSHeaders(response, {
    origin: ["https://app.example.com"],
    credentials: true,
  });
}
```

### Client-Side Page Loading

```typescript
import { PageLoader, ViewportPrefetch } from "#veryfront/routing";

// Create page loader
const loader = new PageLoader("/");

// Load page data
const pageData = await loader.loadPage("/blog/hello");
console.log(pageData.html, pageData.data);

// Auto-prefetch visible links
const prefetch = new ViewportPrefetch(loader);
prefetch.start();

// Manual prefetch
await loader.prefetch("/about");
```

### Client-Side Navigation

```typescript
import { NavigationHandlers, PageTransition } from "#veryfront/routing";

const handlers = new NavigationHandlers({
  loader: new PageLoader("/"),
  onNavigate: (url) => {
    console.log("Navigating to:", url);
  },
  onError: (error) => {
    console.error("Navigation error:", error);
  },
});

// Handle link clicks
handlers.attachToLinks();

// Page transitions
const transition = new PageTransition({
  duration: 300,
  fadeOut: true,
});

transition.start(() => {
  // Update page content
  document.body.innerHTML = newHTML;
});
```

### Route Specificity

```typescript
import { getSpecificityScore } from "#veryfront/routing";

// More specific routes have higher scores
const scores = [
  getSpecificityScore("/blog/react/hooks"), // 300 (static)
  getSpecificityScore("/blog/:category/hooks"), // 201 (1 dynamic)
  getSpecificityScore("/blog/:category/:slug"), // 102 (2 dynamic)
  getSpecificityScore("/:path*"), // 1 (catch-all)
];

console.log(scores); // [300, 201, 102, 1]
```

## Route Pattern Syntax

### Static Segments

```
/blog/about           → Matches exactly "/blog/about"
/api/users            → Matches exactly "/api/users"
```

### Dynamic Segments

```
/blog/:slug           → Matches "/blog/hello", "/blog/world"
/api/users/:id        → Matches "/api/users/123"
/blog/:cat/:slug      → Matches "/blog/react/hooks"
```

### Catch-All Segments

```
/docs/:path*          → Matches "/docs/a", "/docs/a/b", "/docs/a/b/c"
```

### File Path Mapping

```
pages/blog/[slug].tsx       → /blog/:slug
pages/api/users/[id].ts     → /api/users/:id
pages/[...path].tsx         → /:path*
```

## Performance

### Route Matching

- Static routes: O(1) lookup
- Dynamic routes: O(n) where n = number of dynamic routes
- Specificity scoring: O(1) per route

### Optimization Tips

1. **Use static routes** when possible (faster matching)
2. **Order routes** by specificity (more specific first)
3. **Cache match results** for frequently accessed routes
4. **Prefetch pages** for better navigation performance

## Testing

```bash
# Run routing tests
deno task test src/routing/

# Test route matching
deno task test src/routing/matchers/

# Test slug mapping
deno task test src/routing/slug-mapper/

# Test API routes
deno task test src/routing/api/

# Test client routing
deno task test src/routing/client/
```

## Maintainer

**Team:** Routing Team
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`server/`](../server/README.md) - HTTP server integration
- [`rendering/`](../rendering/README.md) - Page rendering
- [`middleware/`](../middleware/README.md) - Request pipeline
- [`security/`](../security/README.md) - CORS and validation

## Troubleshooting

### Route Not Matching

```typescript
// Problem: Route doesn't match
const match = router.match("/blog/hello");
console.log(match); // null

// Solution: Check route pattern
router.addRoute({
  pattern: "/blog/:slug", // Must use : for dynamic segments
  filePath: "pages/blog/[slug].tsx",
});
```

### Conflicting Routes

```typescript
// Problem: Multiple routes match same URL
router.addRoute({ pattern: "/blog/:slug", filePath: "a.tsx" });
router.addRoute({ pattern: "/blog/:category", filePath: "b.tsx" });

// Solution: Use specificity scoring or more specific patterns
router.addRoute({ pattern: "/blog/category/:name", filePath: "b.tsx" });
router.addRoute({ pattern: "/blog/:slug", filePath: "a.tsx" });
```

### CORS Errors

```typescript
// Problem: CORS errors in browser
// Error: "No 'Access-Control-Allow-Origin' header"

// Solution: Add CORS headers
export async function GET(ctx: APIContext) {
  const response = json({ data: "example" });

  return applyCORSHeaders(response, {
    origin: "*", // or specific origins
    methods: ["GET"],
  });
}
```

### Path Normalization

```typescript
// Problem: Inconsistent path formats
const paths = ["/blog/", "blog", "/blog//post"];

// Solution: Normalize all paths
import { normalizePath } from "#veryfront/routing";

const normalized = paths.map(normalizePath);
console.log(normalized); // ['/blog', '/blog', '/blog/post']
```

## References

- [File-based Routing](https://veryfront.com/docs/routing)
- [API Routes](https://veryfront.com/docs/api-routes)
- [Client-side Routing](https://veryfront.com/docs/client-routing)
- [Veryfront Routing Guide](https://veryfront.com/docs/routing)
