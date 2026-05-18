---
title: "API routes"
description: "HTTP handlers, request parsing, and streaming responses."
order: 6
---

# API routes

HTTP handlers, request parsing, and streaming responses.

Veryfront supports API routes in the app router and the pages router. The router changes the file location and handler arguments. The request and response APIs stay based on the standard Web `Request` and `Response` objects.

## Router module shapes

Use `app/api/**/route.ts` in the app router. Export named HTTP method handlers. Each handler receives the `Request` directly and receives route params in the second argument.

```ts
// app/api/hello/route.ts
export function GET() {
  return Response.json({ message: "Hello, world!" });
}
```

Use `pages/api/**` in the pages router. Export named HTTP method handlers or a `default` fallback handler. Each handler receives an `APIContext` as `ctx`; use `ctx.request` for the raw request, `ctx.params` for route params, `ctx.query` for query parameters, and `ctx.json()` or `Response.json()` to return JSON.

```ts
// pages/api/hello.ts
import type { APIContext } from "veryfront";

export function GET(ctx: APIContext) {
  return ctx.json({ message: "Hello, world!" });
}
```

## Basic route

```ts
// app/api/hello/route.ts
export function GET() {
  return Response.json({ message: "Hello, world!" });
}
```

This creates `GET /api/hello`.

Try it with the dev server running:

```bash
curl http://localhost:3000/api/hello
```

The response should be:

```json
{ "message": "Hello, world!" }
```

## HTTP methods

Export any standard HTTP method:

```ts
// app/api/users/route.ts
const users = [{ id: "user_123", name: "Ada Lovelace" }];

export async function GET() {
  return Response.json(users);
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = { id: "user_456", ...body };
  return Response.json(user, { status: 201 });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  return new Response(null, { status: 204 });
}
```

The same pages router route uses `ctx`:

```ts
// pages/api/users.ts
import type { APIContext } from "veryfront";

const users = [{ id: "user_123", name: "Ada Lovelace" }];

export async function GET(ctx: APIContext) {
  return ctx.json(users);
}

export async function POST(ctx: APIContext) {
  const body = await ctx.request.json();
  const user = { id: "user_456", ...body };
  return ctx.json(user, { status: 201 });
}

export async function DELETE(ctx: APIContext) {
  const { id } = await ctx.request.json();
  if (!id) return ctx.json({ error: "Missing id" }, { status: 400 });
  return new Response(null, { status: 204 });
}
```

## Dynamic parameters

Use brackets in the path, then read params from the route context:

```ts
// app/api/users/[id]/route.ts
export async function GET(
  _request: Request,
  { params }: { params: Record<string, string> },
) {
  const id = params.id;

  if (!id) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const user = { id, name: "Ada Lovelace" };
  return Response.json(user);
}
```

In the pages router, params are available on `ctx.params`:

```ts
// pages/api/users/[id].ts
import type { APIContext } from "veryfront";

export async function GET(ctx: APIContext) {
  const id = String(ctx.params.id ?? "");

  if (!id) {
    return ctx.json({ error: "Not found" }, { status: 404 });
  }

  const user = { id, name: "Ada Lovelace" };
  return ctx.json(user);
}
```

## Request parsing

### JSON body

```ts
export async function POST(request: Request) {
  const { name, email } = await request.json();
  // ...
}
```

### Form data

```ts
export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("avatar") as File;
  // ...
}
```

### Query parameters

```ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = url.searchParams.get("page") ?? "1";
  // ...
}
```

### Headers and cookies

```ts
export async function GET(request: Request) {
  const token = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  // ...
}
```

## Streaming responses

Return a `ReadableStream` for real-time data:

```ts
// app/api/stream/route.ts
export function GET() {
  const stream = new ReadableStream({
    start(controller) {
      let i = 0;
      const interval = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(`data: ${i++}\n\n`));
        if (i > 10) {
          clearInterval(interval);
          controller.close();
        }
      }, 100);
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
  });
}
```

## Chat endpoint

The most common API route pattern in Veryfront connects a chat UI to an agent:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

Messages use Veryfront's parts-based chat message format: `{ id, role, parts: [{ type: "text", text }] }`. The route responds with AG-UI SSE and pairs with `useChat({ api: "/api/ag-ui" })` on the client. See the [Chat UI](./chat-ui.md) guide.

## Next

- [Agents](./agents.md): the agent behind the `/api/ag-ui` endpoint
- [Middleware](./middleware.md): add CORS, rate limiting, and auth checks

## Related

- [`veryfront/agent`](../reference/veryfront/agent.md): agent API reference
- [`veryfront/middleware`](../reference/veryfront/middleware.md): middleware API reference
