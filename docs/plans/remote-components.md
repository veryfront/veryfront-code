# Remote Components (Cross-Project Imports)

## Overview

Remote components allow importing from other Veryfront projects:

```typescript
import { Button } from "https://react.veryfront.com/@/components/Button";
import { useAuth } from "https://auth.veryfront.com/@/hooks/useAuth";
```

---

## Prerequisites

### Renderer Must Enforce `isPublic` and CORS

**Current gaps:**
1. The renderer serves `/@/` routes without checking if the project is public (security issue)
2. The renderer doesn't serve CORS headers on `/@/` routes (browser imports would fail)

**Required fixes:** Before serving any `/@/` module route, the renderer must:
1. Check the project's `isPublic` flag (fail-closed if unavailable)
2. Include CORS headers for cross-origin browser imports

**Example `isPublic` check:**

```typescript
// In module-server.ts, before serving /@/ routes
const projectData = await adapter.getProjectData();

if (!projectData?.isPublic) {
  // Project is private - check for auth or reject
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Forbidden: Project is not public", { status: 403 });
  }
  // Future: validate auth token has access to this project
}

// Project is public or auth validated - serve the module
```

**Where `isPublic` is defined:**
- Set in API (Studio project settings)
- Stored in database on project record
- Fetched by renderer via `adapter.getProjectData()`

**This is a prerequisite for remote components** - without it, all projects' modules are publicly accessible regardless of settings.

---

## Access Control

### Public vs Private Projects

| Project Setting | `/@/` Routes | Cross-Project Import |
|-----------------|--------------|----------------------|
| `isPublic: true` | Publicly accessible | ✅ Works |
| `isPublic: false` | Requires auth | ❌ Returns 403 |

### MVP Scope

For MVP, **only public projects can be imported cross-project**:

```typescript
// ✅ Works - ui-components is a public project
import { Button } from "https://ui-components.veryfront.com/@/components/Button";

// ❌ 403 Forbidden - private-lib is not public
import { secret } from "https://private-lib.veryfront.com/@/lib/secret";
```

### Future: Private Project Imports

To enable private cross-project imports (post-MVP):

1. **Auth token in request** - Pass bearer token that has access to target project
2. **Explicit sharing** - Project A grants Project B access
3. **Organization scope** - Projects in same org can import each other

---

## Design Philosophy

### URL is Truth

The URL is the canonical address. We fetch it. That's it.

```typescript
import { Button } from "https://react.veryfront.com/@/components/Button";
// Browser: fetch this URL
// SSR: fetch this URL
// Same behavior, same code path
```

This follows:
- **Deno's model** - Import URLs directly, cache them
- **ESM CDN model** - esm.sh, unpkg, skypack all work this way
- **Web standards** - URLs are addresses, they should work

### Start Simple, Add Complexity When Proven Necessary

We avoid premature complexity:
- ❌ No URL parsing to extract project slugs
- ❌ No domain registry lookups
- ❌ No separate browser vs SSR code paths
- ❌ No API-based resolution layer

Instead:
- ✅ HTTP fetch the URL
- ✅ Cache aggressively
- ✅ Good error messages

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  import { Button } from "https://react.veryfront.com/@/..."     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   HTTP Fetch    │
                    │  (both browser  │
                    │    and SSR)     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │     Cache       │
                    │ (content-based) │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │   Transform     │
                    │   (if needed)   │
                    └────────┬────────┘
                             │
                             ▼
                         Use module
```

**Same flow for browser and SSR.** No special cases.

---

## URL Pattern

### Format

```
https://{project}.veryfront.com/@/{path}
https://{project}.preview.veryfront.com/@/{path}
```

### Examples

```typescript
// Components
import { Button } from "https://ui.veryfront.com/@/components/Button";

// Hooks
import { useAuth } from "https://auth.veryfront.com/@/hooks/useAuth";

