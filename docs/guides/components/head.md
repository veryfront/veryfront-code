---
title: Head Component
description: Manage document metadata, SEO tags, and head elements with the Veryfront Head component
keywords:
  - head component
  - metadata
  - SEO
  - Open Graph
  - Twitter Cards
  - document head
  - title tag
  - meta tags
related:
  - /docs/components/link.md
  - /docs/components/script.md
  - /guides/routing/app-router.md
  - /guides/rendering/ssr.md
---

# Head Component

The `Head` component allows you to modify the `<head>` section of your HTML document. Use it to set page titles, meta descriptions, Open Graph tags, and other metadata for SEO and social sharing.

## Overview

The Head component in Veryfront provides:

- **SEO Optimization**: Set titles, descriptions, and structured metadata
- **Social Sharing**: Configure Open Graph and Twitter Card tags
- **Metadata Management**: Add favicon, canonical URLs, and custom meta tags
- **Dynamic Content**: Update metadata based on route data or API responses
- **Automatic Merging**: Multiple Head components merge intelligently
- **TypeScript Support**: Full type safety for metadata objects

## Basic Usage

### Setting Page Title

```tsx
import { Head } from 'veryfront';

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About Us - Acme Corp</title>
        <meta name="description" content="Learn about our company and mission" />
      </Head>

      <div>
        <h1>About Us</h1>
        <p>Welcome to our company...</p>
      </div>
    </>
  );
}
```

### Multiple Meta Tags

```tsx
import { Head } from 'veryfront';

export default function HomePage() {
  return (
    <>
      <Head>
        <title>Home - Acme Corp</title>
        <meta name="description" content="Welcome to Acme Corp" />
        <meta name="keywords" content="acme, products, services" />
        <meta name="author" content="Acme Corp" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div>
        <h1>Welcome</h1>
      </div>
    </>
  );
}
```

## SEO Optimization

### Complete SEO Setup

```tsx
import { Head } from 'veryfront';

export default function ProductPage({ product }: { product: Product }) {
  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{product.name} - Acme Store</title>
        <meta name="title" content={`${product.name} - Acme Store`} />
        <meta name="description" content={product.description} />
        <meta name="keywords" content={product.tags.join(', ')} />

        {/* Canonical URL */}
        <link rel="canonical" href={`https://acme.com/products/${product.slug}`} />

        {/* Robots */}
        <meta name="robots" content="index, follow" />

        {/* Language */}
        <meta httpEquiv="content-language" content="en" />
      </Head>

      <div>
        <h1>{product.name}</h1>
        <p>{product.description}</p>
      </div>
    </>
  );
}
```

### Dynamic Metadata

```tsx
import { Head } from 'veryfront';

interface BlogPostProps {
  post: {
    title: string;
    excerpt: string;
    publishedAt: string;
    author: string;
    tags: string[];
  };
}

export default function BlogPost({ post }: BlogPostProps) {
  const title = `${post.title} | Acme Blog`;
  const description = post.excerpt;
  const keywords = post.tags.join(', ');

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="keywords" content={keywords} />
        <meta name="author" content={post.author} />
        <meta name="publish-date" content={post.publishedAt} />
      </Head>

      <article>
        <h1>{post.title}</h1>
        <p>{post.excerpt}</p>
      </article>
    </>
  );
}
```

## Open Graph Tags

### Basic Open Graph

```tsx
import { Head } from 'veryfront';

export default function ProductPage({ product }: { product: Product }) {
  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{product.name} - Acme Store</title>
        <meta name="description" content={product.description} />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="product" />
        <meta property="og:url" content={`https://acme.com/products/${product.slug}`} />
        <meta property="og:title" content={product.name} />
        <meta property="og:description" content={product.description} />
        <meta property="og:image" content={product.imageUrl} />
        <meta property="og:site_name" content="Acme Store" />
      </Head>

      <div>
        <h1>{product.name}</h1>
        <img src={product.imageUrl} alt={product.name} />
      </div>
    </>
  );
}
```

### Complete Open Graph for Articles

```tsx
import { Head } from 'veryfront';

