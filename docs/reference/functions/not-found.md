---
title: notFound
description: Return a 404 Not Found response from server-side data fetching functions
category: reference
type: function
keywords: [not-found, 404, error-handling, server-side]
related: [/reference/functions/get-server-data.md, /reference/functions/redirect.md]
---

# notFound

Return a 404 Not Found response from server-side data fetching functions. This utility function provides a clean way to handle missing resources.

## Syntax

```typescript
import { notFound } from 'veryfront';

export const getServerData = async (ctx) => {
  const data = await fetchData(ctx.params.id);

  if (!data) {
    return notFound();
  }

  return { props: { data } };
};
```

## Parameters

The `notFound` function takes no parameters.

## Return Value

Returns an object that signals Veryfront to render the 404 page:

```typescript
{
  notFound: true
}
```

## Examples

### Basic Usage

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetch(
    `https://api.example.com/posts/${ctx.params.slug}`
  ).then(res => {
    if (!res.ok) return null;
    return res.json();
  });

  if (!post) {
    return notFound();
  }

  return {
    props: {
      post
    }
  };
};

export default function BlogPost({ post }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  );
}
```

### With Database Query

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';
import { db } from '@/lib/database';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const user = await db.user.findUnique({
    where: { id: ctx.params.id }
  });

  if (!user) {
    return notFound();
  }

  return {
    props: {
      user
    }
  };
};

export default function UserProfile({ user }) {
  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.bio}</p>
    </div>
  );
}
```

### Multiple Conditions

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const product = await fetchProduct(ctx.params.id);

  // Check if product exists
  if (!product) {
    return notFound();
  }

  // Check if product is published
  if (!product.isPublished) {
    return notFound();
  }

  // Check if product is available in user's region
  const userRegion = ctx.headers.get('cloudfront-viewer-country');
  if (!product.availableRegions.includes(userRegion)) {
    return notFound();
  }

  return {
    props: {
      product
    }
  };
};
```

### With Error Handling

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  try {
    const article = await fetch(
      `https://api.example.com/articles/${ctx.params.slug}`
    ).then(res => {
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        throw new Error('Failed to fetch article');
      }
      return res.json();
    });

    if (!article) {
      return notFound();
    }

    return {
      props: {
        article
      }
    };
  } catch (error) {
    console.error('Error fetching article:', error);
    // Return 500 error page instead of 404
    throw error;
  }
};
```

### Conditional Not Found Based on User

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const page = await fetchPage(ctx.params.id);

  if (!page) {
    return notFound();
  }

  // Check if page requires authentication
  if (page.requiresAuth) {
    const token = ctx.headers.get('cookie')?.includes('auth-token');

    if (!token) {
      // Could also redirect to login
      return notFound();
    }
  }

  return {
    props: {
      page
    }
  };
};
```

### With Catch-All Routes

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

// Route: /docs/[...slug]
export const getServerData = async (ctx: DataContext<{ slug: string[] }>) => {
  const path = ctx.params.slug.join('/');

  const doc = await fetch(
    `https://api.example.com/docs/${path}`
  ).then(res => {
    if (!res.ok) return null;
    return res.json();
  });

  if (!doc) {
    return notFound();
  }

  return {
    props: {
      doc
    }
  };
};
```

### With Validation

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  // Validate ID format
  if (!/^[0-9a-f]{24}$/i.test(ctx.params.id)) {
    return notFound();
  }

  const item = await fetchItem(ctx.params.id);

  if (!item) {
    return notFound();
  }

  return {
    props: {
      item
    }
  };
};
```

### Inline Return

You can also return the object directly without using the `notFound()` helper:

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const data = await fetchData(ctx.params.id);

  if (!data) {
    return { notFound: true };  // Equivalent to notFound()
  }

  return {
    props: {
      data
    }
  };
};
```

### With getStaticPaths Fallback

```typescript
import { notFound } from 'veryfront';
import type { GetStaticPaths, DataContext } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetchPopularPosts();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: 'blocking'  // Generate other pages on-demand
  };
};

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetchPost(ctx.params.slug);

  // Return 404 if post doesn't exist
  if (!post) {
    return notFound();
  }

  return {
    props: {
      post
    }
  };
};
```

### Date-Based Not Found

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetchPost(ctx.params.slug);

  if (!post) {
    return notFound();
  }

  // Return 404 if post is scheduled for future
  const publishDate = new Date(post.publishDate);
  if (publishDate > new Date()) {
    return notFound();
  }

  return {
    props: {
      post
    }
  };
};
```

### With Locale/Region

```typescript
import { notFound } from 'veryfront';
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{
  locale: string;
  slug: string;
}>) => {
  const { locale, slug } = ctx.params;

  // Validate locale
  const validLocales = ['en', 'es', 'fr', 'de'];
  if (!validLocales.includes(locale)) {
    return notFound();
  }

  const content = await fetchContent(slug, locale);

  if (!content) {
    return notFound();
  }

  return {
    props: {
      content
    }
  };
};
```

## Behavior

- **HTTP 404**: Sends a 404 HTTP status code
- **Custom 404 page**: Renders your custom 404 page (if defined)
- **SEO friendly**: Search engines recognize and handle 404 responses properly
- **Server-side only**: Can only be used in `getServerData` or `getStaticPaths`

## Custom 404 Pages

### App Router

Create a `not-found.tsx` file in your app directory:

```typescript
// app/not-found.tsx
import { Link } from 'veryfront';

export default function NotFound() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <Link href="/">Go back home</Link>
    </div>
  );
}
```

### Pages Router

Create a `404.tsx` file in your pages directory:

```typescript
// pages/404.tsx
import { Link } from 'veryfront';

export default function Custom404() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <Link href="/">Go back home</Link>
    </div>
  );
}
```

## Notes

- Only works in server-side context (`getServerData`, `getStaticPaths`)
- Cannot be used in client components or API routes
- Prefer `notFound()` over throwing errors for missing resources
- The `notFound()` helper is a convenience wrapper for `{ notFound: true }`
- Results in a 404 HTTP status code
- Triggers rendering of your custom 404 page

## Related

- [getServerData](/reference/functions/get-server-data.md) - Server-side data fetching
- [redirect](/reference/functions/redirect.md) - Redirect users
- [getStaticPaths](/reference/functions/get-static-paths.md) - Define static paths
