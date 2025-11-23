---
title: RSC (React Server Components)
description: Modern server-first rendering with React Server Components in Veryfront
category: rendering
tags: [rsc, server-components, streaming, suspense, performance]
related:
  - rendering/ssr
  - rendering/comparison
  - routing/app-router
  - api/streaming
difficulty: advanced
---

# RSC (React Server Components)

React Server Components (RSC) is a modern rendering paradigm that enables server-first components with automatic code splitting, streaming, and zero client-side JavaScript for data fetching. RSC is **only available with the App Router** in Veryfront.

## Overview

React Server Components fundamentally change how we think about React applications:

- ✅ **Server-First**: Components render on the server by default
- ✅ **Zero Client JS**: Data fetching code never ships to the browser
- ✅ **Automatic Code Splitting**: Only interactive components load on client
- ✅ **Streaming**: Send HTML progressively as it renders
- ✅ **Direct Data Access**: Fetch data directly in components without APIs
- ✅ **Improved Performance**: Smaller bundles, faster initial loads

### Server vs Client Components

```typescript
// Server Component (default in App Router)
// app/blog/page.tsx
export default async function BlogPage() {
  // This runs ONLY on the server
  const posts = await db.posts.findAll();

  return (
    <div>
      <h1>Blog Posts</h1>
      {posts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

// Client Component (opt-in with 'use client')
// components/search-box.tsx
'use client';

import { useState } from 'react';

export function SearchBox() {
  // This runs on the client
  const [query, setQuery] = useState('');

  return (
    <input
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Search..."
    />
  );
}
```

## Getting Started

### Basic Server Component

Server components are async and can fetch data directly:

```typescript
// app/products/page.tsx
import { db } from '@/lib/db';

export default async function ProductsPage() {
  // Fetch data directly - no API route needed!
  const products = await db.products.findAll({
    where: { active: true },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="products">
      <h1>Our Products</h1>
      <div className="grid">
        {products.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </div>
  );
}

// This component is also a server component
function ProductCard({ product }: { product: Product }) {
  return (
    <div className="card">
      <img src={product.image} alt={product.name} />
      <h2>{product.name}</h2>
      <p>${product.price}</p>
    </div>
  );
}
```

### Adding Client Interactivity

Use `'use client'` directive for interactive components:

```typescript
// app/products/page.tsx
import { SearchBox } from '@/components/search-box';
import { db } from '@/lib/db';

export default async function ProductsPage() {
  const products = await db.products.findAll();

  return (
    <div>
      <h1>Products</h1>

      {/* Client component for interactivity */}
      <SearchBox />

      {/* Server component for data */}
      <ProductList products={products} />
    </div>
  );
}

// components/search-box.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'veryfront';

export function SearchBox() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const handleSearch = () => {
    router.push(`/products/search?q=${query}`);
  };

  return (
    <div className="search">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        placeholder="Search products..."
      />
      <button onClick={handleSearch}>Search</button>
    </div>
  );
}
```

## Data Fetching Patterns

### Pattern 1: Parallel Data Fetching

Fetch multiple data sources in parallel:

```typescript
// app/dashboard/page.tsx
export default async function DashboardPage() {
  // These fetch in parallel!
  const [user, stats, notifications, recentActivity] = await Promise.all([
    db.users.getCurrent(),
    db.analytics.getStats(),
    db.notifications.getRecent(),
    db.activity.getRecent()
  ]);

  return (
    <div className="dashboard">
      <UserHeader user={user} />
      <StatsGrid stats={stats} />
      <NotificationsList notifications={notifications} />
      <ActivityFeed activity={recentActivity} />
    </div>
  );
}
```

### Pattern 2: Sequential Data Fetching

Fetch data that depends on previous data:

