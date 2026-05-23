---
title: "Create frontend"
description: "Add a page and a navigation link to a Veryfront project."
order: 6
---

Add a page to your Veryfront project and link to it from the home page. This is
the fifth step in the Getting Started flow, between
[Create API](./create-api.md) and [Deploy project](./deploy-project.md).

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

The file path maps to the URL. `app/about/page.tsx` is served at `/about`. The
default export is the React component for the page. Add `"use client"` at the
top of a file when it needs browser interactivity.

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

`Link` from `veryfront/router` performs client-side navigation. The browser does
not reload the page when the user selects the link.

## Verify it worked

1. Open [http://localhost:3000/](http://localhost:3000/) and select the **About
   this project** link.
2. The URL updates to `/about` without a full page reload.
3. Open the browser back button and confirm history works.

## Next

- [Deploy project](./deploy-project.md): ship the project to production
- [Create agent](./create-agent.md): wire an AI agent into the project

## Related

- [Pages and routing](../guides/pages-and-routing.md): full surface (layouts,
  dynamic routes, MDX, navigation hooks)
- [Head and SEO](../guides/head-and-seo.md): set page metadata, Open Graph tags,
  and structured data
- [Chat UI](../guides/chat-ui.md): drop a streaming chat interface into a page
