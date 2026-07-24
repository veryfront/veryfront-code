---
title: "veryfront/index.client"
description: "Browser- and SSR-safe helpers from the `veryfront` package. This entrypoint exposes the root package's client-safe configuration, platform, routing, data, and security helpers without server bootstrap functions. Most app code can import these helpers from `veryfront`; use this explicit entrypoint when a browser or SSR module needs to declare that boundary directly."
order: 12
---

## Import

```ts
import {
  apiNotFound,
  apiRedirect,
  badRequest,
  createValidatedHandler,
  createValidationError,
  defineConfig,
} from "veryfront/index.client";
```

## Examples

```ts
import { getEnv, json } from "veryfront/index.client";

export function GET() {
  return json({ mode: getEnv("MODE") ?? "development" });
}
```

## Exports

### Components

| Name                      | Description                                                                                                                                                                                                               | Source                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CommonSchemas`           | Lazy-getter object that preserves the `CommonSchemas.email` call shape. Each access returns the cached `Schema<T>` (memoized inside `defineSchema`), so chained calls like `CommonSchemas.email.parse(x)` work as before. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/schemas/common.ts#L65)                |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError)                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L77) |

### Functions

| Name                     | Description                                                                                    | Source                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apiNotFound`            | Create a 404 Not Found response.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L114)     |
| `apiRedirect`            | Create an HTTP redirect response.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L92)      |
| `badRequest`             | Create a 400 Bad Request response.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L119)     |
| `createValidatedHandler` | Create a validated API handler wrapper that auto-validates body/query with Zod schemas         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L20)   |
| `createValidationError`  | Create an input validation error. Convenience wrapper around INPUT_VALIDATION_FAILED.create(). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/errors.ts#L11)    |
| `defineConfig`           | Define a Veryfront project configuration object.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L6)                 |
| `defineConfigWithEnv`    | Define a Veryfront project configuration from the current environment name.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L11)                |
| `forbidden`              | Create a 403 Forbidden response.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L129)     |
| `getEnv`                 | Read an environment variable from the active project scope.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L117)        |
| `json`                   | Create a JSON response with the correct content type.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L67)      |
| `mergeConfigs`           | Merge multiple partial Veryfront configuration objects into one config object.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L19)                |
| `mergeConfigs`           |                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L20)                |
| `mergeConfigs`           |                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/define-config.ts#L21)                |
| `notFound`               | Render the 404 page from a data loader.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/helpers.ts#L45)                        |
| `parseFormData`          | Parse and validate multipart or URL-encoded form data.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L48)   |
| `parseJsonBody`          | Parse and validate a JSON request body.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L12)   |
| `parseQueryParams`       | Parse and validate query parameters from a request URL.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/parsers.ts#L81)   |
| `redirect`               | Redirect the request from a data loader.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/helpers.ts#L34)                        |
| `sanitizeData`           | Sanitize data to prevent XSS and prototype pollution attacks.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/sanitizers.ts#L2) |
| `serverError`            | Create a 500 Internal Server Error response.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L134)     |
| `unauthorized`           | Create a 401 Unauthorized response.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L124)     |

### Types

| Name                       | Description                                                                                                                                                                             | Source                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `APIContext`               | Context object passed to API route handlers.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/context-builder.ts#L10)       |
| `APIHandler`               | Function signature for API route handlers.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/handler.ts#L94)               |
| `APIResponse`              | Structured response shape for API route helpers.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/handler.ts#L87)               |
| `APIRoute`                 | Route module shape with method handlers and an optional default handler.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/routing/api/module-loader/types.ts#L28)   |
| `DataContext`              | Context passed to `getServerData()`.                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/schemas/data.schema.ts#L54)          |
| `InferGetServerDataProps`  | Utility type to infer props from a page with data                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/types.ts#L28)                        |
| `MDXFrontmatter`           | Parsed frontmatter values from an MDX page.                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L89)                       |
| `PageContext`              | Runtime page context passed to page components.                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L106)                      |
| `PageWithData`             | Page with data fetching capabilities                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/types.ts#L16)                        |
| `StartServerOptions`       | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L129)                     |
| `StaticPathsResult`        | Return type for `getStaticPaths()`.                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/data/schemas/data.schema.ts#L61)          |
| `ValidatedHandlerConfig`   | Configuration for `createValidatedHandler()`.                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L7)  |
| `ValidatedHandlerFunction` | Handler signature that receives validated request data.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/input-validation/handler.ts#L14) |
| `VeryfrontConfig`          | Project configuration. The underlying zod schema stores `extensions` as `unknown[]`; this tightened alias surfaces the expected `ExtensionConfigEntry[]` shape to TypeScript consumers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/config/schemas/index.ts#L25)              |
| `VeryfrontHandler`         | Web API request handler with WebSocket upgrade and HMR helpers.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L144)                     |
| `VeryfrontServer`          | Running server instance with lifecycle controls.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L132)                     |
