---
title: Performance Optimization
description: Optimize Veryfront applications for maximum speed and Core Web Vitals
keywords:
  - performance optimization
  - Core Web Vitals
  - LCP
  - FID
  - CLS
  - code splitting
  - lazy loading
  - bundle optimization
  - image optimization
related:
  - /docs/guides/performance/caching.md
  - /docs/components/image.md
  - /docs/components/script.md
  - /docs/guides/deployment/node.md
---

# Performance Optimization

Optimize your Veryfront applications for exceptional performance, perfect Core Web Vitals scores, and outstanding user experience.

## Overview

Performance optimization focuses on:

- **Core Web Vitals**: LCP, FID, CLS
- **Bundle Size**: Minimize JavaScript payload
- **Load Time**: Fast initial page load
- **Runtime Performance**: Smooth interactions
- **Resource Optimization**: Images, fonts, assets
- **Rendering**: Efficient SSR and hydration

## Core Web Vitals

### Largest Contentful Paint (LCP)

Target: < 2.5 seconds

**Optimize LCP:**

```tsx
// 1. Priority load above-the-fold images
import { Image } from 'veryfront';

export default function Hero() {
  return (
    <Image
      src="/hero-banner.jpg"
      alt="Hero"
      width={1920}
      height={1080}
      priority={true}  // Load immediately
    />
  );
}

// 2. Preload critical resources
import { Head } from 'veryfront';

export default function Layout() {
  return (
    <Head>
      <link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      <link rel="preload" href="/hero-banner.jpg" as="image" />
    </Head>
  );
}

// 3. Optimize server response time
// Use caching, CDN, and efficient data fetching
```

### First Input Delay (FID)

Target: < 100 milliseconds

**Optimize FID:**

```tsx
// 1. Reduce JavaScript execution time
// Use code splitting and lazy loading

// 2. Break up long tasks
async function processLargeData(data: any[]) {
  // ❌ Bad: Blocks main thread
  data.forEach(item => processItem(item));

  // ✅ Good: Break into chunks
  for (let i = 0; i < data.length; i++) {
    processItem(data[i]);

    // Yield to main thread every 50 items
    if (i % 50 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

// 3. Use web workers for heavy computation
const worker = new Worker('/worker.js');
worker.postMessage({ data: largeDataset });
worker.onmessage = (e) => {
  handleResult(e.data);
};
```

### Cumulative Layout Shift (CLS)

Target: < 0.1

**Optimize CLS:**

```tsx
// 1. Always specify image dimensions
import { Image } from 'veryfront';

export default function Gallery() {
  return (
    <Image
      src="/photo.jpg"
      alt="Photo"
      width={800}  // Prevents layout shift
      height={600}
    />
  );
}

// 2. Reserve space for dynamic content
export default function AdSlot() {
  return (
    <div style={{ minHeight: '250px' }}>
      {/* Ad loads here */}
    </div>
  );
}

// 3. Avoid inserting content above existing content
// Use animations for content that appears
```

## Code Splitting

### Dynamic Imports

```tsx
// Lazy load heavy components
import { lazy, Suspense } from 'react';

const HeavyChart = lazy(() => import('./HeavyChart'));
const VideoPlayer = lazy(() => import('./VideoPlayer'));

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>

      <Suspense fallback={<div>Loading chart...</div>}>
        <HeavyChart data={chartData} />
      </Suspense>

      <Suspense fallback={<div>Loading player...</div>}>
        <VideoPlayer url="/video.mp4" />
      </Suspense>
    </div>
  );
}
```

### Route-Based Splitting

```tsx
// Veryfront automatically splits by route
// app/
//   blog/
//     page.tsx       → blog-[hash].js
//   dashboard/
//     page.tsx       → dashboard-[hash].js
//   page.tsx         → home-[hash].js

// Each route loads only its required code
```

### Component-Based Splitting

