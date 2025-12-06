---
title: useSearchParams Hook
description: Read and update URL query parameters with the useSearchParams hook in Veryfront
keywords:
  - useSearchParams
  - query parameters
  - URL params
  - search params
  - query string
  - URL state
related:
  - /docs/hooks/use-router.md
  - /docs/hooks/use-pathname.md
  - /docs/hooks/use-params.md
  - /docs/components/link.md
---

# useSearchParams Hook

The `useSearchParams` hook provides access to the current URL's query string parameters. Use it to read search params like `?q=react&sort=popular` and update them programmatically in Client Components.

## Overview

- **Read Query Params**: Access URL search parameters
- **Update Params**: Set, add, or remove parameters
- **URLSearchParams API**: Standard Web API interface
- **Client Component Only**: Must be used in Client Components
- **Type-Safe**: Full TypeScript support

## Basic Usage

```tsx
'use client';

import { useSearchParams } from 'veryfront';

// URL: /search?q=react&sort=popular
export default function SearchPage() {
  const searchParams = useSearchParams();

  const query = searchParams.get('q'); // "react"
  const sort = searchParams.get('sort'); // "popular"

  return (
    <div>
      <p>Query: {query}</p>
      <p>Sort: {sort}</p>
    </div>
  );
}
```

## Reading Search Params

### Single Parameter

```tsx
'use client';

import { useSearchParams } from 'veryfront';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q');

  return <div>Searching for: {query || 'all'}</div>;
}

// URL: /search?q=react
// query: "react"

// URL: /search
// query: null
```

### Multiple Parameters

```tsx
'use client';

import { useSearchParams } from 'veryfront';

export default function ProductsPage() {
  const searchParams = useSearchParams();

  const category = searchParams.get('category');
  const minPrice = searchParams.get('minPrice');
  const maxPrice = searchParams.get('maxPrice');
  const sort = searchParams.get('sort');

  return (
    <div>
      <p>Category: {category}</p>
      <p>Price Range: ${minPrice} - ${maxPrice}</p>
      <p>Sort: {sort}</p>
    </div>
  );
}

// URL: /products?category=electronics&minPrice=100&maxPrice=500&sort=price-asc
```

### Check Parameter Existence

```tsx
'use client';

import { useSearchParams } from 'veryfront';

export default function FilteredPage() {
  const searchParams = useSearchParams();

  const hasQuery = searchParams.has('q');
  const hasFilter = searchParams.has('filter');

  return (
    <div>
      {hasQuery && <p>Search active</p>}
      {hasFilter && <p>Filters applied</p>}
    </div>
  );
}
```

## Updating Search Params

### With useRouter

```tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'veryfront';

export default function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSearch = (query: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (query) {
      params.set('q', query);
    } else {
      params.delete('q');
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <input
      type="search"
      defaultValue={searchParams.get('q') || ''}
      onChange={(e) => handleSearch(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

### Update Multiple Params

```tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'veryfront';

export default function FilterControls() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateFilters = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div>
      <select onChange={(e) => updateFilters({ category: e.target.value })}>
        <option value="">All Categories</option>
        <option value="electronics">Electronics</option>
        <option value="clothing">Clothing</option>
      </select>

      <select onChange={(e) => updateFilters({ sort: e.target.value })}>
        <option value="">Default</option>
        <option value="price-asc">Price: Low to High</option>
        <option value="price-desc">Price: High to Low</option>
      </select>
    </div>
  );
}
```

## URLSearchParams Methods

### get(name)

```tsx
const query = searchParams.get('q'); // "react" or null
```

### getAll(name)

```tsx
// URL: /search?tags=react&tags=typescript&tags=deno
const tags = searchParams.getAll('tags'); // ["react", "typescript", "deno"]
```

### has(name)

```tsx
const hasQuery = searchParams.has('q'); // true or false
```

### toString()

```tsx
const queryString = searchParams.toString(); // "q=react&sort=popular"
```

### entries()

```tsx
for (const [key, value] of searchParams.entries()) {
  console.log(key, value);
}
```

## Real-World Examples

### Search with Filters

```tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'veryfront';
import { useState, useEffect } from 'react';

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
}

export default function ProductsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Read current filters
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const minPrice = searchParams.get('minPrice') || '';
  const maxPrice = searchParams.get('maxPrice') || '';
  const sort = searchParams.get('sort') || 'popular';

  // Fetch products when params change
  useEffect(() => {
    async function fetchProducts() {
      setLoading(true);

      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (category) params.append('category', category);
      if (minPrice) params.append('minPrice', minPrice);
      if (maxPrice) params.append('maxPrice', maxPrice);
      params.append('sort', sort);

      const res = await fetch(`/api/products?${params.toString()}`);
      const data = await res.json();

      setProducts(data);
      setLoading(false);
    }

    fetchProducts();
  }, [query, category, minPrice, maxPrice, sort]);

  // Update URL params
  const updateParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }

    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="products-page">
      <aside className="filters">
        <input
          type="search"
          value={query}
          onChange={(e) => updateParam('q', e.target.value)}
          placeholder="Search products..."
        />

        <select
          value={category}
          onChange={(e) => updateParam('category', e.target.value)}
        >
          <option value="">All Categories</option>
          <option value="electronics">Electronics</option>
          <option value="clothing">Clothing</option>
          <option value="books">Books</option>
        </select>

        <div className="price-range">
          <input
            type="number"
            value={minPrice}
            onChange={(e) => updateParam('minPrice', e.target.value)}
            placeholder="Min price"
          />
          <input
            type="number"
            value={maxPrice}
            onChange={(e) => updateParam('maxPrice', e.target.value)}
            placeholder="Max price"
          />
        </div>

        <select value={sort} onChange={(e) => updateParam('sort', e.target.value)}>
          <option value="popular">Most Popular</option>
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="newest">Newest First</option>
        </select>
      </aside>

      <main className="products-grid">
        {loading ? (
          <div>Loading products...</div>
        ) : (
          products.map(product => (
            <ProductCard key={product.id} product={product} />
          ))
        )}
      </main>
    </div>
  );
}
```

### Pagination

```tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'veryfront';