interface ArticleProps {
  article: {
    title: string;
    description: string;
    imageUrl: string;
    publishedAt: string;
    modifiedAt: string;
    author: {
      name: string;
      url: string;
    };
    tags: string[];
    slug: string;
  };
}

export default function ArticlePage({ article }: ArticleProps) {
  const url = `https://acme.com/blog/${article.slug}`;

  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{article.title} - Acme Blog</title>
        <meta name="description" content={article.description} />

        {/* Open Graph / Facebook */}
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={article.title} />
        <meta property="og:description" content={article.description} />
        <meta property="og:image" content={article.imageUrl} />
        <meta property="og:site_name" content="Acme Blog" />

        {/* Article Metadata */}
        <meta property="article:published_time" content={article.publishedAt} />
        <meta property="article:modified_time" content={article.modifiedAt} />
        <meta property="article:author" content={article.author.url} />
        {article.tags.map(tag => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}
      </Head>

      <article>
        <h1>{article.title}</h1>
        <p>{article.description}</p>
      </article>
    </>
  );
}
```

## Twitter Cards

### Summary Card

```tsx
import { Head } from 'veryfront';

export default function AboutPage() {
  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>About Us - Acme Corp</title>
        <meta name="description" content="Learn about our company and mission" />

        {/* Twitter */}
        <meta property="twitter:card" content="summary" />
        <meta property="twitter:url" content="https://acme.com/about" />
        <meta property="twitter:title" content="About Us - Acme Corp" />
        <meta property="twitter:description" content="Learn about our company and mission" />
        <meta property="twitter:image" content="https://acme.com/logo.png" />
        <meta property="twitter:site" content="@acmecorp" />
      </Head>

      <div>
        <h1>About Us</h1>
      </div>
    </>
  );
}
```

### Large Image Card

```tsx
import { Head } from 'veryfront';

export default function BlogPost({ post }: { post: Post }) {
  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{post.title} - Acme Blog</title>
        <meta name="description" content={post.excerpt} />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:url" content={`https://acme.com/blog/${post.slug}`} />
        <meta property="twitter:title" content={post.title} />
        <meta property="twitter:description" content={post.excerpt} />
        <meta property="twitter:image" content={post.imageUrl} />
        <meta property="twitter:image:alt" content={post.imageAlt} />
        <meta property="twitter:site" content="@acmeblog" />
        <meta property="twitter:creator" content={post.authorTwitter} />
      </Head>

      <article>
        <h1>{post.title}</h1>
      </article>
    </>
  );
}
```

## Favicon and Icons

### Basic Favicon

```tsx
import { Head } from 'veryfront';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <Head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
      </Head>
      <body>{children}</body>
    </html>
  );
}
```

### Complete Favicon Set

```tsx
import { Head } from 'veryfront';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <Head>
        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />

        {/* Apple Touch Icon */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />

        {/* Android Chrome */}
        <link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/android-chrome-512x512.png" />

        {/* Web App Manifest */}
        <link rel="manifest" href="/site.webmanifest" />

        {/* Safari Pinned Tab */}
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#5bbad5" />

        {/* Theme Color */}
        <meta name="theme-color" content="#ffffff" />
        <meta name="msapplication-TileColor" content="#da532c" />
      </Head>
      <body>{children}</body>
    </html>
  );
}
```

## Advanced Patterns

### Merging Multiple Head Components

Veryfront automatically merges Head components from different levels:

```tsx
// app/layout.tsx - Root layout
import { Head } from 'veryfront';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body>{children}</body>
    </html>
  );
}

// app/blog/layout.tsx - Blog layout
import { Head } from 'veryfront';

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head>
        <meta property="og:site_name" content="Acme Blog" />
        <meta property="twitter:site" content="@acmeblog" />
      </Head>
      <div className="blog-layout">
        {children}
      </div>
    </>
  );
}