```tsx
// Split large component libraries
import dynamic from 'next/dynamic';

const Chart = dynamic(() => import('recharts').then(mod => mod.LineChart), {
  loading: () => <p>Loading chart...</p>,
  ssr: false,  // Don't render on server
});

export default function Analytics() {
  return <Chart data={data} />;
}
```

## Bundle Optimization

### Analyze Bundle Size

```bash
# Build with analysis
veryfront build --analyze

# View bundle composition
# Opens browser with bundle visualization
```

### Tree Shaking

```tsx
// ❌ Bad: Imports entire library
import _ from 'lodash';
_.debounce(fn, 300);

// ✅ Good: Import specific functions
import { debounce } from 'lodash-es';
debounce(fn, 300);

// ✅ Better: Use native alternatives
const debounce = (fn: Function, ms: number) => {
  let timeout: NodeJS.Timeout;
  return (...args: any[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
};
```

### Remove Unused Dependencies

```bash
# Find unused dependencies
npx depcheck

# Remove unused packages
npm uninstall unused-package

# Use bundle size checker
npx bundlephobia <package-name>
```

### Optimize Imports

```tsx
// ❌ Bad: Barrel imports (imports everything)
import { Button, Modal, Dropdown, Tooltip } from '@/components';

// ✅ Good: Direct imports
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';

// ✅ Better: Re-export specific components
// components/index.ts
export { Button } from './Button';
export { Modal } from './Modal';
```

## Image Optimization

### Use Image Component

```tsx
import { Image } from 'veryfront';

export default function OptimizedImages() {
  return (
    <>
      {/* Automatic lazy loading */}
      <Image
        src="/product.jpg"
        alt="Product"
        width={600}
        height={400}
      />

      {/* Priority for above-the-fold */}
      <Image
        src="/hero.jpg"
        alt="Hero"
        width={1920}
        height={1080}
        priority
      />

      {/* Responsive images */}
      <Image
        src="/banner.jpg"
        alt="Banner"
        width={1200}
        height={600}
        sizes="(max-width: 768px) 100vw, 1200px"
      />
    </>
  );
}
```

### Modern Image Formats

```tsx
// Use WebP with fallback
<picture>
  <source srcSet="/image.webp" type="image/webp" />
  <source srcSet="/image.jpg" type="image/jpeg" />
  <img src="/image.jpg" alt="Image" />
</picture>

// Or use Image component (handles automatically)
<Image src="/image.jpg" alt="Image" width={800} height={600} />
```

### Image CDN

```tsx
// Use image CDN for optimization
const imageUrl = 'https://cdn.example.com/image.jpg';

<Image
  src={imageUrl}
  alt="Optimized"
  width={800}
  height={600}
  // CDN handles format conversion, resizing, compression
/>
```

## JavaScript Optimization

### Debounce and Throttle

```tsx
'use client';

import { useState, useCallback } from 'react';

function useDebounce<T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): T {
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout>();

  return useCallback(
    ((...args: Parameters<T>) => {
      if (timeoutId) clearTimeout(timeoutId);

      const id = setTimeout(() => fn(...args), delay);
      setTimeoutId(id);
    }) as T,
    [fn, delay, timeoutId]
  );
}

export default function SearchBox() {
  const [query, setQuery] = useState('');

  const handleSearch = useDebounce((value: string) => {
    // API call happens only after 300ms of no typing
    fetch(`/api/search?q=${value}`);
  }, 300);

  return (
    <input
      value={query}
      onChange={(e) => {
        setQuery(e.target.value);
        handleSearch(e.target.value);
      }}
    />
  );
}
```

### Memoization

```tsx
'use client';

import { useMemo, useCallback } from 'react';

export default function ExpensiveComponent({ data }: { data: any[] }) {
  // Memoize expensive calculations
  const processedData = useMemo(() => {
    return data
      .filter(item => item.active)
      .map(item => complexTransformation(item))
      .sort((a, b) => a.value - b.value);
  }, [data]);

  // Memoize callbacks
  const handleClick = useCallback((id: string) => {
    // Handle click
  }, []);

  return (
    <div>
      {processedData.map(item => (
        <div key={item.id} onClick={() => handleClick(item.id)}>
          {item.name}
        </div>
      ))}
    </div>
  );
}
```

