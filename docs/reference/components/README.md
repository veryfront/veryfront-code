---
title: Components Reference
description: Complete reference for all React components provided by Veryfront
category: reference
keywords: [components, react, ui, link, head, image]
---

# Components Reference

React components provided by Veryfront for building performant and SEO-friendly web applications.

## Available Components

### Navigation

#### [Link](/reference/components/link.md)

Client-side navigation component for seamless page transitions without full page reloads.

```typescript
import { Link } from 'veryfront';

<Link href="/about" prefetch={true}>
  About Us
</Link>
```

**Key Features:**
- Client-side navigation without page reloads
- Optional prefetching for instant navigation
- History management (push/replace)
- Automatic external link detection
- Full accessibility support

**Use Cases:**
- Navigation menus
- Internal links
- Dynamic route navigation
- Breadcrumb trails

---

### SEO & Metadata

#### [Head](/reference/components/head.md)

Component for modifying the document `<head>` from anywhere in your application.

```typescript
import { Head } from 'veryfront';

<Head>
  <title>My Page Title</title>
  <meta name="description" content="Page description" />
  <meta property="og:image" content="/image.jpg" />
</Head>
```

**Key Features:**
- Dynamic title and meta tags
- Open Graph support
- Twitter Card support
- Canonical URLs
- Custom scripts and styles

**Use Cases:**
- SEO optimization
- Social media sharing
- Dynamic page titles
- Custom stylesheets
- Analytics scripts

---

### Media & Assets

#### [OptimizedImage](/reference/components/optimized-image.md)

Optimized image component with automatic format conversion, lazy loading, and responsive sizing.

```typescript
import { OptimizedImage } from 'veryfront';

<OptimizedImage
  src="/photo.jpg"
  alt="Description"
  width={800}
  height={600}
  format="webp"
  loading="lazy"
/>
```

**Key Features:**
- Automatic image optimization
- WebP and AVIF format conversion
- Lazy loading by default
- Priority loading for above-the-fold images
- Responsive image sizing
- Quality control

**Use Cases:**
- Product images
- Blog post covers
- Hero banners
- Photo galleries
- Avatars and thumbnails

---

## Component Patterns

### Server vs Client Components

Components in Veryfront can be either server or client components:

**Server Components (Default):**
```typescript
// No 'use client' directive - runs on server
export default function ServerComponent() {
  return <div>Server rendered</div>;
}
```

**Client Components:**
```typescript
'use client';

// Runs on client - required for hooks and interactivity
export default function ClientComponent() {
  const router = useRouter();
  return <button onClick={() => router.push('/page')}>Go</button>;
}
```

### Component Composition

Components work seamlessly together:

```typescript
import { Link, Head, OptimizedImage } from 'veryfront';

export default function BlogPost({ post }) {
  return (
    <>
      <Head>
        <title>{post.title} - My Blog</title>
        <meta name="description" content={post.excerpt} />
        <meta property="og:image" content={post.coverImage} />
      </Head>

      <article>
        <OptimizedImage
          src={post.coverImage}
          alt={post.title}
          width={1200}
          height={630}
          priority={true}
        />

        <h1>{post.title}</h1>
        <div>{post.content}</div>

        <Link href="/blog">Back to Blog</Link>
      </article>
    </>
  );
}
```

## Styling Components

All components accept standard React props for styling:

### className Prop

```typescript
<Link href="/about" className="nav-link active">
  About
</Link>
```

### style Prop

```typescript
<OptimizedImage
  src="/image.jpg"
  alt="Image"
  style={{ borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}
/>
```

### CSS Modules

```typescript
import styles from './Component.module.css';

<Link href="/about" className={styles.navLink}>
  About
</Link>
```

### Tailwind CSS

```typescript
<Link href="/about" className="text-blue-600 hover:text-blue-800 underline">
  About
</Link>
```

## Performance Best Practices

### Image Optimization

```typescript
// Above the fold - load immediately
<OptimizedImage
  src="/hero.jpg"
  alt="Hero"
  priority={true}
  format="webp"
  quality={90}
/>

// Below the fold - lazy load
<OptimizedImage
  src="/content.jpg"
  alt="Content"
  loading="lazy"
  format="webp"
  quality={80}
/>
```

### Link Prefetching

```typescript
// Prefetch on hover for instant navigation
<Link href="/important-page" prefetch={true}>
  Important Page
</Link>
```

### Head Tag Optimization

```typescript
// Combine multiple Head components
<Head>
  {/* Critical meta tags */}
  <title>{dynamicTitle}</title>
  <meta name="description" content={dynamicDescription} />

  {/* Open Graph */}
  <meta property="og:title" content={dynamicTitle} />
  <meta property="og:image" content={dynamicImage} />

  {/* Preconnect to external domains */}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
</Head>
```

## Accessibility

All Veryfront components follow accessibility best practices:

### Link Accessibility

```typescript
// Descriptive link text
<Link href="/contact">Contact Us</Link>

// Not: <Link href="/contact">Click here</Link>

// External links
<Link href="https://external.com" target="_blank" rel="noopener noreferrer">
  External Link
</Link>
```

### Image Accessibility

```typescript
// Always provide meaningful alt text
<OptimizedImage
  src="/product.jpg"
  alt="Blue cotton t-shirt with round neck"
  width={400}
  height={400}
/>

// Decorative images
<OptimizedImage
  src="/decoration.jpg"
  alt=""  // Empty alt for decorative images
  width={200}
  height={200}
/>
```

### Head Accessibility

```typescript
<Head>
  {/* Page language */}
  <html lang="en" />

  {/* Viewport for responsive design */}
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  {/* Theme color */}
  <meta name="theme-color" content="#000000" />
</Head>
```

## TypeScript Support

All components are fully typed for TypeScript:

```typescript
import type { LinkProps } from 'veryfront';

const CustomLink: React.FC<LinkProps> = (props) => {
  return <Link {...props} className="custom-link" />;
};
```

## Browser Support

Veryfront components support all modern browsers:

- Chrome (latest)
- Firefox (latest)
- Safari 14+
- Edge (latest)

Automatic polyfills and fallbacks are provided for older browsers where needed.

## Related Documentation

- [Hooks Reference](/reference/hooks/) - Client-side hooks
- [Functions Reference](/reference/functions/) - Server-side functions
- [Routing Guide](/guides/routing/README.md) - File-based routing
- [Styling Guide](/guides/components/README.md) - Styling approaches

## Examples

- [Navigation Menu Example](https://github.com/veryfront/veryfront/tree/main/examples/minimal-app-router)
- [SEO Optimization Example](https://github.com/veryfront/veryfront/tree/main/examples/basic-mdx)
- [Image Gallery Example](https://github.com/veryfront/veryfront/tree/main/examples/full-demo)
- [Blog with Images Example](https://github.com/veryfront/veryfront/tree/main/examples/basic-mdx)
