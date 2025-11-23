---
title: useSearchParams
description: React hook to access and manipulate URL query string parameters in client components
category: reference
type: hook
keywords: [search-params, query-params, url, hooks, client-side, useSearchParams]
related: [/reference/hooks/use-pathname.md, /reference/hooks/use-params.md, /reference/hooks/use-router.md]
---

# useSearchParams

React hook to access and manipulate URL query string parameters in client components. Provides a `URLSearchParams` object for reading query parameters.

## Syntax

```typescript
'use client';  // Required for App Router

import { useSearchParams } from 'veryfront';

const searchParams = useSearchParams();
```

## Parameters

The `useSearchParams` hook takes no parameters.

## Return Value

Returns a `URLSearchParams` object (read-only) containing the current URL query parameters.

```typescript
URLSearchParams
```

### URLSearchParams Methods

| Method | Parameters | Return Type | Description |
|--------|------------|-------------|-------------|
| get | key: string | string \| null | Get the value of a parameter |
| getAll | key: string | string[] | Get all values for a parameter |
| has | key: string | boolean | Check if parameter exists |
| keys | none | Iterator | Get all parameter keys |
| values | none | Iterator | Get all parameter values |
| entries | none | Iterator | Get all key-value pairs |
| toString | none | string | Convert to query string |

## Examples

### Basic Query Parameter Access

```typescript
'use client';

import { useSearchParams } from 'veryfront';

// URL: /search?q=veryfront&page=2
export default function SearchResults() {
  const searchParams = useSearchParams();

  const query = searchParams.get('q');      // "veryfront"
  const page = searchParams.get('page');    // "2"

  return (
    <div>
      <h1>Search: {query}</h1>
      <p>Page: {page}</p>
    </div>
  );
}
```

### With Default Values

```typescript
'use client';

import { useSearchParams } from 'veryfront';

export default function ProductList() {
  const searchParams = useSearchParams();

  const sort = searchParams.get('sort') || 'newest';
  const category = searchParams.get('category') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  return (
    <div>
      <p>Sort: {sort}</p>
      <p>Category: {category}</p>
      <p>Page: {page}</p>
    </div>
  );
}
```

### Check if Parameter Exists

```typescript
'use client';

import { useSearchParams } from 'veryfront';

export default function FilteredView() {
  const searchParams = useSearchParams();

  const hasFilter = searchParams.has('filter');
  const hasSort = searchParams.has('sort');

  return (
    <div>
      {hasFilter && <p>Filters applied</p>}
      {hasSort && <p>Custom sort order</p>}
    </div>
  );
}
```

### Multiple Values for Same Parameter

```typescript
'use client';

import { useSearchParams } from 'veryfront';

// URL: /products?tag=electronics&tag=sale&tag=featured
export default function ProductFilters() {
  const searchParams = useSearchParams();

  const tags = searchParams.getAll('tag');
  // ["electronics", "sale", "featured"]

  return (
    <div>
      <h2>Active Filters:</h2>
      <ul>
        {tags.map(tag => (
          <li key={tag}>{tag}</li>
        ))}
      </ul>
    </div>
  );
}
```

### Update Query Parameters

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function Pagination() {
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
      <button
        onClick={() => setPage(currentPage - 1)}
        disabled={currentPage === 1}
      >
        Previous
      </button>
      <span>Page {currentPage}</span>
      <button onClick={() => setPage(currentPage + 1)}>
        Next
      </button>
    </div>
  );
}
```

### Search Form with Query Params

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';
import { useState } from 'react';

export default function SearchForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const params = new URLSearchParams(searchParams.toString());

    if (query) {
      params.set('q', query);
    } else {
      params.delete('q');
    }

    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      <button type="submit">Search</button>
    </form>
  );
}
```

### Filter Controls

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function ProductFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    // Reset to page 1 when filters change
    params.delete('page');

    router.push(`?${params.toString()}`);
  };

  const category = searchParams.get('category') || '';
  const sort = searchParams.get('sort') || '';

  return (
    <div>
      <select
        value={category}
        onChange={(e) => updateFilter('category', e.target.value)}
      >
        <option value="">All Categories</option>
        <option value="electronics">Electronics</option>
        <option value="clothing">Clothing</option>
      </select>

      <select
        value={sort}
        onChange={(e) => updateFilter('sort', e.target.value)}
      >
        <option value="">Sort By</option>
        <option value="price-asc">Price: Low to High</option>
        <option value="price-desc">Price: High to Low</option>
      </select>
    </div>
  );
}
```

### Clear All Filters

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function ClearFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const hasFilters =
    searchParams.has('category') ||
    searchParams.has('sort') ||
    searchParams.has('filter');

  const clearFilters = () => {
    router.push(window.location.pathname);
  };

  if (!hasFilters) return null;

  return (
    <button onClick={clearFilters}>
      Clear All Filters
    </button>
  );
}
```

### Convert to Plain Object

```typescript
'use client';

import { useSearchParams } from 'veryfront';

export default function ParamsDebug() {
  const searchParams = useSearchParams();

  // Convert to plain object
  const paramsObject = Object.fromEntries(searchParams.entries());

  return (
    <pre>
      {JSON.stringify(paramsObject, null, 2)}
    </pre>
  );
}
```

