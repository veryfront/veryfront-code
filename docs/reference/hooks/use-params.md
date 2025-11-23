---
title: useParams
description: React hook to access dynamic route parameters in client components
category: reference
type: hook
keywords: [params, routing, dynamic-routes, hooks, client-side, useParams]
related: [/reference/hooks/use-pathname.md, /reference/hooks/use-search-params.md, /reference/hooks/use-router.md]
---

# useParams

React hook to access dynamic route parameters in client components. Essential for working with dynamic routes like `/blog/[slug]` or `/products/[id]`.

## Syntax

```typescript
'use client';  // Required for App Router

import { useParams } from 'veryfront';

const params = useParams();
```

## Parameters

The `useParams` hook takes no parameters.

## Return Value

Returns an object containing the current route parameters. The structure depends on your dynamic route segments.

```typescript
Record<string, string | string[]>
```

For single dynamic segments: `{ slug: "my-post" }`
For catch-all segments: `{ slug: ["category", "subcategory", "post"] }`

## Examples

### Basic Dynamic Route

```typescript
'use client';

import { useParams } from 'veryfront';

// Route: /blog/[slug]
export default function BlogPost() {
  const params = useParams();
  // params.slug = "my-first-post"

  return (
    <article>
      <h1>Post: {params.slug}</h1>
    </article>
  );
}
```

### Multiple Dynamic Segments

```typescript
'use client';

import { useParams } from 'veryfront';

// Route: /shop/[category]/[productId]
export default function ProductPage() {
  const params = useParams();
  // params.category = "electronics"
  // params.productId = "laptop-123"

  return (
    <div>
      <p>Category: {params.category}</p>
      <p>Product ID: {params.productId}</p>
    </div>
  );
}
```

### Catch-All Routes

```typescript
'use client';

import { useParams } from 'veryfront';

// Route: /docs/[...slug]
export default function DocsPage() {
  const params = useParams();
  // For URL: /reference/reference/hooks
  // params.slug = ["api", "reference", "hooks"]

  const path = Array.isArray(params.slug)
    ? params.slug.join('/')
    : params.slug;

  return (
    <div>
      <p>Documentation path: {path}</p>
    </div>
  );
}
```

### Typed Params

```typescript
'use client';

import { useParams } from 'veryfront';

interface BlogParams {
  slug: string;
}

export default function BlogPost() {
  const params = useParams() as BlogParams;

  // TypeScript knows params.slug is a string
  const slug: string = params.slug;

  return (
    <article>
      <h1>{slug.replace(/-/g, ' ')}</h1>
    </article>
  );
}
```

### Fetch Data Based on Params

```typescript
'use client';

import { useParams } from 'veryfront';
import { useEffect, useState } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
}

export default function ProductDetails() {
  const params = useParams();
  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    fetch(`/api/products/${params.id}`)
      .then(res => res.json())
      .then(setProduct);
  }, [params.id]);

  if (!product) return <div>Loading...</div>;

  return (
    <div>
      <h1>{product.name}</h1>
      <p>${product.price}</p>
    </div>
  );
}
```

### Navigate Based on Params

```typescript
'use client';

import { useParams, useRouter } from 'veryfront';

export default function ProductActions() {
  const params = useParams();
  const router = useRouter();

  const goToCategory = () => {
    router.push(`/products/category/${params.category}`);
  };

  const goToRelated = () => {
    router.push(`/products/${params.id}/related`);
  };

  return (
    <div>
      <button onClick={goToCategory}>
        View Category
      </button>
      <button onClick={goToRelated}>
        Related Products
      </button>
    </div>
  );
}
```

### Breadcrumbs with Params

```typescript
'use client';

import { useParams } from 'veryfront';
import { Link } from 'veryfront';

// Route: /shop/[category]/[subcategory]/[productId]
export default function ProductBreadcrumbs() {
  const params = useParams();

  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        <li><Link href="/">Home</Link></li>
        <li><Link href="/shop">Shop</Link></li>
        <li>
          <Link href={`/shop/${params.category}`}>
            {params.category}
          </Link>
        </li>
        <li>
          <Link href={`/shop/${params.category}/${params.subcategory}`}>
            {params.subcategory}
          </Link>
        </li>
        <li>{params.productId}</li>
      </ol>
    </nav>
  );
}
```

### Optional Catch-All Routes

```typescript
'use client';

import { useParams } from 'veryfront';

// Route: /docs/[[...slug]]
export default function OptionalDocsPage() {
  const params = useParams();

  // params.slug can be undefined for /docs
  // or ["api"] for /docs/api
  // or ["api", "reference"] for /reference/reference

  const segments = params.slug
    ? Array.isArray(params.slug)
      ? params.slug
      : [params.slug]
    : [];

  if (segments.length === 0) {
    return <div>Documentation Home</div>;
  }

  return (
    <div>
      <p>Path: {segments.join(' / ')}</p>
    </div>
  );
}
```

### Validate Params

