---
title: Image Component
description: Optimize images with automatic lazy loading, responsive sizes, and modern formats in Veryfront
keywords:
  - image component
  - lazy loading
  - responsive images
  - image optimization
  - WebP
  - AVIF
  - srcset
  - performance
related:
  - /docs/components/head.md
  - /docs/components/link.md
  - /docs/guides/performance/optimization.md
  - /guides/rendering/ssr.md
---

# Image Component

The `Image` component provides automatic image optimization, lazy loading, and responsive image support. It helps improve performance by loading images efficiently and serving modern formats when supported.

## Overview

The Image component in Veryfront provides:

- **Lazy Loading**: Automatic lazy loading using Intersection Observer API
- **Responsive Images**: Serve different image sizes based on viewport
- **Modern Formats**: Automatic WebP and AVIF support with fallbacks
- **Priority Loading**: Disable lazy loading for above-the-fold images
- **Placeholder Support**: Show blurred or solid color placeholders while loading
- **Automatic Sizing**: Calculate optimal image dimensions
- **TypeScript Support**: Full type safety for all props

## Basic Usage

### Simple Image

```tsx
import { Image } from 'veryfront';

export default function ProfilePage() {
  return (
    <div>
      <h1>Profile</h1>
      <Image
        src="/profile.jpg"
        alt="User profile photo"
        width={200}
        height={200}
      />
    </div>
  );
}
```

### Lazy Loading (Default)

```tsx
import { Image } from 'veryfront';

export default function BlogPost() {
  return (
    <article>
      <h1>Article Title</h1>
      <p>Introduction paragraph...</p>

      {/* This image lazy loads when it's near the viewport */}
      <Image
        src="/article-image.jpg"
        alt="Article illustration"
        width={800}
        height={600}
      />

      <p>Article content...</p>
    </article>
  );
}
```

## Priority Loading

### Above-the-Fold Images

Use `priority={true}` for images that should load immediately (like hero images):

```tsx
import { Image } from 'veryfront';

export default function HomePage() {
  return (
    <div>
      {/* Hero image loads immediately */}
      <Image
        src="/hero-banner.jpg"
        alt="Welcome banner"
        width={1920}
        height={1080}
        priority={true}
      />

      <h1>Welcome to Our Site</h1>

      {/* Other images lazy load */}
      <Image
        src="/feature-1.jpg"
        alt="Feature 1"
        width={400}
        height={300}
      />
    </div>
  );
}
```

### LCP Images

```tsx
import { Image } from 'veryfront';

export default function ProductPage({ product }: { product: Product }) {
  return (
    <div className="product-page">
      {/* Main product image is LCP - load with priority */}
      <Image
        src={product.mainImage}
        alt={product.name}
        width={800}
        height={800}
        priority={true}
      />

      <h1>{product.name}</h1>

      {/* Gallery images can lazy load */}
      <div className="gallery">
        {product.galleryImages.map((image, index) => (
          <Image
            key={index}
            src={image.url}
            alt={`${product.name} - Image ${index + 1}`}
            width={400}
            height={400}
          />
        ))}
      </div>
    </div>
  );
}
```

## Responsive Images

### Multiple Sizes with srcset

```tsx
import { Image } from 'veryfront';

export default function ResponsiveImage() {
  return (
    <Image
      src="/image.jpg"
      alt="Responsive image"
      width={800}
      height={600}
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 800px"
      srcSet="/image-400.jpg 400w, /image-800.jpg 800w, /image-1200.jpg 1200w"
    />
  );
}
```

### Automatic Responsive Sizing

```tsx
import { Image } from 'veryfront';

export default function ResponsiveGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {products.map(product => (
        <div key={product.id} className="product-card">
          <Image
            src={product.image}
            alt={product.name}
            width={400}
            height={400}
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
          <h3>{product.name}</h3>
        </div>
      ))}
    </div>
  );
}
```

