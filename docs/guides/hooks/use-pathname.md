---
title: usePathname Hook
description: Access the current URL pathname with the usePathname hook in Veryfront
keywords:
  - usePathname
  - current path
  - active route
  - pathname hook
  - navigation detection
  - active links
related:
  - /docs/hooks/use-router.md
  - /docs/hooks/use-params.md
  - /docs/hooks/use-search-params.md
  - /docs/components/link.md
---

# usePathname Hook

The `usePathname` hook returns the current URL's pathname in Client Components. Use it to detect the active route, style active links, or conditionally render content based on the current path.

## Overview

- **Current Pathname**: Returns the pathname portion of the URL
- **Read-Only**: For reading pathname only (use `useRouter` for navigation)
- **No Query/Hash**: Returns only the path (e.g., `/blog/post-1`)
- **Client Component Only**: Must be used in Client Components
- **TypeScript**: Returns `string` type

## Basic Usage

```tsx
'use client';

import { usePathname } from 'veryfront';

export default function CurrentPath() {
  const pathname = usePathname();

  return <div>Current path: {pathname}</div>;
}
```

## Active Link Detection

### Simple Active Link

```tsx
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
        className={pathname === '/blog' ? 'active' : ''}
      >
        Blog
      </Link>
    </nav>
  );
}
```

### Active Link with startsWith

```tsx
'use client';

import { Link, usePathname } from 'veryfront';

export default function Navigation() {
  const pathname = usePathname();

  return (
    <nav>
      <Link
        href="/blog"
        className={pathname.startsWith('/blog') ? 'active' : ''}
      >
        Blog
      </Link>

      <Link
        href="/docs"
        className={pathname.startsWith('/docs') ? 'active' : ''}
      >
        Documentation
      </Link>
    </nav>
  );
}
```

## Reusable Components

### ActiveLink Component

```tsx
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

// Usage:
export default function Nav() {
  return (
    <nav>
      <ActiveLink href="/" exact>Home</ActiveLink>
      <ActiveLink href="/blog">Blog</ActiveLink>
      <ActiveLink href="/docs">Docs</ActiveLink>
    </nav>
  );
}
```

### NavLink with Icon

```tsx
'use client';

import { Link, usePathname } from 'veryfront';

interface NavLinkProps {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

export function NavLink({ href, icon, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`nav-link ${isActive ? 'nav-link-active' : ''}`}
    >
      <span className={`icon ${isActive ? 'icon-active' : ''}`}>
        {icon}
      </span>
      <span>{children}</span>
    </Link>
  );
}
```

## Conditional Rendering

### Show Component Based on Route

```tsx
'use client';

import { usePathname } from 'veryfront';

export default function AdminToolbar() {
  const pathname = usePathname();

  if (!pathname.startsWith('/admin')) {
    return null;
  }

  return (
    <div className="admin-toolbar">
      <button>Edit Page</button>
      <button>View Analytics</button>
    </div>
  );
}
```

### Route-Specific Sidebar

```tsx
'use client';

import { usePathname } from 'veryfront';

export default function Sidebar() {
  const pathname = usePathname();

  const renderSidebarContent = () => {
    if (pathname.startsWith('/blog')) {
      return <BlogSidebar />;
    }

    if (pathname.startsWith('/docs')) {
      return <DocsSidebar />;
    }

    if (pathname.startsWith('/products')) {
      return <ProductFilters />;
    }

    return <DefaultSidebar />;
  };

  return (
    <aside className="sidebar">
      {renderSidebarContent()}
    </aside>
  );
}
```

## Breadcrumbs

### Dynamic Breadcrumbs

```tsx
'use client';

import { Link, usePathname } from 'veryfront';

export function Breadcrumbs() {
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        <li>
          <Link href="/">Home</Link>
        </li>

        {segments.map((segment, index) => {
          const href = '/' + segments.slice(0, index + 1).join('/');
          const isLast = index === segments.length - 1;
          const label = segment.replace(/-/g, ' ');

          return (
            <li key={href}>
              {isLast ? (
                <span>{label}</span>
              ) : (
                <Link href={href}>{label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

### Breadcrumbs with Titles

```tsx
'use client';

import { Link, usePathname } from 'veryfront';

const routeTitles: Record<string, string> = {
  '/blog': 'Blog',
  '/blog/posts': 'All Posts',
  '/docs': 'Documentation',
  '/docs/guides': 'Guides',
  '/products': 'Products',
};

