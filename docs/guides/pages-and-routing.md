---
title: "Pages and routing"
description: "File-based routing, layouts, dynamic routes, and MDX pages."
order: 12
---

Veryfront uses file-system based routing. Folders and files under `app/` (or `pages/`) define routes; layouts compose down the tree; brackets in path segments mark dynamic params.

Examples below use the default app router. Set `router: "pages"` in `veryfront.config.ts` to switch to the pages router.

## Prerequisites

- A project created with `veryfront init` (see [Create project](../getting-started/create-project.md)).
- The dev server is the easiest way to test routes:
  `veryfront dev`.

## Router equivalents

Veryfront supports both router styles. The main difference is file shape:

| URL / capability | App router                 | Pages router            |
| ---------------- | -------------------------- | ----------------------- |
| `/`              | `app/page.tsx`             | `pages/index.tsx`       |
| `/about`         | `app/about/page.tsx`       | `pages/about.tsx`       |
| `/blog/:slug`    | `app/blog/[slug]/page.tsx` | `pages/blog/[slug].tsx` |
| `/api/users`     | `app/api/users/route.ts`   | `pages/api/users.ts`    |
| Root layout      | `app/layout.tsx`           | `pages/layout.tsx`      |

Use the app router when you want the newer directory-per-route shape. Use the pages router when you want the flatter file-per-route layout.

## Basic pages

```
app/
  page.tsx          # /
  about/page.tsx    # /about
  blog/page.tsx     # /blog
```

A page exports a default React component:

```tsx
// app/page.tsx
export default function Home() {
  return <h1>Welcome</h1>;
}
```

