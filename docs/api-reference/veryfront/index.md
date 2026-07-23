---
title: "veryfront"
description: "Configuration, server bootstrap, routing, data fetching, and input validation."
order: 1
---

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
  if (!ctx.params.id) return notFound();
  return { title: "Page" };
}
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CommonSchemas` | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L148) |
| `INPUT_VALIDATION_FAILED` | Registered error definition for the input-validation-failed slug. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L87) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `apiNotFound` | Create a 404 Not Found response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L120) |
| `apiRedirect` | Create an HTTP redirect response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L98) |
| `badRequest` | Create a 400 Bad Request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L125) |
| `createHandler` | Create a Veryfront request handler for development or production. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L252) |
| `createValidatedHandler` | Create a validated API handler wrapper that auto-validates body/query with Zod schemas | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L20) |
| `createValidationError` | Create an input validation error. Convenience wrapper around INPUT_VALIDATION_FAILED.create(). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/errors.ts#L11) |
| `defineConfig` | Define a Veryfront project configuration object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L7) |
| `defineConfigWithEnv` | Define a Veryfront project configuration from the current environment name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L12) |
| `forbidden` | Create a 403 Forbidden response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L135) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L119) |
| `json` | Create a JSON response with the correct content type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L67) |
| `mergeConfigs` | Merge multiple partial Veryfront configuration objects into one config object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L20) |
| `mergeConfigs` | Merge multiple user-authored configuration objects before validation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L22) |
| `mergeConfigs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L23) |
| `notFound` | Return a 404 result from a data loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/helpers.ts#L22) |
| `parseFormData` | Parse and validate multipart or URL-encoded form data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L53) |
| `parseJsonBody` | Parse and validate a JSON request body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L17) |
| `parseQueryParams` | Parse and validate query parameters from a request URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L102) |
| `redirect` | Return a redirect result from a data loader. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/helpers.ts#L6) |
| `sanitizeData` | Sanitize data to prevent XSS and prototype pollution attacks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/sanitizers.ts#L2) |
| `serverError` | Create a 500 Internal Server Error response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L140) |
| `startServer` | Start a Veryfront server in development or production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L480) |
| `toNodeHandler` | Convert a Web API request handler into a Node.js HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L6) |
| `unauthorized` | Create a 401 Unauthorized response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L130) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `APIContext` | Context object passed to API route handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/context-builder.ts#L9) |
| `APIHandler` | Function signature for API route handlers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/handler.ts#L71) |
| `APIResponse` | Structured response shape for API route helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/handler.ts#L64) |
| `APIRoute` | Route module shape with method handlers and an optional default handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/module-loader/types.ts#L28) |
| `DataContext` | Context passed to page data loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/schemas/data.schema.ts#L87) |
| `InferGetServerDataProps` | Infer the props type declared by a page data module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/types.ts#L39) |
| `MDXFrontmatter` | Parsed frontmatter values from an MDX page. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L98) |
| `PageContext` | Runtime page context passed to page components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L112) |
| `PageWithData` | Page or layout module with optional server and static data loaders. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/types.ts#L23) |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L142) |
| `StaticPathsResult` | Return value from `getStaticPaths()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/schemas/data.schema.ts#L125) |
| `ValidatedHandlerConfig` | Configuration for `createValidatedHandler()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L7) |
| `ValidatedHandlerFunction` | Handler signature that receives validated request data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L14) |
| `VeryfrontConfig` | Validated project configuration with catalog-backed integration authoring. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/schemas/config.schema.ts#L837) |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L157) |
| `VeryfrontServer` | Running server instance with lifecycle controls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L145) |
