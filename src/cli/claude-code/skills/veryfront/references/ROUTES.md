# Veryfront Route Conventions

Complete reference for file-system based routing in Veryfront.

## Route Files

### page.tsx - Page Component

Defines the UI for a route segment.

```tsx
// app/about/page.tsx → /about
export default function AboutPage() {
  return (
    <div>
      <h1>About Us</h1>
      <p>Welcome to our company.</p>
    </div>
  );
}
```

**Rules:**

- Must export a default React component
- Component receives no props (use hooks for data)
- Can be async for server-side data fetching

### layout.tsx - Layout Component

Wraps child routes, preserved across navigation.

```tsx
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dashboard-container">
      <Sidebar />
      <main>{children}</main>
    </div>
  );
}
```

**Rules:**

- Must accept `children` prop
- State is preserved during navigation between child routes
- Layouts nest automatically (root → segment → segment)

### route.ts - API Route

Defines API endpoints with HTTP method handlers.

```ts
// app/api/users/route.ts → GET/POST /api/users
export async function GET(request: Request) {
  const users = await db.users.findMany();
  return Response.json(users);
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = await db.users.create(body);
  return Response.json(user, { status: 201 });
}
```

**Supported methods:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`

### loading.tsx - Loading UI

Shown while page content is loading.

```tsx
// app/dashboard/loading.tsx
export default function Loading() {
  return <div className="skeleton">Loading...</div>;
}
```

### error.tsx - Error Boundary

Handles errors in the route segment.

```tsx
// app/dashboard/error.tsx
"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

**Note:** Must be a Client Component (`'use client'`)

### not-found.tsx - 404 Page

Shown when a route is not found.

```tsx
// app/not-found.tsx
export default function NotFound() {
  return (
    <div>
      <h2>Page Not Found</h2>
      <p>Could not find the requested resource.</p>
    </div>
  );
}
```

## Dynamic Routes

### Single Dynamic Segment

```
app/blog/[slug]/page.tsx → /blog/hello-world
```

```tsx
export default function BlogPost({
  params,
}: {
  params: { slug: string };
}) {
  return <article>Post: {params.slug}</article>;
}
```

### Multiple Dynamic Segments

```
app/shop/[category]/[product]/page.tsx → /shop/electronics/laptop
```

```tsx
export default function Product({
  params,
}: {
  params: { category: string; product: string };
}) {
  return <div>{params.category} / {params.product}</div>;
}
```

### Catch-All Segments

```
app/docs/[...slug]/page.tsx → /docs/a/b/c
```

```tsx
export default function Docs({
  params,
}: {
  params: { slug: string[] };
}) {
  // slug = ['a', 'b', 'c']
  return <div>Path: {params.slug.join("/")}</div>;
}
```

### Optional Catch-All

```
app/docs/[[...slug]]/page.tsx → /docs OR /docs/a/b/c
```

Matches both the root and any nested paths.

## Route Groups

Organize routes without affecting URL structure.

```
app/
├── (marketing)/
│   ├── about/page.tsx     → /about
│   └── contact/page.tsx   → /contact
├── (shop)/
│   ├── products/page.tsx  → /products
│   └── cart/page.tsx      → /cart
└── layout.tsx             → Shared root layout
```

**Use cases:**

- Organize routes by feature/team
- Apply different layouts to route groups
- Separate public/authenticated sections

## Parallel Routes

Render multiple pages in the same layout simultaneously.

```
app/
├── @sidebar/
│   └── page.tsx
├── @main/
│   └── page.tsx
└── layout.tsx
```

```tsx
// app/layout.tsx
export default function Layout({
  sidebar,
  main,
}: {
  sidebar: React.ReactNode;
  main: React.ReactNode;
}) {
  return (
    <div className="grid">
      <aside>{sidebar}</aside>
      <main>{main}</main>
    </div>
  );
}
```

## Intercepting Routes

Show a route in a modal while preserving context.

```
app/
├── feed/
│   └── page.tsx           → /feed
├── photo/[id]/
│   └── page.tsx           → /photo/123 (direct navigation)
└── @modal/
    └── (.)photo/[id]/
        └── page.tsx       → /photo/123 (soft navigation, shows modal)
```

**Conventions:**

- `(.)` - Same level
- `(..)` - One level up
- `(..)(..)` - Two levels up
- `(...)` - Root

## Route Handlers

### Request Object

```ts
export async function GET(request: Request) {
  // URL info
  const url = new URL(request.url);
  const searchParams = url.searchParams;

  // Headers
  const authHeader = request.headers.get("Authorization");

  // Cookies
  const cookies = request.headers.get("Cookie");

  return Response.json({ ok: true });
}
```

### Response Patterns

```ts
// JSON response
return Response.json({ data });

// With status
return Response.json({ error: "Not found" }, { status: 404 });

// With headers
return new Response(body, {
  status: 200,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "max-age=3600",
  },
});

// Redirect
return Response.redirect(new URL("/login", request.url));

// Stream
return new Response(stream, {
  headers: { "Content-Type": "text/event-stream" },
});
```

### Dynamic Route Handlers

```ts
// app/api/users/[id]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await db.users.findById(params.id);
  if (!user) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json(user);
}
```

## Middleware

Create `middleware.ts` at project root:

```ts
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Check auth
  const token = request.cookies.get("token");
  if (!token && request.nextUrl.pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
```

## Metadata

### Static Metadata

```tsx
// app/about/page.tsx
export const metadata = {
  title: "About Us",
  description: "Learn about our company",
};
```

### Dynamic Metadata

```tsx
// app/blog/[slug]/page.tsx
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}) {
  const post = await getPost(params.slug);
  return {
    title: post.title,
    description: post.excerpt,
  };
}
```

## Static Generation

### generateStaticParams

Pre-render dynamic routes at build time:

```tsx
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map((post) => ({
    slug: post.slug,
  }));
}
```

## Best Practices

1. **Keep routes shallow** - Deep nesting makes URLs long and maintenance hard
2. **Use route groups** - Organize without affecting URLs
3. **Colocate related files** - Keep components near their routes
4. **Prefer server components** - Client components only when needed
5. **Validate API inputs** - Use Zod or similar for request validation
6. **Handle errors gracefully** - Provide error.tsx for each major section
7. **Use loading states** - Improve perceived performance
