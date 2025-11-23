---
title: Hooks Reference
description: Complete reference for all React hooks provided by Veryfront
category: reference
keywords: [hooks, react, client-side, routing, navigation]
---

# Hooks Reference

React hooks provided by Veryfront for client-side routing, navigation, and state management. All hooks must be used in client components.

## Available Hooks

### Routing & Navigation

#### [useRouter](/reference/hooks/use-router.md)

Programmatic navigation and routing control in client components.

```typescript
'use client';

import { useRouter } from 'veryfront';

const router = useRouter();
router.push('/dashboard');
```

**Key Features:**
- Push/replace navigation
- Browser history control (back/forward)
- Page refresh
- Route prefetching
- Client-side only

**Use Cases:**
- Button click navigation
- Form submission redirects
- Conditional navigation
- Programmatic routing
- Multi-step flows

**Methods:**
- `push(url)` - Navigate and add to history
- `replace(url)` - Navigate without adding to history
- `back()` - Go back in history
- `forward()` - Go forward in history
- `refresh()` - Refresh current page
- `prefetch(url)` - Prefetch a route

---

#### [usePathname](/reference/hooks/use-pathname.md)

Get the current pathname for conditional rendering and active link highlighting.

```typescript
'use client';

import { usePathname } from 'veryfront';

const pathname = usePathname();
const isActive = pathname === '/about';
```

**Key Features:**
- Returns current pathname
- Reactive to route changes
- Excludes query params and hash
- Client-side only

**Use Cases:**
- Active link highlighting
- Conditional rendering based on route
- Breadcrumb navigation
- Analytics tracking
- Route-based theming

**Return Value:**
- Always starts with `/`
- Does not include domain, query, or hash
- Example: `/blog/post-1`

---

#### [useParams](/reference/hooks/use-params.md)

Access dynamic route parameters in client components.

```typescript
'use client';

import { useParams } from 'veryfront';

// Route: /blog/[slug]
const params = useParams();
const slug = params.slug;  // "my-post"
```

**Key Features:**
- Access route parameters
- Support for catch-all routes
- Automatic URI decoding
- Type-safe with TypeScript
- Client-side only

**Use Cases:**
- Fetch data based on route params
- Display dynamic content
- Navigate between related pages
- Build breadcrumbs
- Share URLs

**Return Types:**
- Single segment: `{ slug: "value" }`
- Multiple segments: `{ category: "value", id: "123" }`
- Catch-all: `{ slug: ["a", "b", "c"] }`

---

#### [useSearchParams](/reference/hooks/use-search-params.md)

Access and manipulate URL query string parameters.

```typescript
'use client';

import { useSearchParams } from 'veryfront';

// URL: /search?q=veryfront&page=2
const searchParams = useSearchParams();
const query = searchParams.get('q');    // "veryfront"
const page = searchParams.get('page');  // "2"
```

**Key Features:**
- Web standard URLSearchParams API
- Read-only access
- Automatic URI decoding
- Multiple values support
- Reactive to URL changes

**Use Cases:**
- Search functionality
- Filters and sorting
- Pagination
- Tab navigation
- Analytics parameters (UTM)

**Methods:**
- `get(key)` - Get single value
- `getAll(key)` - Get all values
- `has(key)` - Check if exists
- `toString()` - Convert to query string

---

## Hook Patterns

### Navigation Pattern

```typescript
'use client';

import { useRouter, usePathname } from 'veryfront';

export default function Navigation() {
  const router = useRouter();
  const pathname = usePathname();

  const navigate = (path: string) => {
    if (pathname !== path) {
      router.push(path);
    }
  };

  return (
    <nav>
      <button
        onClick={() => navigate('/home')}
        className={pathname === '/home' ? 'active' : ''}
      >
        Home
      </button>
    </nav>
  );
}
```

### Search and Filter Pattern

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentQuery = searchParams.get('q') || '';
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  const handleSearch = (query: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (query) {
      params.set('q', query);
      params.set('page', '1');  // Reset to page 1
    } else {
      params.delete('q');
      params.delete('page');
    }

    router.push(`/search?${params.toString()}`);
  };

  const handlePageChange = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`?${params.toString()}`);
  };

  return (
    <div>
      <input
        defaultValue={currentQuery}
        onBlur={(e) => handleSearch(e.target.value)}
      />
      <button onClick={() => handlePageChange(currentPage + 1)}>
        Next Page
      </button>
    </div>
  );
}
```

### Dynamic Route Navigation Pattern

```typescript
'use client';

import { useParams, useRouter } from 'veryfront';

