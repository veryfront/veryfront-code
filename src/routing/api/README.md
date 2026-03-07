# API Module

The API module provides file-based REST API routing with dynamic path matching, request context, response helpers, and CORS support.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import { APIRouteHandler, json, notFound } from "#api";

// Using barrel file
import { APIRouteHandler, json, notFound } from "./api/index.ts";
```

## Public API Overview

The API module exports:

- **`APIRouteHandler`** - Main class for API route discovery and execution
- **`ApiRouteMatcher`** - File-based dynamic route matching with parameters
- **Response helpers** - `json()`, `redirect()`, `notFound()`, `badRequest()`, etc.
- **CORS utilities** - CORS preflight and header handling
- **Context utilities** - Request context creation and parsing

## File Structure

```
api/
├── index.ts                    # Public API (barrel file) ← USE THIS
├── README.md                   # This file
├── handler.ts                  # APIRouteHandler implementation
├── api-route-matcher.ts        # ApiRouteMatcher implementation
├── responses.ts                # Response helper functions
├── cors-handler.ts             # CORS utilities
├── context-builder.ts          # Context creation utilities
├── error-handler.ts            # Error handling middleware
├── method-validator.ts         # HTTP method validation
├── route-discovery.ts          # File-based route discovery
├── route-executor.ts           # Route execution logic
└── module-loader/              # Dynamic route module loading
    ├── module-loader.ts
    └── types.ts
```

## Quick Start

### Creating an API Route

**Pages Router** (`pages/api/hello.ts`):

```ts
import type { APIContext } from "#api";

export default function handler(ctx: APIContext) {
  return ctx.json({ message: "Hello World!" });
}

// Optional: Specify allowed methods
export const config = {
  methods: ["GET", "POST"],
};
```

**App Router** (`app/api/hello/route.ts`):

```ts
export async function GET(request: Request) {
  return new Response(JSON.stringify({ message: "Hello!" }), {
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  return new Response(JSON.stringify({ received: body }), {
    headers: { "content-type": "application/json" },
  });
}
```

### Using the API Handler

```ts
import { APIRouteHandler } from "#api";
import { getAdapter } from "../adapters/index.ts";

const adapter = await getAdapter();
const handler = new APIRouteHandler({
  projectDir: "./my-app",
  adapter,
});

await handler.initialize();

// Handle a request
const response = await handler.handleRequest(request);
```

## Key Concepts

### 1. Dynamic Routes

Support for dynamic segments:

- `/api/user/[id].ts` → matches `/api/user/123`
- `/api/[...slug].ts` → matches `/api/foo/bar/baz`

### 2. Request Context

Every API route receives a context object:

```ts
interface APIContext {
  req: Request; // Web API Request
  params: Record<string, string>; // Route params
  query: URLSearchParams; // Query params
  json: (data: any) => Response; // JSON response helper
  text: (data: string) => Response; // Text response helper
  // ... more helpers
}
```

### 3. CORS Handling

Automatic CORS support:

```ts
// veryfront.config.ts
export default {
  cors: {
    origin: "https://example.com",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  },
};
```

### 4. Error Handling

Consistent error responses:

```ts
export default function handler(ctx: APIContext) {
  if (!ctx.query.get("id")) {
    throw new Error("Missing ID parameter");
  }
  // Automatically returns 500 JSON error response
}
```

## Advanced Usage

### Middleware for API Routes

```ts
// pages/api/auth/[...].ts
import type { APIContext } from "#api";

export const config = {
  middleware: [authMiddleware, rateLimitMiddleware],
};

export default async function handler(ctx: APIContext) {
  // ctx.user available from authMiddleware
  return ctx.json({ user: ctx.user });
}
```

### Type-Safe Params

```ts
import type { APIContext } from "#api";

interface Params {
  id: string;
}

export default function handler(ctx: APIContext<Params>) {
  const id = ctx.params.id; // TypeScript knows this is a string
  return ctx.json({ id });
}
```

## Testing

Tests are co-located with their modules:

```bash
src/api/
├── handler.test.ts
├── context-builder.test.ts
├── route-discovery.test.ts
└── responses.test.ts
```

Run API tests:

```bash
deno test src/api/*.test.ts
```

## Performance Tips

1. **Use streaming** for large responses
2. **Enable caching** for stable data
3. **Validate early** to fail fast
4. **Use async/await** properly

## Common Patterns

### Health Check Endpoint

```ts
// pages/api/health.ts
export default function handler() {
  return new Response("OK", { status: 200 });
}
```

### Data Fetching API

```ts
// pages/api/posts/[id].ts
export default async function handler(ctx: APIContext) {
  const post = await db.posts.find(ctx.params.id);
  if (!post) {
    return ctx.json({ error: "Not found" }, { status: 404 });
  }
  return ctx.json(post);
}
```

### Webhook Handler

```ts
// pages/api/webhooks/stripe.ts
export const config = { methods: ["POST"] };

export default async function handler(ctx: APIContext) {
  const signature = ctx.req.headers.get("stripe-signature");
  const body = await ctx.req.text();

  // Verify signature...

  return ctx.json({ received: true });
}
```

## Security Best Practices

1. **Validate input** - Never trust client data
2. **Use CORS** - Restrict origins
3. **Rate limiting** - Prevent abuse
4. **Authentication** - Verify identity
5. **HTTPS only** - Encrypt in transit

## Related Domains

- **server/**: Server implementations that use API handlers
- **routing/**: Route registry for handler organization
- **middleware/**: Middleware that wraps API handlers
- **security/**: Security features for APIs

## Module Boundaries

The `api/` module has established boundaries to ensure clean architecture and maintainability.

### Public API (via Barrel File)

**Always import from the barrel file** (`index.ts`):

```typescript
// CORRECT - Using import map alias
import { APIRouteHandler, json, notFound } from "#api";

// ALSO CORRECT - Using barrel file directly
import { APIRouteHandler, json, notFound } from "./api/index.ts";

// WRONG - Deep import bypassing barrel file
import { APIRouteHandler } from "./api/handler.ts";
```

### Internal Files (Do Not Import Directly)

These are implementation details and should not be imported from outside the module:

- `handler.ts` - Internal implementation
- `api-route-matcher.ts` - Internal routing logic
- `context-builder.ts` - Internal context utilities
- `error-handler.ts` - Internal error handling
- `method-validator.ts` - Internal HTTP method validation
- `route-discovery.ts` - Internal route discovery
- `route-executor.ts` - Internal route execution
- `module-loader/` - Internal module loading utilities

### Enforcing Boundaries

Run the deep import linter to check for violations:

```bash
deno task lint:ban-deep-imports
```

This will detect any imports that bypass the barrel file and suggest corrections.

### Why Module Boundaries Matter

1. **Encapsulation**: Internal implementation can be refactored without breaking external code
2. **Clear API**: Public API is explicitly defined in one place
3. **Maintainability**: Changes to internal files don't affect consumers
4. **Discoverability**: Developers know exactly what's public by reading `index.ts`
5. **Type Safety**: Export types are properly managed and versioned
