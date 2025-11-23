# @veryfront/components

> Framework-provided React components for building Veryfront applications

## What It Does

Provides essential React components:

- **Navigation**: Client-side `<Link>` component for routing
- **Metadata**: `<Head>` component for page metadata
- **Layout System**: Layout and provider components
- **Optimized Images**: Image optimization components

## When to Use

**Use when:**

- Building pages with client-side navigation
- Setting page title/meta tags
- Using framework layout system
- Optimizing images for web delivery

**Don't use for:**

- Custom UI components (build your own)
- Third-party component libraries (install separately)

## Quick Start

```typescript
// Link component
import { Link } from "@veryfront/components";

export default function Page() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about" prefetch>About</Link>
      <Link href="/blog" className="active">Blog</Link>
    </nav>
  );
}

// Head component
import { Head } from "@veryfront/components";

export default function Page() {
  return (
    <>
      <Head>
        <title>My Page Title</title>
        <meta name="description" content="Page description" />
        <link rel="canonical" href="https://example.com/page" />
      </Head>
      <main>Content</main>
    </>
  );
}

// MDX Provider
import { MDXProvider } from "@veryfront/components";

const components = {
  h1: (props) => <h1 className="text-4xl font-bold" {...props} />,
  a: (props) => <Link {...props} />,
};

export default function App({ children }) {
  return (
    <MDXProvider components={components}>
      {children}
    </MDXProvider>
  );
}

// Optimized Image
import { OptimizedImage } from "@veryfront/components";

export default function Page() {
  return (
    <OptimizedImage
      src="/images/hero.jpg"
      alt="Hero image"
      width={800}
      height={600}
      loading="lazy"
    />
  );
}
```

## Structure

```
components/
├── Link.tsx              # Client-side navigation
├── Head.tsx              # Page metadata
├── MDXProvider.tsx       # MDX component provider
├── LayoutComponent.tsx   # Layout wrapper
├── ProviderComponent.tsx # Provider wrapper
├── AppWrapper.tsx        # App-level wrapper
├── optimized-image/      # Image optimization
│   ├── OptimizedImage.tsx
│   ├── ImageLoader.tsx
│   └── srcset-builder.ts
└── live/                 # Live reload components
    └── LiveReload.tsx
```

## 🔗 Dependencies

**Depends on:**

- `react` - React library
- `@veryfront/types` - Shared types
- `@veryfront/routing` - Navigation utilities

**Depended on by:**

- User applications - Import components directly
- `@veryfront/runtime` - Uses layout components

**Layer:** 🟢 CORE (Business Logic)

## 📚 Key Concepts

### Link Component

Client-side navigation with prefetching:

```typescript
interface LinkProps {
  href: string;
  prefetch?: boolean; // Auto-prefetch on hover
  replace?: boolean; // Replace history instead of push
  className?: string;
  children: React.ReactNode;
}
```

### Head Component

Manage page metadata (rendered in `<head>`):

```typescript
<Head>
  <title>Page Title</title>
  <meta name="description" content="..." />
  <meta property="og:title" content="..." />
  <link rel="stylesheet" href="/styles.css" />
  <script src="/analytics.js" />
</Head>;
```

### MDX Provider

Customize MDX component rendering:

```typescript
const components = {
  h1: CustomH1,
  h2: CustomH2,
  a: CustomLink,
  img: OptimizedImage,
  code: CodeBlock,
};

<MDXProvider components={components}>
  <MDXContent />
</MDXProvider>;
```

### Optimized Image

Automatic image optimization:

- Generates multiple sizes (srcset)
- Lazy loading support
- WebP/AVIF format conversion
- Responsive images

## 🔧 Advanced Usage

### Custom Link Behavior

```typescript
import { Link } from '@veryfront/components';

// With prefetch on hover
<Link href="/page" prefetch>Prefetch Me</Link>

// Replace history entry
<Link href="/login" replace>Login</Link>

// External link (no prefetch)
<Link href="https://example.com">External</Link>
```

### Dynamic Head Content

```typescript
import { Head } from "@veryfront/components";

export default function BlogPost({ title, description }) {
  return (
    <>
      <Head>
        <title>{title} | My Blog</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
      </Head>
      <article>...</article>
    </>
  );
}
```

### Layout Components

```typescript
import { LayoutComponent } from "@veryfront/components";

// Used internally by framework for layout nesting
<LayoutComponent layout={layoutBundle}>
  <PageContent />
</LayoutComponent>;
```

## 🔗 See Also

- [@veryfront/routing](../routing/README.md) - Routing system
- [@veryfront/runtime](../runtime/README.md) - React rendering
- [Components Guide](../../docs/components.md)

## 📄 License

Part of Veryfront framework