## Placeholders

### Blur Placeholder

```tsx
import { Image } from 'veryfront';

export default function BlurPlaceholder() {
  return (
    <Image
      src="/high-quality.jpg"
      alt="Product photo"
      width={800}
      height={600}
      placeholder="blur"
      blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
    />
  );
}
```

### Solid Color Placeholder

```tsx
import { Image } from 'veryfront';

export default function ColorPlaceholder() {
  return (
    <Image
      src="/product.jpg"
      alt="Product"
      width={400}
      height={400}
      placeholder="empty"
      style={{ backgroundColor: '#f0f0f0' }}
    />
  );
}
```

### Automatic Blur with Import

```tsx
import { Image } from 'veryfront';
import productImage from './product.jpg';

export default function AutoBlur() {
  return (
    <Image
      src={productImage}
      alt="Product"
      placeholder="blur"
      // blurDataURL is automatically generated from imported image
    />
  );
}
```

## Object Fit and Position

### Cover Mode

```tsx
import { Image } from 'veryfront';

export default function CoverImage() {
  return (
    <div style={{ position: 'relative', width: '400px', height: '300px' }}>
      <Image
        src="/banner.jpg"
        alt="Banner"
        fill={true}
        style={{ objectFit: 'cover' }}
      />
    </div>
  );
}
```

### Contain Mode

```tsx
import { Image } from 'veryfront';

export default function ContainImage() {
  return (
    <div style={{ position: 'relative', width: '400px', height: '300px' }}>
      <Image
        src="/logo.png"
        alt="Logo"
        fill={true}
        style={{ objectFit: 'contain' }}
      />
    </div>
  );
}
```

### Custom Position

```tsx
import { Image } from 'veryfront';

export default function PositionedImage() {
  return (
    <div style={{ position: 'relative', width: '400px', height: '300px' }}>
      <Image
        src="/person.jpg"
        alt="Portrait"
        fill={true}
        style={{
          objectFit: 'cover',
          objectPosition: 'top center'
        }}
      />
    </div>
  );
}
```

## Fill Container

### Fill Mode

Use `fill={true}` when you don't know the image dimensions:

```tsx
import { Image } from 'veryfront';

export default function FillExample() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '400px' }}>
      <Image
        src="/hero.jpg"
        alt="Hero"
        fill={true}
        style={{ objectFit: 'cover' }}
      />
    </div>
  );
}
```

### Background Image Pattern

```tsx
import { Image } from 'veryfront';

export default function BackgroundSection() {
  return (
    <section style={{ position: 'relative', minHeight: '500px' }}>
      <Image
        src="/background.jpg"
        alt="Background"
        fill={true}
        style={{
          objectFit: 'cover',
          zIndex: -1
        }}
        priority={true}
      />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <h1>Overlay Content</h1>
        <p>Content appears on top of the background image</p>
      </div>
    </section>
  );
}
```

## Advanced Patterns

### Product Gallery

```tsx
'use client';

import { Image } from 'veryfront';
import { useState } from 'react';

interface ProductGalleryProps {
  images: Array<{ url: string; alt: string }>;
  productName: string;
}

export function ProductGallery({ images, productName }: ProductGalleryProps) {
  const [selectedImage, setSelectedImage] = useState(0);

  return (
    <div className="product-gallery">
      {/* Main Image */}
      <div className="main-image">
        <Image
          src={images[selectedImage].url}
          alt={images[selectedImage].alt}
          width={800}
          height={800}
          priority={selectedImage === 0}
          sizes="(max-width: 768px) 100vw, 800px"
        />
      </div>

      {/* Thumbnails */}
      <div className="thumbnails">
        {images.map((image, index) => (
          <button
            key={index}
            onClick={() => setSelectedImage(index)}
            className={selectedImage === index ? 'active' : ''}
          >
            <Image
              src={image.url}
              alt={`${productName} thumbnail ${index + 1}`}
              width={100}
              height={100}
              sizes="100px"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
```

