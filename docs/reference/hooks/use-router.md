---
title: useRouter
description: Client-side navigation hook for programmatic routing in React components
category: reference
type: hook
keywords: [router, navigation, client-side, hooks, useRouter]
related: [/reference/components/link.md, /reference/hooks/use-pathname.md, /reference/hooks/use-params.md]
---

# useRouter

Client-side navigation hook for programmatic routing in React components. Provides methods to navigate, refresh, and manipulate browser history.

## Syntax

```typescript
'use client';  // Required for App Router

import { useRouter } from 'veryfront';

const router = useRouter();
```

## Parameters

The `useRouter` hook takes no parameters.

## Return Value

Returns a router object with the following methods:

```typescript
interface Router {
  push: (url: string) => void;
  replace: (url: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (url: string) => void;
}
```

### Router Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| push | url: string | Navigate to URL and add to history stack |
| replace | url: string | Navigate to URL and replace current history entry |
| back | none | Go back one entry in history |
| forward | none | Go forward one entry in history |
| refresh | none | Refresh the current page |
| prefetch | url: string | Prefetch a route for faster navigation |

## Examples

### Basic Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function Navigation() {
  const router = useRouter();

  const goToDashboard = () => {
    router.push('/dashboard');
  };

  return (
    <button onClick={goToDashboard}>
      Go to Dashboard
    </button>
  );
}
```

### Navigation with Replace

Replace the current history entry instead of adding a new one:

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function LoginSuccess() {
  const router = useRouter();

  const goToDashboard = () => {
    // Replace login page in history so back button doesn't return to login
    router.replace('/dashboard');
  };

  return (
    <div>
      <h1>Login Successful!</h1>
      <button onClick={goToDashboard}>
        Continue to Dashboard
      </button>
    </div>
  );
}
```

### Browser History Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function HistoryControls() {
  const router = useRouter();

  return (
    <div>
      <button onClick={() => router.back()}>
        Back
      </button>
      <button onClick={() => router.forward()}>
        Forward
      </button>
    </div>
  );
}
```

### Refresh Current Page

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function RefreshButton() {
  const router = useRouter();

  const handleRefresh = () => {
    router.refresh();
  };

  return (
    <button onClick={handleRefresh}>
      Refresh Page
    </button>
  );
}
```

### Prefetch Routes

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

  return (
    <div>
      <h1>Welcome</h1>
    </div>
  );
}
```

### Dynamic Route Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';

interface Product {
  id: string;
  name: string;
}

export default function ProductList({ products }: { products: Product[] }) {
  const router = useRouter();

  const viewProduct = (productId: string) => {
    router.push(`/products/${productId}`);
  };

  return (
    <div>
      {products.map(product => (
        <button
          key={product.id}
          onClick={() => viewProduct(product.id)}
        >
          {product.name}
        </button>
      ))}
    </div>
  );
}
```

### Navigation with Query Parameters

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function SearchForm() {
  const router = useRouter();

  const handleSearch = (query: string) => {
    const params = new URLSearchParams({ q: query, page: '1' });
    router.push(`/search?${params.toString()}`);
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      handleSearch(formData.get('query') as string);
    }}>
      <input name="query" type="text" placeholder="Search..." />
      <button type="submit">Search</button>
    </form>
  );
}
```

### Conditional Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function CheckoutButton() {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCheckout = async () => {
    setIsProcessing(true);

    try {
      const result = await processCheckout();

      if (result.success) {
        router.push('/order/confirmation');
      } else {
        router.push('/checkout/error');
      }
    } catch (error) {
      console.error('Checkout failed:', error);
      setIsProcessing(false);
    }
  };

  return (
    <button onClick={handleCheckout} disabled={isProcessing}>
      {isProcessing ? 'Processing...' : 'Proceed to Checkout'}
    </button>
  );
}
```

### Navigation After Form Submission

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useState } from 'react';

export default function CreatePostForm() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const response = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    });

    const post = await response.json();

    // Navigate to the new post
    router.push(`/posts/${post.id}`);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Content"
      />
      <button type="submit">Create Post</button>
    </form>
  );
}
```

### Multi-Step Form Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useSearchParams } from 'veryfront';

export default function MultiStepForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = parseInt(searchParams.get('step') || '1', 10);

  const nextStep = () => {
    router.push(`/signup?step=${step + 1}`);
  };

  const prevStep = () => {
    if (step > 1) {
      router.back();
    }
  };

  return (
    <div>
      <h1>Step {step} of 3</h1>
      {/* Form content */}
      <button onClick={prevStep} disabled={step === 1}>
        Previous
      </button>
      <button onClick={nextStep} disabled={step === 3}>
        Next
      </button>
    </div>
  );
}
```

