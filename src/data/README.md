# Data module

The Data module defines page-loader contracts for request-time data, static
data, static path generation, redirects, and not-found results. The rendering
pipeline owns normal application use. `DataFetcher` is available only to
framework-internal integrations and tests.

For task-oriented application examples, see the
[data fetching guide](../../docs/guides/data-fetching.md).

## Application surface

Application code imports page helpers and contracts from the root package:

```ts
import { notFound, redirect } from "veryfront";
import type {
  DataContext,
  InferGetServerDataProps,
  PageWithData,
  StaticDataResult,
  StaticDataValue,
  StaticPathsResult,
} from "veryfront";
```

`DataFetcher`, `FetchDataOptions`, the unrestricted `DataResult`, and the cache
types are framework internals. They are intentionally absent from the published
package exports. Repository source that implements or tests the rendering
pipeline uses `#veryfront/data`.

| Export                    | Contract                                                  |
| ------------------------- | --------------------------------------------------------- |
| `notFound()`              | Produces a not-found control result                       |
| `redirect(destination)`   | Produces a temporary or permanent redirect control result |
| `DataContext`             | Request, URL, route parameter, and query context          |
| `PageWithData<T>`         | Page module shape with optional data hooks                |
| `StaticDataResult<T>`     | Runtime-aligned result type for static hooks              |
| `StaticDataValue`         | Recursive static props representation                     |
| `StaticPathsResult`       | Static route parameters and fallback policy               |
| `InferGetServerDataProps` | Extracts the props type from a `PageWithData` declaration |

## Loader selection

`DataFetcher.fetchData()` accepts `"development"` or `"production"`.
Unsupported runtime strings reject with `TypeError`.

| Mode          | First choice    | Fallback        |
| ------------- | --------------- | --------------- |
| `development` | `getServerData` | `getStaticData` |
| `production`  | `getStaticData` | `getServerData` |

A loader export counts only when it is callable. If neither matching loader is
a function, the result is `{ props: {} }`.

## Loader contracts

`getServerData` receives the complete context:

```ts
interface DataContext {
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  request: Request;
  url: URL;
}
```

The framework validates and snapshots context identity before dispatch. The
context and option containers must be plain records with own enumerable data
properties; inherited fields, accessors, and proxies reject without being
executed. `params` must be a plain or null-prototype record whose values are
strings or dense plain string arrays. Other runtime representations reject
instead of being coerced into an identity that could alias another request.

`getStaticData` receives only `params` and `url`. Request-specific state is not
available to a static loader.

```ts
interface PageWithData<Props = unknown> {
  default: unknown;
  getServerData?: (
    context: DataContext,
  ) => DataResult<Props> | Promise<DataResult<Props>>;
  getStaticData?: (
    context: Pick<DataContext, "params" | "url">,
  ) => DataResult<Props> | Promise<DataResult<Props>>;
  getStaticPaths?: () => StaticPathsResult | Promise<StaticPathsResult>;
}
```

A data result can contain page props or a routing control result:

```ts
interface DataResult<Props = unknown> {
  props?: Props;
  redirect?: {
    destination: string;
    permanent?: boolean;
  };
  notFound?: boolean;
  revalidate?: number | false;
}
```

Use the exported `StaticDataResult<Props>` type for static hooks. Its recursive
`StaticDataValue` constraint mirrors the cacheable runtime contract while the
general `DataResult<Props>` type remains available to unrestricted server-data
hooks.

Return one active outcome per invocation: defined `props`, defined `redirect`,
or `notFound: true`. Returning more than one rejects with `TypeError`.
`notFound: false` is inactive and may accompany props. The boundary snapshots
the supported top-level fields once and drops unknown fields. Use `notFound()`
and `redirect()` instead of assembling control objects manually. The helpers
can be returned or thrown. Every other thrown value remains an error.

Use finite, non-negative seconds for `revalidate`. `false` and an omitted value
disable background revalidation. Zero is valid and makes an entry eligible for
revalidation as soon as its timestamp is in the past.

`getStaticPaths` returns route parameters and an explicit fallback mode:

```ts
const paths: StaticPathsResult = {
  paths: [
    { params: { slug: "hello" } },
    { params: { slug: ["docs", "install"] } },
  ],
  fallback: false,
};
```

