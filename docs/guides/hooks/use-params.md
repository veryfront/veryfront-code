---
title: useParams Hook
description: Access dynamic route parameters with the useParams hook in Veryfront
keywords:
  - useParams
  - route parameters
  - dynamic routes
  - URL params
  - param hook
related:
  - /docs/hooks/use-router.md
  - /docs/hooks/use-pathname.md
  - /docs/hooks/use-search-params.md
  - /guides/routing/dynamic-routes.md
---

# useParams Hook

The `useParams` hook returns an object containing the current route's dynamic parameters. Use it to access URL segments like `[id]`, `[slug]`, or `[...path]` in Client Components.

## Overview

- **Dynamic Parameters**: Access URL segment values
- **Read-Only**: For reading params only
- **Type-Safe**: Full TypeScript support
- **Client Component Only**: Must be used in Client Components
- **Object Return**: Returns `Record<string, string | string[]>`

## Basic Usage

```tsx
'use client';

import { useParams } from 'veryfront';

// URL: /products/123
export default function ProductPage() {
  const params = useParams();

  return <div>Product ID: {params.id}</div>;
}
```

## Dynamic Routes

### Single Parameter

```tsx
// File: app/blog/[slug]/page.tsx
'use client';

import { useParams } from 'veryfront';

export default function BlogPost() {
  const params = useParams();

  return (
    <div>
      <h1>Post: {params.slug}</h1>
    </div>
  );
}

// URL: /blog/hello-world
// params: { slug: "hello-world" }
```

### Multiple Parameters

```tsx
// File: app/blog/[category]/[slug]/page.tsx
'use client';

import { useParams } from 'veryfront';

export default function BlogPost() {
  const params = useParams();

  return (
    <div>
      <p>Category: {params.category}</p>
      <p>Slug: {params.slug}</p>
    </div>
  );
}

// URL: /blog/tech/hello-world
// params: { category: "tech", slug: "hello-world" }
```

### Catch-All Segments

```tsx
// File: app/docs/[...path]/page.tsx
'use client';

import { useParams } from 'veryfront';

export default function DocsPage() {
  const params = useParams();
  const path = params.path as string[];

  return (
    <div>
      <h1>Path segments: {path.join(' / ')}</h1>
    </div>
  );
}

// URL: /docs/getting-started/installation
// params: { path: ["getting-started", "installation"] }
```

## Data Fetching

### Fetch Based on Param

```tsx
'use client';

import { useParams } from 'veryfront';
import { useEffect, useState } from 'react';

export default function UserProfile() {
  const params = useParams();
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`/api/users/${params.id}`)
      .then(res => res.json())
      .then(setUser);
  }, [params.id]);

  if (!user) return <div>Loading...</div>;

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
}
```

### TypeScript with Data Fetching

```tsx
'use client';

import { useParams } from 'veryfront';
import { useEffect, useState } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
}

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    async function fetchProduct() {
      const response = await fetch(`/api/products/${params.id}`);
      const data = await response.json();
      setProduct(data);
    }

    fetchProduct();
  }, [params.id]);

  if (!product) return <div>Loading product...</div>;

  return (
    <div>
      <h1>{product.name}</h1>
      <p>${product.price}</p>
    </div>
  );
}
```

## TypeScript Support

### Type-Safe Params

```tsx
'use client';

import { useParams } from 'veryfront';

// Define param types
type Params = {
  category: string;
  slug: string;
};

export default function BlogPost() {
  const params = useParams<Params>();

  // TypeScript knows these exist
  const category: string = params.category;
  const slug: string = params.slug;

  return (
    <div>
      <h1>{category} - {slug}</h1>
    </div>
  );
}
```

### Generic Hook Wrapper

