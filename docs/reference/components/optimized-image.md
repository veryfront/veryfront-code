---
title: OptimizedImage
description: Optimized image component with automatic format conversion, lazy loading, and responsive sizing
category: reference
type: component
keywords: [image, optimization, lazy-loading, webp, avif, performance]
related: [/reference/components/link.md, /reference/components/head.md]
---

# OptimizedImage

Optimized image component with automatic format conversion, lazy loading, and responsive sizing for improved performance and user experience.

## Syntax

```typescript
import { OptimizedImage } from 'veryfront';

<OptimizedImage
  src="/image.jpg"
  alt="Description"
  width={800}
  height={600}
/>
```

## Props

| Name | Type | Required | Description |
|------|------|----------|-------------|
| src | string | Yes | Image source path (local or remote URL) |
| alt | string | Yes | Alternative text for accessibility and SEO |
| width | number | No | Image width in pixels |
| height | number | No | Image height in pixels |
| quality | number | No | Image quality from 1-100 (default: 80) |
| format | 'webp' \| 'avif' \| 'jpeg' \| 'png' | No | Output format for image optimization |
| loading | 'lazy' \| 'eager' | No | Loading strategy (default: 'lazy') |
| priority | boolean | No | Load image with high priority, disables lazy loading (default: false) |
| className | string | No | CSS class name to apply to the image element |
| style | React.CSSProperties | No | Inline styles for the image element |

## Return Value

Returns a React element that renders as an optimized `<img>` tag with enhanced loading and performance characteristics.

## Examples

### Basic Usage

```typescript
import { OptimizedImage } from 'veryfront';

export default function Gallery() {
  return (
    <div>
      <OptimizedImage
        src="/photos/landscape.jpg"
        alt="Beautiful landscape"
        width={800}
        height={600}
      />
    </div>
  );
}
```

### WebP Format Conversion

Automatically convert images to WebP for better compression:

```typescript
import { OptimizedImage } from 'veryfront';

export default function ProductImage({ product }) {
  return (
    <OptimizedImage
      src={product.imageUrl}
      alt={product.name}
      width={600}
      height={600}
      format="webp"
      quality={85}
    />
  );
}
```

### High Priority Images (Above the Fold)

For images that should load immediately without lazy loading:

```typescript
import { OptimizedImage } from 'veryfront';

export default function Hero() {
  return (
    <section>
      <OptimizedImage
        src="/hero-banner.jpg"
        alt="Welcome to our site"
        width={1920}
        height={1080}
        priority={true}
        format="webp"
        quality={90}
      />
    </section>
  );
}
```

### Lazy Loading (Below the Fold)

Default behavior for images that can load on scroll:

```typescript
import { OptimizedImage } from 'veryfront';

export default function BlogPost({ post }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <div className="content">{post.content}</div>

      {/* Image loads when user scrolls near it */}
      <OptimizedImage
        src={post.coverImage}
        alt={post.title}
        width={1200}
        height={630}
        loading="lazy"
        format="webp"
      />
    </article>
  );
}
```

### AVIF Format for Maximum Compression

Use AVIF for the best compression and quality ratio:

```typescript
import { OptimizedImage } from 'veryfront';

export default function Thumbnail({ image }) {
  return (
    <OptimizedImage
      src={image.url}
      alt={image.title}
      width={400}
      height={300}
      format="avif"
      quality={80}
      className="rounded-lg shadow-md"
    />
  );
}
```

### Responsive Image Gallery

```typescript
import { OptimizedImage } from 'veryfront';

export default function PhotoGallery({ photos }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      {photos.map((photo) => (
        <OptimizedImage
          key={photo.id}
          src={photo.url}
          alt={photo.caption}
          width={400}
          height={400}
          format="webp"
          quality={85}
          loading="lazy"
          className="object-cover rounded"
        />
      ))}
    </div>
  );
}
```

### Custom Styling