// app/blog/[slug]/page.tsx - Blog post page
import { Head } from 'veryfront';

export default function BlogPost({ post }: { post: Post }) {
  return (
    <>
      <Head>
        <title>{post.title} - Acme Blog</title>
        <meta name="description" content={post.excerpt} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.excerpt} />
        <meta property="og:image" content={post.imageUrl} />
      </Head>
      <article>
        <h1>{post.title}</h1>
      </article>
    </>
  );
}

// Result: All Head tags are merged into single <head>:
// - viewport and favicon from root layout
// - site_name and twitter:site from blog layout
// - title, description, and og tags from blog post page
```

### Conditional Metadata

```tsx
import { Head } from 'veryfront';

interface PageProps {
  isPreview?: boolean;
  isDraft?: boolean;
}

export default function ContentPage({ isPreview, isDraft }: PageProps) {
  return (
    <>
      <Head>
        <title>Content Page</title>

        {/* Prevent indexing for preview/draft */}
        {(isPreview || isDraft) && (
          <meta name="robots" content="noindex, nofollow" />
        )}

        {/* Allow indexing for published content */}
        {!isPreview && !isDraft && (
          <meta name="robots" content="index, follow" />
        )}
      </Head>

      <div>
        {isPreview && <div className="preview-banner">Preview Mode</div>}
        <h1>Content</h1>
      </div>
    </>
  );
}
```

### Reusable Metadata Component

```tsx
import { Head } from 'veryfront';

interface SEOProps {
  title: string;
  description: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'product';
  publishedAt?: string;
  modifiedAt?: string;
  author?: string;
  tags?: string[];
}

