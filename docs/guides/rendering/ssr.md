---
title: "Server-Side Rendering (SSR) Guide"
category: "rendering"
level: "intermediate"
keywords: ["ssr", "server-side-rendering", "dynamic", "real-time", "getServerData"]
ai_summary: "Complete guide to Server-Side Rendering in Veryfront with real-time data, authentication, personalization, and performance optimization"
related: ["rendering/comparison", "rendering/ssg", "rendering/isr", "rendering/jit"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Server-Side Rendering (SSR) Guide

Server-Side Rendering (SSR) generates HTML on the server for **every request**. The server fetches data, renders React components to HTML, and sends a fully-formed page to the browser.

## What is SSR?

SSR renders pages dynamically on each request:

1. **User requests page** → Server receives request
2. **Server fetches data** → Database queries, API calls
3. **Server renders React** → Components → HTML
4. **Server sends HTML** → Browser displays instantly
5. **React hydrates** → Page becomes interactive

**Result:** Fresh data on every page load, SEO-friendly, personalized content.

---

## Why Use SSR?

### Perfect for:
- **Real-time data** - Stock prices, live scores, user dashboards
- **Personalized content** - User-specific pages, recommendations
- **Authentication** - Protected routes, user sessions
- **Dynamic SEO** - Search results, product catalogs
- **Frequently changing data** - News sites, social feeds

### Advantages:
- ✅ **Always Fresh** - Data never stale
- ✅ **SEO Optimized** - Fully rendered HTML for search engines
- ✅ **Fast First Paint** - Users see content immediately
- ✅ **Secure** - Server-side API keys, database access
- ✅ **Personalized** - Per-user, per-request customization

### Trade-offs:
- ❌ **Server Load** - Renders on every request
- ❌ **Response Time** - Depends on data fetching speed
- ❌ **Scaling Cost** - More servers needed for traffic

**When to use:** Dynamic, personalized, or frequently updated content.

---

## Getting Started

### Basic SSR Page

```typescript
// app/dashboard/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

// This runs on EVERY request
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);
  const stats = await fetchUserStats(user.id);

  return {
    props: { user, stats }
  };
};

const DashboardPage: PageWithData<{
  user: User;
  stats: Stats;
}> = ({ user, stats }) => {
  return (
    <div>
      <h1>Welcome, {user.name}</h1>
      <div>
        <p>Posts: {stats.posts}</p>
        <p>Views: {stats.views}</p>
        <p>Followers: {stats.followers}</p>
      </div>
    </div>
  );
};

export default DashboardPage;
```

**How it works:**
1. User visits `/dashboard`
2. `getServerData` runs on server
3. Fetches user data and stats
4. Renders page with fresh data
5. Sends HTML to browser

---

## Data Fetching with getServerData

### Access Request Context

```typescript
export const getServerData = async (ctx: DataContext) => {
  // URL parameters
  const { slug } = ctx.params;

  // Query string
  const { search, page } = ctx.query;

  // Request object
  const authHeader = ctx.request.headers.get('Authorization');

  // Cookies
  const sessionId = ctx.cookies.get('sessionId');

  return { props: { slug, search, page } };
};
```

### Database Queries

```typescript
// app/posts/[id]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const postId = ctx.params.id;

  // Direct database query
  const post = await db.query(
    'SELECT * FROM posts WHERE id = $1',
    [postId]
  );

  // Fetch related data
  const comments = await db.query(
    'SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at DESC',
    [postId]
  );

  return {
    props: { post: post.rows[0], comments: comments.rows }
  };
};

const PostPage: PageWithData<{
  post: Post;
  comments: Comment[];
}> = ({ post, comments }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>

      <section>
        <h2>Comments ({comments.length})</h2>
        {comments.map(comment => (
          <div key={comment.id}>
            <p>{comment.author}: {comment.text}</p>
          </div>
        ))}
      </section>
    </article>
  );
};

export default PostPage;
```

### External API Calls

```typescript
export const getServerData = async (ctx: DataContext) => {
  const city = ctx.query.city || 'London';

  // Call external API
  const response = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${
      Deno.env.get('WEATHER_API_KEY')
    }`
  );

  const weather = await response.json();

  return {
    props: { weather, city }
  };
};
```

### Parallel Data Fetching

```typescript
export const getServerData = async (ctx: DataContext) => {
  const userId = ctx.params.id;

  // Fetch multiple data sources in parallel
  const [user, posts, followers] = await Promise.all([
    fetchUser(userId),
    fetchUserPosts(userId),
    fetchUserFollowers(userId)
  ]);

  return {
    props: { user, posts, followers }
  };
};
```

---

## Authentication & Protected Routes

### Verify User Session

```typescript
// app/profile/page.tsx
import { redirect } from 'veryfront';
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const sessionId = ctx.cookies.get('sessionId');

  if (!sessionId) {
    // Redirect to login if not authenticated
    return redirect('/login');
  }

  const user = await getSession(sessionId);

  if (!user) {
    return redirect('/login');
  }

  const profile = await fetchUserProfile(user.id);

  return {
    props: { user, profile }
  };
};

