---
title: useRouter Hook
description: Programmatically navigate between pages with the useRouter hook in Veryfront
keywords:
  - useRouter
  - programmatic navigation
  - router hook
  - push
  - replace
  - back
  - forward
  - refresh
  - client-side routing
related:
  - /docs/hooks/use-pathname.md
  - /docs/hooks/use-params.md
  - /docs/hooks/use-search-params.md
  - /docs/components/link.md
  - /guides/routing/app-router.md
---

# useRouter Hook

The `useRouter` hook provides programmatic navigation and router control in Client Components. Use it to navigate between pages, manipulate browser history, and refresh the current route.

## Overview

The useRouter hook provides:

- **Programmatic Navigation**: Navigate with `push()` and `replace()`
- **History Control**: Navigate back and forward through browser history
- **Route Refresh**: Refresh the current page data
- **Prefetching**: Prefetch routes programmatically
- **Client Component Only**: Must be used in Client Components
- **TypeScript Support**: Full type safety for all methods

## Basic Usage

### Importing

```tsx
'use client';

import { useRouter } from 'veryfront';
```

### Simple Navigation

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function HomePage() {
  const router = useRouter();

  return (
    <div>
      <h1>Home Page</h1>
      <button onClick={() => router.push('/about')}>
        Go to About
      </button>
    </div>
  );
}
```

## Methods

### push()

Navigate to a new route and add it to the browser history:

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function Navigation() {
  const router = useRouter();

  return (
    <div>
      <button onClick={() => router.push('/dashboard')}>
        Go to Dashboard
      </button>

      <button onClick={() => router.push('/products/123')}>
        View Product 123
      </button>

      <button onClick={() => router.push('/search?q=react')}>
        Search for React
      </button>
    </div>
  );
}
```

### replace()

Navigate to a new route and replace the current history entry:

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function LoginForm() {
  const router = useRouter();

  const handleLogin = async () => {
    // Perform login
    await loginUser();

    // Replace login page with dashboard (can't go back to login)
    router.replace('/dashboard');
  };

  return (
    <form onSubmit={handleLogin}>
      <button type="submit">Log In</button>
    </form>
  );
}
```

### back()

Navigate to the previous page in browser history:

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function ProductPage() {
  const router = useRouter();

  return (
    <div>
      <button onClick={() => router.back()}>
        ← Back
      </button>

      <h1>Product Details</h1>
    </div>
  );
}
```

### forward()

Navigate to the next page in browser history:

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function HistoryNavigation() {
  const router = useRouter();

  return (
    <div>
      <button onClick={() => router.back()}>
        ← Back
      </button>

      <button onClick={() => router.forward()}>
        Forward →
      </button>
    </div>
  );
}
```

### refresh()

Refresh the current route and re-fetch data:

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function DashboardPage() {
  const router = useRouter();

  return (
    <div>
      <h1>Dashboard</h1>

      <button onClick={() => router.refresh()}>
        Refresh Data
      </button>
    </div>
  );
}
```

### prefetch()

Prefetch a route for faster navigation:

```tsx
'use client';

import { useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    // Prefetch dashboard route
    router.prefetch('/dashboard');
  }, [router]);

  return (
    <div>
      <h1>Home</h1>
      <button onClick={() => router.push('/dashboard')}>
        Go to Dashboard (prefetched)
      </button>
    </div>
  );
}
```

## Common Patterns

### Form Submission Navigation

```tsx
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function CreatePostForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/posts', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });

      const post = await response.json();

      // Navigate to the new post
      router.push(`/posts/${post.id}`);
    } catch (error) {
      console.error('Failed to create post:', error);
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Post title"
      />
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating...' : 'Create Post'}
      </button>
    </form>
  );
}
```