### Avatar with Fallback

```tsx
'use client';

import { Image } from 'veryfront';
import { useState } from 'react';

interface AvatarProps {
  src: string;
  alt: string;
  size?: number;
}

export function Avatar({ src, alt, size = 40 }: AvatarProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: '#e0e0e0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size / 2,
          color: '#666'
        }}
      >
        {alt.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      onError={() => setHasError(true)}
      style={{ borderRadius: '50%' }}
    />
  );
}
```

### Image Grid with Lazy Loading

```tsx
import { Image } from 'veryfront';

interface ImageGridProps {
  images: Array<{
    id: string;
    url: string;
    alt: string;
    width: number;
    height: number;
  }>;
}

export function ImageGrid({ images }: ImageGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {images.map((image) => (
        <div key={image.id} className="aspect-square relative">
          <Image
            src={image.url}
            alt={image.alt}
            fill={true}
            style={{ objectFit: 'cover' }}
            sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
          />
        </div>
      ))}
    </div>
  );
}
```

## TypeScript Support

### Type-Safe Image Props

```tsx
import { Image } from 'veryfront';
import type { ComponentProps } from 'react';

type ImageProps = ComponentProps<typeof Image>;

interface OptimizedImageProps extends Omit<ImageProps, 'src'> {
  src: string;
  fallbackSrc?: string;
}

export function OptimizedImage({
  src,
  fallbackSrc = '/placeholder.png',
  ...props
}: OptimizedImageProps) {
  return (
    <Image
      src={src || fallbackSrc}
      {...props}
    />
  );
}

// Usage:
export default function Example() {
  return (
    <OptimizedImage
      src="/product.jpg"
      alt="Product"
      width={400}
      height={400}
      priority={true}
    />
  );
}
```

### Typed Image Gallery

```tsx
import { Image } from 'veryfront';

interface GalleryImage {
  id: string;
  url: string;
  alt: string;
  width: number;
  height: number;
  caption?: string;
}

interface GalleryProps {
  images: GalleryImage[];
  columns?: 2 | 3 | 4;
}

export function Gallery({ images, columns = 3 }: GalleryProps) {
  return (
    <div
      className="gallery-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '1rem'
      }}
    >
      {images.map((image) => (
        <figure key={image.id}>
          <Image
            src={image.url}
            alt={image.alt}
            width={image.width}
            height={image.height}
            sizes={`${100 / columns}vw`}
          />
          {image.caption && <figcaption>{image.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
```

## Best Practices

### 1. Always Provide Alt Text

```tsx
// ❌ Bad: Missing alt text
<Image src="/product.jpg" width={400} height={400} />

// ✅ Good: Descriptive alt text
<Image
  src="/product.jpg"
  alt="Blue cotton t-shirt with logo on chest"
  width={400}
  height={400}
/>
```

### 2. Use Priority for Above-the-Fold Images

```tsx
// ❌ Bad: Hero image lazy loads
<Image src="/hero.jpg" alt="Hero" width={1920} height={1080} />

// ✅ Good: Hero loads immediately
<Image
  src="/hero.jpg"
  alt="Hero"
  width={1920}
  height={1080}
  priority={true}
/>
```

### 3. Specify Dimensions

```tsx
// ❌ Bad: Missing dimensions (causes layout shift)
<Image src="/product.jpg" alt="Product" />

// ✅ Good: Explicit dimensions prevent layout shift
<Image
  src="/product.jpg"
  alt="Product"
  width={800}
  height={600}
/>
```

### 4. Use Appropriate Sizes

```tsx
// ❌ Bad: No sizes attribute (downloads full image on mobile)
<Image
  src="/banner.jpg"
  alt="Banner"
  width={1920}
  height={400}
/>

// ✅ Good: Responsive sizes reduce bandwidth
<Image
  src="/banner.jpg"
  alt="Banner"
  width={1920}
  height={400}
  sizes="(max-width: 768px) 100vw, 1920px"
/>
```