The data-hook boundary accepts `false`, `true`, or `"blocking"` and snapshots
arrays and parameter records. A nullish legacy result normalizes to
`{ paths: [], fallback: false }`. Pages Router production static builds require
`fallback: false`; `true` and `"blocking"` reject the build. App Router
`generateStaticParams` is not implemented by the production static builder.

For Pages Router production builds, each result entry must provide exactly the
parameters named by its route template. Dynamic parameters are non-empty
strings. Catch-all parameters are dense plain string arrays; required
catch-alls cannot be empty. Accessor-backed, prototype-backed, sparse, extra,
missing, traversal, control-character, and non-losslessly-encodable values are
rejected. Every parameter segment is encoded with `encodeURIComponent` for the
output URL; its original decoded value is passed to `getStaticData` and page
rendering.

Production build limits are:

| Limit                                    | Value  |
| ---------------------------------------- | ------ |
| Materialized Pages paths per build       | 10,000 |
| Characters per output route path         | 2,048  |
| Segments per catch-all parameter         | 1,024  |
| Aggregate UTF-8 bytes across Pages paths | 16 MiB |

The raw result path count and catch-all lengths are admitted before arrays are
copied. The final Pages path set also rejects exact duplicates and portable
filesystem collisions after percent-decoding, separator normalization, Unicode
NFC normalization, and case folding. Output ordering is deterministic.
Generated manifest entries map each encoded concrete `path` to its source
`template`.

Static-path expansion and validation complete before the build allocates its
publication directory. A rejected hook result does not modify an existing
output tree or publish a partial manifest.

## Internal programmatic execution

Framework code can use the internal class with page modules and explicit
contexts. The constructor accepts only an optional `DataFetcherOptions` object.
The legacy runtime-adapter position was removed; adapters belong to the owning
rendering or extension boundary and are never accepted or ignored by data core.
Passing the former two-argument shape fails at runtime instead of discarding an
argument.

```ts
import { DataFetcher } from "#veryfront/data";
import type { DataContext, PageWithData } from "#veryfront/data";

const pageModule: PageWithData<{ title: string }> = {
  default: null,
  getServerData: () => ({ props: { title: "Example" } }),
};

const url = new URL("https://example.com/posts/hello");
const context: DataContext = {
  params: { slug: "hello" },
  query: url.searchParams,
  request: new Request(url),
  url,
};

const fetcher = new DataFetcher();
try {
  const result = await fetcher.fetchData(pageModule, context, "development");
  // Use result.
} finally {
  fetcher.destroy();
}
```

The optional constructor options object configures internal execution policy.
For example, `new DataFetcher({ staticPathsTimeoutMs: 30_000 })` applies an explicit local
deadline to `getStaticPaths`; omitted or zero preserves the historical
unbounded behavior.

The framework passes `FetchDataOptions` to establish execution identity and
caller authority. Worker paths are required only when isolation is enabled:

| Option               | Meaning                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `modulePath`         | Absolute page/layout path; absent or empty disables static cache |
| `projectDir`         | Project root used to scope an isolated worker                    |
| `projectId`          | Trusted identity used for breaker and fairness isolation         |
| `cacheScope`         | Exact project, mode, and content version; `null` disables cache  |
| `signal`             | Caller cancellation; shared work may continue for other callers  |
| `workerScopeId`      | Host-owned worker lifetime scope                                 |
| `workerGenerationId` | Immutable source identity within `workerScopeId`                 |

Do not derive `projectId` from an untrusted request header in custom
integrations. Explicit scopes are validated, read once, and frozen before they
are used for admission or cache publication. Project IDs must be non-empty
strings of at most 1,024 characters; runtime values are never coerced.

`workerScopeId` and `workerGenerationId` are internal, paired options. Supplying
only one rejects. When both are present, an isolated worker may be reused only
for that exact scope and immutable source generation. Changing the generation
selects a different worker and import graph. Reusing a generation ID for
different source bytes violates the contract.

Omitting both options selects a unique single-use worker, so an unversioned
request cannot observe an import graph retained by an earlier request. The
renderer owns one scope per project/content context. Module invalidation and
context disposal retire every worker in that scope; active requests finish
before retirement. Scope and generation IDs are validated as non-empty strings
of at most 1,024 characters and are snapshotted before asynchronous work.

