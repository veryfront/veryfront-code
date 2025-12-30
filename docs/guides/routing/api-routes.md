---
title: "API Routes Guide"
category: "routing"
level: "intermediate"
keywords: ["api-routes", "rest", "backend", "endpoints", "api"]
ai_summary: "Complete guide to creating backend API endpoints in Veryfront with both App Router and Pages Router patterns"
related: ["routing/app-router", "routing/pages-router", "routing/dynamic-routes"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# API Routes Guide

API Routes provide a solution to build backend API endpoints directly within your Veryfront application. Create serverless functions that handle HTTP requests without needing a separate backend server.

## Why API Routes?

- **Co-located Backend** - API logic alongside frontend code
- **Serverless** - No server management required
- **Type-Safe** - Full TypeScript support
- **Authentication** - Secure endpoints with middleware
- **Database Access** - Direct database queries
- **Third-Party Integration** - Call external APIs securely

**Best for:** REST APIs, webhooks, authentication, database operations, proxying external APIs

---

## Getting Started

### App Router Style

Place API routes in `app/api/` directory with `route.ts` files:

```
app/
└── api/
    ├── hello/
    │   └── route.ts        # /api/hello
    ├── users/
    │   ├── route.ts        # /api/users
    │   └── [id]/
    │       └── route.ts    # /api/users/:id
    └── posts/
        └── route.ts        # /api/posts
```

### Pages Router Style

Place API routes in `pages/api/` directory with `.ts` files:

```
pages/
└── api/
    ├── hello.ts            # /api/hello
    ├── users.ts            # /api/users
    ├── users/
    │   └── [id].ts         # /api/users/:id
    └── posts/
        └── index.ts        # /api/posts
```

---

## Basic API Route

### App Router

```typescript
// app/api/hello/route.ts
export async function GET(request: Request) {
  return new Response(
    JSON.stringify({ message: 'Hello from API!' }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
```

### Pages Router

```typescript
// pages/api/hello.ts
export default function handler(req: Request) {
  return new Response(
    JSON.stringify({ message: 'Hello from API!' }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
```

**Test it:**
```bash
curl http://localhost:3000/api/hello
# {"message":"Hello from API!"}
```

---

## HTTP Methods

### App Router - Named Exports

```typescript
// app/api/posts/route.ts

// GET /api/posts - List all posts
export async function GET(request: Request) {
  const posts = await fetchAllPosts();
  return Response.json(posts);
}

// POST /api/posts - Create new post
export async function POST(request: Request) {
  const body = await request.json();
  const post = await createPost(body);
  return Response.json(post, { status: 201 });
}

// PUT /api/posts - Update post
export async function PUT(request: Request) {
  const body = await request.json();
  const post = await updatePost(body);
  return Response.json(post);
}

// DELETE /api/posts - Delete post
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  await deletePost(id);
  return Response.json({ success: true });
}
```

### Pages Router - Check Method

```typescript
// pages/api/posts.ts
export default async function handler(req: Request) {
  if (req.method === 'GET') {
    const posts = await fetchAllPosts();
    return Response.json(posts);
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const post = await createPost(body);
    return Response.json(post, { status: 201 });
  }

  if (req.method === 'PUT') {
    const body = await req.json();
    const post = await updatePost(body);
    return Response.json(post);
  }

  if (req.method === 'DELETE') {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    await deletePost(id);
    return Response.json({ success: true });
  }

  return Response.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}
```

---

## Request Handling

### Reading JSON Body

```typescript
// app/api/users/route.ts
export async function POST(request: Request) {
  const body = await request.json();

  const { name, email } = body;

  // Validate
  if (!name || !email) {
    return Response.json(
      { error: 'Name and email required' },
      { status: 400 }
    );
  }

  // Create user
  const user = await createUser({ name, email });

  return Response.json(user, { status: 201 });
}
```

### Reading Form Data

```typescript
// app/api/upload/route.ts
export async function POST(request: Request) {
  const formData = await request.formData();

  const file = formData.get('file') as File;
  const name = formData.get('name') as string;

  if (!file) {
    return Response.json(
      { error: 'No file provided' },
      { status: 400 }
    );
  }

  const bytes = await file.arrayBuffer();
  const buffer = new Uint8Array(bytes);

  await saveFile(name, buffer);

  return Response.json({ success: true });
}
```

### Query Parameters

```typescript
// app/api/search/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const query = searchParams.get('q');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '10');

  const results = await search(query, { page, limit });

  return Response.json(results);
}
```

**Usage:**
```
GET /api/search?q=hello&page=1&limit=20
```

### Headers

```typescript
// app/api/auth/route.ts
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const user = await verifyToken(token);

  return Response.json({ user });
}
```

### Cookies

```typescript
// app/api/session/route.ts
export async function GET(request: Request) {
  const cookies = request.headers.get('Cookie');
  const sessionId = parseCookie(cookies, 'sessionId');

  const session = await getSession(sessionId);

  return Response.json({ session });
}

export async function POST(request: Request) {
  const sessionId = crypto.randomUUID();

  return new Response(
    JSON.stringify({ sessionId }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `sessionId=${sessionId}; HttpOnly; Path=/; Max-Age=86400`
      }
    }
  );
}
```

---

## Dynamic API Routes

### Single Dynamic Segment

```typescript
// app/api/users/[id]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await fetchUser(params.id);

  if (!user) {
    return Response.json(
      { error: 'User not found' },
      { status: 404 }
    );
  }

  return Response.json(user);
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const user = await updateUser(params.id, body);

  return Response.json(user);
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  await deleteUser(params.id);
  return Response.json({ success: true });
}
```

**URLs:**
- `GET /api/users/123` → `id = "123"`
- `PUT /api/users/456` → `id = "456"`
- `DELETE /api/users/789` → `id = "789"`

### Catch-All Routes

```typescript
// app/api/proxy/[...path]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { path: string[] } }
) {
  const path = params.path.join('/');
  const externalUrl = `https://api.example.com/${path}`;

  const response = await fetch(externalUrl);
  const data = await response.json();

  return Response.json(data);
}
```

**URLs:**
- `/api/proxy/users` → `path = ["users"]`
- `/api/proxy/posts/123` → `path = ["posts", "123"]`
- `/api/proxy/v1/data/items` → `path = ["v1", "data", "items"]`

---

## Response Types

### JSON Response

```typescript
export async function GET(request: Request) {
  const data = { message: 'Hello', timestamp: Date.now() };
  return Response.json(data);
}
```

### Text Response

```typescript
export async function GET(request: Request) {
  return new Response('Hello World', {
    headers: { 'Content-Type': 'text/plain' }
  });
}
```

### HTML Response

```typescript
export async function GET(request: Request) {
  const html = `
    <!DOCTYPE html>
    <html>
      <body><h1>Hello World</h1></body>
    </html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
```

### Streaming Response

```typescript
export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < 10; i++) {
        controller.enqueue(encoder.encode(`Event ${i}\n`));
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' }
  });
}
```

### File Download

```typescript
export async function GET(request: Request) {
  const fileBuffer = await readFile('/path/to/file.pdf');

  return new Response(fileBuffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="document.pdf"'
    }
  });
}
```

### Redirect

```typescript
export async function GET(request: Request) {
  return Response.redirect('https://example.com', 302);
}
```

---

## Error Handling

### Validation Errors

```typescript
// app/api/users/route.ts
export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate input
    if (!body.email || !body.email.includes('@')) {
      return Response.json(
        { error: 'Invalid email address' },
        { status: 400 }
      );
    }

    if (!body.name || body.name.length < 2) {
      return Response.json(
        { error: 'Name must be at least 2 characters' },
        { status: 400 }
      );
    }

    const user = await createUser(body);
    return Response.json(user, { status: 201 });

  } catch (error) {
    console.error('Error creating user:', error);
    return Response.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
```

### Not Found

```typescript
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const post = await fetchPost(params.id);

  if (!post) {
    return Response.json(
      { error: 'Post not found' },
      { status: 404 }
    );
  }

  return Response.json(post);
}
```

### Unauthorized

```typescript
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return Response.json(
      { error: 'Missing authorization header' },
      { status: 401,
        headers: { 'WWW-Authenticate': 'Bearer' }
      }
    );
  }

  // Verify token...
}
```

### Rate Limiting

```typescript
const rateLimiter = new Map<string, number[]>();

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const limit = 10; // 10 requests
  const window = 60000; // per minute

  const requests = rateLimiter.get(ip) || [];
  const recentRequests = requests.filter(time => now - time < window);

  if (recentRequests.length >= limit) {
    return Response.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': '60' }
      }
    );
  }

  recentRequests.push(now);
  rateLimiter.set(ip, recentRequests);

  // Handle request...
}
```

---

## Authentication

### JWT Authentication

```typescript
// app/api/auth/login/route.ts
import { sign } from 'jsonwebtoken';

export async function POST(request: Request) {
  const { email, password } = await request.json();

  const user = await authenticateUser(email, password);

  if (!user) {
    return Response.json(
      { error: 'Invalid credentials' },
      { status: 401 }
    );
  }

  const token = sign(
    { userId: user.id, email: user.email },
    getEnv('JWT_SECRET')!,
    { expiresIn: '7d' }
  );

  return Response.json({ token, user });
}
```

### Protected Route

```typescript
// app/api/profile/route.ts
import { verify } from 'jsonwebtoken';

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const payload = verify(token, getEnv('JWT_SECRET')!) as {
      userId: string;
    };

    const user = await fetchUser(payload.userId);
    return Response.json({ user });

  } catch (error) {
    return Response.json(
      { error: 'Invalid token' },
      { status: 401 }
    );
  }
}
```

### Session Authentication

```typescript
// app/api/auth/session/route.ts
export async function GET(request: Request) {
  const cookies = request.headers.get('Cookie');
  const sessionId = parseCookie(cookies, 'sessionId');

  if (!sessionId) {
    return Response.json(
      { error: 'No session' },
      { status: 401 }
    );
  }

  const session = await getSession(sessionId);

  if (!session) {
    return Response.json(
      { error: 'Invalid session' },
      { status: 401 }
    );
  }

  return Response.json({ user: session.user });
}
```

---

## Database Integration

### Deno KV

```typescript
// app/api/posts/route.ts
const kv = await Deno.openKv();

export async function GET(request: Request) {
  const entries = kv.list({ prefix: ['posts'] });
  const posts = [];

  for await (const entry of entries) {
    posts.push(entry.value);
  }

  return Response.json(posts);
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = crypto.randomUUID();

  const post = {
    id,
    ...body,
    createdAt: new Date().toISOString()
  };

  await kv.set(['posts', id], post);

  return Response.json(post, { status: 201 });
}
```

### PostgreSQL

```typescript
// app/api/users/route.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: getEnv('DATABASE_URL')
});

export async function GET(request: Request) {
  const result = await pool.query('SELECT * FROM users');
  return Response.json(result.rows);
}

export async function POST(request: Request) {
  const { name, email } = await request.json();

  const result = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
    [name, email]
  );

  return Response.json(result.rows[0], { status: 201 });
}
```

### MongoDB

```typescript
// app/api/products/route.ts
import { MongoClient } from 'mongodb';

const client = new MongoClient(getEnv('MONGODB_URI')!);
const db = client.db('myapp');
const products = db.collection('products');

export async function GET(request: Request) {
  const items = await products.find().toArray();
  return Response.json(items);
}

export async function POST(request: Request) {
  const body = await request.json();
  const result = await products.insertOne(body);

  return Response.json(
    { id: result.insertedId, ...body },
    { status: 201 }
  );
}
```

---

## External API Integration

### Proxy External API

```typescript
// app/api/weather/route.ts
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get('city');

  if (!city) {
    return Response.json(
      { error: 'City parameter required' },
      { status: 400 }
    );
  }

  const apiKey = getEnv('WEATHER_API_KEY');
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  return Response.json(data);
}
```

### Webhooks

```typescript
// app/api/webhooks/stripe/route.ts
import { verify } from 'stripe';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return Response.json(
      { error: 'No signature' },
      { status: 400 }
    );
  }

  try {
    const event = verify(
      body,
      signature,
      getEnv('STRIPE_WEBHOOK_SECRET')!
    );

    // Handle different event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object);
        break;
    }

    return Response.json({ received: true });

  } catch (error) {
    return Response.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }
}
```

---

## CORS Configuration

### Enable CORS

```typescript
// app/api/public/route.ts
export async function GET(request: Request) {
  const data = { message: 'Public API' };

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}

// Handle OPTIONS preflight
export async function OPTIONS(request: Request) {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }
  });
}
```

### CORS Middleware

```typescript
// lib/cors.ts
export function cors(response: Response, origin = '*') {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  return new Response(response.body, {
    status: response.status,
    headers
  });
}

// Usage
export async function GET(request: Request) {
  const data = { message: 'Hello' };
  const response = Response.json(data);
  return cors(response);
}
```

---

## Best Practices

### 1. Use TypeScript

```typescript
// app/api/users/route.ts
interface User {
  id: string;
  name: string;
  email: string;
}

interface CreateUserRequest {
  name: string;
  email: string;
}

export async function POST(request: Request) {
  const body: CreateUserRequest = await request.json();

  const user: User = await createUser(body);

  return Response.json(user);
}
```

### 2. Validate Input

```typescript
import { z } from 'zod';

const CreatePostSchema = z.object({
  title: z.string().min(3).max(100),
  content: z.string().min(10),
  published: z.boolean().default(false)
});

export async function POST(request: Request) {
  const body = await request.json();

  const result = CreatePostSchema.safeParse(body);

  if (!result.success) {
    return Response.json(
      { error: 'Validation failed', issues: result.error.issues },
      { status: 400 }
    );
  }

  const post = await createPost(result.data);
  return Response.json(post);
}
```

### 3. Handle Errors Gracefully

```typescript
export async function GET(request: Request) {
  try {
    const data = await fetchData();
    return Response.json(data);
  } catch (error) {
    console.error('API Error:', error);

    if (error instanceof ValidationError) {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }

    if (error instanceof NotFoundError) {
      return Response.json(
        { error: 'Resource not found' },
        { status: 404 }
      );
    }

    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### 4. Use Environment Variables

```typescript
const API_KEY = getEnv('EXTERNAL_API_KEY');
const DATABASE_URL = getEnv('DATABASE_URL');
const JWT_SECRET = getEnv('JWT_SECRET');

if (!API_KEY) {
  throw new Error('EXTERNAL_API_KEY not set');
}
```

### 5. Add Logging

```typescript
export async function POST(request: Request) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    console.log('POST /api/users', { body });

    const user = await createUser(body);

    console.log('User created', {
      userId: user.id,
      duration: Date.now() - startTime
    });

    return Response.json(user);
  } catch (error) {
    console.error('Failed to create user', {
      error,
      duration: Date.now() - startTime
    });
    throw error;
  }
}
```

---

## Testing API Routes

### Using fetch

```typescript
// Test locally
const response = await fetch('http://localhost:3000/api/users', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'John', email: 'john@example.com' })
});

