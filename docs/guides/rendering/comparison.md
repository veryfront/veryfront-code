---
title: "Rendering Mode Comparison"
category: "rendering"
level: "beginner"
keywords: ["rendering", "ssr", "ssg", "isr", "jit", "rsc", "comparison", "performance"]
ai_summary: "Decision matrix and detailed comparison of all Veryfront rendering modes: SSR, SSG, ISR, JIT, and RSC"
related: ["rendering/ssr", "rendering/ssg", "rendering/isr", "rendering/jit", "rendering/rsc"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Rendering Mode Comparison

Choose the right rendering strategy for your application. Veryfront supports five rendering modes, each optimized for different use cases.

## Quick Decision Matrix

```
┌─────────────────────────────────────────────────────────────┐
│ START: What kind of content are you rendering?             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │  Is the content dynamic     │
              │  (user-specific, real-time)? │
              └─────────────────────────────┘
                 YES │            │ NO
                     │            │
                     ▼            ▼
              ┌──────────┐  ┌────────────┐
              │   SSR    │  │  Continue  │
              │          │  │    below   │
              └──────────┘  └────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │ Does content change often?    │
                  │ (hourly/daily)                │
                  └───────────────────────────────┘
                       YES │         │ NO
                           │         │
                           ▼         ▼
                    ┌──────────┐  ┌─────────┐
                    │   ISR    │  │   SSG   │
                    └──────────┘  └─────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      │                                 │
                      ▼                                 ▼
           ┌──────────────────────┐      ┌──────────────────────┐
           │ 100,000+ pages?      │      │ Using React Server   │
           │                      │      │ Components?          │
           └──────────────────────┘      └──────────────────────┘
                YES │     │ NO                YES │      │ NO
                    │     │                       │      │
                    ▼     ▼                       ▼      ▼
             ┌─────┐  ┌─────┐               ┌────┐  ┌─────┐
             │ JIT │  │ SSG │               │RSC │  │ SSG │
             └─────┘  └─────┘               └────┘  └─────┘
```

## Comparison Table

| Feature | SSR | SSG | ISR | JIT | RSC |
|---------|-----|-----|-----|-----|-----|
| **Build Time** | Fast | Slow (large sites) | Fast | Fast | Fast |
| **Request Speed** | Medium | Instant | Instant (cached) | Instant (after 1st) | Instant |
| **Dynamic Data** | ✅ Real-time | ❌ Build-time | ⚠️ Periodic | ❌ Build-time | ✅ Real-time |
| **Scalability** | Medium | High | High | Very High | Medium |
| **SEO** | ✅ Excellent | ✅ Excellent | ✅ Excellent | ✅ Excellent | ✅ Excellent |
| **CDN Cacheable** | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No |
| **Best For** | Dashboards | Blogs | E-commerce | Large docs | Interactive |

## Detailed Comparison

### Server-Side Rendering (SSR)

**How it works:** Renders HTML on every request on the server.

**Pros:**
- Always fresh, real-time data
- Personalized content (auth, user-specific)
- SEO-friendly
- No build time for new pages

**Cons:**
- Slower response time (server rendering on each request)
- Higher server load
- Not CDN-cacheable (unless you add cache headers)
- Higher hosting costs

**Use when:**
- Content is user-specific (dashboards, profiles)
- Data changes frequently (live feeds, real-time updates)
- Need authentication and personalization
- SEO is critical and content changes often

**Examples:**
- User dashboards
- Admin panels
- Social media feeds
- Real-time analytics
- Personalized e-commerce pages

**Configuration:**
```typescript
// No special configuration needed - this is the default
export const getServerData = async (ctx) => {
  const data = await fetchRealTimeData();
  return { props: { data } };
};
```

Learn more: [SSR Guide](./ssr.md)

---

### Static Site Generation (SSG)

**How it works:** Pre-renders all pages at build time. Serves pre-generated HTML files.

**Pros:**
- Fastest possible page load (pre-rendered)
- Lowest server costs (static files)
- Highly CDN-cacheable
- Excellent SEO
- Works offline (after initial load)

**Cons:**
- Slow builds for large sites (1000+ pages)
- Content is stale until next build
- Need rebuild to update content
- All paths must be known at build time

**Use when:**
- Content doesn't change often (blogs, docs, marketing)
- You have < 10,000 pages
- Speed and cost are top priorities
- Content is the same for all users

**Examples:**
- Blogs and articles
- Documentation sites
- Marketing pages
- Portfolio sites
- Product catalogs (small)

**Configuration:**
```typescript
// Pre-render all posts at build time
export const getStaticPaths = async () => {
  const posts = await fetchAllPosts();
  return {
    paths: posts.map(p => ({ params: { slug: p.slug } })),
    fallback: false,
  };
};

export const getServerData = async (ctx) => {
  const post = await fetchPost(ctx.params.slug);
  return { props: { post } };
};
```

Learn more: [SSG Guide](./ssg.md)

---

### Incremental Static Regeneration (ISR)

**How it works:** Pre-renders pages at build time, then regenerates them on-demand after a specified time period.

**Pros:**
- Fast initial response (cached)
- Content updates without full rebuild
- CDN-cacheable
- Scales to many pages
- Lower server load than SSR

**Cons:**
- Stale content between revalidations
- First visitor after expiry gets slow response
- More complex cache invalidation
- Requires edge/CDN support

**Use when:**
- Content updates periodically (hourly/daily)
- You have many pages (product catalogs, news sites)
- Speed is important but perfect freshness isn't
- You want automatic background regeneration

**Examples:**
- E-commerce product pages
- News sites
- Job listings
- Event calendars
- Weather data

**Configuration:**
```typescript
export const getServerData = async (ctx) => {
  const product = await fetchProduct(ctx.params.id);
  return {
    props: { product },
    revalidate: 3600, // Regenerate every hour
  };
};
```

Learn more: [ISR Guide](./isr.md)

---

### Just-In-Time (JIT) Rendering

**How it works:** Generates pages on first request, then caches forever. Veryfront's unique mode for massive scale.

**Pros:**
- No build time (generates on-demand)
- Instant subsequent requests (cached forever)
- Scales to millions of pages
- No "stale" pages requiring revalidation
- Perfect for large-scale docs

**Cons:**
- First visitor experiences slow load
- Cache warming required for best UX
- Content doesn't auto-update (manual cache invalidation)
- Less predictable performance

**Use when:**
- You have 100,000+ pages
- Build time would be prohibitive
- Content rarely changes once published
- You can't pre-generate all paths

**Examples:**
- Large documentation sites (100k+ pages)
- Wikipedia-style content
- Code documentation
- API references with many endpoints
- Historical archives

**Configuration:**
```typescript
export const getServerData = async (ctx) => {
  const doc = await fetchDoc(ctx.params.path);
  return {
    props: { doc },
    cache: 'forever', // Cache indefinitely
  };
};
```

Learn more: [JIT Guide](./jit.md)

---

### React Server Components (RSC)

**How it works:** Renders React components on the server, sends minimal JavaScript to client.

**Pros:**
- Zero JavaScript for server components
- Smaller bundle sizes
- Direct database access in components
- Streaming for progressive loading
- Modern React features

**Cons:**
- Experimental in Veryfront (beta)
- Learning curve (new paradigm)
- Limited library compatibility
- Requires edge runtime support
- More complex deployment

**Use when:**
- Bundle size is critical
- You want to use latest React features
- Need direct server data access in components
- Building highly interactive apps with minimal JS
- You're comfortable with experimental tech

**Examples:**
- Admin dashboards with charts
- E-commerce with filters
- Social feeds with infinite scroll
- Interactive docs
- Data-heavy applications

**Configuration:**
```typescript
// Server Component (no 'use client')
export default async function ProductPage({ params }) {
  // Fetch directly in component
  const product = await db.products.find(params.id);

  return (
    <div>
      <h1>{product.name}</h1>
      <ClientButton /> {/* Client component */}
    </div>
  );
}
```

Learn more: [RSC Guide](./rsc.md)

---

## Performance Comparison

### Time to First Byte (TTFB)

```
SSG:  ~10ms  (instant from CDN)
ISR:  ~15ms  (cached) | ~200ms (regenerating)
JIT:  ~15ms  (cached) | ~300ms (first visit)
SSR:  ~200ms (server render)
RSC:  ~150ms (server render + streaming)
```

### Build Time (1000 pages)

```
SSR:  ~1s   (no build)
JIT:  ~1s   (no build)
ISR:  ~2min (partial pre-render)
SSG:  ~5min (full pre-render)
RSC:  ~2s   (no build)
```

### Hosting Cost (monthly, 100k requests)

```
SSG:  $5-10  (static hosting)
ISR:  $10-20 (edge functions + static)
JIT:  $15-25 (edge functions + cache)
SSR:  $50+   (always-on server)
RSC:  $40+   (edge runtime)
```

## Decision Tree by Use Case

### Content Sites (Blogs, Docs, Marketing)
1. **< 1,000 pages** → SSG
2. **1,000-10,000 pages** → SSG or ISR
3. **10,000-100,000 pages** → ISR
4. **100,000+ pages** → JIT

### E-commerce
1. **Product pages** → ISR (update prices hourly)
2. **Category pages** → ISR or SSG
3. **Cart/Checkout** → SSR (user-specific)
4. **Product search** → SSR or RSC

### Dashboards & Apps
1. **Public dashboard** → ISR
2. **User dashboard** → SSR
3. **Admin panel** → SSR
4. **Analytics** → SSR or RSC

### Social/Community
1. **Public profiles** → ISR
2. **Private profiles** → SSR
3. **Feeds** → SSR
4. **Messages** → SSR

## Mixing Rendering Modes

You can use different rendering modes for different pages in the same app:

```
/                        → SSG (homepage)
/blog                    → SSG (blog list)
/blog/[slug]             → ISR (blog posts, revalidate hourly)
/products/[id]           → ISR (products, revalidate daily)
/dashboard               → SSR (user-specific)
/dashboard/settings      → SSR (user-specific)
/docs/[...path]          → JIT (100k+ docs pages)
```

**Configuration:**
Each page can specify its own rendering strategy through its exports. The framework automatically handles routing to the appropriate rendering pipeline.

## Common Patterns

### Blog with Comments
- **Post content:** ISR (revalidate hourly for updated content)
- **Comments:** SSR or client-side fetch (real-time)

### E-commerce
- **Product pages:** ISR (revalidate on price changes)
- **Search results:** SSR (personalized)
- **Static pages:** SSG (about, FAQ)

### Documentation
- **Docs < 10k pages:** SSG
- **Docs > 100k pages:** JIT
- **Search:** SSR or client-side

## Best Practices

1. **Start with SSG** - Simplest, fastest, cheapest. Only move to other modes if SSG limitations become a problem.

2. **Use ISR for "mostly static"** - If content updates periodically (hourly/daily), ISR gives you both speed and freshness.

3. **Reserve SSR for truly dynamic** - Only use SSR when you need real-time, per-request, or user-specific data.

4. **JIT for scale** - When build times become prohibitive (> 10 minutes), switch to JIT.

5. **RSC is experimental** - Great for reducing JavaScript, but understand the tradeoffs and limitations.

## Migration Path

**Growing site evolution:**
```
SSG (< 1k pages)
  → ISR (1k-10k pages, periodic updates)
    → JIT (100k+ pages, long builds)

Static homepage
  → ISR homepage (update daily)
    → SSR homepage (personalized)
```

## Related Documentation

- [SSR Guide](./ssr.md) - Server-Side Rendering
- [SSG Guide](./ssg.md) - Static Site Generation
- [ISR Guide](./isr.md) - Incremental Static Regeneration
- [JIT Guide](./jit.md) - Just-In-Time Rendering
- [RSC Guide](./rsc.md) - React Server Components
- [Rendering Overview](./README.md) - Complete rendering documentation

## Examples

See working examples:
- [SSG Example](/examples/blog/) - Static blog with SSG
- [ISR Example](/examples/e-commerce/) - Product catalog with ISR
- [SSR Example](/examples/dashboard/) - User dashboard with SSR
- [JIT Example](/examples/docs/) - Large documentation site with JIT
- [RSC Example](/examples/rsc-demo/) - React Server Components demo