```typescript
'use client';

import { useParams, useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function UserProfile() {
  const params = useParams();
  const router = useRouter();

  useEffect(() => {
    // Validate ID format
    const userId = params.id as string;
    if (!/^\d+$/.test(userId)) {
      // Invalid ID format, redirect to 404
      router.push('/404');
    }
  }, [params.id, router]);

  return (
    <div>
      <h1>User Profile: {params.id}</h1>
    </div>
  );
}
```

### Active Link Based on Params

```typescript
'use client';

import { useParams } from 'veryfront';
import { Link } from 'veryfront';

export default function CategoryTabs() {
  const params = useParams();
  const activeCategory = params.category as string;

  const categories = ['electronics', 'clothing', 'books', 'toys'];

  return (
    <nav>
      {categories.map(category => (
        <Link
          key={category}
          href={`/shop/${category}`}
          className={activeCategory === category ? 'active' : ''}
        >
          {category}
        </Link>
      ))}
    </nav>
  );
}
```

### Conditional Rendering Based on Params

```typescript
'use client';

import { useParams } from 'veryfront';

export default function UserDashboard() {
  const params = useParams();
  const section = params.section as string;

  return (
    <div>
      {section === 'profile' && <ProfileSection />}
      {section === 'settings' && <SettingsSection />}
      {section === 'orders' && <OrdersSection />}
    </div>
  );
}
```

### Convert Param to Different Type

```typescript
'use client';

import { useParams } from 'veryfront';

export default function PageNumber() {
  const params = useParams();

  // Convert string param to number
  const page = parseInt(params.page as string, 10);

  if (isNaN(page) || page < 1) {
    return <div>Invalid page number</div>;
  }

  return (
    <div>
      <h1>Page {page}</h1>
    </div>
  );
}
```

### Decode URI Component

```typescript
'use client';

import { useParams } from 'veryfront';

export default function SearchResults() {
  const params = useParams();

  // URL: /search/hello%20world
  // params.query = "hello world" (automatically decoded)

  const query = params.query as string;

  return (
    <div>
      <h1>Search: {query}</h1>
    </div>
  );
}
```

### Build API URL from Params

```typescript
'use client';

import { useParams } from 'veryfront';
import { useEffect, useState } from 'react';

export default function NestedResource() {
  const params = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    // Build API URL from multiple params
    const url = `/api/users/${params.userId}/posts/${params.postId}`;

    fetch(url)
      .then(res => res.json())
      .then(setData);
  }, [params.userId, params.postId]);

  if (!data) return <div>Loading...</div>;

  return <div>{JSON.stringify(data)}</div>;
}
```

### Share Link with Current Params

```typescript
'use client';

import { useParams } from 'veryfront';

export default function ShareButton() {
  const params = useParams();

  const handleShare = () => {
    const url = `${window.location.origin}/products/${params.id}`;

    navigator.clipboard.writeText(url);
    alert('Link copied to clipboard!');
  };

  return (
    <button onClick={handleShare}>
      Share Product
    </button>
  );
}
```

## Behavior

- **Client-side only**: The hook only works in client components (requires `'use client'` directive in App Router)
- **Automatic decoding**: Parameter values are automatically URI-decoded
- **Type safety**: Use TypeScript interfaces for better type safety
- **Array for catch-all**: Catch-all routes return arrays, single segments return strings
- **Reactive**: Component re-renders when params change

## Route Types and Return Values

| Route Pattern | Example URL | params Value |
|--------------|-------------|--------------|
| `/blog/[slug]` | `/blog/hello` | `{ slug: "hello" }` |
| `/[category]/[id]` | `/books/123` | `{ category: "books", id: "123" }` |
| `/docs/[...slug]` | `/docs/a/b/c` | `{ slug: ["a", "b", "c"] }` |
| `/docs/[[...slug]]` | `/docs` | `{ slug: undefined }` |
| `/docs/[[...slug]]` | `/docs/a` | `{ slug: ["a"] }` |

## App Router vs Pages Router

### App Router (Recommended)

```typescript
'use client';  // Required!

import { useParams } from 'veryfront';

export default function Component() {
  const params = useParams();
  // params.slug, params.id, etc.
}
```

### Pages Router

```typescript
// No 'use client' needed in Pages Router

import { useRouter } from 'veryfront';

export default function Component() {
  const router = useRouter();
  const params = router.query;
  // params.slug, params.id, etc.
}
```

## Notes

- Must be used in client components (add `'use client'` directive in App Router)
- Cannot be used in server components (use `params` prop instead)
- Parameters are always strings or string arrays
- Values are automatically URL-decoded
- For server components, access params via the component props
- Does not include query parameters (use `useSearchParams` instead)

## Related

- [usePathname](/reference/hooks/use-pathname.md) - Get current pathname
- [useSearchParams](/reference/hooks/use-search-params.md) - Access query parameters
- [useRouter](/reference/hooks/use-router.md) - Programmatic navigation
- [getServerData](/reference/functions/get-server-data.md) - Server-side params access
