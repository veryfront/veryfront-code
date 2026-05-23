---
title: "Create API"
description: "Add an HTTP endpoint to a Veryfront project with a typed Request and Response."
order: 6
---

## Prerequisites

- A project created with [Create project](./create-project.md).
- The dev server running (`veryfront dev`).

## Add a route

Create `app/api/hello/route.ts`:

```ts
// app/api/hello/route.ts
export function GET() {
  return Response.json({ message: "Hello, world!" });
}
```

`app/api/hello/route.ts` maps to `GET /api/hello`. Named exports define the
allowed HTTP methods.

## Verify it worked

With the dev server running:

```bash
curl http://localhost:3000/api/hello
```

The response should be:

```json
{ "message": "Hello, world!" }
```

For request parsing, dynamic routes, and streaming responses, see
[API routes](../guides/api-routes.md).
