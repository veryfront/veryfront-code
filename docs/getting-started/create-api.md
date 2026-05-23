---
title: "Create API"
description: "Add an HTTP endpoint to a Veryfront project with a typed Request and Response."
order: 5
---

Add one HTTP endpoint to a Veryfront project.

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

## Try it

With the dev server running:

```bash
curl http://localhost:3000/api/hello
```

The response is:

```json
{ "message": "Hello, world!" }
```

## Read the request body

For a `POST` endpoint that echoes its input:

```ts
// app/api/echo/route.ts
export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ received: body });
}
```

```bash
curl -X POST http://localhost:3000/api/echo \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
```

## Verify it worked

Confirm with `curl`:

- `GET /api/hello` returns the JSON body above.
- Unknown paths return 404.
- Methods without an export return 405.

## Next

- [Create frontend](./create-frontend.md): add a page
- [Deploy project](./deploy-project.md): ship the project to production

## Related

- [API routes](../guides/api-routes.md): route patterns and streaming
- [Middleware](../guides/middleware.md): CORS, rate limiting, logging, and auth