export function SEO({
  title,
  description,
  image = 'https://acme.com/og-image.png',
  url = 'https://acme.com',
  type = 'website',
  publishedAt,
  modifiedAt,
  author,
  tags = [],
}: SEOProps) {
  const fullTitle = `${title} - Acme`;

  return (
    <Head>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />
      {tags.length > 0 && <meta name="keywords" content={tags.join(', ')} />}
      {author && <meta name="author" content={author} />}

      {/* Canonical URL */}
      <link rel="canonical" href={url} />

      {/* Open Graph */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:site_name" content="Acme" />

      {/* Article Metadata */}
      {type === 'article' && publishedAt && (
        <meta property="article:published_time" content={publishedAt} />
      )}
      {type === 'article' && modifiedAt && (
        <meta property="article:modified_time" content={modifiedAt} />
      )}
      {type === 'article' && tags.map(tag => (
        <meta key={tag} property="article:tag" content={tag} />
      ))}

      {/* Twitter */}
      <meta property="twitter:card" content="summary_large_image" />
      <meta property="twitter:url" content={url} />
      <meta property="twitter:title" content={fullTitle} />
      <meta property="twitter:description" content={description} />
      <meta property="twitter:image" content={image} />
    </Head>
  );
}

// Usage:
export default function BlogPost({ post }: { post: Post }) {
  return (
    <>
      <SEO
        title={post.title}
        description={post.excerpt}
        image={post.imageUrl}
        url={`https://acme.com/blog/${post.slug}`}
        type="article"
        publishedAt={post.publishedAt}
        modifiedAt={post.modifiedAt}
        author={post.author}
        tags={post.tags}
      />

      <article>
        <h1>{post.title}</h1>
      </article>
    </>
  );
}
```

## TypeScript Support

### Type-Safe Metadata

```tsx
import { Head } from 'veryfront';

interface Metadata {
  title: string;
  description: string;
  keywords?: string[];
  author?: string;
  canonical?: string;
  robots?: 'index' | 'noindex';
}

interface OpenGraph {
  type: 'website' | 'article' | 'product';
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}

interface TwitterCard {
  card: 'summary' | 'summary_large_image' | 'app' | 'player';
  site?: string;
  creator?: string;
  title: string;
  description: string;
  image: string;
}

interface MetadataProps {
  metadata: Metadata;
  og?: OpenGraph;
  twitter?: TwitterCard;
}

export function MetadataHead({ metadata, og, twitter }: MetadataProps) {
  return (
    <Head>
      {/* Primary Meta Tags */}
      <title>{metadata.title}</title>
      <meta name="description" content={metadata.description} />
      {metadata.keywords && (
        <meta name="keywords" content={metadata.keywords.join(', ')} />
      )}
      {metadata.author && <meta name="author" content={metadata.author} />}
      {metadata.canonical && <link rel="canonical" href={metadata.canonical} />}
      {metadata.robots && (
        <meta name="robots" content={`${metadata.robots}, follow`} />
      )}

      {/* Open Graph */}
      {og && (
        <>
          <meta property="og:type" content={og.type} />
          <meta property="og:url" content={og.url} />
          <meta property="og:title" content={og.title} />
          <meta property="og:description" content={og.description} />
          <meta property="og:image" content={og.image} />
          <meta property="og:site_name" content={og.siteName} />
        </>
      )}

      {/* Twitter */}
      {twitter && (
        <>
          <meta property="twitter:card" content={twitter.card} />
          {twitter.site && <meta property="twitter:site" content={twitter.site} />}
          {twitter.creator && <meta property="twitter:creator" content={twitter.creator} />}
          <meta property="twitter:title" content={twitter.title} />
          <meta property="twitter:description" content={twitter.description} />
          <meta property="twitter:image" content={twitter.image} />
        </>
      )}
    </Head>
  );
}

// Usage:
export default function ProductPage({ product }: { product: Product }) {
  return (
    <>
      <MetadataHead
        metadata={{
          title: `${product.name} - Acme Store`,
          description: product.description,
          keywords: product.tags,
          canonical: `https://acme.com/products/${product.slug}`,
          robots: 'index',
        }}
        og={{
          type: 'product',
          url: `https://acme.com/products/${product.slug}`,
          title: product.name,
          description: product.description,
          image: product.imageUrl,
          siteName: 'Acme Store',
        }}
        twitter={{
          card: 'summary_large_image',
          site: '@acmestore',
          title: product.name,
          description: product.description,
          image: product.imageUrl,
        }}
      />

      <div>
        <h1>{product.name}</h1>
      </div>
    </>
  );
}
```

## Best Practices

### 1. Use Unique Titles

```tsx
// ❌ Bad: Same title on all pages
<Head>
  <title>Acme Corp</title>
</Head>

// ✅ Good: Unique, descriptive titles
<Head>
  <title>{post.title} - Acme Blog</title>
</Head>
```

### 2. Include Meta Descriptions

```tsx
// ❌ Bad: Missing description
<Head>
  <title>About Us</title>
</Head>

// ✅ Good: Clear, concise description
<Head>
  <title>About Us - Acme Corp</title>
  <meta name="description" content="Learn about our company history, mission, and team" />
</Head>
```

### 3. Set Canonical URLs

```tsx
// ❌ Bad: No canonical URL (causes duplicate content issues)
<Head>
  <title>Product Page</title>
</Head>

// ✅ Good: Canonical URL prevents duplicate content
<Head>
  <title>{product.name}</title>
  <link rel="canonical" href={`https://acme.com/products/${product.slug}`} />
</Head>
```

### 4. Use Open Graph for Social Sharing

```tsx
// ❌ Bad: No social sharing metadata
<Head>
  <title>Blog Post</title>
  <meta name="description" content="..." />
</Head>

// ✅ Good: Complete Open Graph tags
<Head>
  <title>{post.title}</title>
  <meta name="description" content={post.excerpt} />
  <meta property="og:title" content={post.title} />
  <meta property="og:description" content={post.excerpt} />
  <meta property="og:image" content={post.imageUrl} />
  <meta property="og:url" content={postUrl} />
</Head>
```

### 5. Control Indexing

```tsx
// ❌ Bad: Draft content is indexed by search engines
<Head>
  <title>Draft Post</title>
</Head>

// ✅ Good: Prevent indexing of draft content
<Head>
  <title>Draft Post</title>
  <meta name="robots" content="noindex, nofollow" />
</Head>
```

### 6. Include Viewport Meta Tag

```tsx
// ❌ Bad: Missing viewport tag (poor mobile experience)
<Head>
  <title>Home</title>
</Head>

// ✅ Good: Viewport tag for responsive design
<Head>
  <title>Home</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</Head>
```

### 7. Optimize Image Metadata

```tsx
// ❌ Bad: Generic or missing image
<meta property="og:image" content="https://acme.com/logo.png" />

// ✅ Good: Specific, high-quality image with dimensions
<meta property="og:image" content={post.featuredImage} />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content={post.imageAlt} />
```

## Real-World Examples

### E-commerce Product Page

```tsx
import { Head } from 'veryfront';

interface ProductPageProps {
  product: {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    imageUrl: string;
    availability: 'in_stock' | 'out_of_stock';
    brand: string;
    category: string;
    slug: string;
  };
}

export default function ProductPage({ product }: ProductPageProps) {
  const url = `https://acme.com/products/${product.slug}`;
  const priceString = `${product.currency} ${product.price.toFixed(2)}`;

  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{product.name} - ${product.price} - Acme Store</title>
        <meta name="description" content={product.description} />

        {/* Canonical URL */}
        <link rel="canonical" href={url} />

        {/* Open Graph */}
        <meta property="og:type" content="product" />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={product.name} />
        <meta property="og:description" content={product.description} />
        <meta property="og:image" content={product.imageUrl} />

        {/* Product Metadata */}
        <meta property="product:price:amount" content={product.price.toString()} />
        <meta property="product:price:currency" content={product.currency} />
        <meta property="product:availability" content={product.availability} />
        <meta property="product:brand" content={product.brand} />
        <meta property="product:category" content={product.category} />

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:title" content={`${product.name} - ${priceString}`} />
        <meta property="twitter:description" content={product.description} />
        <meta property="twitter:image" content={product.imageUrl} />

        {/* JSON-LD Structured Data */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            description: product.description,
            image: product.imageUrl,
            brand: {
              '@type': 'Brand',
              name: product.brand,
            },
            offers: {
              '@type': 'Offer',
              price: product.price,
              priceCurrency: product.currency,
              availability: `https://schema.org/${product.availability === 'in_stock' ? 'InStock' : 'OutOfStock'}`,
              url: url,
            },
          })}
        </script>
      </Head>

      <div className="product-page">
        <img src={product.imageUrl} alt={product.name} />
        <h1>{product.name}</h1>
        <p className="price">{priceString}</p>
        <p className="description">{product.description}</p>
        <button>Add to Cart</button>
      </div>
    </>
  );
}
```

### Blog Article with Author

```tsx
import { Head } from 'veryfront';