// Utils
import { formatDate } from "https://utils.veryfront.com/@/lib/date";
```

### Valid Paths

Only `@/` with slash is valid:
- ✅ `@/components/...`
- ✅ `@/lib/...`
- ✅ `@/hooks/...`
- ✅ `@/utils/...`
- ❌ `@components/...` (invalid - missing slash)

### Module Format

All `/@/` routes serve **ES modules**:
- Content-Type: `application/javascript`
- Format: Standard ESM with `import`/`export`
- No CommonJS (`require`/`module.exports`)

---

## How It Works

### Browser

1. Browser encounters import URL
2. Browser fetches URL (standard ES module behavior)
3. Target project's renderer serves the file
4. Module is cached per browser caching rules

### SSR

1. SSR encounters import URL in code
2. HTTP fetch to the URL
3. Target project's renderer serves the file
4. Response is cached locally
5. Module is transformed and used

**Key insight:** The target URL (`react.veryfront.com`) is a Veryfront renderer. It knows how to serve `/@/` routes. Just fetch it.

---

## Caching Strategy

### URL-Based Cache with Content Validation

```typescript
// Cache lookup by URL
const cacheKey = hash(url);
const cachePath = `.cache/remote-modules/${cacheKey}.js`;

// Check if cached version exists
const cached = await getFromDisk(cachePath);
if (cached) {
  // Optionally validate with HTTP conditional request
  // using ETag/Last-Modified from previous fetch
  return cached;
}

// Fetch, then cache with content hash for integrity
const content = await fetch(url);
const contentHash = hash(content);
await saveToDisk(cachePath, content, { contentHash });
```

- Cache key is URL-based (can look up without fetching)
- Content hash stored for integrity validation
- Cache survives restarts
- HTTP headers (ETag) enable conditional revalidation

### Cache Layers

| Layer | Scope | TTL | Invalidation |
|-------|-------|-----|--------------|
| Memory | Per-request dedup | Request duration | Automatic |
| Disk | URL-keyed | 1 hour default | HTTP cache headers |
| HTTP | Standard headers | CDN controlled | ETag / Last-Modified |

### Cache Headers (Served by Target)

```
Content-Type: application/javascript
Cache-Control: public, max-age=3600
ETag: "content-hash"
```

### Cache Headers (Respected by Fetcher)

When fetching, respect standard HTTP caching:
- `Cache-Control: max-age` - Don't re-fetch if within TTL
- `ETag` - Store and send `If-None-Match` for conditional requests
- `304 Not Modified` - Use cached version if content unchanged

---

## SSR Optimization (Optional)

For performance, SSR can route veryfront.com URLs internally:

```
https://react.veryfront.com/@/...
    ↓ detected as internal
http://internal-renderer/@/... + X-Project-Slug: react
    ↓ same network, no public internet