### Navigation with Hash

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function TableOfContents() {
  const router = useRouter();

  const scrollToSection = (sectionId: string) => {
    router.push(`#${sectionId}`);
  };

  return (
    <nav>
      <button onClick={() => scrollToSection('introduction')}>
        Introduction
      </button>
      <button onClick={() => scrollToSection('features')}>
        Features
      </button>
      <button onClick={() => scrollToSection('pricing')}>
        Pricing
      </button>
    </nav>
  );
}
```

### Optimistic Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useTransition } from 'react';

export default function DeleteButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleDelete = async () => {
    // Optimistically navigate away
    router.push('/posts');

    // Then perform delete
    startTransition(async () => {
      await fetch(`/api/posts/${postId}`, { method: 'DELETE' });
      router.refresh();
    });
  };

  return (
    <button onClick={handleDelete} disabled={isPending}>
      {isPending ? 'Deleting...' : 'Delete'}
    </button>
  );
}
```

### Tab Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useSearchParams } from 'veryfront';

export default function ProfileTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';

  const setTab = (tab: string) => {
    router.push(`/profile?tab=${tab}`);
  };

  return (
    <div>
      <nav>
        <button
          onClick={() => setTab('overview')}
          className={activeTab === 'overview' ? 'active' : ''}
        >
          Overview
        </button>
        <button
          onClick={() => setTab('posts')}
          className={activeTab === 'posts' ? 'active' : ''}
        >
          Posts
        </button>
        <button
          onClick={() => setTab('settings')}
          className={activeTab === 'settings' ? 'active' : ''}
        >
          Settings
        </button>
      </nav>

      {/* Tab content */}
    </div>
  );
}
```

### External URL Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function ExternalLink() {
  const router = useRouter();

  const goToExternal = () => {
    // For external URLs, use window.location
    window.location.href = 'https://example.com';
    // Or open in new tab
    // window.open('https://example.com', '_blank');
  };

  return (
    <button onClick={goToExternal}>
      Visit External Site
    </button>
  );
}
```

### Navigation with Scroll Restoration

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function ProductDetail({ productId }: { productId: string }) {
  const router = useRouter();

  const goBack = () => {
    router.back();
    // Scroll position is automatically restored
  };

  return (
    <div>
      <button onClick={goBack}>
        Back to Products
      </button>
      {/* Product content */}
    </div>
  );
}
```

## Behavior

- **Client-side only**: The hook only works in client components (requires `'use client'` directive in App Router)
- **History API**: Uses the browser's History API for navigation
- **Shallow routing**: Navigation updates URL without full page reload
- **Automatic prefetching**: Routes are automatically prefetched when using `<Link>` or `prefetch()`
- **Scroll restoration**: Browser automatically handles scroll position restoration

## App Router vs Pages Router

### App Router (Recommended)

```typescript
'use client';  // Required!

import { useRouter } from 'veryfront';

export default function Component() {
  const router = useRouter();
  // router.push, router.replace, etc.
}
```

### Pages Router

```typescript
// No 'use client' needed in Pages Router

import { useRouter } from 'veryfront';

export default function Component() {
  const router = useRouter();
  // router.push, router.replace, etc.
}
```

## Notes

- Must be used in client components (add `'use client'` directive in App Router)
- Cannot be used in server components or during server-side rendering
- For declarative navigation, prefer the `<Link>` component
- The `push` method adds to browser history, `replace` does not
- Prefetching improves navigation performance but increases bandwidth usage
- Use `router.refresh()` to re-fetch data without losing client state

## Related

- [Link](/reference/components/link.md) - Declarative navigation component
- [usePathname](/reference/hooks/use-pathname.md) - Get current pathname
- [useParams](/reference/hooks/use-params.md) - Access route parameters
- [useSearchParams](/reference/hooks/use-search-params.md) - Access query parameters
- [redirect](/reference/functions/redirect.md) - Server-side redirects
