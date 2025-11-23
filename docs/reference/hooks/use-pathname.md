---
title: usePathname
description: React hook to get the current pathname in client components
category: reference
type: hook
keywords: [pathname, routing, hooks, client-side, usePathname]
related: [/reference/hooks/use-router.md, /reference/hooks/use-params.md, /reference/hooks/use-search-params.md]
---

# usePathname

React hook to get the current pathname in client components. Useful for highlighting active navigation links and conditional rendering based on the current route.

## Syntax

```typescript
'use client';  // Required for App Router

import { usePathname } from 'veryfront';

const pathname = usePathname();
```

## Parameters

The `usePathname` hook takes no parameters.

## Return Value

Returns the current pathname as a string.

```typescript
string  // e.g., "/blog/my-post" or "/products/123"
```

## Examples

### Active Link Highlighting

```typescript
'use client';

import { usePathname } from 'veryfront';
import { Link } from 'veryfront';

export default function Navigation() {
  const pathname = usePathname();

  const links = [
    { href: '/', label: 'Home' },
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' }
  ];

  return (
    <nav>
      {links.map(link => (
        <Link
          key={link.href}
          href={link.href}
          className={pathname === link.href ? 'active' : ''}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
```

### Active Link with Partial Match

```typescript
'use client';

import { usePathname } from 'veryfront';
import { Link } from 'veryfront';

export default function BlogNavigation() {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === '/') {
      return pathname === '/';
    }
    return pathname.startsWith(path);
  };

  return (
    <nav>
      <Link
        href="/"
        className={isActive('/') ? 'active' : ''}
      >
        Home
      </Link>
      <Link
        href="/blog"
        className={isActive('/blog') ? 'active' : ''}
      >
        Blog
      </Link>
      <Link
        href="/about"
        className={isActive('/about') ? 'active' : ''}
      >
        About
      </Link>
    </nav>
  );
}
```

### Conditional Rendering Based on Route

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function Layout({ children }) {
  const pathname = usePathname();

  // Hide sidebar on certain pages
  const showSidebar = !pathname.startsWith('/auth') && pathname !== '/';

  return (
    <div className="layout">
      {showSidebar && <Sidebar />}
      <main>{children}</main>
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

  // Split pathname into segments
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

### Page-Specific Header

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function Header() {
  const pathname = usePathname();

  const getTitle = () => {
    if (pathname === '/') return 'Home';
    if (pathname.startsWith('/blog')) return 'Blog';
    if (pathname.startsWith('/products')) return 'Products';
    return 'Page';
  };

  return (
    <header>
      <h1>{getTitle()}</h1>
    </header>
  );
}
```

### Analytics Tracking

```typescript
'use client';

import { usePathname } from 'veryfront';
import { useEffect } from 'react';

export default function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    // Track page view on pathname change
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('config', 'GA_MEASUREMENT_ID', {
        page_path: pathname
      });
    }
  }, [pathname]);

  return null;
}
```

### Nested Navigation

```typescript
'use client';

import { usePathname } from 'veryfront';
import { Link } from 'veryfront';

