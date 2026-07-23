# Errors reference

The errors module defines Veryfront's stable error identities, typed error
instances, recovery catalog, HTTP problem responses, logging metadata, and
boundary helpers.

Import the public API from `veryfront/errors`. Source modules inside Veryfront
use `#veryfront/errors`.

## Error identity

Every registered error has these immutable definition fields:

| Field        | Contract                                                  |
| ------------ | --------------------------------------------------------- |
| `slug`       | Lowercase kebab-case identity, such as `config-not-found` |
| `category`   | One of the categories listed below                        |
| `status`     | Integer error status from 400 through 599                 |
| `title`      | Stable user-facing summary                                |
| `suggestion` | Optional corrective action                                |

Definitions expose `create(options)`, which returns a `VeryfrontError`.

```ts
import { CONFIG_NOT_FOUND } from "veryfront/errors";

const error = CONFIG_NOT_FOUND.create({
  detail: "Veryfront could not find veryfront.config.ts in the project root.",
  context: { source: "project-config" },
});
```

Use `instanceof VeryfrontError` and `slug` to match an occurrence. Do not match
free-form messages.

```ts
import { VeryfrontError } from "veryfront/errors";

export function isMissingConfig(error: unknown): boolean {
  return error instanceof VeryfrontError && error.slug === "config-not-found";
}
```

## Categories

| Category   | Responsibility                                                 |
| ---------- | -------------------------------------------------------------- |
| `CONFIG`   | Project and runtime configuration                              |
| `BUILD`    | Compilation, bundling, MDX, and static generation              |
| `RUNTIME`  | Rendering and runtime execution                                |
| `ROUTE`    | Route definitions, matching, and handlers                      |
| `MODULE`   | Imports and module dependencies                                |
| `SERVER`   | Server startup, capacity, network, cache, and request handling |
| `BOUNDARY` | React Server Component and client/server boundaries            |
| `DEV`      | Development server, HMR, and source maps                       |
| `DEPLOY`   | Production builds and deployment platforms                     |
| `AGENT`    | Agent execution, orchestration, cost, and tools                |
| `GENERAL`  | Shared validation, permissions, resources, and initialization  |

`ERROR_REGISTRY` is the canonical slug-to-definition map. `ErrorSlug` is its
exact key union. Category registry fragments are available for callers that
need a narrower immutable view. Registry assembly rejects duplicate slugs and
keys that do not match their definitions. The resulting map is frozen and has
no inherited object properties.

## Occurrence fields

`VeryfrontError.create()` accepts these occurrence-specific fields:

| Field      | Meaning                                    |
| ---------- | ------------------------------------------ |
| `message`  | Internal Error message override            |
| `detail`   | Diagnostic description for this occurrence |
| `cause`    | Original internal failure                  |
| `instance` | URI reference identifying the occurrence   |
| `context`  | Structured internal diagnostic context     |
| `status`   | Per-occurrence status override             |

Definitions and constructor options are validated and snapshotted. Error
instances remain normal JavaScript Error objects, so external boundaries take a
validated snapshot before reading mutable fields.

## HTTP problem responses

`createErrorResponse()` returns an RFC 9457 `application/problem+json`
response. It never emits `cause`. It omits `detail` for status 500 and above.
For status below 500, it sanitizes diagnostic text before returning it. Problem
responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
Instance values remove URL credentials, query strings, fragments, and local
file references before serialization.

```ts
import { CONFIG_INVALID, createErrorResponse } from "veryfront/errors";

const response = createErrorResponse(
  CONFIG_INVALID.create({ detail: "The routes field must be an object." }),
  "/api/config",
);
```

`createProblemResponse()` validates raw problem parameters and applies the same
filtering rules.

```ts
import { createProblemResponse } from "veryfront/errors";

const response = createProblemResponse({
  slug: "invalid-argument",
  category: "GENERAL",
  status: 400,
  title: "Invalid argument",
  detail: "The limit must be a positive integer.",
});
```

