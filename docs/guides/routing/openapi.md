---
title: "OpenAPI & API Documentation"
category: "routing"
level: "intermediate"
keywords: ["openapi", "swagger", "api-docs", "scalar", "mcp", "ai"]
ai_summary: "Auto-generate OpenAPI 3.1 specs and interactive docs from your API routes. AI agents can discover and call your APIs via MCP."
related: ["routing/api-routes", "ai/specification"]
version: "0.1.0"
last_updated: "2025-01-14"
---

# OpenAPI & API Documentation

Veryfront automatically generates OpenAPI 3.1 specifications from your API routes. Get interactive documentation, AI agent discovery, and type-safe API clients with zero configuration.

## Features

- **Auto-Generated Spec** - OpenAPI 3.1 from route metadata
- **Interactive Docs** - Beautiful Scalar UI at `/_docs`
- **MCP Integration** - AI agents discover and call your APIs
- **Type-Safe** - Zod schemas become JSON Schema
- **Zero Config** - Works out of the box

---

## Quick Start

### 1. Define Routes with Metadata

```typescript
// app/api/users/route.ts
import { createRoute, z } from "veryfront/openapi";

export const GET = createRoute({
  summary: "List all users",
  description: "Returns a paginated list of users",
  tags: ["Users"],
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
  response: {
    200: z.object({
      users: z.array(z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
      })),
      total: z.number(),
    }),
  },
  handler: async (request, { query }) => {
    const page = parseInt(query.page || "1");
    const limit = parseInt(query.limit || "10");
    const users = await fetchUsers({ page, limit });
    return Response.json(users);
  },
});
```

### 2. Access Auto-Generated Docs

| Endpoint | Description |
|----------|-------------|
| `/_docs` | Interactive Scalar UI |
| `/_openapi.json` | OpenAPI 3.1 JSON |
| `/_openapi.yaml` | OpenAPI 3.1 YAML |

That's it. No configuration needed.

---

## The `createRoute` Helper

`createRoute` wraps your handler with OpenAPI metadata for automatic documentation.

### Basic Structure

```typescript
import { createRoute, z } from "veryfront/openapi";

export const POST = createRoute({
  // Metadata
  summary: "Short description",
  description: "Detailed description",
  tags: ["Category"],
  operationId: "createUser",  // Optional, auto-generated if omitted

  // Input schemas
  params: z.object({ id: z.string() }),  // Path parameters
  query: z.object({ filter: z.string() }),  // Query parameters
  body: z.object({ name: z.string() }),  // Request body

  // Response schemas
  response: {
    200: z.object({ id: z.string() }),
    400: z.object({ error: z.string() }),
    404: z.object({ error: z.string() }),
  },

  // Handler
  handler: async (request, context) => {
    const { params, query, body } = context;
    // Your logic here
    return Response.json({ id: "123" });
  },
});
```

### Context Object

The handler receives a typed context object:

```typescript
handler: async (request, context) => {
  // Path parameters (from URL like /users/[id])
  context.params.id;

  // Query parameters (from ?key=value)
  context.query.filter;

  // Parsed request body (automatically parsed)
  context.body.name;

  return Response.json({ success: true });
}
```

---

## Schema Types

### Path Parameters

```typescript
// app/api/users/[id]/posts/[postId]/route.ts
export const GET = createRoute({
  params: z.object({
    id: z.string().describe("User ID"),
    postId: z.string().describe("Post ID"),
  }),
  handler: async (request, { params }) => {
    const { id, postId } = params;
    // ...
  },
});
```

### Query Parameters

```typescript
export const GET = createRoute({
  query: z.object({
    q: z.string().describe("Search query"),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(10).max(100),
    sort: z.enum(["asc", "desc"]).optional(),
  }),
  handler: async (request, { query }) => {
    const { q, page, limit, sort } = query;
    // ...
  },
});
```

### Request Body