Run `veryfront dev` and open [http://localhost:3000](http://localhost:3000). The page should render `Welcome`.

## Layouts

Layouts wrap pages and persist across navigation. Create `layout.tsx` at any level:

```tsx
// app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

Nested layouts compose automatically:

```
app/
  layout.tsx            # Wraps everything
  page.tsx              # /
  dashboard/
    layout.tsx          # Wraps dashboard pages
    page.tsx            # /dashboard
    settings/page.tsx   # /dashboard/settings
```

`/dashboard/settings` renders inside both the root layout and the dashboard layout.

`layout.tsx` and the other supported `layout.*` extensions are reserved layout metadata at every
directory level in both routers. They wrap descendant pages and never create a `/layout` route.

### Overriding or disabling a layout

A page can opt out of the nested layout chain, or replace it with a named layout.

On `.md`/`.mdx` pages, set `layout` in the frontmatter:

```mdx
---
title: Standalone
layout: false
---

# Renders with no layout at all
```

On `.tsx`/`.jsx`/`.ts`/`.js` pages, export a `layout` constant:

```tsx
// app/standalone/page.tsx
export const layout = false;

export default function StandalonePage() {
  return <div>Renders with no layout at all</div>;
}
```

You can also put the same value in an exported `frontmatter` object:

```tsx
export const frontmatter = { layout: "marketing" };
```

The `frontmatter.layout` property accepts the same `false` and named-layout values as the direct
`layout` export.

Supported values in both cases:

- `layout: false` renders the page bare: no ancestor layouts, no default layout.
- `layout: "name"` replaces the entire nested chain with the named layout. Ancestor
  layouts (including the root layout) are not applied.

An explicit project path with a file extension, such as `@/layouts/custom.tsx` or
`@components/CustomLayout.tsx`, loads that file directly, without falling back to
convention-based discovery. Plain names resolve from, in order:

1. `layouts/<name>.{tsx,mdx,md,jsx,ts,js}` - anything in `layouts/` is a layout.
2. `components/<Name>Layout.*` or `components/Layout.*`.

A project-wide default can also be set with `layout` in `veryfront.config.ts`; a page's
`layout` frontmatter or export always wins over the config default.

## Dynamic routes

Use brackets for dynamic segments:

```
app/
  blog/[slug]/page.tsx      # /blog/:slug
  users/[id]/page.tsx       # /users/:id
```

Access params via the `usePageContext` hook:

```tsx
// app/blog/[slug]/page.tsx
"use client";
import { usePageContext } from "veryfront/context";

export default function BlogPost() {
  const { params } = usePageContext();
  return <h1>Post: {params.slug}</h1>;
}
```

Open [http://localhost:3000/blog/hello](http://localhost:3000/blog/hello). The page should render `Post: hello`.

### Catch-all routes

Use `[...segments]` to match multiple path segments:

```
app/docs/[...segments]/page.tsx   # /docs/a, /docs/a/b, /docs/a/b/c
```

## MDX pages

Rename any page to `.mdx` to write content in Markdown with JSX:

```mdx
{/* app/about/page.mdx */}

# About Us

We build tools for developers.

<TeamGrid members={team} />
```

MDX pages support frontmatter:

```mdx
---
title: "About"
description: "Learn about the team."
---

# {frontmatter.title}
```

Access frontmatter from components using `usePageContext()` from `veryfront/context`:

```tsx
"use client";
import { usePageContext } from "veryfront/context";

function PageTitle() {
  const { frontmatter } = usePageContext();
  return <h1>{frontmatter.title}</h1>;
}
```

### Lazy JSX imports

Veryfront bounds the on-disk JSX transform cache. A loaded MDX module keeps a
recovery snapshot for its literal dynamic JSX imports, so a delayed import can
restore an evicted artifact. Recovery uses the original transformed code, not
the latest source at that path. Load the updated MDX module to use changed source.

Recovery snapshots have a combined limit of 2 MiB per MDX module. Recovery follows
the same cache capacity limits as initial compilation and can fail when active
artifacts occupy the available capacity.

### Override rendered MDX elements

Wrap an MDX page or layout with `MDXProvider` to replace generated elements:

```tsx
import type React from "react";
import { MDXProvider } from "veryfront/mdx";

const docsComponents = {
  h1: (props: React.ComponentProps<"h1">) => <h1 className="docs-title" {...props} />,
  a: (props: React.ComponentProps<"a">) => <a {...props} rel="noreferrer" />,
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <MDXProvider components={docsComponents}>{children}</MDXProvider>;
}
```

Nested providers inherit entries from outer providers. A nearer provider wins
for duplicate keys. Call `useMDXComponents(localOverrides)` when a component
needs the effective map; local entries take final precedence.

`MDXProvider` supplies application-owned React components to already compiled
MDX. It does not compile or sanitize arbitrary strings. Render runtime Markdown
strings with `veryfront/markdown`.

### Reading server data from a layout or nested component

A page's [`getServerData`](./data-fetching.md) props are passed to the page
component. To read them from a layout or a deeply-nested component without
prop-drilling, use `usePageContext().data`:

```tsx
import { usePageContext } from "veryfront/context";

function Greeting() {
  const { data } = usePageContext();
  return <p>{data.greeting as string}</p>;
}
```

`data` is the object your page returned as `getServerData`'s `props`. It is
populated identically on the server render, in the hydration markup, and after
client-side navigation. A page without `getServerData` sees an empty object.

## Client components

By default, components render on the server. Add `'use client'` to make a component interactive:

```tsx
"use client";

import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>;
}
```

## Navigation

Use the `Link` component for client-side navigation:

```tsx
import { Link } from "veryfront/router";

export default function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
    </nav>
  );
}
```

Veryfront can prefetch eligible internal links before navigation. Use
`prefetch={false}` when a link must not prefetch.

Programmatic navigation:

```tsx
"use client";

import { useRouter } from "veryfront/router";

export default function LoginForm() {
  const router = useRouter();

  async function handleSubmit() {
    await login();
    router.push("/dashboard");
  }

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### Reading the live location

`useRouter()` is the single hook for location and navigation. Its `pathname`,
`query`, and `params` update reactively on client-side navigation:

```tsx
"use client";

import { useRouter } from "veryfront/router";

export default function Filters() {
  const { pathname, query, params } = useRouter();
  return <p>{pathname} · {params.category} · sort: {query.sort ?? "none"}</p>;
}
```

By default a query-only navigation refetches the page so server data that
depends on the query is never shown stale. If a page's query is purely
client-side state (tabs, filters), opt into the soft fast path, updating the
URL and re-rendering without a refetch, with the router's `shouldRevalidate`
option.

## Verify it worked

Start the dev server and request each page you added:

```bash
veryfront dev
curl -I http://localhost:3000/
curl -I http://localhost:3000/about
curl -I http://localhost:3000/blog/hello
```

Each request should return `HTTP/1.1 200 OK`. Visit the same URLs in a browser
to confirm the React component renders without console errors.