`httpErrorBoundary()` wraps request handlers. Production responses omit stack
traces and 5xx detail. Local development responses can include sanitized stack
and detail fields. Metrics and tracing failures cannot replace the application
failure.

`VeryfrontError.toRFC9457()` remains available for compatibility. Its legacy
`cause` field is internal and deprecated. The compatibility serializer
sanitizes diagnostic fields, but response helpers also apply status-aware
filtering and response headers. Use the response helpers at HTTP boundaries.

## Recovery catalog

`ERROR_CATALOG` contains an immutable recovery entry for every registered
slug. Each entry can contain a title, explanation, ordered steps, an example,
tips, related slugs, and a documentation URL. Catalog assembly rejects
duplicates, mismatched keys, missing registered slugs, and unexpected entries.

```ts
import { getErrorSolution, searchErrors } from "veryfront/errors";

const solution = getErrorSolution("config-not-found");
const matchingSolutions = searchErrors("configuration");
```

`getErrorSolution()` returns `null` for an unknown key. `searchErrors()` is
case-insensitive and accepts at most 256 characters.

## CLI formatting

`formatCLIError(error)` and `formatUserError(error)` return sanitized strings.
They remove credential-shaped text and local filesystem paths. Development
stack output is bounded and sanitized.

`cliErrorBoundary()` writes its default report to standard error and exits with
a nonzero status. Custom exit-code resolvers can return values from 1 through
255. Oversized and non-Error thrown values are bounded before formatting.

```ts
import { formatUserError } from "veryfront/errors";

export function printFailure(error: unknown): void {
  const normalized = error instanceof Error ? error : new Error("Unknown failure");
  console.error(formatUserError(normalized));
}
```

## Logging and tracing

`logError()` emits stable slug, category, status, title, documentation URL, and
sanitized context. Production output is a single JSON record. Development
output is human-readable. Context keys and free-form text pass through shared
redaction and size limits.

`attachErrorToSpan()` and `attachErrorToActiveSpan()` emit only stable identity:

- `error.slug`
- `error.category`
- `error.status`

They do not emit detail, context, cause, prompts, payloads, or raw stack data.

## Fallback and retry helpers

`handleErrorWithFallback()` and `withErrorContext()` make fallback behavior
explicit in the return type. They log only stable, sanitized operation data.
Use them only when continuing with the supplied fallback is correct. Do not use
them to hide required cleanup, discovery, build, or persistence failures.

`retryWithBackoff()` validates all options before invoking the operation. It
supports cooperative cancellation through `AbortSignal`, limits attempts to
100, requires `initialDelay` to be no greater than `maxDelay`, and rethrows the
last operation failure after exhaustion.

The safe filesystem helpers validate their adapter methods and context before
starting work. They use their documented fallback only for failures raised by
the filesystem operation.

## Serializable legacy error data

`createError()` and `toError()` validate `VeryfrontErrorData` at runtime.
`createError()` preserves the valid input object's identity. `toError()` uses a
validated type and message snapshot, while `fromError()` validates attached
context again before returning it.

## Source layout

```text
src/errors/
├── catalog/          Recovery entries and catalog validation
├── error-registry/   Definitions grouped by category
├── middleware/       HTTP and CLI error boundaries
├── user-friendly/    Compatibility identification and text formatting
├── error-registry.ts Canonical registry assembly
├── http-error.ts     RFC 9457 response helpers
├── logging.ts        Structured sanitized logging
├── tracing.ts        Minimal tracing integration
├── types.ts          Definitions and VeryfrontError
└── index.ts          Public module surface
```

## Verification

Run the module suite and public documentation checks from the repository root:

```bash
deno test --allow-all src/errors
deno check src/errors/index.ts
deno doc --lint src/errors/index.ts
deno lint src/errors
deno fmt --check src/errors
```

The canonical protocol reference is [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457).