```tsx
'use client';

import { useParams as useParamsOriginal } from 'veryfront';

function useTypedParams<T extends Record<string, string>>() {
  return useParamsOriginal() as T;
}

// Usage:
type BlogParams = {
  slug: string;
};

export function BlogPost() {
  const { slug } = useTypedParams<BlogParams>();

  return <h1>Post: {slug}</h1>;
}
```

## Real-World Examples

### E-commerce Product Page

```tsx
'use client';

import { useParams } from 'veryfront';
import { useEffect, useState } from 'react';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
  images: string[];
}

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProduct() {
      try {
        const res = await fetch(`/api/products/${params.id}`);
        const data = await res.json();
        setProduct(data);
      } catch (error) {
        console.error('Failed to load product:', error);
      } finally {
        setLoading(false);
      }
    }

    loadProduct();
  }, [params.id]);

  if (loading) return <ProductSkeleton />;
  if (!product) return <ProductNotFound />;

  return (
    <div className="product-page">
      <div className="product-images">
        {product.images.map((img, i) => (
          <img key={i} src={img} alt={product.name} />
        ))}
      </div>

      <div className="product-details">
        <h1>{product.name}</h1>
        <p className="price">${product.price}</p>
        <p className="description">{product.description}</p>

        <button>Add to Cart</button>
      </div>
    </div>
  );
}
```

### Blog Post with Category

```tsx
'use client';

import { useParams, useRouter } from 'veryfront';
import { useEffect, useState } from 'react';

type BlogParams = {
  category: string;
  slug: string;
};

interface Post {
  title: string;
  content: string;
  author: string;
  publishedAt: string;
}

export default function BlogPost() {
  const params = useParams<BlogParams>();
  const router = useRouter();
  const [post, setPost] = useState<Post | null>(null);

  useEffect(() => {
    async function loadPost() {
      const res = await fetch(
        `/api/blog/${params.category}/${params.slug}`
      );

      if (!res.ok) {
        router.push('/404');
        return;
      }

      const data = await res.json();
      setPost(data);
    }

    loadPost();
  }, [params.category, params.slug, router]);

  if (!post) return <div>Loading...</div>;

  return (
    <article>
      <header>
        <h1>{post.title}</h1>
        <div className="meta">
          <span>By {post.author}</span>
          <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
        </div>
      </header>

      <div dangerouslySetInnerHTML={{ __html: post.content }} />

      <nav className="post-nav">
        <button onClick={() => router.push(`/blog/${params.category}`)}>
          ← Back to {params.category}
        </button>
      </nav>
    </article>
  );
}
```

### Documentation with Nested Paths

```tsx
'use client';

import { useParams } from 'veryfront';
import { useEffect, useState } from 'react';

type DocsParams = {
  path: string[];
};

export default function DocsPage() {
  const params = useParams<DocsParams>();
  const [content, setContent] = useState('');

  const path = Array.isArray(params.path) ? params.path : [params.path];
  const fullPath = path.join('/');

  useEffect(() => {
    async function loadDocs() {
      const res = await fetch(`/api/docs/${fullPath}`);
      const data = await res.json();
      setContent(data.content);
    }

    loadDocs();
  }, [fullPath]);

  return (
    <div className="docs-page">
      <Breadcrumbs segments={path} />

      <main className="docs-content">
        <div dangerouslySetInnerHTML={{ __html: content }} />
      </main>

      <DocsSidebar currentPath={path} />
    </div>
  );
}

function Breadcrumbs({ segments }: { segments: string[] }) {
  return (
    <nav className="breadcrumbs">
      <a href="/docs">Docs</a>
      {segments.map((segment, i) => (
        <span key={i}>
          {' / '}
          <a href={`/docs/${segments.slice(0, i + 1).join('/')}`}>
            {segment}
          </a>
        </span>
      ))}
    </nav>
  );
}
```

## Validation and Error Handling

### Validate Param Format

```tsx
'use client';

import { useParams, useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function ProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    // Validate ID format (e.g., must be numeric)
    if (!/^\d+$/.test(params.id)) {
      router.push('/404');
    }
  }, [params.id, router]);

  return <div>Product: {params.id}</div>;
}
```

