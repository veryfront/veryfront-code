---
title: "Data fetching"
description: "Server data, static generation, and client-side fetching."
order: 13
---

Veryfront pages can load data three ways: `getServerData` on every request,
`getStaticData` during static generation and cacheable production requests, or
`fetch` from a client component. Each one has its place.

Examples below use the default app router. Set `router: "pages"` in `veryfront.config.ts` to switch to the pages router.

## Prerequisites

- A project with at least one page (see
  [Pages and routing](./pages-and-routing.md)).
- A data source you can call from server code, build-time scripts, or the
  browser (REST API, database, or in-memory data).

## Server data

`getServerData` runs on every request. Use it when data depends on the request,
such as authentication, query parameters, or cookie reads:

```tsx
// app/dashboard/page.tsx
import type { DataContext } from "veryfront";

export async function getServerData({ query }: DataContext) {
  const name = query.get("name") ?? "Ada";
  return { props: { user: { name } } };
}

export default function Dashboard({ user }: { user: { name: string } }) {
  return <h1>Welcome, {user.name}</h1>;
}
```

Run `veryfront dev` and open [http://localhost:3000/dashboard?name=Grace](http://localhost:3000/dashboard?name=Grace). The page should render `Welcome, Grace`.

`getServerData`, `getStaticData`, and `getStaticPaths` are reserved server data
export names in browser project modules. Veryfront strips their bodies from
browser bundles, and imports used exclusively by those stripped hooks are removed
entirely, including their top-level side effects. Put client initialization in a
separate client-referenced module or a bare side-effect import that is not only
used by a server data hook.

### Declare server data hooks directly

Veryfront must find a local declaration for each server data export so it can
empty it before the module reaches the browser. Declare the hook in the route
module as a function declaration or as an initializer on a `const`, `let`, or
`var`:

```tsx
// Supported
export async function getServerData(ctx: DataContext) {
  return { props: { query: ctx.query.toString() } };
}

// Also supported
export const getStaticData = async () => ({ props: { generated: true } });
```

These forms have no declaration to empty and fail the build with
`server-export-strip-failed`:

```tsx
// Not supported: the hook is a re-exported import
import { loadIt } from "./loader.ts";
export { loadIt as getServerData };

// Not supported: the hook is a class
export class getServerData {}
```

Move the import inside a directly declared hook to migrate:

```tsx
export async function getServerData(ctx: DataContext) {
  const { loadIt } = await import("./loader.ts");
  return loadIt(ctx);
}
```

The same build error reports a value that only a stripped hook reads when that
value is declared in a position Veryfront cannot remove, such as a loop head:

```tsx
// Not supported: the binding is declared by the loop, not at module scope
for (var KEY of getEnv("SECRET_KEY")) {}

// Supported
const KEY = getEnv("SECRET_KEY");
```

### Modules that rewrite the Object intrinsic

Compiled input carries name registrations such as `__name(loadUser, "loadUser")`.
Veryfront reads them as build metadata, which is what lets it see that
`loadUser` is read only by a stripped hook and remove it along with the server
import and the secret behind it.

A module that rewrites `Object.defineProperty`, or reaches it through
`.constructor`, `__proto__`, `eval`, or `Function`, makes that reading
unprovable. Veryfront must not delete a call the module can observe, and it must
not emit a module that still holds a server-only binding, so the build fails
with `server-export-strip-failed`.

```tsx
// Not supported: the module rebinds Object, so the name registration
// cannot be proven to be compiler metadata
const Object = globalThis.Object;

export async function getServerData() {
  return { props: { user: await loadUser() } };
}
```

Move the code that reaches or rewrites the intrinsic into a module that exports
no server data hook, then import what you need from it:

```tsx
import { isPlainObject } from "../lib/is-plain-object.ts";

export async function getServerData() {
  return { props: { user: await loadUser() } };
}
```

Ordinary client code that reads `.constructor` or `__proto__` on a value, such
as an `isPlainObject` helper or `error.constructor.name` logging, does not
trigger this failure.

The `props` you return are passed to the page component. To read the same props
data from a layout or nested component without prop-drilling, use
`usePageContext().data` (see
[Pages and routing](./pages-and-routing.md)). Veryfront serializes that data
into hydration markup and restores it after client-side navigation; do not rely
on JavaScript object identity surviving serialization.

The `DataContext` provides:

| Property  | Type                                 | Description                                 |
| --------- | ------------------------------------ | ------------------------------------------- |
| `request` | `Request`                            | The incoming HTTP request                   |
| `params`  | `Record<string, string \| string[]>` | Route parameters (e.g. `{ slug: "hello" }`) |
| `query`   | `URLSearchParams`                    | Query string parameters                     |
| `url`     | `URL`                                | Parsed request URL                          |

## Set response headers and cookies

Return `headers` or `cookies` from `getServerData` to add metadata to the full
document response:

```tsx
// app/account/page.tsx
import type { DataResult } from "veryfront";

interface AccountProps {
  displayName: string;
}

export function getServerData(): DataResult<AccountProps> {
  const sessionId = crypto.randomUUID();

  return {
    props: { displayName: "Ada" },
    headers: { "x-account-state": "fresh" },
    cookies: [{
      name: "session",
      value: sessionId,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    }],
  };
}

export default function Account({ displayName }: AccountProps) {
  return <h1>Welcome, {displayName}</h1>;
}
```

Each cookie supports `name`, `value`, `domain`, `path`, `expires`, `maxAge`,
`httpOnly`, `secure`, and `sameSite`. Use an RFC 7231 date string for
`expires`. Veryfront URI-encodes cookie values and emits every cookie as a
distinct `Set-Cookie` field.

Veryfront owns CORS, cache, content, redirect, security, transport, and
`x-veryfront-*` headers. Returning one of those headers throws an error. Use
`cookies` instead of a `Set-Cookie` entry in `headers`.

Layouts merge from outermost to innermost, then the page. The closest loader
wins when custom header names conflict. Cookies append in that same order.
Any response with a cookie uses `no-cache`, omits its ETag, and is not stored
in the render cache.

Response metadata applies to full document responses. `getStaticData` rejects
it because static caches must not replay response cookies. Use an API route or
middleware when a client-side navigation request must write response metadata.

## Static data

`getStaticData` supplies cacheable data for static builds and production
requests. Use it for content that does not depend on request headers, cookies,
or request bodies:

```tsx
// app/blog/[slug]/page.tsx
const posts = [
  { slug: "hello", title: "Hello" },
  { slug: "workflow", title: "Workflow notes" },
];

export async function getStaticData({ params }: { params: { slug: string } }) {
  const post = posts.find((item) => item.slug === params.slug);
  return { props: { post } };
}

export async function getStaticPaths() {
  return {
    paths: posts.map((p) => ({ params: { slug: p.slug } })),
  };
}

export default function BlogPost({ post }: { post: { title: string } }) {
  return <article>{post.title}</article>;
}
```

For dynamic routes, pair `getStaticData` with `getStaticPaths` to tell the framework which pages to generate.

`getStaticData` receives `params` and `url`. It does not receive `request`,
request headers, cookies, a body, or a separate `query` property. Read query
parameters from `url.searchParams`; the complete URL, including the query
string, participates in static cache identity.

## Revalidate static data

Set `revalidate` to a finite, non-negative number of seconds to refresh static
data after it becomes stale:

```tsx
export async function getStaticData() {
  const response = await fetch("https://api.example.com/posts");
  const posts = await response.json();

  return {
    props: { posts },
    revalidate: 60,
  };
}
```

Veryfront serves the cached result while one background refresh runs. A failed
refresh keeps the live cached result. Omit `revalidate` or set it to `false` to
disable background refreshes.

## Redirects and 404s

Return `redirect()` or `notFound()` from `getServerData` or `getStaticData`:

```tsx
import { type DataContext, notFound, redirect } from "veryfront";

export async function getServerData({ params }: DataContext) {
  if (params.slug === "old-post") return redirect("/blog/hello");
  if (params.slug !== "hello") return notFound();

  return { props: { post: { title: "Hello" } } };
}
```

`redirect()` accepts an optional second argument for permanent redirects:

```ts
redirect("/new-url", true); // 301 permanent redirect
```

When redirecting from `getServerData`, pass response metadata as the third
argument to set a cookie or header on the redirect response:

```ts
import { redirect } from "veryfront";

export function getServerData() {
  const sessionId = crypto.randomUUID();

  return redirect("/account", false, {
    cookies: [{
      name: "session",
      value: sessionId,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    }],
  });
}
```

Throwing works the same way. `throw notFound()` and `throw redirect(...)` behave exactly like returning them, which is useful inside a helper that has no clean way to return to the data function:

```tsx
import { type DataContext, notFound } from "veryfront";

const posts = [{ slug: "hello", title: "Hello" }];

function requirePost(slug: string) {
  const post = posts.find((item) => item.slug === slug);
  if (!post) throw notFound();

  return post;
}

export function getServerData({ params }: DataContext) {
  return { props: { post: requirePost(String(params.slug)) } };
}
```

Only the objects `notFound()` and `redirect()` produce are read as control flow. Every other thrown value is an error, including an object that happens to carry a `notFound` property, such as a parsed error body from an upstream API.

To restrict redirects to the current request origin and selected external
origins, configure an allowlist:

```ts
import { defineConfig } from "veryfront/config";

export default defineConfig({
  security: {
    redirects: {
      allowedOrigins: ["https://accounts.example.com"],
    },
  },
});
```

The allowlist uses exact canonical origins, including the scheme and port when
present. Do not include a path, query, fragment, credentials, or trailing slash.
Root-relative, path-relative, query-only, fragment-only, and same-origin
destinations remain allowed. Use an empty list to permit only same-origin
redirects. Omit `security.redirects` to preserve unrestricted redirect
behavior. The policy applies equally to returned and thrown `redirect()`
results during full-page and client-side navigation.

## Client-side fetching

For data that loads after the page renders, fetch in a client component:

```tsx
"use client";

import { useEffect, useState } from "react";

export default function Search() {
  const [results, setResults] = useState([]);

  useEffect(() => {
    fetch("/api/search?q=react")
      .then((r) => r.json())
      .then(setResults);
  }, []);

  return <ul>{results.map((r) => <li key={r.id}>{r.title}</li>)}</ul>;
}
```

## Verify it worked

- For `getServerData`, hit the page with `curl http://localhost:3000/<path>`
  and confirm the response contains the value you returned in `props`.
- To verify response metadata, run
  `curl -sD - -o /dev/null http://localhost:3000/<path>` and inspect the
  custom header and separate `Set-Cookie` fields.
- For `getStaticData`, run `veryfront build` and inspect the generated HTML
  for the page. The HTML should contain the static value rather than a
  client-side fetch loop.
- For client-side fetching, open the browser dev tools network tab. The
  request should fire after the page paints and the rendered output should
  match the response.