export function Breadcrumbs() {
  const pathname = usePathname();

  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav>
      <ol className="breadcrumb">
        <li><Link href="/">Home</Link></li>

        {segments.map((_, index) => {
          const path = '/' + segments.slice(0, index + 1).join('/');
          const title = routeTitles[path] || segments[index];
          const isLast = index === segments.length - 1;

          return (
            <li key={path}>
              {isLast ? (
                <span>{title}</span>
              ) : (
                <Link href={path}>{title}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

## Analytics and Tracking

### Page View Tracking

```tsx
'use client';

import { usePathname } from 'veryfront';
import { useEffect } from 'react';

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    // Track page view
    if (typeof window.gtag !== 'undefined') {
      window.gtag('config', 'GA-XXXXXXX', {
        page_path: pathname,
      });
    }
  }, [pathname]);

  return null;
}
```

### Route Change Logging

```tsx
'use client';

import { usePathname } from 'veryfront';
import { useEffect } from 'react';

export function RouteLogger() {
  const pathname = usePathname();

  useEffect(() => {
    console.log('Route changed:', pathname);

    // Send to analytics service
    fetch('/api/analytics', {
      method: 'POST',
      body: JSON.stringify({
        event: 'page_view',
        path: pathname,
        timestamp: Date.now(),
      }),
    });
  }, [pathname]);

  return null;
}
```

## Layout Variations

### Different Headers by Section

```tsx
'use client';

import { usePathname } from 'veryfront';

export default function Header() {
  const pathname = usePathname();

  if (pathname.startsWith('/admin')) {
    return <AdminHeader />;
  }

  if (pathname.startsWith('/dashboard')) {
    return <DashboardHeader />;
  }

  return <PublicHeader />;
}
```

### Conditional Footer

```tsx
'use client';

import { usePathname } from 'veryfront';

export default function Footer() {
  const pathname = usePathname();

  // Hide footer on checkout pages
  if (pathname.startsWith('/checkout')) {
    return null;
  }

  // Minimal footer for auth pages
  if (pathname.startsWith('/login') || pathname.startsWith('/signup')) {
    return <MinimalFooter />;
  }

  return <FullFooter />;
}
```

## TypeScript Patterns

### Type-Safe Route Detection

```tsx
'use client';

import { usePathname } from 'veryfront';

const ROUTES = {
  HOME: '/',
  BLOG: '/blog',
  DOCS: '/docs',
  PRODUCTS: '/products',
} as const;

type Route = typeof ROUTES[keyof typeof ROUTES];

function isRoute(pathname: string, route: Route): boolean {
  return pathname.startsWith(route);
}

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav>
      <Link
        href={ROUTES.HOME}
        className={isRoute(pathname, ROUTES.HOME) ? 'active' : ''}
      >
        Home
      </Link>

      <Link
        href={ROUTES.BLOG}
        className={isRoute(pathname, ROUTES.BLOG) ? 'active' : ''}
      >
        Blog
      </Link>
    </nav>
  );
}
```

### Typed Pathname Hook

```tsx
'use client';

import { usePathname } from 'veryfront';

type Section = 'home' | 'blog' | 'docs' | 'products' | 'unknown';

export function useCurrentSection(): Section {
  const pathname = usePathname();

  if (pathname === '/') return 'home';
  if (pathname.startsWith('/blog')) return 'blog';
  if (pathname.startsWith('/docs')) return 'docs';
  if (pathname.startsWith('/products')) return 'products';

  return 'unknown';
}

// Usage:
export function SectionIndicator() {
  const section = useCurrentSection();

  return <div>Current section: {section}</div>;
}
```

## Best Practices

### 1. Use Exact Matching for Root

```tsx
// ❌ Bad: Root matches all paths
const isActive = pathname.startsWith('/');

// ✅ Good: Exact match for root
const isActive = pathname === '/';
```

### 2. Handle Trailing Slashes

```tsx
// ❌ Bad: Won't match '/blog/'
const isActive = pathname === '/blog';

// ✅ Good: Normalize pathname
const normalizedPath = pathname.replace(/\/$/, '');
const isActive = normalizedPath === '/blog';
```

### 3. Avoid Excessive Re-renders

```tsx
// ❌ Bad: Creates new function on every render
<Link className={pathname === '/blog' ? 'active' : ''} />

// ✅ Good: Memoize if needed
const isActive = useMemo(() => pathname === '/blog', [pathname]);
```

## Common Patterns

### Tab Navigation

```tsx
'use client';

import { usePathname, useRouter } from 'veryfront';

const tabs = [
  { id: 'overview', label: 'Overview', path: '/dashboard' },
  { id: 'analytics', label: 'Analytics', path: '/dashboard/analytics' },
  { id: 'settings', label: 'Settings', path: '/dashboard/settings' },
];

export function TabNavigation() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <div className="tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => router.push(tab.path)}
          className={pathname === tab.path ? 'tab-active' : 'tab'}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

### Section-Based Styling

```tsx
'use client';

import { usePathname } from 'veryfront';

export default function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const getSectionClass = () => {
    if (pathname.startsWith('/blog')) return 'theme-blog';
    if (pathname.startsWith('/docs')) return 'theme-docs';
    if (pathname.startsWith('/products')) return 'theme-products';
    return 'theme-default';
  };

  return (
    <div className={`layout ${getSectionClass()}`}>
      {children}
    </div>
  );
}
```

## Return Value

The `usePathname` hook returns a `string` representing the current pathname:

```tsx
const pathname = usePathname(); // Returns: "/blog/posts/hello-world"
```

**Important Notes:**
- Returns the pathname only (no query string or hash)
- Always starts with `/`
- Does not include trailing slash (normalized)
- Returns `null` during Server-Side Rendering

## Server vs Client

```tsx
// ❌ Bad: Can't use in Server Components
export default function ServerComponent() {
  const pathname = usePathname(); // Error!
  return <div>{pathname}</div>;
}

// ✅ Good: Use in Client Components
'use client';

export default function ClientComponent() {
  const pathname = usePathname(); // Works!
  return <div>{pathname}</div>;
}
```

## Next Steps

- Learn about [useRouter hook](/docs/hooks/use-router.md) for programmatic navigation
- Explore [useParams hook](/docs/hooks/use-params.md) for route parameters
- Check out [useSearchParams hook](/docs/hooks/use-search-params.md) for query strings
- Read about [Link component](/docs/components/link.md) for declarative navigation