### Conditional Navigation

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function ProtectedAction() {
  const router = useRouter();

  const handleAction = () => {
    const isAuthenticated = checkAuth();

    if (!isAuthenticated) {
      // Redirect to login
      router.push('/login?redirect=/protected');
      return;
    }

    // Proceed with action
    performAction();
  };

  return (
    <button onClick={handleAction}>
      Protected Action
    </button>
  );
}
```

### Search with Query Parameters

```tsx
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();

    if (query.trim()) {
      router.push(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <form onSubmit={handleSearch}>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search..."
      />
      <button type="submit">Search</button>
    </form>
  );
}
```

### Multi-Step Form Navigation

```tsx
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function MultiStepForm() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({});

  const handleNext = () => {
    // Update URL to reflect current step
    router.push(`/onboarding?step=${step + 1}`);
    setStep(step + 1);
  };

  const handleBack = () => {
    router.back();
    setStep(step - 1);
  };

  const handleSubmit = async () => {
    await submitForm(formData);
    router.replace('/dashboard'); // Replace to prevent going back to form
  };

  return (
    <div>
      <h2>Step {step} of 3</h2>

      {step === 1 && <StepOne onNext={handleNext} />}
      {step === 2 && <StepTwo onNext={handleNext} onBack={handleBack} />}
      {step === 3 && <StepThree onSubmit={handleSubmit} onBack={handleBack} />}
    </div>
  );
}
```

### Optimistic Navigation

```tsx
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function DeleteButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);

    try {
      await fetch(`/api/items/${itemId}`, { method: 'DELETE' });

      // Optimistically navigate away
      router.push('/items');

      // Refresh to update the list
      router.refresh();
    } catch (error) {
      console.error('Delete failed:', error);
      setIsDeleting(false);
    }
  };

  return (
    <button onClick={handleDelete} disabled={isDeleting}>
      {isDeleting ? 'Deleting...' : 'Delete'}
    </button>
  );
}
```

### Tab Navigation

```tsx
'use client';

import { useRouter, usePathname } from 'veryfront';