interface ArticleProps {
  article: {
    title: string;
    excerpt: string;
    content: string;
    imageUrl: string;
    imageAlt: string;
    slug: string;
    publishedAt: string;
    modifiedAt: string;
    author: {
      name: string;
      url: string;
      image: string;
    };
    tags: string[];
    readingTime: number;
  };
}

export default function ArticlePage({ article }: ArticleProps) {
  const url = `https://acme.com/blog/${article.slug}`;

  return (
    <>
      <Head>
        {/* Primary Meta Tags */}
        <title>{article.title} - Acme Blog</title>
        <meta name="description" content={article.excerpt} />
        <meta name="author" content={article.author.name} />

        {/* Canonical URL */}
        <link rel="canonical" href={url} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:url" content={url} />
        <meta property="og:title" content={article.title} />
        <meta property="og:description" content={article.excerpt} />
        <meta property="og:image" content={article.imageUrl} />
        <meta property="og:site_name" content="Acme Blog" />

        {/* Article Metadata */}
        <meta property="article:published_time" content={article.publishedAt} />
        <meta property="article:modified_time" content={article.modifiedAt} />
        <meta property="article:author" content={article.author.url} />
        {article.tags.map(tag => (
          <meta key={tag} property="article:tag" content={tag} />
        ))}

        {/* Twitter */}
        <meta property="twitter:card" content="summary_large_image" />
        <meta property="twitter:title" content={article.title} />
        <meta property="twitter:description" content={article.excerpt} />
        <meta property="twitter:image" content={article.imageUrl} />
        <meta property="twitter:image:alt" content={article.imageAlt} />

        {/* JSON-LD Structured Data */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: article.title,
            description: article.excerpt,
            image: article.imageUrl,
            datePublished: article.publishedAt,
            dateModified: article.modifiedAt,
            author: {
              '@type': 'Person',
              name: article.author.name,
              url: article.author.url,
              image: article.author.image,
            },
            publisher: {
              '@type': 'Organization',
              name: 'Acme Blog',
              logo: {
                '@type': 'ImageObject',
                url: 'https://acme.com/logo.png',
              },
            },
            keywords: article.tags.join(', '),
            wordCount: article.content.split(/\s+/).length,
            timeRequired: `PT${article.readingTime}M`,
          })}
        </script>
      </Head>

      <article>
        <header>
          <h1>{article.title}</h1>
          <div className="author">
            <img src={article.author.image} alt={article.author.name} />
            <span>{article.author.name}</span>
          </div>
          <time dateTime={article.publishedAt}>
            {new Date(article.publishedAt).toLocaleDateString()}
          </time>
        </header>

        <img src={article.imageUrl} alt={article.imageAlt} />

        <div dangerouslySetInnerHTML={{ __html: article.content }} />

        <footer>
          <div className="tags">
            {article.tags.map(tag => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        </footer>
      </article>
    </>
  );
}
```

## Quick Reference

### Common Meta Tags

```tsx
<Head>
  {/* Basic */}
  <title>Page Title</title>
  <meta name="description" content="Page description" />
  <meta name="keywords" content="keyword1, keyword2" />
  <meta name="author" content="Author Name" />

  {/* Viewport */}
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  {/* Robots */}
  <meta name="robots" content="index, follow" />
  <meta name="googlebot" content="index, follow" />

  {/* Canonical */}
  <link rel="canonical" href="https://example.com/page" />

  {/* Language */}
  <meta httpEquiv="content-language" content="en" />