```typescript
export const POST = createRoute({
  body: z.object({
    name: z.string().min(2).max(100),
    email: z.string().email(),
    role: z.enum(["user", "admin"]).default("user"),
    metadata: z.record(z.unknown()).optional(),
  }),
  handler: async (request, { body }) => {
    const { name, email, role } = body;
    // ...
  },
});
```

### Multiple Response Types

```typescript
export const GET = createRoute({
  response: {
    200: z.object({
      user: z.object({ id: z.string(), name: z.string() }),
    }),
    400: z.object({
      error: z.string(),
      details: z.array(z.string()).optional(),
    }),
    404: z.object({
      error: z.literal("User not found"),
    }),
    500: z.object({
      error: z.string(),
      requestId: z.string(),
    }),
  },
  handler: async (request, { params }) => {
    const user = await findUser(params.id);
    if (!user) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }
    return Response.json({ user });
  },
});
```

---

## Interactive Documentation (Scalar)

The `/_docs` endpoint serves interactive API documentation using [Scalar](https://scalar.com/).

### Features

- **Try It** - Execute API calls directly from the browser
- **Code Samples** - Auto-generated examples in multiple languages
- **Search** - Find endpoints quickly
- **Dark Mode** - Beautiful light and dark themes
- **Download** - Export OpenAPI spec

### Customization

```typescript
// veryfront.config.ts
export default {
  openapi: {
    title: "My API",
    version: "2.0.0",
    description: "API for managing users and posts",
    docs: true,  // Enable /_docs (default: true)
    paths: {
      json: "/_openapi.json",   // Custom path
      yaml: "/_openapi.yaml",   // Custom path
      docs: "/_docs",           // Custom path
    },
  },
};
```

---

## MCP Integration (AI Agents)

Veryfront exposes your API to AI agents via the Model Context Protocol (MCP).

### Resource: `openapi://spec`

AI agents can read your OpenAPI spec to understand available endpoints:

```typescript
// In an AI agent
const agent = createAgent({
  resources: ["openapi://spec"],
});

// Agent can now understand your API structure
```

### Auto-Generated Tools

Each API route becomes an MCP tool that agents can invoke:

| Route | Tool ID |
|-------|---------|
| `GET /api/users` | `api:listUsers` |
| `POST /api/users` | `api:createUser` |
| `GET /api/users/[id]` | `api:getUserById` |
| `DELETE /api/users/[id]` | `api:deleteUser` |

### Enable/Disable MCP

```typescript
// veryfront.config.ts
export default {
  openapi: {
    mcp: {
      resource: true,     // Expose openapi://spec (default: true)
      tools: true,        // Generate API tools (default: true)
      toolPrefix: "api",  // Tool naming: api:operationId (default: "api")
    },
  },
};
```

### Custom Operation IDs

Control tool names with explicit `operationId`:

```typescript
export const GET = createRoute({
  operationId: "fetchAllUsers",  // Tool: api:fetchAllUsers
  summary: "List users",
  handler: async () => { /* ... */ },
});
```

---

## Configuration Reference

```typescript
// veryfront.config.ts
export default {
  openapi: {
    // Enable/disable OpenAPI generation (default: true)
    enabled: true,

    // Enable interactive docs at /_docs (default: true)
    docs: true,

    // API metadata
    title: "My API",
    version: "1.0.0",
    description: "API description",

    // Custom endpoint paths
    paths: {
      json: "/_openapi.json",
      yaml: "/_openapi.yaml",
      docs: "/_docs",
    },

    // MCP (AI agent) integration
    mcp: {
      resource: true,     // Expose OpenAPI as MCP resource
      tools: true,        // Auto-generate MCP tools
      toolPrefix: "api",  // Tool naming prefix
    },
  },
};
```

---

## Mixed Routes (With & Without Metadata)

Not all routes need OpenAPI metadata. Plain handlers work normally:

```typescript
// app/api/health/route.ts

// Standard handler - no OpenAPI metadata
export async function GET() {
  return Response.json({ status: "ok" });
}

// app/api/users/route.ts
import { createRoute, z } from "veryfront/openapi";

// Documented handler - full OpenAPI metadata
export const GET = createRoute({
  summary: "List users",
  response: { 200: z.array(UserSchema) },
  handler: async () => {
    const users = await fetchUsers();
    return Response.json(users);
  },
});
```

Routes without `createRoute` still work but won't appear in documentation.

---

## Best Practices

### 1. Use Descriptive Summaries

```typescript
// Good
summary: "Create a new user account"

// Bad
summary: "POST user"
```

### 2. Add Tags for Organization

```typescript
export const GET = createRoute({
  tags: ["Users", "Admin"],
  summary: "List all users",
  // ...
});
```

### 3. Document All Response Codes

```typescript
response: {
  200: SuccessSchema,
  400: ValidationErrorSchema,
  401: UnauthorizedSchema,
  404: NotFoundSchema,
  500: ServerErrorSchema,
}
```

### 4. Use `.describe()` for Field Docs

```typescript
const UserSchema = z.object({
  id: z.string().uuid().describe("Unique user identifier"),
  email: z.string().email().describe("User's email address"),
  createdAt: z.string().datetime().describe("ISO 8601 timestamp"),
});
```

### 5. Reuse Schemas

```typescript
// lib/schemas.ts
export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10).max(100),
});

// app/api/users/route.ts
import { UserSchema, PaginationSchema } from "@/lib/schemas";

export const GET = createRoute({
  query: PaginationSchema,
  response: {
    200: z.object({
      users: z.array(UserSchema),
      total: z.number(),
    }),
  },
  handler: async (request, { query }) => { /* ... */ },
});
```

---

## Accessing the Spec Programmatically

### In Your Application

```typescript
// Fetch the spec from your own server
const response = await fetch("/_openapi.json");
const spec = await response.json();

console.log(spec.info.title);
console.log(Object.keys(spec.paths));
```

### Generate TypeScript Client

```bash
# Using openapi-typescript
npx openapi-typescript http://localhost:3000/_openapi.json -o ./types/api.d.ts

# Using orval
npx orval --input http://localhost:3000/_openapi.json --output ./src/api
```

---

## Troubleshooting

### Routes Not Appearing in Docs

1. Ensure route uses `createRoute` wrapper
2. Check that `openapi.enabled` is not `false` in config
3. Verify route file naming (`route.ts` for App Router)

### Schema Validation Errors

Zod schemas are validated at runtime:

```typescript
export const POST = createRoute({
  body: z.object({
    email: z.string().email(),  // Validation happens automatically
  }),
  handler: async (request, { body }) => {
    // body.email is guaranteed to be valid
    return Response.json({ success: true });
  },
});
```

If validation fails, returns 400 with error details.

### MCP Tools Not Working

1. Check `openapi.mcp.tools` is `true` (default)
2. Ensure routes have valid `operationId` or auto-generated ones
3. Verify AI agent has access to MCP tools

---

## Related Documentation

- [API Routes Guide](./api-routes.md) - Basic API route patterns
- [AI Specification](/docs/ai/specification.md) - MCP and agent details
- [Zod Documentation](https://zod.dev) - Schema validation

---

## Quick Reference

### Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/_docs` | Interactive Scalar documentation |
| `/_openapi.json` | OpenAPI 3.1 JSON spec |
| `/_openapi.yaml` | OpenAPI 3.1 YAML spec |

### Imports

```typescript
import { createRoute, z } from "veryfront/openapi";
```

### Basic Pattern

```typescript
export const METHOD = createRoute({
  summary: "Description",
  tags: ["Category"],
  params: z.object({ id: z.string() }),
  query: z.object({ page: z.string() }),
  body: z.object({ name: z.string() }),
  response: {
    200: z.object({ success: z.boolean() }),
    400: z.object({ error: z.string() }),
  },
  handler: async (request, { params, query, body }) => {
    return Response.json({ success: true });
  },
});
```

### Config

```typescript
// veryfront.config.ts
export default {
  openapi: {
    enabled: true,
    docs: true,
    title: "My API",
    version: "1.0.0",
    mcp: { resource: true, tools: true },
  },
};
```
