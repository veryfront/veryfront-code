---
title: Link Component
description: Client-side navigation component for Veryfront applications
category: components
tags: [link, navigation, routing, prefetch, performance]
related:
  - routing/app-router
  - routing/pages-router
  - hooks/use-router
  - components/head
difficulty: beginner
---

# Link Component

The `Link` component enables client-side navigation between routes in your Veryfront application. It extends the standard HTML `<a>` element with prefetching, optimistic navigation, and automatic scroll management.

## Overview

Benefits of using `Link`:

- ✅ **Client-Side Navigation**: No full page reload
- ✅ **Automatic Prefetching**: Loads linked pages in the background
- ✅ **Scroll Management**: Automatic scroll to top on navigation
- ✅ **Active Link Detection**: Easily style active links
- ✅ **TypeScript Support**: Fully typed props
- ✅ **Accessibility**: Preserves semantic HTML

## Basic Usage

### Simple Link

```typescript
import { Link } from 'veryfront';

export default function Navigation() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/blog">Blog</Link>
      <Link href="/contact">Contact</Link>
    </nav>
  );
}
```

### Link with Dynamic Route

```typescript
import { Link } from 'veryfront';

export default function BlogList({ posts }: { posts: Post[] }) {
  return (
    <div>
      {posts.map(post => (
        <article key={post.id}>
          <Link href={`/blog/${post.slug}`}>
            <h2>{post.title}</h2>
          </Link>
          <p>{post.excerpt}</p>
        </article>
      ))}
    </div>
  );
}
```

## Props

### Required Props

#### `href`

The destination URL or path.

```typescript
// Absolute path
<Link href="/about">About</Link>

// Relative path
<Link href="../back">Go Back</Link>

// With query parameters
<Link href="/search?q=veryfront">Search</Link>

// With hash
<Link href="/docs#api">API Docs</Link>

// External URL (automatically uses <a> tag)
<Link href="https://example.com">External</Link>
```

### Optional Props

#### `prefetch`

Controls link prefetching behavior. Default: `true`

```typescript
// Prefetch enabled (default)
<Link href="/blog" prefetch={true}>
  Blog
</Link>

// Prefetch disabled
<Link href="/blog" prefetch={false}>
  Blog
</Link>

// Prefetch only on hover
<Link href="/blog" prefetch="hover">
  Blog
</Link>
```

**Prefetch Strategies:**

- `true`: Prefetch immediately when link enters viewport
- `false`: Never prefetch
- `"hover"`: Prefetch only when user hovers over link

#### `replace`

Replace current history entry instead of adding new one. Default: `false`

```typescript
// Normal navigation (adds to history)
<Link href="/login">Login</Link>

// Replace history entry (back button skips this page)
<Link href="/login" replace={true}>
  Login
</Link>
```

**Use Cases for `replace`:**
- Login redirects
- Form submission redirects
- Temporary pages
- Wizard/multi-step flows

#### `scroll`

Control scroll behavior after navigation. Default: `true`

```typescript
// Scroll to top after navigation (default)
<Link href="/page" scroll={true}>
  Next Page
</Link>

// Preserve scroll position
<Link href="/page" scroll={false}>
  Next Page
</Link>
```

#### `shallow`

Perform shallow routing (URL changes without re-running data fetching). Default: `false`

```typescript
// Full navigation with data fetching
<Link href="/posts?page=2">
  Next Page
</Link>

// Shallow routing (only URL changes)
<Link href="/posts?page=2" shallow={true}>
  Next Page
</Link>
```

**Note**: Shallow routing is primarily for Pages Router. App Router handles this automatically with React Server Components.

#### Standard HTML Attributes

All standard `<a>` attributes are supported:

```typescript
<Link
  href="/about"
  className="nav-link"
  id="about-link"
  target="_blank"     // Open in new tab
  rel="noopener"      // Security for external links
  title="About Us"
  aria-label="Navigate to About page"
>
  About
</Link>
```

## Prefetching Behavior

### Automatic Prefetching

Links are automatically prefetched when they enter the viewport:

```typescript
// These links prefetch automatically
export default function PostList() {
  return (
    <div>
      <Link href="/post-1">Post 1</Link>  {/* Prefetches when visible */}
      <Link href="/post-2">Post 2</Link>
      <Link href="/post-3">Post 3</Link>
    </div>
  );
}
```

### Manual Prefetch Control