### Virtual Scrolling

```tsx
'use client';

import { FixedSizeList } from 'react-window';

export default function LargeList({ items }: { items: any[] }) {
  const Row = ({ index, style }: any) => (
    <div style={style}>
      {items[index].name}
    </div>
  );

  return (
    <FixedSizeList
      height={600}
      itemCount={items.length}
      itemSize={50}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

## Font Optimization

### Self-Host Fonts

```tsx
import { Head } from 'veryfront';

export default function Layout() {
  return (
    <Head>
      <link
        rel="preload"
        href="/fonts/inter-var.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
    </Head>
  );
}

// CSS
// @font-face {
//   font-family: 'Inter';
//   src: url('/fonts/inter-var.woff2') format('woff2');
//   font-display: swap;
// }
```

### Font Display Strategy

```css
/* CSS */
@font-face {
  font-family: 'MyFont';
  src: url('/fonts/myfont.woff2') format('woff2');
  /* Show fallback immediately, swap when loaded */
  font-display: swap;
}

/* Preload critical fonts */
<link rel="preload" href="/fonts/critical.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
```

## Third-Party Scripts

### Optimize Loading

```tsx
import { Script } from 'veryfront';

export default function Analytics() {
  return (
    <>
      {/* Load analytics after page is interactive */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=GA-XXX"
        strategy="afterInteractive"
      />

      {/* Load chat widget on idle */}
      <Script
        src="https://widget.intercom.io/widget/app-id"
        strategy="lazyOnload"
      />

      {/* Critical scripts only */}
      <Script
        src="/critical-analytics.js"
        strategy="beforeInteractive"
      />
    </>
  );
}
```

## Server-Side Rendering (SSR)

### Optimize Data Fetching

```tsx
// Parallel data fetching
export default async function Page() {
  const [user, posts, comments] = await Promise.all([
    fetchUser(),
    fetchPosts(),
    fetchComments(),
  ]);

  return (
    <div>
      <UserProfile user={user} />
      <PostsList posts={posts} />
      <CommentsList comments={comments} />
    </div>
  );
}

// Cache data fetching
const cachedFetch = async (url: string) => {
  const cached = await cache.get(url);
  if (cached) return cached;

  const data = await fetch(url).then(r => r.json());
  await cache.set(url, data, { ttl: 3600 });
  return data;
};
```

### Streaming SSR

```tsx
// Stream large components
import { Suspense } from 'react';

export default function Page() {
  return (
    <div>
      <h1>Product Page</h1>

      {/* Renders immediately */}
      <ProductInfo />

      {/* Streams when ready */}
      <Suspense fallback={<div>Loading reviews...</div>}>
        <Reviews />
      </Suspense>

      <Suspense fallback={<div>Loading recommendations...</div>}>
        <Recommendations />
      </Suspense>
    </div>
  );
}
```

## Performance Monitoring

### Web Vitals

```tsx
'use client';

import { useEffect } from 'react';

export function WebVitals() {
  useEffect(() => {
    import('web-vitals').then(({ onCLS, onFID, onLCP }) => {
      onCLS(console.log);
      onFID(console.log);
      onLCP(console.log);
    });
  }, []);

  return null;
}

// Add to root layout
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <WebVitals />
        {children}
      </body>
    </html>
  );
}
```

### Performance API

```tsx
'use client';

import { useEffect } from 'react';

