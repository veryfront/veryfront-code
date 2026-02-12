---
title: "veryfront"
description: "Configuration, server bootstrap, routing, data fetching, and input validation."
order: 1
---

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
| `CommonSchemas` | Built-in Zod schemas (email, URL, etc.) |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError) |

### Functions

| Name | Description |
|------|-------------|
| `apiNotFound` | 404 Not Found response |
| `apiRedirect` | Redirect response |
| `badRequest` | 400 Bad Request response |
| `createValidatedHandler` | Create a validated API handler wrapper that auto-validates body/query with Zod schemas |
| `createValidationError` | Create an input validation error. |
| `createVeryfrontHandler` | Create HTTP request handler |
| `defineConfig` | Define project configuration |
| `forbidden` | 403 Forbidden response |
| `getEnv` | Read environment variable (typed) |
| `json` | JSON response helper |
| `notFound` | Throw 404 in data loaders |
| `parseFormData` | Parse multipart form data |
| `parseJsonBody` | Parse and validate JSON body |
| `parseQueryParams` | Parse and validate query params |
| `redirect` | Throw redirect in data loaders |
| `sanitizeData` | ****** Sanitize data to prevent XSS and prototype pollution attacks |
| `serverError` | 500 Internal Server Error response |
| `startVeryfrontServer` | Start a Veryfront server in development or production mode. |
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
| `StartVeryfrontServerOptions` | Server options. Use `mode: "development"` for dev server with HMR, |
| `StaticPathsResult` | `getStaticPaths` return type |
| `ValidatedHandlerConfig` | `createValidatedHandler` config |
| `ValidatedHandlerFunction` | Handler with validated inputs |
| `VeryfrontConfig` | Project configuration shape |
| `VeryfrontServerHandle` | Server handle (for shutdown) |