```typescript
'use client';

import { Link, usePrefetch } from 'veryfront';
import { useEffect } from 'react';

export default function Navigation() {
  const prefetch = usePrefetch();

  useEffect(() => {
    // Prefetch important routes on mount
    prefetch('/dashboard');
    prefetch('/profile');
  }, [prefetch]);

  return (
    <nav>
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/profile">Profile</Link>
    </nav>
  );
}
```

### Disable Prefetching

```typescript
// Disable for heavy pages
<Link href="/large-report" prefetch={false}>
  Large Report
</Link>

// Disable for authenticated routes
<Link href="/admin" prefetch={false}>
  Admin Panel
</Link>

// Disable for dynamic content
<Link href="/live-feed" prefetch={false}>
  Live Feed
</Link>
```

## Active Link Styling

### Using `usePathname` Hook

```typescript
'use client';

import { Link, usePathname } from 'veryfront';

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav>
      <Link
        href="/"
        className={pathname === '/' ? 'active' : ''}
      >
        Home
      </Link>
      <Link
        href="/about"
        className={pathname === '/about' ? 'active' : ''}
      >
        About
      </Link>
      <Link
        href="/blog"
        className={pathname.startsWith('/blog') ? 'active' : ''}
      >
        Blog
      </Link>
    </nav>
  );
}
```

### Reusable ActiveLink Component

```typescript
'use client';

import { Link, usePathname } from 'veryfront';
import type { ComponentProps } from 'react';

type ActiveLinkProps = ComponentProps<typeof Link> & {
  activeClassName?: string;
  exact?: boolean;
};

export function ActiveLink({
  href,
  className = '',
  activeClassName = 'active',
  exact = false,
  children,
  ...props
}: ActiveLinkProps) {
  const pathname = usePathname();
  const hrefString = typeof href === 'string' ? href : href.pathname || '';

  const isActive = exact
    ? pathname === hrefString
    : pathname.startsWith(hrefString);

  const finalClassName = isActive
    ? `${className} ${activeClassName}`.trim()
    : className;

  return (
    <Link href={href} className={finalClassName} {...props}>
      {children}
    </Link>
  );
}

// Usage
<ActiveLink href="/" exact>Home</ActiveLink>
<ActiveLink href="/blog">Blog</ActiveLink>
<ActiveLink href="/about" activeClassName="is-active">
  About
</ActiveLink>
```

## Advanced Patterns

### Conditional Link Wrapper

Only wrap in Link if URL is internal:

```typescript
interface ConditionalLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
}

function ConditionalLink({ href, children, className }: ConditionalLinkProps) {
  const isExternal = href.startsWith('http') || href.startsWith('//');

  if (isExternal) {
    return (
      <a
        href={href}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// Usage
<ConditionalLink href="/about">About</ConditionalLink>
<ConditionalLink href="https://example.com">External</ConditionalLink>
```

### Link with Query Parameters

```typescript
import { Link } from 'veryfront';

export default function SearchResults() {
  const buildSearchUrl = (query: string, filters: Record<string, string>) => {
    const params = new URLSearchParams({ q: query, ...filters });
    return `/search?${params.toString()}`;
  };

  return (
    <div>
      <Link href={buildSearchUrl('veryfront', { category: 'docs' })}>
        Search Docs
      </Link>

      <Link href={buildSearchUrl('veryfront', { category: 'blog' })}>
        Search Blog
      </Link>
    </div>
  );
}
```

### Programmatic Navigation with Link State

```typescript
'use client';

import { Link } from 'veryfront';

export default function ProductCard({ product }: { product: Product }) {
  return (
    <Link
      href={`/products/${product.id}`}
      // Pass state to destination page
      state={{ fromList: true, product }}
    >
      <img src={product.image} alt={product.name} />
      <h3>{product.name}</h3>
      <p>${product.price}</p>
    </Link>
  );
}

// Access state in destination page
'use client';

import { useRouter } from 'veryfront';
import { useEffect } from 'react';

export default function ProductPage() {
  const router = useRouter();

  useEffect(() => {
    // Access navigation state
    const state = router.state;
    if (state?.fromList) {
      console.log('Navigated from product list', state.product);
    }
  }, [router]);

  return <div>Product Details</div>;
}
```

### Link with Loading State

```typescript
'use client';

import { Link } from 'veryfront';
import { useState, useTransition } from 'react';
import { useRouter } from 'veryfront';

export function NavigationLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    startTransition(() => {
      router.push(href);
    });
  };

  return (
    <Link href={href} onClick={handleClick}>
      {isPending ? 'Loading...' : children}
    </Link>
  );
}
```