</Head>
```

### Open Graph Tags

```tsx
<Head>
  {/* Basic */}
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://example.com" />
  <meta property="og:title" content="Title" />
  <meta property="og:description" content="Description" />
  <meta property="og:image" content="https://example.com/image.png" />
  <meta property="og:site_name" content="Site Name" />

  {/* Image */}
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Image description" />

  {/* Article */}
  <meta property="article:published_time" content="2024-01-01T00:00:00Z" />
  <meta property="article:modified_time" content="2024-01-02T00:00:00Z" />
  <meta property="article:author" content="Author URL" />
  <meta property="article:tag" content="Tag" />
</Head>
```

### Twitter Card Tags

```tsx
<Head>
  {/* Summary Card */}
  <meta property="twitter:card" content="summary" />
  <meta property="twitter:site" content="@username" />
  <meta property="twitter:creator" content="@username" />
  <meta property="twitter:title" content="Title" />
  <meta property="twitter:description" content="Description" />
  <meta property="twitter:image" content="https://example.com/image.png" />

  {/* Large Image Card */}
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image:alt" content="Image description" />
</Head>
```

## Next Steps

- Learn about the [Script component](/docs/components/script.md) for loading external scripts
- Explore [Image optimization](/docs/components/image.md) for better performance
- Read about [SSR](/guides/rendering/ssr.md) for dynamic metadata
- Check out [App Router](/guides/routing/app-router.md) for layout composition
