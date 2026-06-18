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
