---
title: "API Routes"
description: "HTTP handlers, request parsing, and streaming responses."
order: 5
---

Files named `route.ts` inside `app/api/` become API endpoints. Export functions named after HTTP methods.

## Basic route

```ts
// app/api/hello/route.ts
export function GET() {
  return Response.json({ message: "Hello, world!" });
}
```

This creates `GET /api/hello`.

## HTTP methods

Export any standard HTTP method:

```ts
// app/api/users/route.ts
export async function GET() {
  const users = await db.users.findMany();
  return Response.json(users);
}

export async function POST(request: Request) {
  const body = await request.json();
  const user = await db.users.create(body);
  return Response.json(user, { status: 201 });
}

export async function DELETE(request: Request) {
  const { id } = await request.json();
  await db.users.delete(id);
  return new Response(null, { status: 204 });
}
```

## Dynamic parameters

Use brackets in the path, then read params from the URL:

```ts
// app/api/users/[id]/route.ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();
  const user = await db.users.findById(id);

  if (!user) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(user);
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

## AI chat endpoint

The most common API route pattern in Veryfront connects a chat UI to an agent:

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { messages } = await request.json();
  const agent = getAgent("assistant");
  if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

Messages use the AI SDK v5 format: `{ id, role, parts: [{ type: "text", text }] }`. This pairs with `useChat({ api: "/api/chat" })` on the client, which handles the format automatically. See the [Chat UI](./chat-ui.md) guide.

## Next

- [Agents](./agents.md) — the agent behind the `/api/chat` endpoint
- [Middleware](./middleware.md) — add CORS, rate limiting, and auth checks

## Related

- [`veryfront/agent`](../reference/agent.md) — agent API reference
- [`veryfront/middleware`](../reference/middleware.md) — middleware API reference