const ProfilePage: PageWithData<{
  user: User;
  profile: Profile;
}> = ({ user, profile }) => {
  return (
    <div>
      <h1>{user.name}'s Profile</h1>
      <p>Email: {user.email}</p>
      <p>Bio: {profile.bio}</p>
    </div>
  );
};

export default ProfilePage;
```

### JWT Authentication

```typescript
import { verify } from 'jsonwebtoken';
import { redirect } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const authHeader = ctx.request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return redirect('/login');
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const payload = verify(
      token,
      Deno.env.get('JWT_SECRET')!
    ) as { userId: string };

    const user = await fetchUser(payload.userId);

    return { props: { user } };
  } catch (error) {
    return redirect('/login');
  }
};
```

### Role-Based Access

```typescript
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  if (user.role !== 'admin') {
    return redirect('/unauthorized');
  }

  const users = await fetchAllUsers();
  const stats = await fetchAdminStats();

  return {
    props: { users, stats }
  };
};
```

---

## Personalized Content

### User-Specific Data

```typescript
// app/feed/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  // Personalized feed based on user interests
  const posts = await fetchPersonalizedFeed({
    userId: user.id,
    interests: user.interests,
    following: user.following
  });

  return {
    props: { posts, user }
  };
};
```

### Recommendations

```typescript
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  // ML-based recommendations
  const recommendations = await getRecommendations({
    userId: user.id,
    viewHistory: await fetchViewHistory(user.id),
    preferences: user.preferences
  });

  return {
    props: { recommendations, user }
  };
};
```

### Localization

```typescript
export const getServerData = async (ctx: DataContext) => {
  const locale = ctx.cookies.get('locale') || 'en';
  const currency = ctx.cookies.get('currency') || 'USD';

  const products = await fetchProducts();

  // Convert prices to user's currency
  const localizedProducts = products.map(product => ({
    ...product,
    price: convertCurrency(product.price, currency)
  }));

  return {
    props: {
      products: localizedProducts,
      locale,
      currency
    }
  };
};
```

---

## Error Handling

### Handle Not Found

```typescript
import { notFound } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  if (!post) {
    // Trigger 404 page
    notFound();
  }

  return { props: { post } };
};
```

### Handle Errors

```typescript
export const getServerData = async (ctx: DataContext) => {
  try {
    const data = await fetchData(ctx.params.id);
    return { props: { data } };
  } catch (error) {
    console.error('Error fetching data:', error);

    // Return error props instead of throwing
    return {
      props: {
        error: 'Failed to load data',
        data: null
      }
    };
  }
};