```typescript
// app/posts/[id]/page.tsx
export default async function PostPage({ params }: { params: { id: string } }) {
  // First, get the post
  const post = await db.posts.findById(params.id);

  if (!post) {
    notFound();
  }

  // Then, get data that depends on the post
  const [author, comments, relatedPosts] = await Promise.all([
    db.users.findById(post.authorId),
    db.comments.findByPost(post.id),
    db.posts.findRelated(post.category, post.id)
  ]);

  return (
    <article>
      <PostHeader post={post} author={author} />
      <PostContent content={post.content} />
      <CommentsSection comments={comments} />
      <RelatedPosts posts={relatedPosts} />
    </article>
  );
}
```

### Pattern 3: Deduplication

Veryfront automatically deduplicates identical fetch requests:

```typescript
// app/blog/[slug]/page.tsx
export default async function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = await fetchPost(params.slug);

  return (
    <div>
      <PostHeader post={post} />
      <PostContent post={post} />
    </div>
  );
}

// These two components both fetch the same post
// But Veryfront only makes ONE database query!
async function PostHeader({ post }: { post: Post }) {
  // This fetch is deduplicated
  const author = await fetchUser(post.authorId);
  return <header>{post.title} by {author.name}</header>;
}

async function PostContent({ post }: { post: Post }) {
  // This fetch is also deduplicated
  const author = await fetchUser(post.authorId);
  return <div>{post.content} - {author.bio}</div>;
}

// Helper function
async function fetchUser(id: string) {
  return await db.users.findById(id);
}
```

### Pattern 4: Streaming with Suspense

Stream parts of the page as they load:

```typescript
// app/dashboard/page.tsx
import { Suspense } from 'react';

export default function DashboardPage() {
  return (
    <div className="dashboard">
      {/* Header loads immediately */}
      <DashboardHeader />

      {/* Stats stream in when ready */}
      <Suspense fallback={<StatsLoading />}>
        <DashboardStats />
      </Suspense>

      {/* Activity streams in independently */}
      <Suspense fallback={<ActivityLoading />}>
        <RecentActivity />
      </Suspense>
    </div>
  );
}

async function DashboardStats() {
  // This can be slow - page doesn't wait for it
  const stats = await db.analytics.getStats();

  return (
    <div className="stats">
      <StatCard label="Users" value={stats.users} />
      <StatCard label="Revenue" value={stats.revenue} />
    </div>
  );
}

async function RecentActivity() {
  // This also streams in independently
  const activity = await db.activity.getRecent();

  return (
    <div className="activity">
      {activity.map(item => (
        <ActivityItem key={item.id} item={item} />
      ))}
    </div>
  );
}

function StatsLoading() {
  return <div className="skeleton">Loading stats...</div>;
}

function ActivityLoading() {
  return <div className="skeleton">Loading activity...</div>;
}
```

## Component Composition

### Passing Server Components to Client Components

You can pass server components as children to client components:

```typescript
// app/blog/page.tsx
import { Tabs } from '@/components/tabs'; // Client component

export default async function BlogPage() {
  const [recentPosts, popularPosts] = await Promise.all([
    db.posts.findRecent(),
    db.posts.findPopular()
  ]);

  return (
    <Tabs>
      {/* Server components passed as children */}
      <Tab label="Recent">
        <PostList posts={recentPosts} />
      </Tab>
      <Tab label="Popular">
        <PostList posts={popularPosts} />
      </Tab>
    </Tabs>
  );
}

// Server component
async function PostList({ posts }: { posts: Post[] }) {
  return (
    <div>
      {posts.map(post => (
        <PostCard key={post.id} post={post} />
      ))}
    </div>
  );
}

// components/tabs.tsx
'use client';

import { useState } from 'react';

export function Tabs({ children }: { children: React.ReactNode[] }) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <div className="tabs">
      <div className="tab-buttons">
        {children.map((child, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(i)}
            className={i === activeTab ? 'active' : ''}
          >
            {child.props.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {children[activeTab]}
      </div>
    </div>
  );
}

export function Tab({ children }: { label: string; children: React.ReactNode }) {
  return <div>{children}</div>;
}
```