// Route: /products/[category]/[id]
export default function ProductNavigation() {
  const router = useRouter();
  const params = useParams();

  const goToCategory = () => {
    router.push(`/products/${params.category}`);
  };

  const goToNext = () => {
    const nextId = parseInt(params.id as string, 10) + 1;
    router.push(`/products/${params.category}/${nextId}`);
  };

  return (
    <div>
      <button onClick={goToCategory}>
        Back to Category
      </button>
      <button onClick={goToNext}>
        Next Product
      </button>
    </div>
  );
}
```

### Active Link Pattern

```typescript
'use client';

import { usePathname } from 'veryfront';
import { Link } from 'veryfront';

export default function NavLink({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive =
    href === '/'
      ? pathname === href
      : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={isActive ? 'active' : ''}
    >
      {children}
    </Link>
  );
}
```

## Client Component Requirement

All hooks require the `'use client'` directive in App Router:

```typescript
'use client';  // Required!

import { useRouter } from 'veryfront';

export default function Component() {
  const router = useRouter();
  // Hook usage here
}
```

### Why 'use client'?

Hooks are client-side only because they:
- Access browser APIs (History API, URL API)
- Need JavaScript for interactivity
- React to client-side state changes
- Cannot run during server-side rendering

## Server vs Client Data Access

### Server Components (Preferred)

```typescript
// No hooks needed - use props
export default function Page({
  params,
  searchParams
}: {
  params: { slug: string };
  searchParams: { page?: string };
}) {
  return (
    <div>
      <h1>Post: {params.slug}</h1>
      <p>Page: {searchParams.page}</p>
    </div>
  );
}
```

### Client Components

```typescript
'use client';

import { useParams, useSearchParams } from 'veryfront';

export default function Page() {
  const params = useParams();
  const searchParams = useSearchParams();

  return (
    <div>
      <h1>Post: {params.slug}</h1>
      <p>Page: {searchParams.get('page')}</p>
    </div>
  );
}
```

## TypeScript Support

All hooks are fully typed:

```typescript
'use client';

import { useParams, useSearchParams } from 'veryfront';

// Type your params
interface RouteParams {
  category: string;
  id: string;
}

export default function Component() {
  const params = useParams() as RouteParams;
  // params.category and params.id are typed

  const searchParams = useSearchParams();
  // searchParams is URLSearchParams type
}
```

## Performance Considerations

### 1. Minimize Re-renders

```typescript
'use client';

import { usePathname } from 'veryfront';
import { memo } from 'react';

// Memoize component to prevent unnecessary re-renders
export default memo(function Navigation() {
  const pathname = usePathname();

  return (
    <nav>
      <Link href="/" className={pathname === '/' ? 'active' : ''}>
        Home
      </Link>
    </nav>
  );
});
```

### 2. Conditional Hook Usage

```typescript
'use client';

import { useRouter, useSearchParams } from 'veryfront';
import { useEffect } from 'react';

export default function Component({ needsRouter }: { needsRouter: boolean }) {
  // Only use hooks when needed
  const router = needsRouter ? useRouter() : null;
  const searchParams = useSearchParams();

  useEffect(() => {
    if (needsRouter && router) {
      // Use router
    }
  }, [needsRouter, router]);
}
```

### 3. Prefetch Routes

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Prefetch likely next pages
    router.prefetch('/products');
    router.prefetch('/about');
  }, [router]);

  return <div>Home Page</div>;
}
```

## Common Patterns

### Form Submission with Redirect

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function CreateForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await submitForm(formData);
      router.push(`/success/${result.id}`);
    } catch (error) {
      setIsSubmitting(false);
      // Handle error
    }
  };

  return <form onSubmit={handleSubmit}>...</form>;
}
```

### Paginated List

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function PaginatedList({ data, totalPages }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  const setPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`?${params.toString()}`);
  };

  return (
    <div>
      {data.map(item => <div key={item.id}>{item.title}</div>)}

      <div className="pagination">
        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
          <button
            key={page}
            onClick={() => setPage(page)}
            className={page === currentPage ? 'active' : ''}
          >
            {page}
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Breadcrumb Navigation

```typescript
'use client';

import { usePathname } from 'veryfront';
import { Link } from 'veryfront';

export default function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav aria-label="Breadcrumb">
      <ol>
        <li><Link href="/">Home</Link></li>
        {segments.map((segment, index) => {
          const href = '/' + segments.slice(0, index + 1).join('/');
          const isLast = index === segments.length - 1;

          return (
            <li key={href}>
              {isLast ? (
                <span>{segment}</span>
              ) : (
                <Link href={href}>{segment}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

## Related Documentation

- [Components Reference](/reference/components/) - React components
- [Functions Reference](/reference/functions/) - Server-side functions
- [Routing Guide](/routing/) - File-based routing
- [Data Fetching Guide](/data-fetching/) - Data loading patterns

## Examples

- [Navigation Example](/examples/navigation/)
- [Search with Filters](/examples/search-filters/)
- [Multi-Step Form](/examples/multi-step-form/)
- [Pagination Example](/examples/pagination/)