export default function TabNavigation() {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = [
    { id: 'overview', label: 'Overview', path: '/dashboard' },
    { id: 'analytics', label: 'Analytics', path: '/dashboard/analytics' },
    { id: 'settings', label: 'Settings', path: '/dashboard/settings' },
  ];

  return (
    <div className="tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => router.push(tab.path)}
          className={pathname === tab.path ? 'active' : ''}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

## TypeScript Support

### Typed Router Actions

```tsx
'use client';

import { useRouter } from 'veryfront';

interface NavigationProps {
  defaultRoute?: string;
  onNavigate?: (path: string) => void;
}

export function Navigation({ defaultRoute = '/', onNavigate }: NavigationProps) {
  const router = useRouter();

  const navigate = (path: string) => {
    onNavigate?.(path);
    router.push(path);
  };

  return (
    <nav>
      <button onClick={() => navigate('/home')}>Home</button>
      <button onClick={() => navigate('/about')}>About</button>
      <button onClick={() => navigate('/contact')}>Contact</button>
    </nav>
  );
}
```

### Route Builder Pattern

```tsx
'use client';

import { useRouter } from 'veryfront';

type RouteParams = {
  productId: string;
  variant?: string;
};

function buildProductUrl({ productId, variant }: RouteParams): string {
  const url = `/products/${productId}`;
  return variant ? `${url}?variant=${variant}` : url;
}

export function ProductNavigation() {
  const router = useRouter();

  const goToProduct = (params: RouteParams) => {
    const url = buildProductUrl(params);
    router.push(url);
  };

  return (
    <div>
      <button onClick={() => goToProduct({ productId: '123' })}>
        View Product
      </button>
      <button onClick={() => goToProduct({ productId: '123', variant: 'blue' })}>
        View Blue Variant
      </button>
    </div>
  );
}
```

## Best Practices

### 1. Use Link Component for Navigation

```tsx
// ❌ Bad: Using router for all navigation
<button onClick={() => router.push('/about')}>About</button>

// ✅ Good: Use Link component for standard navigation
<Link href="/about">About</Link>

// ✅ OK: Use router for conditional/programmatic navigation
<button onClick={handleSubmit}>Submit</button>
```

### 2. Handle Navigation Errors

```tsx
// ❌ Bad: No error handling
router.push('/dashboard');

// ✅ Good: Handle potential errors
try {
  await router.push('/dashboard');
} catch (error) {
  console.error('Navigation failed:', error);
}
```

### 3. Use replace() for Redirects

```tsx
// ❌ Bad: Using push() for post-action redirects
router.push('/success');  // User can go back to form

// ✅ Good: Use replace() to prevent going back
router.replace('/success');  // User can't go back to form
```

### 4. Prefetch Important Routes

```tsx
// ❌ Bad: No prefetching for likely navigation
<button onClick={() => router.push('/checkout')}>
  Checkout
</button>

// ✅ Good: Prefetch on mount or hover
useEffect(() => {
  router.prefetch('/checkout');
}, [router]);
```

### 5. Avoid Excessive Refreshes

```tsx
// ❌ Bad: Refreshing on every action
onClick={() => {
  doSomething();
  router.refresh();
}}

// ✅ Good: Only refresh when data changes
onClick={async () => {
  await updateData();
  router.refresh();  // Refresh to show new data
}}
```

## Comparison: push() vs replace()

| Method | Adds to History | Can Navigate Back | Use Case |
|--------|-----------------|-------------------|----------|
| `push()` | Yes | Yes | Normal navigation, page changes |
| `replace()` | No | No | Redirects, post-submission, authentication |

Example:

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function NavigationExamples() {
  const router = useRouter();

  return (
    <div>
      {/* push() - adds to history */}
      <button onClick={() => router.push('/products')}>
        View Products (can go back)
      </button>

      {/* replace() - replaces current entry */}
      <button onClick={() => router.replace('/products')}>
        View Products (can't go back)
      </button>
    </div>
  );
}
```

## Router Methods Reference

| Method | Parameters | Description |
|--------|------------|-------------|
| `push(href)` | `href: string` | Navigate to new route, add to history |
| `replace(href)` | `href: string` | Navigate to new route, replace history |
| `back()` | None | Navigate to previous page |
| `forward()` | None | Navigate to next page |
| `refresh()` | None | Refresh current route and re-fetch data |
| `prefetch(href)` | `href: string` | Prefetch route for faster navigation |

## Common Use Cases

### Authentication Redirect

```tsx
'use client';

import { useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function ProtectedPage() {
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const isAuth = await verifyAuth();

      if (!isAuth) {
        router.replace('/login');
      }
    };

    checkAuth();
  }, [router]);

  return <div>Protected Content</div>;
}
```

### After Payment Success

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function CheckoutForm() {
  const router = useRouter();

  const handlePayment = async () => {
    const result = await processPayment();

    if (result.success) {
      // Replace so user can't go back to checkout
      router.replace(`/order-confirmation/${result.orderId}`);
    }
  };

  return <button onClick={handlePayment}>Complete Purchase</button>;
}
```

### Cancel/Back Button

```tsx
'use client';

import { useRouter } from 'veryfront';

export default function EditForm() {
  const router = useRouter();

  const handleCancel = () => {
    // Go back to previous page
    router.back();
  };

  return (
    <form>
      <button type="button" onClick={handleCancel}>
        Cancel
      </button>
      <button type="submit">Save Changes</button>
    </form>
  );
}
```

## Next Steps

- Learn about [usePathname hook](/reference/hooks/use-pathname.md) for current path detection
- Explore [useParams hook](/reference/hooks/use-params.md) for route parameters
- Check out [useSearchParams hook](/reference/hooks/use-search-params.md) for query strings
- Read about [Link component](/reference/components/link.md) for declarative navigation
- Review [App Router](/guides/routing/app-router.md) for routing concepts