### Handle Missing Params

```tsx
'use client';

import { useParams, useRouter } from 'veryfront';
import { useEffect, useState } from 'react';

export default function ItemPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.id) {
      setError('No ID provided');
      return;
    }

    async function loadItem() {
      try {
        const res = await fetch(`/api/items/${params.id}`);

        if (!res.ok) {
          setError('Item not found');
          return;
        }

        const data = await res.json();
        setItem(data);
      } catch (err) {
        setError('Failed to load item');
      }
    }

    loadItem();
  }, [params.id]);

  if (error) return <div className="error">{error}</div>;
  if (!item) return <div>Loading...</div>;

  return <div>{/* Render item */}</div>;
}
```

## Best Practices

### 1. Type Your Params

```tsx
// ❌ Bad: No types
const params = useParams();
const id = params.id; // Type: string | string[] | undefined

// ✅ Good: Typed params
const params = useParams<{ id: string }>();
const id = params.id; // Type: string
```

### 2. Handle Arrays for Catch-All Routes

```tsx
// ❌ Bad: Assuming string
const path = params.path; // Could be string[]

// ✅ Good: Check array
const path = Array.isArray(params.path) ? params.path : [params.path];
```

### 3. Validate Params Early

```tsx
// ❌ Bad: Use params without validation
fetch(`/api/users/${params.id}`);

// ✅ Good: Validate first
if (!params.id || typeof params.id !== 'string') {
  return <Error message="Invalid ID" />;
}

fetch(`/api/users/${params.id}`);
```

### 4. Use useMemo for Computed Values

```tsx
// ❌ Bad: Recompute on every render
const fullPath = params.path.join('/');

// ✅ Good: Memoize computed values
const fullPath = useMemo(
  () => Array.isArray(params.path) ? params.path.join('/') : params.path,
  [params.path]
);
```

## Common Patterns

### Parameter-Based Styling

```tsx
'use client';

import { useParams } from 'veryfront';

type Params = { theme: 'light' | 'dark' };

export default function ThemedPage() {
  const params = useParams<Params>();

  return (
    <div className={`page theme-${params.theme}`}>
      <h1>Themed Content</h1>
    </div>
  );
}
```

### Conditional Rendering

```tsx
'use client';

import { useParams } from 'veryfront';

type Params = { mode?: 'edit' | 'view' };

export default function DocumentPage() {
  const params = useParams<Params>();
  const isEditMode = params.mode === 'edit';

  return (
    <div>
      {isEditMode ? (
        <DocumentEditor />
      ) : (
        <DocumentViewer />
      )}
    </div>
  );
}
```

## Return Value

The `useParams` hook returns an object with parameter key-value pairs:

```tsx
// Single param
{ slug: "hello-world" }

// Multiple params
{ category: "tech", slug: "hello-world" }

// Catch-all
{ path: ["getting-started", "installation"] }
```

## Server vs Client

```tsx
// ❌ Bad: Can't use in Server Components
export default function ServerComponent() {
  const params = useParams(); // Error!
  return <div>{params.id}</div>;
}

// ✅ Good: Use in Client Components
'use client';

export default function ClientComponent() {
  const params = useParams(); // Works!
  return <div>{params.id}</div>;
}

// ✅ Alternative: Access params in Server Components via props
export default function ServerComponent({ params }: { params: { id: string } }) {
  return <div>{params.id}</div>;
}
```

## Next Steps

- Learn about [useRouter hook](/docs/hooks/use-router.md) for programmatic navigation
- Explore [useSearchParams hook](/docs/hooks/use-search-params.md) for query strings
- Check out [usePathname hook](/docs/hooks/use-pathname.md) for current pathname
- Read about [Dynamic Routes](/guides/routing/dynamic-routes.md) for route patterns