const Page: PageWithData<{ data: Data | null; error?: string }> = ({
  data,
  error
}) => {
  if (error) {
    return <div>Error: {error}</div>;
  }

  return <div>{data.title}</div>;
};
```

### Fallback Data

```typescript
export const getServerData = async (ctx: DataContext) => {
  try {
    const data = await fetchData();
    return { props: { data } };
  } catch (error) {
    // Return fallback data on error
    const cachedData = await getCachedData();
    return {
      props: {
        data: cachedData || [],
        isStale: true
      }
    };
  }
};
```

---

## Performance Optimization

### Caching Headers

```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();

  return {
    props: { data },
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300'
    }
  };
};
```

**Cache-Control options:**
- `max-age=60` - Cache for 60 seconds
- `stale-while-revalidate=300` - Serve stale content while revalidating for 5 minutes
- `private` - User-specific, don't cache in CDN
- `no-cache` - Revalidate every time

### Database Connection Pooling

```typescript
// lib/db.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: Deno.env.get('DATABASE_URL'),
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});

export default pool;

// app/users/page.tsx
import pool from '../../lib/db.ts';

export const getServerData = async (ctx: DataContext) => {
  const result = await pool.query('SELECT * FROM users LIMIT 100');
  return { props: { users: result.rows } };
};
```

### Query Optimization

```typescript
export const getServerData = async (ctx: DataContext) => {
  const postId = ctx.params.id;

  // Bad: N+1 query problem
  // const post = await fetchPost(postId);
  // const author = await fetchUser(post.authorId);
  // const comments = await fetchComments(postId);
  // for (const comment of comments) {
  //   comment.author = await fetchUser(comment.authorId);
  // }

  // Good: Single query with JOINs
  const result = await db.query(`
    SELECT
      posts.*,
      authors.name as author_name,
      authors.avatar as author_avatar,
      comments.id as comment_id,
      comments.text as comment_text,
      comment_authors.name as comment_author_name
    FROM posts
    LEFT JOIN users authors ON posts.author_id = authors.id
    LEFT JOIN comments ON comments.post_id = posts.id
    LEFT JOIN users comment_authors ON comments.author_id = comment_authors.id
    WHERE posts.id = $1
  `, [postId]);

  // Transform flat rows into nested structure
  const post = transformQueryResult(result.rows);

  return { props: { post } };
};
```

### Streaming Responses

```typescript
export const getServerData = async (ctx: DataContext) => {
  // Start with fast data
  const basicData = await fetchBasicData(); // Fast query

  // Defer slow data to client
  return {
    props: { basicData },
    // Client will fetch this separately
    deferredData: {
      slowData: fetchSlowData() // Slow query
    }
  };
};
```

---

## Real-World Patterns

### Dashboard with Live Data

```typescript
// app/dashboard/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  const [stats, recentActivity, notifications] = await Promise.all([
    fetchUserStats(user.id),
    fetchRecentActivity(user.id, { limit: 10 }),
    fetchUnreadNotifications(user.id)
  ]);

  return {
    props: {
      user,
      stats,
      recentActivity,
      notifications,
      timestamp: new Date().toISOString()
    }
  };
};
```

### Search Results

```typescript
// app/search/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const query = ctx.query.q || '';
  const page = parseInt(ctx.query.page || '1');
  const limit = 20;

  if (!query) {
    return { props: { results: [], query: '', total: 0 } };
  }

  const [results, total] = await Promise.all([
    searchPosts(query, { page, limit }),
    countSearchResults(query)
  ]);

  return {
    props: {
      results,
      query,
      page,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};
```

### E-commerce Product Page

```typescript
// app/products/[slug]/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const slug = ctx.params.slug;
  const user = await getCurrentUser(ctx.request);

  const [product, reviews, related] = await Promise.all([
    fetchProduct(slug),
    fetchProductReviews(slug, { limit: 5 }),
    fetchRelatedProducts(slug, { limit: 4 })
  ]);

  if (!product) {
    notFound();
  }

  // Check if product is in user's wishlist
  const inWishlist = user
    ? await isInWishlist(user.id, product.id)
    : false;

  return {
    props: {
      product,
      reviews,
      related,
      inWishlist,
      user
    }
  };
};
```

### User Profile

```typescript
// app/users/[username]/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const username = ctx.params.username;
  const currentUser = await getCurrentUser(ctx.request);

  const user = await fetchUserByUsername(username);

  if (!user) {
    notFound();
  }

  const [posts, followers, following] = await Promise.all([
    fetchUserPosts(user.id, { limit: 20 }),
    countFollowers(user.id),
    countFollowing(user.id)
  ]);

  const isFollowing = currentUser
    ? await checkIsFollowing(currentUser.id, user.id)
    : false;

  return {
    props: {
      user,
      posts,
      followers,
      following,
      isFollowing,
      isOwnProfile: currentUser?.id === user.id
    }
  };
};
```

---

## Best Practices

### 1. Keep getServerData Fast

```typescript
// Bad: Sequential queries (slow)
const user = await fetchUser(id);
const posts = await fetchPosts(user.id);
const comments = await fetchComments(user.id);