const data = await response.json();
console.log(data);
```

### Using curl

```bash
# GET request
curl http://localhost:3000/api/users

# POST request
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@example.com"}'

# With authorization
curl http://localhost:3000/api/profile \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Unit Tests

```typescript
// tests/api/users.test.ts
import { assertEquals } from 'std/assert/mod.ts';
import { GET, POST } from '../app/api/users/route.ts';

Deno.test('GET /api/users returns users', async () => {
  const request = new Request('http://localhost/api/users');
  const response = await GET(request);

  assertEquals(response.status, 200);

  const data = await response.json();
  assertEquals(Array.isArray(data), true);
});

Deno.test('POST /api/users creates user', async () => {
  const request = new Request('http://localhost/api/users', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test', email: 'test@example.com' })
  });

  const response = await POST(request);

  assertEquals(response.status, 201);

  const data = await response.json();
  assertEquals(data.name, 'Test');
  assertEquals(data.email, 'test@example.com');
});
```

---

## Related Documentation

- [App Router](./app-router.md) - Modern routing system
- [Pages Router](./pages-router.md) - Traditional routing
- [Dynamic Routes](./dynamic-routes.md) - URL parameters
- [Data Fetching](/reference/functions/get-server-data.md) - Server-side data

---

## Examples

- [Form Handling](https://github.com/veryfront/veryfront/tree/main/examples/form-handling) - API routes with forms
- [Auth App](https://github.com/veryfront/veryfront/tree/main/examples/auth-app) - Authentication API
- [Full Demo](https://github.com/veryfront/veryfront/tree/main/examples/full-demo) - Complete API examples

---

## Quick Reference

### App Router Structure
```
app/
└── api/
    ├── hello/
    │   └── route.ts        # Named exports (GET, POST, etc.)
    └── users/
        └── [id]/
            └── route.ts    # Dynamic segment
```

### Pages Router Structure
```
pages/
└── api/
    ├── hello.ts            # Default export
    └── users/
        └── [id].ts         # Dynamic segment
```

### HTTP Methods (App Router)
```typescript
export async function GET(request: Request) {}
export async function POST(request: Request) {}
export async function PUT(request: Request) {}
export async function DELETE(request: Request) {}
export async function PATCH(request: Request) {}
export async function OPTIONS(request: Request) {}
```

### Common Patterns
- **JSON:** `Response.json(data)`
- **Text:** `new Response(text, { headers: { 'Content-Type': 'text/plain' } })`
- **Error:** `Response.json({ error: 'Message' }, { status: 400 })`
- **Redirect:** `Response.redirect(url, 302)`
- **Headers:** `request.headers.get('Authorization')`
- **Cookies:** `request.headers.get('Cookie')`
- **Query:** `new URL(request.url).searchParams.get('q')`