### Nested Links (Icon + Text)

```typescript
import { Link } from 'veryfront';

export default function PostCard({ post }: { post: Post }) {
  return (
    <article className="post-card">
      <Link href={`/blog/${post.slug}`}>
        <img src={post.coverImage} alt={post.title} />
        <h2>{post.title}</h2>
        <p>{post.excerpt}</p>
      </Link>

      <div className="post-meta">
        <Link href={`/author/${post.author.id}`}>
          {post.author.name}
        </Link>
        <span>{post.publishedAt}</span>
      </div>
    </article>
  );
}
```

**Note**: Nested links are not semantically correct HTML. Consider using `<a>` tags with `onClick` handlers or restructure your component.

## Performance Optimization

### Lazy Load Links

```typescript
import { lazy, Suspense } from 'react';
import { Link } from 'veryfront';

// Only load heavy component when link is clicked
const HeavyComponent = lazy(() => import('./HeavyComponent'));

export default function Page() {
  const [showHeavy, setShowHeavy] = useState(false);

  return (
    <div>
      <Link href="/page" onClick={() => setShowHeavy(true)}>
        Show Heavy Content
      </Link>

      {showHeavy && (
        <Suspense fallback={<div>Loading...</div>}>
          <HeavyComponent />
        </Suspense>
      )}
    </div>
  );
}
```

### Prefetch on Hover

```typescript
'use client';

import { Link, usePrefetch } from 'veryfront';

export default function SmartLink({ href, children }: { href: string; children: React.ReactNode }) {
  const prefetch = usePrefetch();

  return (
    <Link
      href={href}
      prefetch={false}  // Disable automatic prefetch
      onMouseEnter={() => prefetch(href)}  // Prefetch on hover
    >
      {children}
    </Link>
  );
}
```

### Batch Prefetch

```typescript
'use client';

import { Link, usePrefetch } from 'veryfront';
import { useEffect } from 'react';

export default function NavigationMenu({ links }: { links: string[] }) {
  const prefetch = usePrefetch();

  useEffect(() => {
    // Prefetch all menu links on mount
    links.forEach(link => prefetch(link));
  }, [links, prefetch]);

  return (
    <nav>
      {links.map(link => (
        <Link key={link} href={link} prefetch={false}>
          {link}
        </Link>
      ))}
    </nav>
  );
}
```

## Accessibility

### ARIA Labels

```typescript
<Link
  href="/profile"
  aria-label="View your user profile"
>
  <UserIcon />
</Link>

<Link
  href="/search"
  aria-label="Search the site"
  title="Search"
>
  <SearchIcon />
</Link>
```

### Keyboard Navigation

```typescript
'use client';

import { Link } from 'veryfront';
import { useRef } from 'react';

export default function Menu() {
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      firstLinkRef.current?.focus();
    }
  };

  return (
    <nav onKeyDown={handleKeyDown}>
      <Link ref={firstLinkRef} href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/contact">Contact</Link>
    </nav>
  );
}
```

### Skip Links

```typescript
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Link
        href="#main-content"
        className="skip-link"
        style={{
          position: 'absolute',
          left: '-9999px',
          ':focus': { left: '0' }
        }}
      >
        Skip to main content
      </Link>

      <header>
        <Navigation />
      </header>

      <main id="main-content">
        {children}
      </main>
    </>
  );
}
```

## TypeScript

### Typed Href

```typescript
import { Link } from 'veryfront';
import type { Route } from 'veryfront';

// Define allowed routes
type AppRoute = '/' | '/about' | '/blog' | `/blog/${string}` | '/contact';

interface TypedLinkProps {
  href: AppRoute;
  children: React.ReactNode;
  className?: string;
}

function TypedLink({ href, children, className }: TypedLinkProps) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

// Usage
<TypedLink href="/">Home</TypedLink>
<TypedLink href="/blog/post-1">Post</TypedLink>
<TypedLink href="/invalid">Error!</TypedLink>  {/* TypeScript error */}
```

### Component Props Type

```typescript
import { Link } from 'veryfront';
import type { ComponentProps } from 'react';

type LinkProps = ComponentProps<typeof Link>;

function CustomLink(props: LinkProps) {
  return <Link {...props} />;
}

// Or extract specific props
type LinkHref = ComponentProps<typeof Link>['href'];
type LinkPrefetch = ComponentProps<typeof Link>['prefetch'];
```

