---
title: "veryfront"
description: "Configuration, server bootstrap, routing, data fetching, and input validation."
order: 1
---

# veryfront

Configuration, server bootstrap, routing, data fetching, and input validation.

## Import

```ts
import {
  defineConfig,
  json,
  notFound,
  redirect,
  getEnv,
  createValidatedHandler,
} from "veryfront";
```

## Examples

### Configuration

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  // your project config
});
```

### API routes

```ts
import { json } from "veryfront";
import type { APIContext, APIResponse } from "veryfront";

export function GET(ctx: APIContext): APIResponse {
  return json({ message: "Hello" });
}
```

### Data loading

```ts
import { notFound } from "veryfront";
import type { DataContext } from "veryfront";

export function getServerData(ctx: DataContext) {
  if (!ctx.params.id) throw notFound();
  return { title: "Page" };
}
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError) |

### Functions

| Name | Description |
|------|-------------|
| `apiNotFound` | 404 Not Found response |
| `apiRedirect` | Redirect response |
| `badRequest` | 400 Bad Request response |
| `createHandler` | Create HTTP request handler |
| `createValidatedHandler` | Create a validated API handler wrapper that auto-validates body/query with Zod schemas |
| `createValidationError` | Create an input validation error. |
| `defineConfig` | Define project configuration |
| `forbidden` | 403 Forbidden response |
| `getEnv` | Read environment variable (typed) |
| `json` | JSON response helper |
| `notFound` | Throw 404 in data loaders |
| `parseFormData` | Parse multipart form data |
| `parseJsonBody` | Parse and validate JSON body |
| `parseQueryParams` | Parse and validate query params |
| `redirect` | Throw redirect in data loaders |
| `sanitizeData` | Sanitize data to prevent XSS and prototype pollution attacks. |
| `serverError` | 500 Internal Server Error response |
| `startServer` | Start a Veryfront server in development or production mode. |
| `toNodeHandler` | Convert a Web API request handler into a Node.js HTTP request listener |
| `unauthorized` | 401 Unauthorized response |

### Types

| Name | Description |
|------|-------------|
| `APIContext` | API route handler context |
| `APIHandler` | API route handler signature |
| `APIResponse` | API handler response type |
| `APIRoute` | Route with method handlers |
| `DataContext` | `getServerData` context |
| `InferGetServerDataProps` | Utility type to infer props from a page with data |
| `MDXFrontmatter` | Parsed MDX frontmatter |
| `PageContext` | Page runtime context |
| `PageWithData` | Page with data fetching capabilities |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. |
| `StaticPathsResult` | `getStaticPaths` return type |
| `ValidatedHandlerConfig` | `createValidatedHandler` config |
| `ValidatedHandlerFunction` | Handler with validated inputs |
| `VeryfrontConfig` | Project configuration. The underlying zod schema stores `extensions` as |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. |
| `VeryfrontServer` | Running server instance with lifecycle controls. |

## Related

Reference modules:

- [`veryfront/head`](./head.md): Declarative `<head>` metadata
- [`veryfront/router`](./router.md): Client-side routing and navigation
- [`veryfront/context`](./context.md): Access route params and page data

User guides:

- [configuration](../../guides/configuration.md): Configure your Veryfront project
- [project-structure](../../guides/project-structure.md): Project layout and conventions
- [data-fetching](../../guides/data-fetching.md): Server data, static data, params

Architecture:

- [01-system-overview](../../architecture/01-system-overview.md): System overview and boundaries
- [02-request-pipeline](../../architecture/02-request-pipeline.md): Request handling pipeline
