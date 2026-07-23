# Data module reference

The `veryfront/data` module defines the contract between page modules and the
Veryfront renderer. It supports request-scoped server data, cacheable static
data, dynamic path generation, redirects, and not-found results.

Use the public subpath for direct access to the complete data API:

```ts
import {
  type DataContext,
  DataFetcher,
  type DataResult,
  notFound,
  type PageWithData,
  redirect,
  type StaticPathsResult,
} from "veryfront/data";
```

Page modules can import the commonly used helpers and context types from
`veryfront`.

## Page data loaders

A page or layout module can export any of these loaders:

| Export           | Context                             | Purpose                                       |
| ---------------- | ----------------------------------- | --------------------------------------------- |
| `getServerData`  | `params`, `query`, `request`, `url` | Load request-specific data.                   |
| `getStaticData`  | `params`, `url`                     | Load data that can be cached and revalidated. |
| `getStaticPaths` | No arguments                        | Declare dynamic paths and fallback behavior.  |

In development, `DataFetcher` prefers `getServerData` and falls back to
`getStaticData`. In production, it prefers `getStaticData` and falls back to
`getServerData`.

The static loader receives snapshots of `params` and `url`. The URL retains its
origin and pathname but omits the request query and fragment so cached data
cannot vary on state that is absent from its cache key.

Each server loader receives snapshots of the route params, query, URL, headers,
and request body stream. Concurrent page and layout loaders can read their own
request body without consuming another loader's copy.

### Server data

```ts
import { type DataContext, type DataResult, notFound } from "veryfront/data";

interface Post {
  id: string;
  title: string;
}

interface PostProps {
  post: Post;
}

export async function getServerData(
  context: DataContext,
): Promise<DataResult<PostProps>> {
  const id = context.params.id;
  if (typeof id !== "string") return notFound();

  const response = await fetch(`https://example.com/api/posts/${encodeURIComponent(id)}`);
  if (response.status === 404) return notFound();
  if (!response.ok) throw new Error("The post request failed");

  return { props: { post: await response.json() as Post } };
}
```

### Static data and paths

```ts
import type { DataResult, StaticPathsResult } from "veryfront/data";

interface PostProps {
  post: { id: string; title: string };
}

export function getStaticPaths(): StaticPathsResult {
  return {
    paths: [
      { params: { id: "welcome" } },
      { params: { id: "release-notes" } },
    ],
    fallback: false,
  };
}

export async function getStaticData(
  context: { params: Record<string, string | string[]>; url: URL },
): Promise<DataResult<PostProps>> {
  const id = context.params.id;
  if (typeof id !== "string") throw new Error("The route requires one post ID");

  const response = await fetch(`https://example.com/api/posts/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error("The post request failed");

  return {
    props: { post: await response.json() as PostProps["post"] },
    revalidate: 60,
  };
}
```

`fallback` accepts `false`, `true`, or `"blocking"`. The route layer defines
how each fallback mode is presented to the user.

## Loader results

Each data loader returns a `DataResult<T>`:

```ts
interface DataResult<T = unknown> {
  props?: T;
  redirect?: { destination: string; permanent?: boolean };
  notFound?: boolean;
  revalidate?: number | false;
}
```

Use the helpers for redirect and not-found results:

```ts
import { notFound, redirect } from "veryfront/data";

return notFound();
return redirect("/login");
return redirect("/new-path", true);
```

If a result contains both `redirect` and `notFound`, the redirect takes
precedence. Loader results and static paths are validated before the renderer
uses or caches them.

## Programmatic execution

The renderer creates `DataFetcher` instances internally. Runtime integrations
can also create one directly:

```ts
import { type DataContext, DataFetcher, type PageWithData } from "veryfront/data";

const fetcher = new DataFetcher();
const page: PageWithData<{ message: string }> = {
  default: undefined,
  getServerData: () => ({ props: { message: "Hello" } }),
};
const request = new Request("https://example.com/greeting?lang=en");
const context: DataContext = {
  params: {},
  query: new URL(request.url).searchParams,
  request,
  url: new URL(request.url),
};

try {
  const result = await fetcher.fetchData(page, context, "production");
  if (result.props?.message !== "Hello") throw new Error("Unexpected page data");
} finally {
  fetcher.destroy();
}
```

Call `destroy()` when the fetcher is no longer needed. After destruction,
`fetchData()`, `getStaticPaths()`, and `clearCache()` reject further use.

For isolated server execution, pass both `modulePath` and `projectDir` to
`fetchData()`. Veryfront uses the worker pool when data isolation is enabled.
Supplying only one isolation field is an error.

## Caching behavior

Static-data caching requires an active production cache-key context. Preview
requests bypass the static-data cache. Cache entries include the page source,
origin, pathname, and canonical route params so page and layout loaders cannot collide.
Concurrent cache misses for the same entry share one loader execution.

`revalidate` controls stale-while-revalidate behavior:

- Omit it to keep the entry until explicit invalidation or eviction.
- Use `false` to disable timed revalidation.
- Use a number to request background revalidation after that many seconds.

Use `clearCache()` to clear all entries owned by a fetcher. Pass a non-empty
pattern to clear only matching internal keys. Cache invalidation also prevents
matching in-flight fetches and revalidations from restoring stale entries.

## Failure boundaries

Veryfront applies bounded timeouts to server, static, and static-path loaders.
It validates request contexts and loader results without including request or
loader data in validation errors. Context URLs, queries, and aggregate route
params are bounded. Loader results reject accessors, executable values, shared
memory, excessive depth, excessive node counts, and payloads over the result
limit. Isolated server execution also enforces the worker request-body limit
before dispatch.

Timeouts stop waiting for a loader. A JavaScript loader that does not accept a
cancellation signal can continue running until its own operation settles, so
data-source clients should also use their native cancellation support.