### Context Providers in Server Components

Use client components for context providers:

```typescript
// app/layout.tsx
import { ThemeProvider } from '@/components/theme-provider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

// components/theme-provider.tsx
'use client';

import { createContext, useState, useContext } from 'react';

const ThemeContext = createContext<{
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
}>({ theme: 'light', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className={theme}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

## Streaming and Suspense

### Nested Suspense Boundaries

Create multiple suspense boundaries for fine-grained streaming:

```typescript
// app/product/[id]/page.tsx
import { Suspense } from 'react';

export default async function ProductPage({ params }: { params: { id: string } }) {
  // Product data loads first
  const product = await db.products.findById(params.id);

  return (
    <div>
      {/* Product details load immediately */}
      <ProductDetails product={product} />

      {/* Reviews stream in independently */}
      <Suspense fallback={<ReviewsLoading />}>
        <ProductReviews productId={product.id} />
      </Suspense>

      {/* Recommendations stream in independently */}
      <Suspense fallback={<RecommendationsLoading />}>
        <ProductRecommendations productId={product.id} />
      </Suspense>

      {/* Nested suspense for Q&A */}
      <Suspense fallback={<QALoading />}>
        <ProductQA productId={product.id} />
      </Suspense>
    </div>
  );
}

async function ProductReviews({ productId }: { productId: string }) {
  // Slow query - doesn't block the page
  const reviews = await db.reviews.findByProduct(productId);

  return (
    <section className="reviews">
      <h2>Customer Reviews</h2>
      {reviews.map(review => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </section>
  );
}

async function ProductRecommendations({ productId }: { productId: string }) {
  // ML recommendation query - also doesn't block
  const recommendations = await ml.getRecommendations(productId);

  return (
    <section className="recommendations">
      <h2>You May Also Like</h2>
      {recommendations.map(product => (
        <ProductCard key={product.id} product={product} />
      ))}
    </section>
  );
}

async function ProductQA({ productId }: { productId: string }) {
  const questions = await db.questions.findByProduct(productId);

  return (
    <section className="qa">
      <h2>Questions & Answers</h2>
      {questions.map(q => (
        <QuestionCard key={q.id} question={q} />
      ))}
    </section>
  );
}
```

### Streaming with Loading UI

Use the `loading.tsx` file convention for automatic suspense:

```typescript
// app/dashboard/loading.tsx
export default function DashboardLoading() {
  return (
    <div className="dashboard-loading">
      <div className="skeleton header" />
      <div className="skeleton stats-grid" />
      <div className="skeleton chart" />
    </div>
  );
}

// app/dashboard/page.tsx
export default async function DashboardPage() {
  // Page automatically wrapped in Suspense with loading.tsx
  const data = await fetchDashboardData();

  return (
    <div className="dashboard">
      <DashboardHeader data={data} />
      <StatsGrid stats={data.stats} />
      <Chart data={data.chartData} />
    </div>
  );
}
```

## Real-World Examples

### Example 1: E-commerce Product Page

Complete product page with streaming:

```typescript
// app/shop/[category]/[product]/page.tsx
import { Suspense } from 'react';
import { notFound } from 'veryfront';

export default async function ProductPage({
  params
}: {
  params: { category: string; product: string };
}) {
  // Critical product data loads first
  const product = await db.products.findOne({
    category: params.category,
    slug: params.product
  });

  if (!product) {
    notFound();
  }

  return (
    <div className="product-page">
      {/* Above the fold - loads immediately */}
      <div className="product-main">
        <ProductImages images={product.images} />
        <ProductInfo product={product} />
        <AddToCartButton product={product} />
      </div>

      {/* Below the fold - streams in */}
      <Suspense fallback={<DescriptionLoading />}>
        <ProductDescription productId={product.id} />
      </Suspense>

      <Suspense fallback={<ReviewsLoading />}>
        <ReviewsSection productId={product.id} />
      </Suspense>

      <Suspense fallback={<RecommendationsLoading />}>
        <RelatedProducts categoryId={product.categoryId} productId={product.id} />
      </Suspense>
    </div>
  );
}

function ProductImages({ images }: { images: string[] }) {
  return (
    <div className="product-images">
      <img src={images[0]} alt="Product" className="main-image" />
      <div className="thumbnails">
        {images.slice(1).map((img, i) => (
          <img key={i} src={img} alt={`View ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}

function ProductInfo({ product }: { product: Product }) {
  return (
    <div className="product-info">
      <h1>{product.name}</h1>
      <div className="price">${product.price}</div>
      <div className="stock">
        {product.stock > 0 ? `In Stock (${product.stock})` : 'Out of Stock'}
      </div>
    </div>
  );
}

// components/add-to-cart-button.tsx
'use client';

export function AddToCartButton({ product }: { product: Product }) {
  const handleAddToCart = () => {
    // Client-side cart logic
    addToCart(product);
  };

  return (
    <button
      onClick={handleAddToCart}
      disabled={product.stock === 0}
      className="add-to-cart"
    >
      Add to Cart
    </button>
  );
}

async function ProductDescription({ productId }: { productId: string }) {
  const product = await db.products.findById(productId);

  return (
    <section className="description">
      <h2>Product Description</h2>
      <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
    </section>
  );
}

async function ReviewsSection({ productId }: { productId: string }) {
  const reviews = await db.reviews.findByProduct(productId, { limit: 10 });
  const stats = await db.reviews.getStats(productId);

  return (
    <section className="reviews">
      <h2>Customer Reviews</h2>
      <div className="review-stats">
        <span className="rating">{stats.averageRating} / 5</span>
        <span className="count">({stats.totalReviews} reviews)</span>
      </div>
      {reviews.map(review => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </section>
  );
}

async function RelatedProducts({
  categoryId,
  productId
}: {
  categoryId: string;
  productId: string;
}) {
  const related = await db.products.findRelated(categoryId, productId, { limit: 4 });

  return (
    <section className="related">
      <h2>You May Also Like</h2>
      <div className="grid">
        {related.map(p => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
```

### Example 2: Social Media Feed

Infinite scroll feed with RSC:

```typescript
// app/feed/page.tsx
import { Suspense } from 'react';

export default function FeedPage() {
  return (
    <div className="feed">
      <CreatePost />

      <Suspense fallback={<FeedLoading />}>
        <FeedPosts />
      </Suspense>
    </div>
  );
}

// components/create-post.tsx
'use client';

export function CreatePost() {
  const [content, setContent] = useState('');

  const handlePost = async () => {
    await fetch('/api/posts', {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    setContent('');
    // Trigger revalidation
    window.location.reload();
  };

  return (
    <div className="create-post">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="What's on your mind?"
      />
      <button onClick={handlePost}>Post</button>
    </div>
  );
}

async function FeedPosts() {
  const posts = await db.posts.findRecent({ limit: 20 });

  return (
    <div className="posts">
      {posts.map(post => (
        <Suspense key={post.id} fallback={<PostLoading />}>
          <Post postId={post.id} />
        </Suspense>
      ))}
    </div>
  );
}

async function Post({ postId }: { postId: string }) {
  const [post, author, likes, comments] = await Promise.all([
    db.posts.findById(postId),
    db.posts.getAuthor(postId),
    db.posts.getLikes(postId),
    db.posts.getComments(postId, { limit: 3 })
  ]);

  return (
    <article className="post">
      <div className="post-header">
        <img src={author.avatar} alt={author.name} />
        <div>
          <span className="author">{author.name}</span>
          <time>{new Date(post.createdAt).toLocaleString()}</time>
        </div>
      </div>

      <div className="post-content">{post.content}</div>

      <div className="post-actions">
        <LikeButton postId={post.id} initialLikes={likes} />
        <CommentButton postId={post.id} commentCount={comments.length} />
      </div>

      {comments.length > 0 && (
        <div className="comments">
          {comments.map(comment => (
            <Comment key={comment.id} comment={comment} />
          ))}
        </div>
      )}
    </article>
  );
}

// components/like-button.tsx
'use client';

export function LikeButton({ postId, initialLikes }: { postId: string; initialLikes: number }) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);

  const handleLike = async () => {
    setLiked(!liked);
    setLikes(liked ? likes - 1 : likes + 1);

    await fetch(`/api/posts/${postId}/like`, {
      method: 'POST',
      body: JSON.stringify({ liked: !liked })
    });
  };

  return (
    <button onClick={handleLike} className={liked ? 'liked' : ''}>
      ❤️ {likes}
    </button>
  );
}
```

### Example 3: Analytics Dashboard

Real-time dashboard with streaming data:

```typescript
// app/analytics/page.tsx
import { Suspense } from 'react';

export default async function AnalyticsPage() {
  // Load user info immediately
  const user = await db.users.getCurrent();

  return (
    <div className="analytics-dashboard">
      <DashboardHeader user={user} />

      <div className="dashboard-grid">
        {/* Each metric streams in independently */}
        <Suspense fallback={<MetricLoading />}>
          <TotalUsersMetric />
        </Suspense>

        <Suspense fallback={<MetricLoading />}>
          <RevenueMetric />
        </Suspense>

        <Suspense fallback={<MetricLoading />}>
          <ConversionsMetric />
        </Suspense>

        <Suspense fallback={<MetricLoading />}>
          <ActiveUsersMetric />
        </Suspense>
      </div>

      {/* Charts stream in after metrics */}
      <div className="charts">
        <Suspense fallback={<ChartLoading />}>
          <RevenueChart />
        </Suspense>

        <Suspense fallback={<ChartLoading />}>
          <UserGrowthChart />
        </Suspense>
      </div>

      {/* Recent activity */}
      <Suspense fallback={<ActivityLoading />}>
        <RecentActivity />
      </Suspense>
    </div>
  );
}

async function TotalUsersMetric() {
  const count = await db.users.count();
  const growth = await db.analytics.getUserGrowth();

  return (
    <MetricCard
      label="Total Users"
      value={count.toLocaleString()}
      change={growth}
    />
  );
}

async function RevenueMetric() {
  const revenue = await db.analytics.getTotalRevenue();
  const growth = await db.analytics.getRevenueGrowth();

  return (
    <MetricCard
      label="Revenue"
      value={`$${revenue.toLocaleString()}`}
      change={growth}
    />
  );
}

async function ConversionsMetric() {
  const conversions = await db.analytics.getConversions();
  const rate = await db.analytics.getConversionRate();

  return (
    <MetricCard
      label="Conversions"
      value={conversions.toLocaleString()}
      subtitle={`${rate}% conversion rate`}
    />
  );
}

async function ActiveUsersMetric() {
  const active = await db.analytics.getActiveUsers();

  return (
    <MetricCard
      label="Active Users"
      value={active.toLocaleString()}
      subtitle="Last 30 days"
    />
  );
}

function MetricCard({
  label,
  value,
  change,
  subtitle
}: {
  label: string;
  value: string;
  change?: number;
  subtitle?: string;
}) {
  return (
    <div className="metric-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {change !== undefined && (
        <div className={`change ${change >= 0 ? 'positive' : 'negative'}`}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change)}%
        </div>
      )}
      {subtitle && <div className="subtitle">{subtitle}</div>}
    </div>
  );
}

async function RevenueChart() {
  const data = await db.analytics.getRevenueChartData();

  return (
    <div className="chart">
      <h3>Revenue Trend</h3>
      <ChartComponent data={data} type="line" />
    </div>
  );
}

async function UserGrowthChart() {
  const data = await db.analytics.getUserGrowthData();

  return (
    <div className="chart">
      <h3>User Growth</h3>
      <ChartComponent data={data} type="bar" />
    </div>
  );
}

async function RecentActivity() {
  const activities = await db.activity.getRecent({ limit: 10 });

  return (
    <div className="recent-activity">
      <h3>Recent Activity</h3>
      <ul>
        {activities.map(activity => (
          <li key={activity.id}>
            <span className="user">{activity.user.name}</span>
            <span className="action">{activity.action}</span>
            <time>{new Date(activity.timestamp).toLocaleString()}</time>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricLoading() {
  return <div className="metric-card skeleton" />;
}

function ChartLoading() {
  return <div className="chart skeleton" />;
}

function ActivityLoading() {
  return <div className="activity skeleton" />;
}
```

## Performance Optimization

### Optimize Bundle Size

Only client components ship to the browser:

```typescript
// ❌ Bad: Entire heavy library ships to client
'use client';

import { parse } from 'huge-markdown-library'; // 500KB!

export function MarkdownViewer({ content }: { content: string }) {
  const html = parse(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// ✅ Good: Library only runs on server
import { parse } from 'huge-markdown-library'; // 0KB shipped to client!

export async function MarkdownViewer({ content }: { content: string }) {
  const html = parse(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

### Preload Data

Use React's `preload` pattern for critical data:

```typescript
// lib/data.ts
import { cache } from 'react';

export const preloadUser = (id: string) => {
  void getUser(id); // Starts fetching but doesn't wait
};

export const getUser = cache(async (id: string) => {
  return await db.users.findById(id);
});

// app/users/[id]/page.tsx
import { preloadUser, getUser } from '@/lib/data';

export default async function UserPage({ params }: { params: { id: string } }) {
  // Start fetching immediately
  preloadUser(params.id);

  // This will likely hit cache
  const user = await getUser(params.id);

  return <UserProfile user={user} />;
}
```

### Optimize Images

Use Veryfront's optimized image component:

```typescript
// app/gallery/page.tsx
import { OptimizedImage } from 'veryfront';

export default async function GalleryPage() {
  const images = await db.images.findAll();

  return (
    <div className="gallery">
      {images.map(image => (
        <OptimizedImage
          key={image.id}
          src={image.url}
          alt={image.alt}
          width={400}
          height={300}
          loading="lazy"
        />
      ))}
    </div>
  );
}
```

## Best Practices

### 1. Keep Client Components Small

```typescript
// ❌ Bad: Entire page is a client component
'use client';

export default function ProductPage() {
  const [liked, setLiked] = useState(false);

  // All this data fetching code ships to client!
  const product = useSWR('/api/product');
  const reviews = useSWR('/api/reviews');

  return (
    <div>
      <ProductDetails product={product} />
      <Reviews reviews={reviews} />
      <button onClick={() => setLiked(!liked)}>
        {liked ? 'Unlike' : 'Like'}
      </button>
    </div>
  );
}

// ✅ Good: Only interactive part is client component
export default async function ProductPage() {
  // Data fetching on server - doesn't ship to client
  const [product, reviews] = await Promise.all([
    fetchProduct(),
    fetchReviews()
  ]);

  return (
    <div>
      <ProductDetails product={product} />
      <Reviews reviews={reviews} />
      {/* Only the button is a client component */}
      <LikeButton />
    </div>
  );
}

// components/like-button.tsx
'use client';

export function LikeButton() {
  const [liked, setLiked] = useState(false);

  return (
    <button onClick={() => setLiked(!liked)}>
      {liked ? 'Unlike' : 'Like'}
    </button>
  );
}
```

### 2. Use Suspense Strategically

```typescript
// ✅ Good: Suspense boundaries around slow queries
export default function DashboardPage() {
  return (
    <div>
      {/* Fast data loads immediately */}
      <DashboardHeader />

      {/* Slow data streams in */}
      <Suspense fallback={<Loading />}>
        <SlowDataComponent />
      </Suspense>
    </div>
  );
}
```

### 3. Avoid Serialization Issues

```typescript
// ❌ Bad: Can't serialize functions or classes
export default async function Page() {
  const data = {
    date: new Date(), // Can't serialize Date
    callback: () => {} // Can't serialize functions
  };

  return <ClientComponent data={data} />;
}

// ✅ Good: Only serialize plain objects
export default async function Page() {
  const data = {
    date: new Date().toISOString(), // Serialize as string
    timestamp: Date.now() // Or as number
  };

  return <ClientComponent data={data} />;
}
```

### 4. Handle Errors Gracefully

```typescript
// app/posts/[id]/error.tsx
'use client';

export default function PostError({
  error,
  reset
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="error">
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}

// app/posts/[id]/page.tsx
export default async function PostPage({ params }: { params: { id: string } }) {
  const post = await db.posts.findById(params.id);

  if (!post) {
    throw new Error('Post not found');
  }

  return <PostContent post={post} />;
}
```

## Comparison with Other Patterns

| Feature | RSC | SSR | SSG | CSR |
|---------|-----|-----|-----|-----|
| **Initial Load** | Fast | Fast | Fastest | Slow |
| **Interactivity** | Instant | Instant | Instant | Delayed |
| **Data Fetching** | Server | Server | Build time | Client |
| **Bundle Size** | Smallest | Medium | Medium | Largest |
| **Streaming** | ✅ Yes | Limited | ❌ No | ❌ No |
| **Code Splitting** | Automatic | Manual | Manual | Manual |
| **Real-time Data** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Complexity** | Medium | Low | Low | High |

### When to Use RSC

**Use RSC (App Router) when:**
- Building a new application
- Need optimal performance and smallest bundles
- Want automatic code splitting
- Need streaming capabilities
- Want server-first architecture

**Use SSR (Pages Router) when:**
- Migrating from Next.js Pages Router
- Need simpler mental model
- Don't need streaming
- Prefer explicit data fetching

**Use SSG when:**
- Content rarely changes
- Building a blog, docs, or marketing site
- Want maximum performance
- Don't need real-time data

## Quick Reference

### Server Component (Default)

```typescript
// Runs on server, async allowed
export default async function ServerComponent() {
  const data = await fetchData();
  return <div>{data}</div>;
}
```

### Client Component

```typescript
'use client';

import { useState } from 'react';

export function ClientComponent() {
  const [state, setState] = useState(0);
  return <button onClick={() => setState(state + 1)}>{state}</button>;
}
```

### Streaming with Suspense

```typescript
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SlowComponent />
    </Suspense>
  );
}
```

### Data Fetching

```typescript
// Parallel
const [a, b] = await Promise.all([fetchA(), fetchB()]);

// Sequential
const a = await fetchA();
const b = await fetchB(a.id);

// Cached (automatic deduplication)
import { cache } from 'react';
const getData = cache(async (id) => await fetch(id));
```

## Related Documentation

- [SSR (Server-Side Rendering)](./ssr.md) - Traditional SSR patterns
- [Rendering Mode Comparison](./comparison.md) - Compare all rendering modes
- [App Router](../routing/app-router.md) - RSC is App Router exclusive
- [Streaming API](/reference/functions/streaming.md) - Advanced streaming patterns

## Summary

React Server Components (RSC) represent the future of React applications:

- ✅ **Server-first**: Components render on server by default
- ✅ **Zero JS**: Data fetching code never ships to browser
- ✅ **Automatic splitting**: Only interactive components load on client
- ✅ **Streaming**: Progressive rendering with Suspense
- ✅ **Optimal performance**: Smallest bundles, fastest loads
- ✅ **App Router only**: Requires App Router, not Pages Router

RSC provides the best of all worlds: server-side performance with client-side interactivity, automatic code splitting, and the smallest possible bundle sizes.
