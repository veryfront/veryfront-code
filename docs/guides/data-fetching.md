---
title: "Data fetching"
description: "Server data, static generation, and client-side fetching."
order: 5
---

# Data fetching

Server data, static generation, and client-side fetching.

Examples below use the default app router. Veryfront Code also supports the pages router through `veryfront.config.ts` with `router: "pages"`.

## Prerequisites

- A project with at least one page (see
  [Pages and routing](./pages-and-routing.md)).
- A data source you can call from server code, build-time scripts, or the
  browser (REST API, database, or in-memory data).

## Server data

`getServerData` runs on every request. Use it when data depends on the request (auth, query params, cookies):

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

The `DataContext` provides:

| Property  | Type                     | Description                                 |
| --------- | ------------------------ | ------------------------------------------- |
| `request` | `Request`                | The incoming HTTP request                   |
| `params`  | `Record<string, string>` | Route parameters (e.g. `{ slug: "hello" }`) |
| `query`   | `URLSearchParams`        | Query string parameters                     |

## Static data

`getStaticData` runs at build time. Use it for content that doesn't change per request:

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

## Redirects and 404s

Return `redirect()` or `notFound()` from any data function:

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
- For `getStaticData`, run `veryfront build` and inspect the generated HTML
  for the page. The HTML should contain the static value rather than a
  client-side fetch loop.
- For client-side fetching, open the browser dev tools network tab. The
  request should fire after the page paints and the rendered output should
  match the response.

## Next

- [API routes](./api-routes.md): create the endpoints your pages fetch from
- [Agents](./agents.md): load AI-generated data server-side

## Related

- [`veryfront` (root)](../reference/veryfront/index.md): `getServerData`, `getStaticData`, `redirect`, `notFound`
