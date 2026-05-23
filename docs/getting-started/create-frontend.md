---
title: "Create frontend"
description: "Add a page and a navigation link to a Veryfront project."
order: 6
---

## Prerequisites

- A project created with [Create project](./create-project.md).
- The dev server running (`veryfront dev`).

## Add a page

Create `app/about/page.tsx`:

```tsx
// app/about/page.tsx
export default function About() {
  return (
    <main>
      <h1>About</h1>
      <p>This project is built with Veryfront.</p>
    </main>
  );
}
```

`app/about/page.tsx` maps to `/about`. The default export is the page component.
Add `"use client"` only when the page needs browser interactivity.

Open [http://localhost:3000/about](http://localhost:3000/about). The page
renders.

## Link to it

Edit `app/page.tsx` to add a `Link` to the new page:

```tsx
// app/page.tsx
import { Link } from "veryfront/router";

export default function Home() {
  return (
    <main>
      <h1>Welcome</h1>
      <p>
        <Link href="/about">About this project</Link>
      </p>
    </main>
  );
}
```

`Link` from `veryfront/router` navigates without a full page reload.

## Verify it worked

1. Open [http://localhost:3000/](http://localhost:3000/) and select the **About
   this project** link.
2. The URL updates to `/about` without a full page reload.
3. Open the browser back button and confirm history works.

## Next

Continue with [Deploy project](./deploy-project.md).

## Related

- [Pages and routing](../guides/pages-and-routing.md): layouts, dynamic routes,
  MDX, and navigation hooks
- [Head and SEO](../guides/head-and-seo.md): metadata and structured data
