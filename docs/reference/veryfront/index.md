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

| Name | Description | Source |
|------|-------------|--------|
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L65) |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry.ts#L685) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `apiNotFound` | Create a 404 Not Found response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L113) |
| `apiRedirect` | Create an HTTP redirect response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L91) |
| `badRequest` | Create a 400 Bad Request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L118) |
| `createHandler` | Create a Veryfront request handler for development or production. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L195) |
| `createValidatedHandler` | Create a validated API handler wrapper that auto-validates body/query with Zod schemas | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L20) |
| `createValidationError` | Create an input validation error. Convenience wrapper around INPUT_VALIDATION_FAILED.create(). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/errors.ts#L12) |
| `defineConfig` | Define a Veryfront project configuration object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L6) |
| `forbidden` | Create a 403 Forbidden response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L128) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L104) |
| `json` | Create a JSON response with the correct content type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L66) |
| `notFound` | Return a 404 result from a data loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/helpers.ts#L9) |
| `parseFormData` | Parse and validate multipart or URL-encoded form data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L48) |
| `parseJsonBody` | Parse and validate a JSON request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L12) |
| `parseQueryParams` | Parse and validate query parameters from a request URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L81) |
| `redirect` | Return a redirect result from a data loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/helpers.ts#L4) |
| `sanitizeData` | Sanitize data to prevent XSS and prototype pollution attacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/sanitizers.ts#L2) |
| `serverError` | Create a 500 Internal Server Error response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L133) |
| `startServer` | Start a Veryfront server in development or production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L329) |
| `toNodeHandler` | Convert a Web API request handler into a Node.js HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L4) |
| `unauthorized` | Create a 401 Unauthorized response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L123) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `APIContext` | Context object passed to API route handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/context-builder.ts#L8) |
| `APIHandler` | Function signature for API route handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/handler.ts#L59) |
| `APIResponse` | Structured response shape for API route helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/handler.ts#L52) |
| `APIRoute` | Route module shape with method handlers and an optional default handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/module-loader/types.ts#L28) |
| `DataContext` | Context passed to `getServerData()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/schemas/data.schema.ts#L54) |
| `InferGetServerDataProps` | Utility type to infer props from a page with data | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/types.ts#L28) |
| `MDXFrontmatter` | Parsed frontmatter values from an MDX page. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L88) |
| `PageContext` | Runtime page context passed to page components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L105) |
| `PageWithData` | Page with data fetching capabilities | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/types.ts#L16) |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L127) |
| `StaticPathsResult` | Return type for `getStaticPaths()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/schemas/data.schema.ts#L61) |
| `ValidatedHandlerConfig` | Configuration for `createValidatedHandler()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L7) |
| `ValidatedHandlerFunction` | Handler signature that receives validated request data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L14) |
| `VeryfrontConfig` | Project configuration. The underlying zod schema stores `extensions` as `unknown[]`; this tightened alias surfaces the expected `ExtensionConfigEntry[]` shape to TypeScript consumers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/schemas/index.ts#L25) |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L142) |
| `VeryfrontServer` | Running server instance with lifecycle controls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L130) |

## Related

Reference modules:

- [`veryfront/head`](./head.md): Declarative `<head>` metadata
- [`veryfront/router`](./router.md): Client-side routing and navigation
- [`veryfront/context`](./context.md): Access route params and page data

User guides:

- [index](../../guides/index.md): Browse the guide map
- [quickstart](../../guides/quickstart.md): Build and run a first agent app
- [veryfront-code](../../guides/veryfront-code.md): What Veryfront Code is and how guides fit together
- [installation](../../guides/installation.md): Install the CLI and framework
- [create-a-project](../../guides/create-a-project.md): Scaffold and run a project
- [create-an-agent](../../guides/create-an-agent.md): Define and invoke a first agent
- [create-an-api](../../guides/create-an-api.md): Add a first API route
- [create-a-frontend](../../guides/create-a-frontend.md): Add a first page
- [deploy-a-project](../../guides/deploy-a-project.md): Deploy a first project
- [choose-a-primitive](../../guides/choose-a-primitive.md): Choose the right primitive
- [production-path](../../guides/production-path.md): Move a route toward production checks
- [configuration](../../guides/configuration.md): Configure your Veryfront project
- [project-structure](../../guides/project-structure.md): Project layout and conventions
- [data-fetching](../../guides/data-fetching.md): Server data, static data, params

Architecture:

- [01-system-overview](../../architecture/01-system-overview.md): System overview and boundaries
- [02-request-pipeline](../../architecture/02-request-pipeline.md): Request handling pipeline
