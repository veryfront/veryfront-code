---
title: "Head & SEO"
description: "Declarative metadata, Open Graph, and structured data."
order: 18
---

Use the `Head` component to manage `<title>`, `<meta>`, `<link>`, and other `<head>` elements from any page or component.

## Basic metadata

```tsx
import { Head } from "veryfront/head";

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About Us</title>
        <meta name="description" content="Learn about our team and mission." />
      </Head>
      <main>
        <h1>About Us</h1>
      </main>
    </>
  );
}
```

The `Head` component renders its children into the document's `<head>`. When multiple `Head` components are present (e.g., in a layout and a page), they merge — page-level tags override layout-level tags for duplicate keys.

## Open Graph

```tsx
<Head>
  <title>My Article</title>
  <meta property="og:title" content="My Article" />
  <meta property="og:description" content="A great read." />
  <meta property="og:image" content="https://example.com/image.jpg" />
  <meta property="og:type" content="article" />
  <meta name="twitter:card" content="summary_large_image" />
</Head>
```

## Favicon and icons

```tsx
<Head>
  <link rel="icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</Head>
```

## Fonts

Load Google Fonts with the `GoogleFonts` component:

```tsx
import { GoogleFonts } from "veryfront/fonts";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <GoogleFonts
        fonts={[
          { name: "Inter", weights: [400, 500, 700] },
          { name: "Fira Code", weights: [400] },
        ]}
      />
      {children}
    </>
  );
}
```

## Structured data (JSON-LD)

```tsx
<Head>
  <script type="application/ld+json">
    {JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "My Article",
      "author": { "@type": "Person", "name": "Jane Doe" },
    })}
  </script>
</Head>
```

## Per-page metadata in layouts

Set defaults in the layout, override in pages:

```tsx
// app/layout.tsx
import { Head } from "veryfront/head";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head>
        <title>My App</title>
        <meta name="description" content="Default description" />
      </Head>
      {children}
    </>
  );
}
```

```tsx
// app/about/page.tsx
import { Head } from "veryfront/head";

export default function About() {
  return (
    <>
      <Head>
        <title>About - My App</title>
        <meta name="description" content="About our team." />
      </Head>
      <h1>About</h1>
    </>
  );
}
```

The about page overrides both the title and description from the layout.

## MDX frontmatter

MDX pages can set metadata via frontmatter:

```mdx
---
title: "Blog Post Title"
description: "A brief summary of the post."
---

# {frontmatter.title}

Content here.
```

The framework automatically injects `title` and `description` from frontmatter into the `<head>`.

## Related

- [`veryfront/head`](../reference/head.md) — Head component API reference
- [`veryfront/fonts`](../reference/fonts.md) — fonts API reference
- [`veryfront/context`](../reference/context.md) — access frontmatter data