export default function DocsNavigation() {
  const pathname = usePathname();

  const sections = [
    {
      title: 'Getting Started',
      links: [
        { href: '/docs/introduction', label: 'Introduction' },
        { href: '/docs/installation', label: 'Installation' }
      ]
    },
    {
      title: 'API Reference',
      links: [
        { href: '/reference/components', label: 'Components' },
        { href: '/reference/hooks', label: 'Hooks' }
      ]
    }
  ];

  return (
    <nav>
      {sections.map(section => (
        <div key={section.title}>
          <h3>{section.title}</h3>
          <ul>
            {section.links.map(link => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={pathname === link.href ? 'active' : ''}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
```

### Mobile Menu Toggle Based on Route

```typescript
'use client';

import { usePathname } from 'veryfront';
import { useEffect, useState } from 'react';

export default function MobileMenu() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Close menu when route changes
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <div>
      <button onClick={() => setIsOpen(!isOpen)}>
        Menu
      </button>

      {isOpen && (
        <nav>
          {/* Menu items */}
        </nav>
      )}
    </div>
  );
}
```

### Route-Based Theme

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function ThemedLayout({ children }) {
  const pathname = usePathname();

  const getTheme = () => {
    if (pathname.startsWith('/admin')) return 'dark';
    if (pathname.startsWith('/blog')) return 'light';
    return 'auto';
  };

  return (
    <div className={`theme-${getTheme()}`}>
      {children}
    </div>
  );
}
```

### Scroll Progress Indicator

```typescript
'use client';

import { usePathname } from 'veryfront';
import { useEffect, useState } from 'react';

export default function ScrollProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Reset progress on route change
    setProgress(0);

    const handleScroll = () => {
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollTop = window.scrollY;

      const scrollPercentage =
        (scrollTop / (documentHeight - windowHeight)) * 100;

      setProgress(scrollPercentage);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [pathname]);

  return (
    <div
      className="scroll-progress"
      style={{ width: `${progress}%` }}
    />
  );
}
```

### Dynamic Back Button Label

```typescript
'use client';

import { usePathname } from 'veryfront';
import { useRouter } from 'veryfront';

export default function BackButton() {
  const pathname = usePathname();
  const router = useRouter();

  const getBackLabel = () => {
    if (pathname.startsWith('/blog/')) return 'Back to Blog';
    if (pathname.startsWith('/products/')) return 'Back to Products';
    return 'Back';
  };

  return (
    <button onClick={() => router.back()}>
      {getBackLabel()}
    </button>
  );
}
```

### Section-Specific Sidebar

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function Sidebar() {
  const pathname = usePathname();

  if (pathname.startsWith('/docs')) {
    return <DocsSidebar />;
  }

  if (pathname.startsWith('/blog')) {
    return <BlogSidebar />;
  }

  if (pathname.startsWith('/products')) {
    return <ProductSidebar />;
  }

  return null;
}
```

### Route Matching Pattern

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function Navigation() {
  const pathname = usePathname();

  const matchRoute = (pattern: string) => {
    const regex = new RegExp(
      '^' + pattern.replace(/\[.*?\]/g, '[^/]+') + '$'
    );
    return regex.test(pathname);
  };

  return (
    <nav>
      <a className={matchRoute('/blog/[slug]') ? 'active' : ''}>
        Blog Post
      </a>
      <a className={matchRoute('/products/[id]') ? 'active' : ''}>
        Product
      </a>
    </nav>
  );
}
```

### Locale-Based Pathname

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function LocaleNav() {
  const pathname = usePathname();

  // Extract locale from pathname (e.g., /en/about -> en)
  const locale = pathname.split('/')[1];
  const path = pathname.replace(`/${locale}`, '') || '/';

  const switchLocale = (newLocale: string) => {
    return `/${newLocale}${path}`;
  };

  return (
    <div>
      <a href={switchLocale('en')}>English</a>
      <a href={switchLocale('es')}>Español</a>
      <a href={switchLocale('fr')}>Français</a>
    </div>
  );
}
```

### Show/Hide Components Based on Path

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function ConditionalBanner() {
  const pathname = usePathname();

  // Show banner only on homepage
  if (pathname !== '/') {
    return null;
  }

  return (
    <div className="banner">
      <h1>Welcome to our site!</h1>
    </div>
  );
}
```

## Behavior

- **Client-side only**: The hook only works in client components (requires `'use client'` directive in App Router)
- **Returns pathname only**: Does not include query parameters, hash, or domain
- **Always starts with /**: Pathname always begins with a forward slash
- **Reactive**: Component re-renders when pathname changes

## Pathname Structure

```typescript
// For URL: https://example.com/blog/post-1?page=2#comments

const pathname = usePathname();
// Returns: "/blog/post-1"
// Does NOT include: query params (?page=2) or hash (#comments)
```

## App Router vs Pages Router

### App Router (Recommended)

```typescript
'use client';  // Required!

import { usePathname } from 'veryfront';

export default function Component() {
  const pathname = usePathname();
  // pathname is "/current/path"
}
```

### Pages Router

```typescript
// No 'use client' needed in Pages Router

import { useRouter } from 'veryfront';

export default function Component() {
  const router = useRouter();
  const pathname = router.pathname;
  // pathname is "/current/path"
}
```

## Notes

- Must be used in client components (add `'use client'` directive in App Router)
- Cannot be used in server components or during server-side rendering
- Only returns the pathname, not the full URL
- Does not include query parameters (use `useSearchParams` instead)
- Does not include dynamic route parameters (use `useParams` instead)
- The pathname is URL-decoded

## Related

- [useRouter](/reference/hooks/use-router.md) - Programmatic navigation
- [useParams](/reference/hooks/use-params.md) - Access route parameters
- [useSearchParams](/reference/hooks/use-search-params.md) - Access query parameters
- [Link](/reference/components/link.md) - Declarative navigation