export function PerformanceMonitor() {
  useEffect(() => {
    // Measure page load
    const navigationTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;

    console.log({
      dns: navigationTiming.domainLookupEnd - navigationTiming.domainLookupStart,
      tcp: navigationTiming.connectEnd - navigationTiming.connectStart,
      ttfb: navigationTiming.responseStart - navigationTiming.requestStart,
      download: navigationTiming.responseEnd - navigationTiming.responseStart,
      domParsing: navigationTiming.domInteractive - navigationTiming.responseEnd,
      domContentLoaded: navigationTiming.domContentLoadedEventEnd - navigationTiming.domContentLoadedEventStart,
      total: navigationTiming.loadEventEnd - navigationTiming.fetchStart,
    });

    // Measure resources
    performance.getEntriesByType('resource').forEach((resource: any) => {
      console.log(`${resource.name}: ${resource.duration}ms`);
    });
  }, []);

  return null;
}
```

## Performance Budget

### Set Budgets

```json
// performance-budget.json
{
  "budgets": [
    {
      "resourceSizes": [
        {
          "resourceType": "script",
          "budget": 300
        },
        {
          "resourceType": "total",
          "budget": 500
        }
      ]
    }
  ]
}
```

### Monitor Budgets

```bash
# Run Lighthouse CI
npm install -g @lhci/cli

# Configure
lhci autorun --config=lighthouserc.json

# Fail build if budget exceeded
lhci assert --budgetsFile=performance-budget.json
```

## Best Practices Checklist

### Load Performance

- [ ] Optimize images with Image component
- [ ] Use priority loading for above-the-fold images
- [ ] Implement code splitting and lazy loading
- [ ] Minimize JavaScript bundle size
- [ ] Use CDN for static assets
- [ ] Enable compression (gzip/brotli)
- [ ] Preload critical resources
- [ ] Defer non-critical scripts

### Runtime Performance

- [ ] Debounce/throttle expensive operations
- [ ] Use memoization for expensive calculations
- [ ] Implement virtual scrolling for long lists
- [ ] Avoid layout thrashing
- [ ] Optimize animations (use CSS transforms)
- [ ] Use web workers for heavy computation

### Core Web Vitals

- [ ] LCP < 2.5s (optimize largest image/text)
- [ ] FID < 100ms (reduce JavaScript execution)
- [ ] CLS < 0.1 (reserve space for dynamic content)
- [ ] Monitor with Web Vitals library
- [ ] Track in analytics

### Rendering

- [ ] Use server-side rendering effectively
- [ ] Implement streaming for slow components
- [ ] Parallel data fetching
- [ ] Cache API responses
- [ ] Optimize hydration

## Performance Testing Tools

### Lighthouse

```bash
# Run Lighthouse
npx lighthouse https://example.com --view

# CI integration
npx @lhci/cli autorun
```

### WebPageTest

```bash
# Test from multiple locations
webpagetest test https://example.com --location Dulles:Chrome
```

### Chrome DevTools

1. Open DevTools (F12)
2. Performance tab → Record
3. Interact with page
4. Stop recording
5. Analyze timeline

## Common Performance Issues

### 1. Large Bundle Size

**Problem**: JavaScript bundle > 500KB

**Solution**:
```bash
# Analyze bundle
veryfront build --analyze

# Remove unused dependencies
npx depcheck

# Use dynamic imports
const Heavy = lazy(() => import('./Heavy'));
```

### 2. Slow Images

**Problem**: Images load slowly

**Solution**:
```tsx
// Use Image component
<Image src="/photo.jpg" width={800} height={600} />

// Enable priority loading
<Image src="/hero.jpg" priority />
```

### 3. Layout Shifts

**Problem**: Content jumps during load

**Solution**:
```tsx
// Specify dimensions
<Image width={800} height={600} />

// Reserve space
<div style={{ minHeight: '250px' }}>
  {/* Dynamic content */}
</div>
```

## Next Steps

- Learn about [Caching Strategies](/docs/guides/performance/caching.md)
- Optimize [Images](/docs/components/image.md)
- Configure [Scripts](/docs/components/script.md)
- Review [Deployment](/docs/guides/deployment/node.md) best practices