### Toggle Parameter

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function ToggleSwitch() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isActive = searchParams.get('premium') === 'true';

  const toggle = () => {
    const params = new URLSearchParams(searchParams.toString());

    if (isActive) {
      params.delete('premium');
    } else {
      params.set('premium', 'true');
    }

    router.push(`?${params.toString()}`);
  };

  return (
    <button onClick={toggle}>
      {isActive ? 'Hide' : 'Show'} Premium Items
    </button>
  );
}
```

### Multi-Select Filters

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function MultiSelectFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedTags = searchParams.getAll('tag');

  const toggleTag = (tag: string) => {
    const params = new URLSearchParams();

    // Copy all existing params except 'tag'
    searchParams.forEach((value, key) => {
      if (key !== 'tag') {
        params.append(key, value);
      }
    });

    // Toggle the tag
    if (selectedTags.includes(tag)) {
      selectedTags
        .filter(t => t !== tag)
        .forEach(t => params.append('tag', t));
    } else {
      [...selectedTags, tag].forEach(t => params.append('tag', t));
    }

    router.push(`?${params.toString()}`);
  };

  const tags = ['electronics', 'sale', 'new', 'featured'];

  return (
    <div>
      {tags.map(tag => (
        <label key={tag}>
          <input
            type="checkbox"
            checked={selectedTags.includes(tag)}
            onChange={() => toggleTag(tag)}
          />
          {tag}
        </label>
      ))}
    </div>
  );
}
```

### Preserve Query Params on Navigation

```typescript
'use client';

import { useSearchParams } from 'veryfront';
import { Link } from 'veryfront';

export default function NavWithParams() {
  const searchParams = useSearchParams();

  const buildLink = (path: string) => {
    const params = searchParams.toString();
    return params ? `${path}?${params}` : path;
  };

  return (
    <nav>
      <Link href={buildLink('/products')}>Products</Link>
      <Link href={buildLink('/categories')}>Categories</Link>
    </nav>
  );
}
```

### Analytics Tracking

```typescript
'use client';

import { useSearchParams } from 'veryfront';
import { useEffect } from 'react';

export default function AnalyticsTracker() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // Track UTM parameters
    const source = searchParams.get('utm_source');
    const medium = searchParams.get('utm_medium');
    const campaign = searchParams.get('utm_campaign');

    if (source || medium || campaign) {
      // Send to analytics
      console.log('UTM Params:', { source, medium, campaign });
    }
  }, [searchParams]);

  return null;
}
```

### Decode URI Components

```typescript
'use client';

import { useSearchParams } from 'veryfront';

// URL: /search?q=hello%20world&filter=price%3A10-20
export default function SearchPage() {
  const searchParams = useSearchParams();

  // Automatically decoded
  const query = searchParams.get('q');      // "hello world"
  const filter = searchParams.get('filter'); // "price:10-20"

  return (
    <div>
      <p>Query: {query}</p>
      <p>Filter: {filter}</p>
    </div>
  );
}
```

### Share Current URL

```typescript
'use client';

import { useSearchParams } from 'veryfront';

export default function ShareButton() {
  const searchParams = useSearchParams();

  const handleShare = () => {
    const url = `${window.location.origin}${window.location.pathname}?${searchParams.toString()}`;

    navigator.clipboard.writeText(url);
    alert('Link copied!');
  };

  return (
    <button onClick={handleShare}>
      Share Current View
    </button>
  );
}
```

## Behavior

- **Client-side only**: The hook only works in client components (requires `'use client'` directive in App Router)
- **Read-only**: The returned object is read-only; use router.push to update
- **Automatic decoding**: Parameter values are automatically URI-decoded
- **Reactive**: Component re-renders when search params change
- **Web standard**: Uses standard `URLSearchParams` API

## Updating Search Params

To update search params, create a new `URLSearchParams` object and navigate:

```typescript
'use client';

import { useSearchParams, useRouter } from 'veryfront';

export default function UpdateParams() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParam = () => {
    // Create new URLSearchParams from existing
    const params = new URLSearchParams(searchParams.toString());

    // Modify params
    params.set('key', 'value');
    params.delete('oldKey');

    // Navigate with new params
    router.push(`?${params.toString()}`);
  };

  return <button onClick={updateParam}>Update</button>;
}
```

## App Router vs Pages Router

### App Router (Recommended)

```typescript
'use client';  // Required!

import { useSearchParams } from 'veryfront';

export default function Component() {
  const searchParams = useSearchParams();
  const value = searchParams.get('key');
}
```

### Pages Router

```typescript
// No 'use client' needed in Pages Router

import { useRouter } from 'veryfront';

export default function Component() {
  const router = useRouter();
  const value = router.query.key;
}
```

## Notes

- Must be used in client components (add `'use client'` directive in App Router)
- Cannot be used in server components (use `searchParams` prop instead)
- The returned object is read-only
- Use `router.push()` to update query parameters
- Values are automatically URL-decoded
- For server components, access search params via props
- Does not include route parameters (use `useParams` instead)

## Related

- [useParams](/reference/hooks/use-params.md) - Access route parameters
- [usePathname](/reference/hooks/use-pathname.md) - Get current pathname
- [useRouter](/reference/hooks/use-router.md) - Programmatic navigation
- [getServerData](/reference/functions/get-server-data.md) - Server-side query access