Faster response
```

**This is an optimization, not a requirement.** The simple HTTP fetch works without it.

---

## Custom Domains

Custom domains just work:

```typescript
import { Button } from "https://components.example.com/@/Button";
```

- Browser fetches URL → works (CORS permitting)
- SSR fetches URL → works
- No domain registry needed
- No special handling

The custom domain points to Veryfront infrastructure, which serves the file.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network error | Clear error: "Failed to fetch remote component: {url}" |
| 403 Forbidden | Clear error: "Cannot import from private project: {url}. Only public projects can be imported." |
| 404 | Clear error: "Remote component not found: {url}" |
| 500 | Clear error: "Remote server error fetching: {url}" |
| Timeout | Clear error: "Timeout fetching remote component: {url}" |
| CORS error | Clear error: "CORS error fetching: {url}" |

All errors include the original URL for easy debugging.

**Note:** The 403 error is expected for private projects. Users should either:
1. Make the target project public (in Studio project settings)
2. Wait for private import support (future feature)

---

## Implementation

### Phase 0: Security Prerequisites

**Must be done before enabling remote components.**

#### 0.1 Enforce `isPublic` on Module Routes

Update `src/modules/server/module-server.ts`:

```typescript
// At the start of handleModuleServer, for /@/ routes
async function handleModuleServer(req: Request, ctx: RequestContext, ...) {
  const url = new URL(req.url);

  // Check if this is a public module route (/@/)
  if (url.pathname.startsWith("/@/")) {
    // Fail-closed: if adapter unavailable, reject request
    if (!ctx.adapter?.fs?.getProjectData) {
      return new Response(
        JSON.stringify({ error: "Service unavailable" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const projectData = await ctx.adapter.fs.getProjectData();

    if (!projectData?.isPublic) {
      // Future: check Authorization header for private project access
      return new Response(
        JSON.stringify({ error: "Forbidden: Project is not public" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // Continue with normal module serving...
}
```

#### 0.2 Add `isPublic` to Renderer Schema

**Current gap:** The renderer's `ProjectSchema` doesn't include `isPublic`.

Update `src/platform/adapters/veryfront-api-client/schemas.ts`:

```typescript
export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  provider: z.string().nullish(),
  provider_id: z.string().nullish(),
  layout: z.string().nullish(),
  layout_id: z.string().nullish(),
  config: z.union([z.string(), z.record(z.unknown())]).optional(),
  is_public: z.boolean().optional(),  // ADD THIS
});
```

The API already returns `is_public` - the renderer just needs to parse it.

Ensure `getProjectData()` in `VeryfrontFSAdapter` exposes this field.

#### 0.3 Add CORS Headers for Module Routes

For browser ESM imports to work cross-origin, `/@/` routes must include CORS headers:

```typescript
// When serving /@/ routes for public projects
const headers = new Headers({
  "Content-Type": "application/javascript",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=3600",
});

// Handle preflight requests
if (req.method === "OPTIONS") {
  return new Response(null, { status: 204, headers });
}
```

Without CORS headers, browser imports from other domains will fail with:
```
Access to script at 'https://ui.veryfront.com/@/...' from origin 'https://myapp.veryfront.com'
has been blocked by CORS policy
```

---

### Phase 1: Basic HTTP Fetch (MVP)

#### 1.1 Detect Remote Imports

```typescript
// In transform pipeline or module loader
function isRemoteImport(specifier: string): boolean {
  return specifier.startsWith("https://") || specifier.startsWith("http://");
}
```

#### 1.2 Fetch and Cache

**Option A: Reuse existing `http-cache.ts`**

The existing `src/transforms/esm/http-cache.ts` already handles HTTP module caching for esm.sh. Consider extending it:

```typescript
// Extend existing cacheHttpModule() or create wrapper
import { cacheHttpImportsToLocal } from "#veryfront/transforms/esm/http-cache.ts";

// Reuses existing: URL normalization, content-addressed caching, import rewriting
```

**Option B: New dedicated fetcher**

```typescript
// src/modules/remote/fetcher.ts

async function fetchRemoteModule(url: string): Promise<string> {
  // Check cache first
  const cached = await getFromCache(url);
  if (cached) return cached;

  // Fetch
  const response = await fetch(url, {
    headers: {
      "Accept": "application/javascript, text/javascript, */*",
      "User-Agent": "Veryfront-SSR/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch remote component: ${url} (${response.status})`);
  }

  const content = await response.text();

  // Cache
  await saveToCache(url, content);

  return content;
}
```

**Recommendation:** Start with Option A (reuse existing), only create new if requirements diverge.

#### 1.3 Integrate with Transform Pipeline

```typescript
// src/transforms/pipeline/stages/remote-imports.ts

export const remoteImportsPlugin: TransformPlugin = {
  name: "remote-imports",
  stage: TransformStage.RESOLVE_IMPORTS,

  async transform(ctx) {
    // Find HTTP(S) imports
    // Fetch each
    // Rewrite to local cached path
    // Return transformed code
  }
};
```

### Phase 2: Optimizations (When Needed)

Only add these if measurements show they're needed:

- **Internal routing** - Route veryfront.com URLs internally
- **Prefetching** - Prefetch known remote dependencies
- **Bundling** - Bundle frequently-used remote components

### Phase 3: Enhancements (Future)

Only add if users request:

- **Versioning** - `@1.2.3/` syntax for pinned versions
- **Private projects** - Auth headers for private imports
- **Offline mode** - Work with cached modules when offline

---

## What We're NOT Building (Yet)

| Feature | Why Not Now |
|---------|-------------|
| URL parsing for project extraction | HTTP fetch works without it |
| Domain registry | Custom domains work via HTTP fetch |
| API-based resolution | HTTP fetch is simpler |
| Version parsing | Can add later if needed |
| Two code paths (browser vs SSR) | Same path works for both |

**Principle:** Add complexity to solve real problems, not hypothetical ones.

---

## Implementation Readiness

### Verified Components

| Component | Location | Status |
|-----------|----------|--------|
| `isPublic` in API | `veryfront-api/src/api/http/rest/projects/routes.ts:133` | ✅ Returns `is_public` |
| `isPublic` in DB | `is_public` column on projects table | ✅ Exists, defaults `false` |
| `ProjectSchema` | `src/platform/adapters/veryfront-api-client/schemas.ts` | ❌ Needs `is_public` field |
| `getProjectData()` | `src/platform/adapters/fs/veryfront/adapter.ts` | ✅ Exists |
| Module server | `src/modules/server/module-server.ts` | ✅ Handles `/@/` routes |
| HTTP cache | `src/transforms/esm/http-cache.ts` | ✅ Can be reused for remote modules |

### Implementation Order

1. **Phase 0.2** - Add `is_public` to `ProjectSchema` (5 min)
2. **Phase 0.1** - Add `isPublic` check in module-server.ts (15 min)
3. **Phase 0.3** - Add CORS headers to `/@/` responses (15 min)
4. **Phase 1** - Remote module fetcher + cache (1-2 hours)

---

## Testing Plan

### Unit Tests
- Remote import detection
- Fetch and cache logic
- Error handling

### Integration Tests
- SSR with remote imports
- Cache hit/miss scenarios
- Error scenarios (404, timeout, etc.)

### E2E Tests
- Full page render with remote components
- Cross-project import chains

---

## Rollout Plan

1. **Implement basic fetch + cache**
2. **Test with internal projects**
3. **Measure performance**
4. **Add optimizations only if needed**
5. **Document for users**

---

## Open Questions (Deferred)

These are valid concerns but we defer them until we have real usage data:

1. **Circular dependencies** - Project A imports B imports A
2. **Rate limiting** - Should we limit fetches per request? (Monitor fetch counts per SSR request)
3. **Private projects** - How to handle auth?
4. **Versioning** - Do users need to pin versions?
5. **SSR failure mode** - Should SSR abort or gracefully degrade if remote fetch fails?
6. **React instance sharing** - If remote component bundles different React, could cause "Invalid hook call". Mitigation: All Veryfront projects use same esm.sh React version.
7. **CSS handling** - CSS-in-JS works natively. CSS modules or global CSS would need separate handling.
8. **TypeScript types** - How do consumers get types for remote components? (Not blocking for MVP)

We'll address these when they become real problems.

---

## Summary

| Aspect | Decision |
|--------|----------|
| Resolution | HTTP fetch (browser and SSR) |
| Access control | Only public projects (`isPublic: true`) can be imported |
| Prerequisites | 1) Enforce `isPublic` on `/@/` routes, 2) CORS headers, 3) Fail-closed checks |
| Module format | ES modules (`application/javascript`) |
| Caching | URL-keyed lookup, HTTP cache headers respected |
| Custom domains | Just work (HTTP fetch + CORS) |
| Code paths | One (same for browser and SSR) |
| Versioning | Future enhancement |
| Private imports | Future enhancement (auth tokens) |
| Domain registry | Not needed |
| Complexity | Minimal - add when proven necessary |
