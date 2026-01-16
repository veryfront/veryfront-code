# Veryfront Component Patterns

Best practices for building React components in Veryfront applications.

## Component Structure

### File Organization

```
components/
├── ui/                     # Primitive UI components
│   ├── button.tsx
│   ├── input.tsx
│   └── card.tsx
├── forms/                  # Form components
│   ├── login-form.tsx
│   └── signup-form.tsx
├── layouts/                # Layout components
│   ├── header.tsx
│   └── footer.tsx
└── features/               # Feature-specific components
    ├── user-profile.tsx
    └── product-card.tsx
```

### Component File Structure

```tsx
// components/ui/button.tsx

// 1. Imports
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

// 2. Types
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

// 3. Component
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded font-medium',
          // Variant styles
          variant === 'primary' && 'bg-blue-600 text-white hover:bg-blue-700',
          variant === 'secondary' && 'bg-gray-200 text-gray-900 hover:bg-gray-300',
          variant === 'ghost' && 'bg-transparent hover:bg-gray-100',
          // Size styles
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-10 px-4',
          size === 'lg' && 'h-12 px-6 text-lg',
          // State styles
          loading && 'opacity-50 cursor-not-allowed',
          className
        )}
        disabled={loading || props.disabled}
        {...props}
      >
        {loading ? <Spinner className="mr-2" /> : null}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
```

## Server vs Client Components

### Server Components (Default)

```tsx
// app/users/page.tsx
// No 'use client' directive = Server Component

async function getUsers() {
  // Can access database directly
  const users = await db.users.findMany();
  return users;
}

export default async function UsersPage() {
  const users = await getUsers();

  return (
    <div>
      <h1>Users</h1>
      <UserList users={users} />
    </div>
  );
}
```

**When to use:**
- Data fetching
- Accessing backend resources
- Keeping sensitive data on server
- Reducing client bundle size

### Client Components

```tsx
// components/counter.tsx
'use client';

import { useState } from 'react';

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Increment
      </button>
    </div>
  );
}
```

**When to use:**
- useState, useEffect, useContext
- Event handlers (onClick, onChange)
- Browser APIs (localStorage, window)
- Interactive features

### Composition Pattern

```tsx
// app/dashboard/page.tsx (Server Component)
import { DashboardStats } from './dashboard-stats';  // Server
import { DashboardChart } from './dashboard-chart';  // Client

export default async function Dashboard() {
  const stats = await getStats();

  return (
    <div>
      {/* Server component with data */}
      <DashboardStats stats={stats} />

      {/* Client component for interactivity */}
      <DashboardChart initialData={stats.chartData} />
    </div>
  );
}
```

## Props Patterns

### Required vs Optional

```tsx
interface CardProps {
  // Required
  title: string;
  children: React.ReactNode;

  // Optional with defaults
  variant?: 'default' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({
  title,
  children,
  variant = 'default',
  padding = 'md',
}: CardProps) {
  // ...
}
```

### Compound Components

```tsx
// components/tabs.tsx
interface TabsContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({ children, defaultTab }: TabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children }: { children: React.ReactNode }) {
  return <div className="tab-list">{children}</div>;
}

export function Tab({ value, children }: TabProps) {
  const { activeTab, setActiveTab } = useContext(TabsContext)!;

  return (
    <button
      className={cn('tab', activeTab === value && 'active')}
      onClick={() => setActiveTab(value)}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value, children }: TabPanelProps) {
  const { activeTab } = useContext(TabsContext)!;
  if (activeTab !== value) return null;
  return <div className="tab-panel">{children}</div>;
}

// Usage
<Tabs defaultTab="overview">
  <TabList>
    <Tab value="overview">Overview</Tab>
    <Tab value="settings">Settings</Tab>
  </TabList>
  <TabPanel value="overview">Overview content</TabPanel>
  <TabPanel value="settings">Settings content</TabPanel>
</Tabs>
```

### Polymorphic Components

```tsx
type PolymorphicProps<E extends React.ElementType> = {
  as?: E;
  children: React.ReactNode;
} & React.ComponentPropsWithoutRef<E>;

export function Text<E extends React.ElementType = 'p'>({
  as,
  children,
  className,
  ...props
}: PolymorphicProps<E>) {
  const Component = as || 'p';

  return (
    <Component className={cn('text-base', className)} {...props}>
      {children}
    </Component>
  );
}

// Usage
<Text>Paragraph text</Text>
<Text as="span">Inline text</Text>
<Text as="h1" className="text-2xl">Heading</Text>
```

## State Management

### Local State

```tsx
'use client';

import { useState } from 'react';

export function SearchInput({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      <button type="submit">Search</button>
    </form>
  );
}
```

### Derived State

```tsx
'use client';

import { useMemo } from 'react';

export function FilteredList({ items, filter }: Props) {
  // Derive filtered list - don't store in state
  const filteredItems = useMemo(
    () => items.filter(item => item.name.includes(filter)),
    [items, filter]
  );

  return (
    <ul>
      {filteredItems.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
}
```

