---
title: "Create agent"
description: "Define an AI agent and stream its response in under five minutes."
order: 4
---

## Prerequisites

- A Veryfront project from [Create project](./create-project.md).
- An `agents/` directory. For the `minimal` template, run `mkdir agents`.
- Veryfront Cloud auth. Run `veryfront login`, or set `VERYFRONT_API_TOKEN`.
  `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` also work.

## Define the agent

Create `agents/assistant.ts`:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a concise assistant. Answer in one short paragraph.",
});
```

The file name becomes the agent id unless the agent config sets another `id`.

## Invoke the agent

Mount the agent through `createAgUiHandler` to get a streaming chat endpoint:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

## Run it

Start the dev server:

```bash
veryfront dev
```

## Verify it worked

Send a chat message from another terminal. The `-N` flag tells curl to flush
each chunk as it arrives:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is Veryfront in one sentence?"}]}]}'
```

The curl response should emit `data:` lines as the answer streams.

If the dev server logs a missing-provider error, run `veryfront login`, then
restart `veryfront dev`. If you prefer direct provider keys or local models,
see [Providers](../guides/providers.md).