// Good: Parallel queries (fast)
const [user, posts, comments] = await Promise.all([
  fetchUser(id),
  fetchPosts(id),
  fetchComments(id)
]);
```

### 2. Use Appropriate Cache-Control

```typescript
// User dashboard: No cache (always fresh)
return {
  props: { data },
  headers: { 'Cache-Control': 'no-cache' }
};

// Public product page: Cache with revalidation
return {
  props: { data },
  headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' }
};
```

### 3. Handle Loading States

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useState, useEffect } from 'react';

export default function Page({ data }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleStart = () => setLoading(true);
    const handleComplete = () => setLoading(false);

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
    };
  }, [router]);

  if (loading) return <LoadingSpinner />;

  return <div>{data.content}</div>;
}
```

### 4. Secure Sensitive Data

```typescript
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  // Only send necessary data to client
  return {
    props: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email
        // Don't send: passwordHash, apiKeys, etc.
      }
    }
  };
};
```

---

## SSR vs Other Rendering Modes

| Feature | SSR | SSG | ISR | JIT |
|---------|-----|-----|-----|-----|
| **Build Time** | None | High | Medium | Low |
| **Response Time** | Medium | Instant | Instant | Instant (cached) |
| **Data Freshness** | Always fresh | Stale until rebuild | Stale until revalidate | Stale until invalidate |
| **Server Load** | High | None | Low | Low |
| **Use Case** | Dynamic, personalized | Static content | Semi-dynamic | Infrequent updates |

**Choose SSR when:**
- Content changes frequently
- Data is user-specific
- Real-time updates required
- Authentication needed

**Consider alternatives when:**
- Content rarely changes → SSG
- Content updates periodically → ISR
- Content updates on-demand → JIT

---

## Related Documentation

- [Rendering Comparison](./comparison.md) - Choose the right mode
- [SSG Guide](./ssg.md) - Static Site Generation
- [ISR Guide](./isr.md) - Incremental Static Regeneration
- [JIT Guide](./jit.md) - Just-In-Time Rendering
- [Data Fetching API](/reference/functions/data-fetching.md) - Complete reference

---

## Examples

- [Auth App](/examples/auth-app/) - Protected SSR routes
- [Data Fetching Demo](/examples/data-fetching-demo/) - All patterns
- [Full Demo](/examples/full-demo/) - Real-world SSR usage

---

## Quick Reference

### Basic SSR
```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();
  return { props: { data } };
};
```

### With Authentication
```typescript
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);
  if (!user) return redirect('/login');
  return { props: { user } };
};
```

### With Caching
```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();
  return {
    props: { data },
    headers: { 'Cache-Control': 'public, max-age=60' }
  };
};
```

### With Error Handling
```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData(ctx.params.id);
  if (!data) notFound();
  return { props: { data } };
};
```