## Comparison with HTML `<a>`

| Feature | `<Link>` | `<a>` |
|---------|----------|-------|
| **Client-side Navigation** | ✅ Yes | ❌ Full reload |
| **Prefetching** | ✅ Automatic | ❌ No |
| **Scroll Management** | ✅ Automatic | ❌ Manual |
| **History API** | ✅ Uses | ❌ Browser default |
| **Performance** | ⚡ Fast | 🐌 Slower |
| **External Links** | ⚠️ Use `<a>` | ✅ Native |
| **File Downloads** | ⚠️ Use `<a>` | ✅ Native |
| **Anchor Links** | ✅ Supported | ✅ Native |

**When to use `<a>` instead:**
- External URLs
- File downloads
- `mailto:` and `tel:` links
- Hash-only navigation within same page

## Best Practices

### 1. Use Link for Internal Navigation

```typescript
// ✅ Good: Internal navigation
<Link href="/about">About</Link>

// ❌ Bad: External URL with Link
<Link href="https://example.com">External</Link>

// ✅ Good: External URL with <a>
<a href="https://example.com" target="_blank" rel="noopener noreferrer">
  External
</a>
```

### 2. Prefetch Strategically

```typescript
// ✅ Good: Prefetch likely navigation
<Link href="/dashboard" prefetch={true}>Dashboard</Link>

// ✅ Good: Don't prefetch heavy pages
<Link href="/analytics-report" prefetch={false}>Report</Link>

// ✅ Good: Prefetch on hover for secondary nav
<Link href="/settings" prefetch="hover">Settings</Link>
```

### 3. Use Semantic HTML

```typescript
// ✅ Good: Link wraps entire card
<Link href="/post/1">
  <article>
    <h2>Post Title</h2>
    <p>Excerpt</p>
  </article>
</Link>

// ❌ Bad: Nested links
<article>
  <Link href="/post/1">
    <h2>Post Title</h2>
  </Link>
  <Link href="/author/1">Author</Link>  {/* Nested! */}
</article>
```

### 4. Handle External Links

```typescript
// ✅ Good: Automatic external link handling
function SmartLink({ href, children }: { href: string; children: React.ReactNode }) {
  const isExternal = href.startsWith('http');

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }

  return <Link href={href}>{children}</Link>;
}
```

## Common Issues

### Issue: Link Not Navigating

**Cause**: Missing `href` prop or invalid href

**Solution**:
```typescript
// ❌ Bad
<Link>Click Me</Link>

// ✅ Good
<Link href="/page">Click Me</Link>
```

### Issue: Full Page Reload

**Cause**: Using `<a>` instead of `<Link>`

**Solution**:
```typescript
// ❌ Bad: Full reload
<a href="/about">About</a>

// ✅ Good: Client-side navigation
<Link href="/about">About</Link>
```

### Issue: Prefetch Not Working

**Cause**: `prefetch={false}` or link not in viewport

**Solution**:
```typescript
// Check prefetch is enabled
<Link href="/page" prefetch={true}>Page</Link>

// Or manually prefetch
const prefetch = usePrefetch();
useEffect(() => {
  prefetch('/page');
}, [prefetch]);
```

## Quick Reference

```typescript
import { Link } from 'veryfront';

// Basic link
<Link href="/about">About</Link>

// With all props
<Link
  href="/page"
  prefetch={true}
  replace={false}
  scroll={true}
  shallow={false}
  className="nav-link"
>
  Navigate
</Link>

// External link (use <a>)
<a href="https://example.com" target="_blank" rel="noopener">
  External
</a>
```

## Related Documentation

- [App Router](/guides/routing/app-router.md) - Modern routing with RSC
- [Pages Router](/guides/routing/pages-router.md) - Traditional routing
- [useRouter Hook](../hooks/use-router.md) - Programmatic navigation
- [usePathname Hook](../hooks/use-pathname.md) - Current path detection

## Summary

The `Link` component is essential for Veryfront applications:

- ✅ **Client-side navigation** without full page reloads
- ✅ **Automatic prefetching** for instant page transitions
- ✅ **Scroll management** with configurable behavior
- ✅ **TypeScript support** for type-safe routing
- ✅ **Accessibility** with ARIA support
- ✅ **Performance optimized** with smart prefetching

Use `Link` for all internal navigation and `<a>` for external URLs, downloads, and special protocols.