### URL State

```tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';

export function Filters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const category = searchParams.get('category') || 'all';

  const setCategory = (newCategory: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('category', newCategory);
    router.push(`?${params.toString()}`);
  };

  return (
    <select value={category} onChange={(e) => setCategory(e.target.value)}>
      <option value="all">All</option>
      <option value="electronics">Electronics</option>
      <option value="clothing">Clothing</option>
    </select>
  );
}
```

## Data Fetching

### Server Component Fetch

```tsx
// app/products/page.tsx
async function getProducts() {
  const res = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 }, // Cache for 60 seconds
  });
  return res.json();
}

export default async function ProductsPage() {
  const products = await getProducts();
  return <ProductGrid products={products} />;
}
```

### Client-side Fetch with SWR

```tsx
'use client';

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function UserProfile({ userId }: { userId: string }) {
  const { data, error, isLoading } = useSWR(
    `/api/users/${userId}`,
    fetcher
  );

  if (isLoading) return <Skeleton />;
  if (error) return <Error message={error.message} />;

  return (
    <div>
      <h2>{data.name}</h2>
      <p>{data.email}</p>
    </div>
  );
}
```

### Server Actions

```tsx
// app/actions.ts
'use server';

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string;
  const content = formData.get('content') as string;

  const post = await db.posts.create({ title, content });
  revalidatePath('/posts');

  return { success: true, id: post.id };
}

// components/post-form.tsx
'use client';

import { createPost } from '../app/actions';

export function PostForm() {
  return (
    <form action={createPost}>
      <input name="title" placeholder="Title" />
      <textarea name="content" placeholder="Content" />
      <button type="submit">Create Post</button>
    </form>
  );
}
```

## Error Handling

### Error Boundaries

```tsx
// app/dashboard/error.tsx
'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="error-container">
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

### Component-level Error Handling

```tsx
'use client';

import { useState } from 'react';

export function Form({ onSubmit }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && <div className="error">{error}</div>}
      {/* form fields */}
      <button type="submit" disabled={loading}>
        {loading ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
```

## Loading States

### Suspense Boundaries

```tsx
// app/dashboard/page.tsx
import { Suspense } from 'react';

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStats />
      </Suspense>
      <Suspense fallback={<ChartSkeleton />}>
        <RevenueChart />
      </Suspense>
    </div>
  );
}
```

### Loading Components

```tsx
// app/dashboard/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-32 bg-gray-200 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
```

## Accessibility

### Semantic HTML

```tsx
export function Navigation() {
  return (
    <nav aria-label="Main navigation">
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/products">Products</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  );
}
```

### ARIA Attributes

```tsx
export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-hidden={!isOpen}
    >
      <h2 id="modal-title">{title}</h2>
      <div>{children}</div>
      <button onClick={onClose} aria-label="Close modal">
        &times;
      </button>
    </div>
  );
}
```

### Keyboard Navigation

```tsx
'use client';

import { useRef, useEffect } from 'react';

export function Dropdown({ items, onSelect }: DropdownProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(i + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        onSelect(items[activeIndex]);
        break;
    }
  };

  return (
    <ul role="listbox" onKeyDown={handleKeyDown}>
      {items.map((item, index) => (
        <li
          key={item.id}
          role="option"
          aria-selected={index === activeIndex}
          onClick={() => onSelect(item)}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
```

## Performance

### Memoization

```tsx
'use client';

import { memo, useMemo, useCallback } from 'react';

// Memoize component
export const ExpensiveList = memo(function ExpensiveList({ items }: Props) {
  return (
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  );
});

// Memoize values and callbacks
export function Parent() {
  const [filter, setFilter] = useState('');

  const filteredItems = useMemo(
    () => items.filter(i => i.name.includes(filter)),
    [items, filter]
  );

  const handleSelect = useCallback((item: Item) => {
    // ...
  }, []);

  return <ExpensiveList items={filteredItems} onSelect={handleSelect} />;
}
```

### Code Splitting

```tsx
'use client';

import dynamic from 'next/dynamic';

// Lazy load heavy components
const HeavyChart = dynamic(() => import('./heavy-chart'), {
  loading: () => <ChartSkeleton />,
  ssr: false, // Client-only
});

export function Dashboard() {
  return (
    <div>
      <Stats />
      <HeavyChart data={chartData} />
    </div>
  );
}
```

## Best Practices Summary

1. **Default to Server Components** - Only use `'use client'` when needed
2. **Props over State** - Let parents control children when possible
3. **Composition over Inheritance** - Use children and render props
4. **Type Everything** - Define interfaces for all props
5. **Keep Components Small** - Extract when over 100 lines
6. **Colocate Related Code** - Keep styles/tests near components
7. **Test Behavior, not Implementation** - Focus on user interactions
8. **Accessible by Default** - Use semantic HTML, ARIA when needed
