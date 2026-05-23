---
title: "Create API"
description: "Expose a Veryfront agent through a streaming AG-UI route."
order: 5
---

## Prerequisites

- The `assistant` agent from [Create agent](./create-agent.md).
- An API route directory. For a minimal setup, run `mkdir -p app/api/ag-ui`.
- Veryfront Cloud auth for inference. Run `veryfront login`, or set
  `VERYFRONT_API_TOKEN`. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` also work.

## Create the route

Create `app/api/ag-ui/route.ts`:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

This route exposes the `assistant` agent at `POST /api/ag-ui` and streams AG-UI
events to the chat UI.

## Run it

Start the dev server:

```bash
veryfront dev
```

## Verify it worked

Send a chat message from another terminal:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is Veryfront in one sentence?"}]}]}'
```

The `-N` flag tells curl to flush each chunk as it arrives.

The curl response should emit `data:` lines as the answer streams.

If the dev server logs a missing-provider error, run `veryfront login`, then
restart `veryfront dev`. If you prefer direct provider keys or local models,
see [Providers](../guides/providers.md).

For non-agent endpoints, see [API routes](../guides/api-routes.md).
