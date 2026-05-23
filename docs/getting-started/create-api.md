---
title: "Create API"
description: "Add an HTTP endpoint to a Veryfront project with a typed Request and Response."
order: 5
---

Add an HTTP endpoint to a Veryfront project. This is the fourth step in the
Getting Started flow, between [Create agent](./create-agent.md) and
[Create frontend](./create-frontend.md).

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

The file path maps to the URL. `app/api/hello/route.ts` exposes
`GET /api/hello`. Named exports define the allowed HTTP methods. Each handler
receives a `Request` and returns a `Response`.

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

Each route file you add produces an endpoint at the matching URL. Hit it with
`curl` and confirm:

- 200 OK with the expected JSON body for the methods you exported.
- 404 if the file path does not match the URL.
- 405 if you call a method that has no exported handler in the file.

## Next

- [Create frontend](./create-frontend.md): add a page that calls this endpoint
- [Deploy project](./deploy-project.md): ship the project to production

## Related

- [API routes](../guides/api-routes.md): full surface (request parsing,
  streaming, dynamic params, pages-router shape)
- [Middleware](../guides/middleware.md): add CORS, rate limiting, logging, and
  auth checks
- [Agents](../guides/agents.md): wire an agent behind an API route with
  `createAgUiHandler`
