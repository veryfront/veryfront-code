---
title: "Data Fetching"
description: "Server data, static generation, and client-side fetching."
order: 4
---

# Data Fetching

Server data, static generation, and client-side fetching.

## Server data

`getServerData` runs on every request. Use it when data depends on the request (auth, query params, cookies):

```tsx
// app/dashboard/page.tsx
import type { DataContext } from "veryfront";

export async function getServerData({ request, params }: DataContext) {
  const token = request.headers.get("authorization");
  const user = await fetchUser(token);
  return { props: { user } };
}

export default function Dashboard({ user }: { user: User }) {
  return <h1>Welcome, {user.name}</h1>;
}
```

The `DataContext` provides:

| Property | Type | Description |
|----------|------|-------------|
| `request` | `Request` | The incoming HTTP request |
| `params` | `Record<string, string>` | Route parameters (e.g. `{ slug: "hello" }`) |
| `query` | `URLSearchParams` | Query string parameters |

## Static data

`getStaticData` runs at build time. Use it for content that doesn't change per request:

```tsx
// app/blog/[slug]/page.tsx
export async function getStaticData({ params }: { params: { slug: string } }) {
  const post = await getPost(params.slug);
  return { props: { post } };
}

export async function getStaticPaths() {
  const posts = await getAllPosts();
  return {
    paths: posts.map((p) => ({ params: { slug: p.slug } })),
  };
}

export default function BlogPost({ post }: { post: Post }) {
  return <article>{post.title}</article>;
}
```

For dynamic routes, pair `getStaticData` with `getStaticPaths` to tell the framework which pages to generate.

## Redirects and 404s

Return `redirect()` or `notFound()` from any data function:

```tsx
import { redirect, notFound } from "veryfront";

export async function getServerData({ params }: DataContext) {
  const post = await getPost(params.slug);

  if (!post) return notFound();
  if (post.moved) return redirect(`/blog/${post.newSlug}`);

  return { props: { post } };
}
```

`redirect()` accepts an optional second argument for permanent redirects:

```ts
redirect("/new-url", true); // 301 permanent redirect
```

## Client-side fetching

For data that loads after the page renders, fetch in a client component:

```tsx
'use client'

import { useState, useEffect } from "react";

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

## Next

- [API Routes](./api-routes.md) — create the endpoints your pages fetch from
- [Agents](./agents.md) — load AI-generated data server-side

## Related

- [`veryfront` (root)](../reference/root.md) — `getServerData`, `getStaticData`, `redirect`, `notFound`