`getStaticPaths(pageModule, { projectId, signal })` accepts the same trusted
project identity and caller cancellation. Its options container must be a plain
record of recognized own data fields; accessors, proxies, unknown fields, and
invalid signals reject before project code runs. Internal callers may also
supply non-negative `maxPaths` and `maxArrayParamSegments` admission limits.
The production renderer supplies the build limits above. `destroy()` is
idempotent and prevents later use, but it cannot forcibly terminate project
code that has already started.

## Cache and revalidation behavior

Static data caching requires both an active production cache context established
by the framework and a non-empty `modulePath`. Preview requests, calls without a
cache context, and calls without a module identity execute without cache lookup
or publication.

Production cache identity includes:

- project, mode, and content version;
- page or layout module path;
- the complete `url.href` (scheme, host, port, path, query, and fragment);
- route parameters with canonical key ordering.

Each identity segment is independently framed, so delimiter-bearing module
paths, routes, queries, and parameters cannot alias another entry. Raw cache
identities are not attached to logs or tracing spans.

Concurrent cold misses for the same identity share one loader execution.
Stale entries are served immediately while one background revalidation runs.
If a background loader fails, times out, redirects, or returns not-found, the
live cached page remains available. The same cache key waits at least 30
seconds before another request may retry, preventing a failing dependency from
being called once per incoming request. A refresh replaces or defers only the
exact cache generation that started it; eviction, expiry, or a newer cold load
cannot be overwritten by older background work.

Every `getStaticData` result is captured as bounded framework-owned plain data
before dependency success is recorded. This applies consistently when caching
is enabled or disabled. Cache storage is immutable and never exposed to a
loader or caller. Every cache hit, cold-singleflight participant, and uncached
static caller receives a fresh mutable graph; mutating one result cannot affect
another request or the retained byte accounting.

Static props may contain `null`, `undefined`, booleans, numbers, strings, dense
plain arrays, and plain or null-prototype records. Cycles and repeated references
are preserved within each detached graph. Functions and symbols, `bigint`,
accessors, proxies, sparse or extended arrays, custom prototypes, dates, regular
expressions, collections, and typed or shared buffers reject. Redirect,
not-found, and revalidation fields retain their validated semantics.

One static result is limited to 64 levels, 100,000 value/reference visits, and
a deterministic 10 MiB retained-size charge. A representation or limit failure
rejects the loader result within its deadline and execution admission; it is not
silently retained or served uncached.

The cache defaults to 500 entries and 50 MiB process-wide, with a ceiling of
100 entries and 10 MiB for one project. All releases and content versions for
the same project share that project quota. A project that reaches its ceiling
evicts its own least-recently-used entries before it can displace a peer.
Entry limits and retained-byte quotas can be configured with:

- `DATA_FETCHING_MAX_ENTRIES`
- `DATA_FETCHING_MAX_ENTRIES_PER_PROJECT`
- `DATA_FETCHING_MAX_SIZE_MB`
- `DATA_FETCHING_MAX_SIZE_MB_PER_PROJECT`

The byte quotas charge the immutable stored snapshot, the complete framed key,
and the cache-entry metadata. Snapshot size is recorded by the same bounded
traversal that creates storage, so later caller mutation cannot make accounting
stale. Direct internal cache tests can inject a size estimator, but production
static publication uses the recorded snapshot charge.

The per-project values must not exceed their global values. Malformed or
out-of-range data-safety overrides fail during startup instead of silently
using a default. If only configured cache capacity rejects an already valid
snapshot, the caller still receives a detached fresh result and a later request
may retry publication. Unexpected cache publication or accounting failures
propagate instead of being treated as ordinary capacity pressure.

Direct JavaScript calls are bounded independently of HTTP validation. A cache
scope version and project ID may contain at most 1,024 characters. Module paths,
project directories, invalidation patterns, and pathnames are limited to 4,096
characters; canonicalized pathnames are checked again after percent expansion.
URLs and query strings are limited to 65,536 characters, and the complete
framed cache key to 16,384. Params accept at most 256 properties, 1,024
characters per key, 4,096 per string value, 1,024 segments per array, and 65,536
characters in total.