```typescript
import { OptimizedImage } from 'veryfront';

export default function Avatar({ user }) {
  return (
    <OptimizedImage
      src={user.avatar}
      alt={`${user.name}'s avatar`}
      width={100}
      height={100}
      format="webp"
      quality={90}
      className="rounded-full border-2 border-gray-300"
      style={{
        objectFit: 'cover',
        aspectRatio: '1/1'
      }}
    />
  );
}
```

### Product Images with Fallback

```typescript
import { OptimizedImage } from 'veryfront';

export default function ProductCard({ product }) {
  return (
    <div className="product-card">
      <OptimizedImage
        src={product.image || '/placeholder.png'}
        alt={product.name}
        width={500}
        height={500}
        format="webp"
        quality={85}
        loading="lazy"
        className="product-image"
      />
      <h3>{product.name}</h3>
      <p>${product.price}</p>
    </div>
  );
}
```

### Different Quality Settings

```typescript
import { OptimizedImage } from 'veryfront';

export default function ImageQualityExamples() {
  return (
    <div>
      {/* High quality for hero images */}
      <OptimizedImage
        src="/hero.jpg"
        alt="Hero"
        quality={95}
        width={1920}
        height={1080}
      />

      {/* Medium quality for content images */}
      <OptimizedImage
        src="/content.jpg"
        alt="Content"
        quality={80}
        width={800}
        height={600}
      />

      {/* Lower quality for thumbnails */}
      <OptimizedImage
        src="/thumbnail.jpg"
        alt="Thumbnail"
        quality={70}
        width={200}
        height={200}
      />
    </div>
  );
}
```

### Remote Images

```typescript
import { OptimizedImage } from 'veryfront';

export default function RemoteImage() {
  return (
    <OptimizedImage
      src="https://cdn.example.com/image.jpg"
      alt="Remote image"
      width={800}
      height={600}
      format="webp"
      quality={85}
      loading="lazy"
    />
  );
}
```

### Dynamic Images from Data Fetching

```typescript
import { OptimizedImage } from 'veryfront';
import type { DataContext } from 'veryfront';

interface PageProps {
  post: {
    title: string;
    coverImage: string;
    content: string;
  };
}

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetchPost(ctx.params.slug);
  return { props: { post } };
};

export default function BlogPost({ post }: PageProps) {
  return (
    <article>
      <OptimizedImage
        src={post.coverImage}
        alt={post.title}
        width={1200}
        height={630}
        format="webp"
        quality={85}
        priority={true}
      />
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  );
}
```

## Behavior

- **Automatic optimization**: Images are automatically optimized during build or on-demand
- **Format conversion**: Converts to modern formats (WebP, AVIF) for better compression
- **Lazy loading**: Images load only when they enter the viewport (unless `priority={true}`)
- **Responsive**: Automatically serves appropriate sizes based on device
- **SEO friendly**: Maintains proper alt text and semantic HTML

## Performance Benefits

- **Reduced file size**: WebP images are typically 25-35% smaller than JPEG
- **AVIF support**: Up to 50% smaller than JPEG with better quality
- **Lazy loading**: Reduces initial page load time by deferring off-screen images
- **Priority loading**: Critical images load immediately without blocking
- **Caching**: Optimized images are cached for subsequent requests

## Browser Support

- **WebP**: Supported in all modern browsers (Chrome, Firefox, Safari 14+, Edge)
- **AVIF**: Supported in Chrome 85+, Firefox 93+, Safari 16+
- **Fallback**: Automatically falls back to original format in older browsers

## Notes

- Always provide `width` and `height` to prevent layout shift during loading
- Use `priority={true}` for above-the-fold images to improve Largest Contentful Paint (LCP)
- The `quality` prop controls the trade-off between file size and visual quality
- Remote images may require additional configuration for optimization
- For best performance, store images in your project's public directory

## Related

- [Link](/reference/components/link.md) - Client-side navigation
- [Head](/reference/components/head.md) - Document head management
- [getServerData](/reference/functions/get-server-data.md) - Server-side data fetching