### 5. Optimize Source Images

```tsx
// ❌ Bad: Serving 5MB original image
<Image src="/photo-original.jpg" alt="Photo" width={800} height={600} />

// ✅ Good: Pre-optimized source image
<Image src="/photo-optimized.jpg" alt="Photo" width={800} height={600} />
```

### 6. Use Fill for Unknown Dimensions

```tsx
// ❌ Bad: Hardcoded dimensions for dynamic content
<Image src={dynamicImage} alt="Dynamic" width={400} height={300} />

// ✅ Good: Fill container for flexible layouts
<div style={{ position: 'relative', width: '100%', aspectRatio: '16/9' }}>
  <Image
    src={dynamicImage}
    alt="Dynamic"
    fill={true}
    style={{ objectFit: 'cover' }}
  />
</div>
```

### 7. Provide Placeholder for Better UX

```tsx
// ❌ Bad: No placeholder (blank space while loading)
<Image src="/large-image.jpg" alt="Large" width={1200} height={800} />

// ✅ Good: Blur placeholder improves perceived performance
<Image
  src="/large-image.jpg"
  alt="Large"
  width={1200}
  height={800}
  placeholder="blur"
  blurDataURL="data:image/jpeg;base64,..."
/>
```

## Real-World Examples

### E-commerce Product Card

```tsx
import { Image } from 'veryfront';
import { Link } from 'veryfront';

interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  imageWidth: number;
  imageHeight: number;
  slug: string;
}

export function ProductCard({ product }: { product: Product }) {
  return (
    <Link href={`/products/${product.slug}`}>
      <div className="product-card">
        <div className="image-container">
          <Image
            src={product.image}
            alt={product.name}
            width={product.imageWidth}
            height={product.imageHeight}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            style={{
              width: '100%',
              height: 'auto'
            }}
          />
        </div>
        <div className="details">
          <h3>{product.name}</h3>
          <p className="price">${product.price}</p>
        </div>
      </div>
    </Link>
  );
}
```

### Blog Post Header

```tsx
import { Image } from 'veryfront';

interface BlogHeaderProps {
  title: string;
  coverImage: string;
  coverImageAlt: string;
  author: {
    name: string;
    avatar: string;
  };
  publishedAt: string;
}

export function BlogHeader({
  title,
  coverImage,
  coverImageAlt,
  author,
  publishedAt
}: BlogHeaderProps) {
  return (
    <header className="blog-header">
      {/* Cover Image */}
      <div style={{ position: 'relative', width: '100%', height: '400px' }}>
        <Image
          src={coverImage}
          alt={coverImageAlt}
          fill={true}
          priority={true}
          style={{ objectFit: 'cover' }}
          sizes="100vw"
        />
      </div>

      {/* Content */}
      <div className="header-content">
        <h1>{title}</h1>

        <div className="author-info">
          <Image
            src={author.avatar}
            alt={author.name}
            width={48}
            height={48}
            style={{ borderRadius: '50%' }}
          />
          <div>
            <p className="author-name">{author.name}</p>
            <time dateTime={publishedAt}>
              {new Date(publishedAt).toLocaleDateString()}
            </time>
          </div>
        </div>
      </div>
    </header>
  );
}
```

### Image Carousel