`clearCache()` clears the instance cache. `clearCache(pattern)` clears entries
whose decoded project-scoped key contains the pattern. A full clear invalidates
all older in-flight writes; a pattern clear invalidates only matching writes.
Post-clear requests do not join invalidated single-flight work, and unrelated
pattern writes remain eligible to populate their entries. Invalidation
patterns and pathnames must be primitive strings, and project invalidation uses
the same validated non-empty project identity as execution. An empty pattern
retains the documented full-clear behavior.

## Timeouts and isolation limits

`getServerData` and `getStaticData` have a 10-second local deadline. Request
body preparation and isolated or direct `getServerData` execution share that
single budget. Dependency timeouts count toward the project circuit breaker.
Breaker health is shared across routes only within an authoritative source.
Server data prefers the exact worker-generation tuple, then the exact cache
scope; cached static data uses the cache scope, while uncached static data uses
the worker-generation tuple. Compatibility calls that supply neither identity
share one unversioned bucket per project.
Direct `getServerData` receives a request signal that combines caller
cancellation with the framework deadline, so cooperative downstream work can
stop. `getStaticData` has no signal in its public contract. Non-cooperative
project code cannot be forcibly stopped after the caller rejects.

Direct `DataFetcher` use gives `getStaticPaths` no default local deadline for
backward compatibility. Internal integrations can opt in with
`DataFetcherOptions.staticPathsTimeoutMs`. The production rendering pipeline
uses a 10-second result deadline. It covers both the hook and result validation.
A timeout or caller abort stops waiting, but the framework observes the late
settlement and retains the execution lease until project code settles.
Validation that starts before the deadline retains the same lease; a result
that arrives after the timeout is not traversed.

This is an in-process completion deadline, not CPU or memory preemption. A
synchronous CPU-bound hook can block the event loop past the deadline and is
rejected only after it returns; memory allocation is not capped. Enforcing hard
execution limits requires a separately isolated process or worker that the host
can terminate.

All three hooks share a fail-closed process execution budget. Defaults are 512
active hooks globally and 128 for one project. Configure them with
`DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS` and
`DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS_PER_PROJECT`; malformed values fail
startup, and the per-project value cannot exceed the global value. Capacity
remains occupied for the raw producer lifetime, not merely until the HTTP
caller disconnects or a timeout is reported. Capacity exhaustion returns the
registered `service-overloaded` error.

When data worker isolation is enabled:

- both `modulePath` and `projectDir` are mandatory; missing values reject before
  project code runs;
- an exact source integration policy is required;
- request bodies are streamed into a bounded buffer;
- malformed `Content-Length` values are rejected;
- declared and actual body sizes are limited to 10 MiB;
- each worker is structurally serialized to one active request; this invariant
  is not configurable;
- rejected request bodies do not count as dependency failures in the project
  circuit breaker;
- host-side worker-pool shedding does not open a project's dependency circuit.

## Internal files

| File                       | Responsibility                                      |
| -------------------------- | --------------------------------------------------- |
| `index.ts`                 | Internal module barrel                              |
| `data-fetcher.ts`          | Loader selection and orchestration                  |
| `data-fetching-cache.ts`   | Project-scoped in-memory static-data cache          |
| `server-data-fetcher.ts`   | Request-time execution and worker boundary          |
| `static-data-fetcher.ts`   | Static cache, single-flight loads, and revalidation |
| `cache-result-snapshot.ts` | Bounded immutable static-result capture and cloning |
| `data-limits.ts`           | Direct-call identity and snapshot resource limits   |
| `static-paths-fetcher.ts`  | Static path validation, admission, and deadline     |
| `static-path-limits.ts`    | Central production static-path limits               |
| `execution-admission.ts`   | Global and per-project hook capacity                |
| `abort-utils.ts`           | Exact caller-abort composition and detached waiting |
| `helpers.ts`               | Branded redirect and not-found results              |
| `schemas/data.schema.ts`   | Data contract schemas and inferred types            |
| `types.ts`                 | Page loader interfaces and type utilities           |

Application code must use the root `"veryfront"` exports shown above. Do not
publish or depend on source deep imports.