interface PaginationProps {
  totalPages: number;
}

export function Pagination({ totalPages }: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPage = Number(searchParams.get('page')) || 1;

  const goToPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', page.toString());
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="pagination">
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
      >
        Previous
      </button>

      {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
        <button
          key={page}
          onClick={() => goToPage(page)}
          className={page === currentPage ? 'active' : ''}
        >
          {page}
        </button>
      ))}

      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
      >
        Next
      </button>
    </div>
  );
}
```

### Tab Navigation with Params

```tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'veryfront';

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'specs', label: 'Specifications' },
];

export function TabNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab = searchParams.get('tab') || 'overview';

  const setTab = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div>
      <div className="tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={activeTab === tab.id ? 'active' : ''}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'reviews' && <ReviewsTab />}
        {activeTab === 'specs' && <SpecsTab />}
      </div>
    </div>
  );
}
```

## TypeScript Support

### Type-Safe Param Reading

```tsx
'use client';

import { useSearchParams } from 'veryfront';

type SortOption = 'popular' | 'price-asc' | 'price-desc' | 'newest';

function isSortOption(value: string | null): value is SortOption {
  return ['popular', 'price-asc', 'price-desc', 'newest'].includes(value || '');
}

export default function SortedList() {
  const searchParams = useSearchParams();
  const sortParam = searchParams.get('sort');
  const sort: SortOption = isSortOption(sortParam) ? sortParam : 'popular';

  return <div>Sorting by: {sort}</div>;
}
```

### Reusable Hook

```tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'veryfront';
import { useCallback } from 'react';

export function useQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setQueryParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const setQueryParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      });

      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  return {
    searchParams,
    setQueryParam,
    setQueryParams,
  };
}

// Usage:
export default function FilteredPage() {
  const { searchParams, setQueryParam } = useQueryParams();

  const category = searchParams.get('category');

  return (
    <select value={category || ''} onChange={(e) => setQueryParam('category', e.target.value)}>
      <option value="">All</option>
      <option value="electronics">Electronics</option>
    </select>
  );
}
```

## Best Practices

### 1. Preserve Existing Params

```tsx
// ❌ Bad: Overwrites all params
router.push(`${pathname}?q=${query}`);

// ✅ Good: Preserves existing params
const params = new URLSearchParams(searchParams.toString());
params.set('q', query);
router.push(`${pathname}?${params.toString()}`);
```

### 2. Remove Empty Values

```tsx
// ❌ Bad: Adds empty params to URL
params.set('q', ''); // ?q=

// ✅ Good: Remove empty params
if (query) {
  params.set('q', query);
} else {
  params.delete('q');
}
```

### 3. Debounce Search Input

```tsx
import { useDe bounce } from 'use-debounce';

export default function SearchInput() {
  const [value, setValue] = useState('');
  const [debouncedValue] = useDebounce(value, 300);

  useEffect(() => {
    // Update URL only after user stops typing
    updateSearchParam(debouncedValue);
  }, [debouncedValue]);

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
```

### 4. Handle Array Parameters

```tsx
// URL: /search?tags=react&tags=typescript

// ❌ Bad: Only gets first value
const tag = searchParams.get('tags'); // "react"

// ✅ Good: Gets all values
const tags = searchParams.getAll('tags'); // ["react", "typescript"]
```

## Common Patterns

### Clear All Filters

```tsx
'use client';

import { useRouter, usePathname } from 'veryfront';

export function ClearFiltersButton() {
  const router = useRouter();
  const pathname = usePathname();

  const clearFilters = () => {
    router.push(pathname); // Remove all params
  };

  return <button onClick={clearFilters}>Clear All Filters</button>;
}
```

### Active Filter Count

```tsx
'use client';

import { useSearchParams } from 'veryfront';

export function FilterCount() {
  const searchParams = useSearchParams();

  const filterKeys = ['category', 'minPrice', 'maxPrice', 'brand'];
  const activeFilters = filterKeys.filter(key => searchParams.has(key));

  return <span>({activeFilters.length} active)</span>;
}
```

## Return Value

The `useSearchParams` hook returns a `ReadonlyURLSearchParams` object with the following methods:

```tsx
interface ReadonlyURLSearchParams extends URLSearchParams {
  get(name: string): string | null;
  getAll(name: string): string[];
  has(name: string): boolean;
  toString(): string;
  entries(): IterableIterator<[string, string]>;
  // ... other URLSearchParams methods
}
```

## Server vs Client

```tsx
// ❌ Bad: Can't use in Server Components
export default function ServerComponent() {
  const searchParams = useSearchParams(); // Error!
  return <div>{searchParams.get('q')}</div>;
}

// ✅ Good: Use in Client Components
'use client';

export default function ClientComponent() {
  const searchParams = useSearchParams(); // Works!
  return <div>{searchParams.get('q')}</div>;
}

// ✅ Alternative: Access search params in Server Components via props
export default function ServerComponent({
  searchParams
}: {
  searchParams: { q?: string }
}) {
  return <div>{searchParams.q}</div>;
}
```

## Next Steps

- Learn about [useRouter hook](/reference/hooks/use-router.md) for programmatic navigation
- Explore [useParams hook](/reference/hooks/use-params.md) for route parameters
- Check out [usePathname hook](/reference/hooks/use-pathname.md) for current pathname
- Read about [Dynamic Routes](/guides/routing/dynamic-routes.md) for route patterns