```tsx
'use client';

import { Image } from 'veryfront';
import { useState, useEffect } from 'react';

interface CarouselProps {
  images: Array<{
    url: string;
    alt: string;
  }>;
  autoPlay?: boolean;
  interval?: number;
}

export function Carousel({
  images,
  autoPlay = false,
  interval = 5000
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!autoPlay) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, interval);

    return () => clearInterval(timer);
  }, [autoPlay, interval, images.length]);

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  return (
    <div className="carousel">
      <div className="carousel-container">
        {images.map((image, index) => (
          <div
            key={index}
            className="carousel-slide"
            style={{
              display: index === currentIndex ? 'block' : 'none'
            }}
          >
            <Image
              src={image.url}
              alt={image.alt}
              width={1200}
              height={600}
              priority={index === 0}
              sizes="100vw"
            />
          </div>
        ))}
      </div>

      <button
        onClick={goToPrevious}
        className="carousel-button prev"
        aria-label="Previous image"
      >
        ‹
      </button>

      <button
        onClick={goToNext}
        className="carousel-button next"
        aria-label="Next image"
      >
        ›
      </button>

      <div className="carousel-indicators">
        {images.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={index === currentIndex ? 'active' : ''}
            aria-label={`Go to image ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
```

## Props Reference

### Required Props

| Prop | Type | Description |
|------|------|-------------|
| `src` | `string` | Image source URL (required) |
| `alt` | `string` | Alternative text for accessibility (required) |
| `width` | `number` | Image width in pixels (required unless using `fill`) |
| `height` | `number` | Image height in pixels (required unless using `fill`) |

### Optional Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `fill` | `boolean` | `false` | Fill parent container (replaces width/height) |
| `priority` | `boolean` | `false` | Load image immediately, disable lazy loading |
| `loading` | `'lazy' \| 'eager'` | `'lazy'` | Browser-native lazy loading behavior |
| `placeholder` | `'blur' \| 'empty'` | `'empty'` | Placeholder to show while loading |
| `blurDataURL` | `string` | - | Data URL for blur placeholder |
| `sizes` | `string` | `'100vw'` | Responsive image sizes |
| `srcSet` | `string` | - | Custom srcset for responsive images |
| `quality` | `number` | `75` | Image quality (1-100) |
| `onLoad` | `() => void` | - | Callback when image loads |
| `onError` | `() => void` | - | Callback when image fails to load |
| `style` | `CSSProperties` | - | Inline styles |
| `className` | `string` | - | CSS class name |

## Performance Tips

### 1. Use Modern Formats

Veryfront automatically serves WebP/AVIF when supported, with JPEG/PNG fallbacks.

### 2. Lazy Load Off-Screen Images

By default, images lazy load. Only use `priority={true}` for above-the-fold content.

### 3. Optimize Source Images

Pre-optimize images before upload:
- Compress with tools like ImageOptim, Squoosh, or TinyPNG
- Remove EXIF data
- Use appropriate formats (JPG for photos, PNG for graphics, SVG for icons)

### 4. Use Appropriate Dimensions

Don't serve 2000px images when displaying at 400px. Match source size to display size.

### 5. Implement Responsive Images

Use `sizes` and `srcset` to serve different image sizes based on viewport:

```tsx
<Image
  src="/image.jpg"
  alt="Responsive"
  width={1200}
  height={800}
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 1200px"
  srcSet="/image-400.jpg 400w, /image-800.jpg 800w, /image-1200.jpg 1200w"
/>
```

## Accessibility

### Alt Text Guidelines

```tsx
// ❌ Bad: Generic or redundant alt text
<Image src="/photo.jpg" alt="image" width={400} height={300} />
<Image src="/photo.jpg" alt="Photo" width={400} height={300} />

// ✅ Good: Descriptive alt text
<Image
  src="/sunset.jpg"
  alt="Golden sunset over mountain peaks with purple sky"
  width={800}
  height={600}
/>

// ✅ Good: Empty alt for decorative images
<Image
  src="/decorative-border.png"
  alt=""
  width={1200}
  height={20}
  role="presentation"
/>
```

## Next Steps

- Learn about [Script component](/guides/components/script.md) for loading external scripts
- Explore [Performance optimization](/guides/performance/optimization.md) for more tips
- Check out [Head component](/reference/components/head.md) for metadata management
- Read about [SSR](/guides/rendering/ssr.md) for dynamic image URLs
