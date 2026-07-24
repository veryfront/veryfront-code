# Error Handling

`src/errors` owns Veryfront's typed error identity, RFC 9457 problem responses,
boundary adapters, retry helpers, diagnostic logging, tracing metadata, and
user-facing troubleshooting guidance.

## Sources of truth

The module has three intentionally distinct representations:

1. `error-registry.ts` is the canonical source of throwable errors. Each
   registered definition has a stable slug, category, HTTP error status, title,
   suggestion, and `.create()` factory.
2. `catalog/` is a partial troubleshooting catalog keyed by canonical registry
   slugs. Not every registered error needs a long-form solution.
3. `VeryfrontErrorData` in `veryfront-error.ts` is the legacy serializable data
   union used by adapters. It is not the throwable `VeryfrontError` class.

`user-friendly/` preserves older solution keys for compatibility. Its
identifier maps canonical `VeryfrontError` slugs to those keys before falling
back to message heuristics.

Registered definitions, composed registries, catalog entries, and catalog maps
are immutable. Canonical registry composition validates its slugs, categories,
titles, and HTTP error statuses at runtime. The generic `defineError()` and
`VeryfrontError` APIs retain custom slug and status support for integrations.

## Defining and throwing an error

Add a definition to the appropriate file under `error-registry/`, then include
it in that file's category registry.

```ts
import { defineError } from "#veryfront/errors";

export const PROJECT_LOAD_FAILED = defineError({
  slug: "project-load-failed",
  category: "RUNTIME",
  status: 500,
  title: "Project load failed",
  suggestion: "Check the project files and retry",
});

throw PROJECT_LOAD_FAILED.create({
  detail: "The project manifest could not be parsed",
  context: { projectId: "project-123" },
});
```

Canonical registry slugs use lowercase kebab-case. Their status values and
definition status values must be integer HTTP error statuses from 400 through
599. Registry composition enforces those invariants without restricting generic
errors or per-instance status overrides created by integrations. HTTP boundary
serializers fall back to `unknown-error` when a custom status cannot be emitted
as a valid response.

Use `cause` for provenance and `context` for structured diagnostics. Do not put
credentials, raw authorization headers, request bodies, or private
infrastructure details in user-facing fields.

## RFC 9457 responses

`VeryfrontError.toRFC9457()` returns the problem-details object. The
`type` field is the stable documentation URL:

```text
https://veryfront.com/docs/errors/<slug>
```

Choose the response helper based on the boundary:

- `errorToRFC9457Response()` is the environment-aware HTTP boundary serializer.
  It includes stacks only for local projects, removes `cause` in production,
  and also removes `detail` from production 5xx responses.
- `errorToResponse()` is the safe generic serializer. It removes `cause` from
  every response, removes `detail` from every 5xx response, and never mutates
  the source error.
- `createErrorResponse()` and `createProblemResponse()` are explicit low-level
  serializers. Callers are responsible for passing only response-safe fields.

```ts
import { errorToResponse } from "#veryfront/errors";

try {
  await loadProject();
} catch (error) {
  return errorToResponse(error, "/api/projects/project-123");
}
```

HTTP problem responses use `application/problem+json`.

Custom error slugs are credential-scrubbed and encoded as one documentation URL
path segment. Separators, query and fragment markers, percent signs, and
malformed Unicode cannot escape that segment. Exact `.` and `..` slugs fall back
to `unknown-error` so URL normalization cannot leave the error documentation
path.

Diagnostic fields, stacks, structured context, serialized problem responses,
production log records, and terminal renderings use shared size limits.
Credential redaction runs before truncation so a cut cannot expose a credential
prefix. Oversized structured outputs remain valid JSON.

## Boundaries

Use `httpErrorBoundary()` or `wrapHandlerWithErrorBoundary()` for server
handlers. They normalize unknown throws, record stable metrics and trace
metadata, and return RFC 9457 responses.

Use `cliErrorBoundary()` for CLI entry points. CLI output may include local
diagnostic details and development stack frames.

`wrapUnknownError()` retains an existing `VeryfrontError` or creates the
canonical `unknown-error`. `wrapWithContext()` creates a new error and preserves
the original error as provenance.

## Logging and tracing

`logError()` emits a human-readable development record or structured production
JSON. Structured context is copied through the shared fail-closed redactor, and
credentials embedded in URLs, authorization values, API-key assignments, and
cookie assignments are removed from diagnostic text.

Tracing exports only stable identity fields:

- `error.slug`
- `error.category`
- `error.status`

Raw detail, suggestions, stacks, and causes are not attached to spans.

## Troubleshooting catalogs

Use canonical catalog lookup when the slug is known:

```ts
import { getErrorSolution, searchErrors } from "#veryfront/errors";

const solution = getErrorSolution("config-not-found");
const matches = searchErrors("configuration");
```

`searchErrors()` trims the query, normalizes spaces and underscores for slug
matching, and returns no results for an empty query.

Use `formatErrorBox()` or `formatUserError()` for CLI-friendly strings. Unknown
errors include stack frames only outside production.

When adding a long-form solution:

1. Add it to the matching file under `catalog/`.
2. Keep the key and `slug` identical to the canonical registry slug.
3. Use public CLI commands and public documentation URLs.
4. Do not include internal endpoints, deployment names, tokens, or operational
   runbooks.

## Retry helpers

`retryWithBackoff()` uses zero-based attempt numbers. `maxAttempts` includes the
first call. Delays and timeouts must be finite, non-negative numbers no greater
than `2_147_483_647` milliseconds. Fractional values round up to the next whole
millisecond, and `onRetry` receives the normalized delay that will be scheduled.

The timeout is cooperative: the attempt stops only when the callback observes
the supplied `AbortSignal`. Its timer is cleared as soon as the attempt settles,
before retry hooks or backoff work runs.

`onRetry` and `wrapFinalError` receive a detached Error snapshot so repeated
diagnostic reads cannot re-enter a hostile proxy. Without `wrapFinalError`, a
terminal Error is rethrown with its original identity and subclass; non-Error
throws are normalized to Error.

## Tests

Run every module test:

```sh
VF_DISABLE_LRU_INTERVAL=1 NODE_ENV=production LOG_FORMAT=text deno test \
  --preload=src/schemas/_test-setup.ts \
  --no-check --parallel --allow-all \
  --unstable-worker-options --unstable-net \
  $(find src/errors -name '*.test.ts' -print)
```

Before merging, also run scoped formatting, linting, and type checking for every
changed TypeScript file.

## Related documentation

- [Configuration guide](../../docs/guides/configuration.md)
- [Observability architecture](../../docs/architecture/13-observability.md)
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)
