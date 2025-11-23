---
title: Head
description: Component for modifying the document head from anywhere in your application
category: reference
type: component
keywords: [head, meta, seo, title, metadata, document]
related: [/reference/components/link.md]
---

# Head

Component for modifying the document `<head>` from anywhere in your application, enabling dynamic SEO optimization and metadata management.

## Syntax

```typescript
import { Head } from 'veryfront';

<Head>
  <title>Page Title</title>
  <meta name="description" content="Description" />
</Head>
```

## Props

The `Head` component accepts standard React children. Any valid HTML `<head>` elements can be used as children.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| children | React.ReactNode | Yes | Valid HTML head elements to inject into the document head |

## Supported Elements

The `Head` component supports all standard HTML head elements:

- **`<title>`** - Page title displayed in browser tab and search results
- **`<meta>`** - Meta tags for SEO, Open Graph, Twitter Cards, etc.
- **`<link>`** - External resources (stylesheets, canonical URLs, favicons, etc.)
- **`<script>`** - External JavaScript files
- **`<style>`** - Inline CSS styles
- **`<base>`** - Base URL for relative links

## Return Value

Returns a React element that injects the provided head elements into the document `<head>`.

## Examples

### Basic Page Title

```typescript
import { Head } from 'veryfront';

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About Us - My Company</title>
      </Head>
      <main>
        <h1>About Us</h1>
      </main>
    </>
  );
}
```

### SEO Meta Tags

```typescript
import { Head } from 'veryfront';

export default function BlogPost({ post }) {
  return (
    <>
      <Head>
        <title>{post.title} - My Blog</title>
        <meta name="description" content={post.excerpt} />
        <meta name="author" content={post.author} />
        <meta name="keywords" content={post.tags.join(', ')} />
        <link rel="canonical" href={`https://myblog.com/posts/${post.slug}`} />
      </Head>
      <article>
        <h1>{post.title}</h1>
        <div>{post.content}</div>
      </article>
    </>
  );
}
```

### Open Graph Tags

```typescript
import { Head } from 'veryfront';

export default function ProductPage({ product }) {
  return (
    <>
      <Head>
        <title>{product.name} - Shop</title>
        <meta property="og:title" content={product.name} />
        <meta property="og:description" content={product.description} />
        <meta property="og:image" content={product.imageUrl} />
        <meta property="og:type" content="product" />
        <meta property="og:url" content={`https://shop.com/products/${product.id}`} />
        <meta property="og:price:amount" content={product.price} />
        <meta property="og:price:currency" content="USD" />
      </Head>
      <main>
        <h1>{product.name}</h1>
        <img src={product.imageUrl} alt={product.name} />
        <p>${product.price}</p>
      </main>
    </>
  );
}
```

### Twitter Card

```typescript
import { Head } from 'veryfront';

export default function ArticlePage({ article }) {
  return (
    <>
      <Head>
        <title>{article.title}</title>
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:site" content="@mywebsite" />
        <meta name="twitter:title" content={article.title} />
        <meta name="twitter:description" content={article.excerpt} />
        <meta name="twitter:image" content={article.coverImage} />
      </Head>
      <article>
        <h1>{article.title}</h1>
        <p>{article.content}</p>
      </article>
    </>
  );
}
```

### External Stylesheets and Scripts

```typescript
import { Head } from 'veryfront';

export default function MapPage() {
  return (
    <>
      <Head>
        <title>Location Map</title>
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        />
        <script
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        />
      </Head>
      <div id="map"></div>
    </>
  );
}
```

### Favicon and Icons

```typescript
import { Head } from 'veryfront';

export default function Layout({ children }) {
  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
      </Head>
      <main>{children}</main>
    </>
  );
}
```

### Dynamic Meta Tags with Data Fetching

```typescript
import { Head } from 'veryfront';
import type { DataContext } from 'veryfront';

interface PageProps {
  user: {
    name: string;
    bio: string;
    avatar: string;
  };
}

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const user = await fetchUser(ctx.params.id);
  return { props: { user } };
};

export default function UserProfile({ user }: PageProps) {
  return (
    <>
      <Head>
        <title>{user.name} - Profile</title>
        <meta name="description" content={user.bio} />
        <meta property="og:title" content={`${user.name}'s Profile`} />
        <meta property="og:description" content={user.bio} />
        <meta property="og:image" content={user.avatar} />
      </Head>
      <div>
        <h1>{user.name}</h1>
        <p>{user.bio}</p>
      </div>
    </>
  );
}
```

### Inline Styles

```typescript
import { Head } from 'veryfront';

export default function CustomStyledPage() {
  return (
    <>
      <Head>
        <title>Custom Styled Page</title>
        <style>{`
          body {
            background: linear-gradient(to bottom, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
          }
        `}</style>
      </Head>
      <div className="container">
        <h1>Custom Styled Content</h1>
      </div>
    </>
  );
}
```

## Behavior

- **Merge strategy**: Multiple `<Head>` components merge their content; later definitions override earlier ones
- **SSR support**: Head modifications are included in server-rendered HTML for SEO
- **Client-side updates**: Head updates happen immediately when navigating between pages
- **Deduplication**: Duplicate tags with the same key are automatically deduplicated

## Notes

- For multiple `<title>` tags, the last one wins
- Meta tags are matched by `name` or `property` attribute for deduplication
- The `<Head>` component can be used anywhere in your component tree, not just at the top level
- Head modifications persist until the component unmounts or is replaced
- Always include a title for better SEO and user experience

## Related

- [Link](/reference/components/link.md) - Client-side navigation component
- [getServerData](/reference/functions/get-server-data.md) - Server-side data fetching
