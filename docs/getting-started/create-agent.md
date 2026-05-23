---
title: "Create agent"
description: "Define an AI agent and stream its response in under five minutes."
order: 4
---

## Prerequisites

- [Veryfront installed](./installation.md) and a project created with
  [Create project](./create-project.md).
- An `agents/` directory in the project root. If you started from the `minimal`
  template, create one: `mkdir agents`.
- A provider configured for inference. Set `OPENAI_API_KEY` or
  `ANTHROPIC_API_KEY` in `.env`. See [Providers](../guides/providers.md) for
  other options.

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

The handler validates the request, runs the agent, and returns an AG-UI SSE
response. Pair it with `useChat({ api: "/api/ag-ui" })` in a React client.

Use `agent.generate()` only for non-interactive work such as cron jobs, batch
calls, and focused tests. See [Agents](../guides/agents.md#non-streaming-response).
For non-chat streaming, see [Memory and streaming](../guides/memory-and-streaming.md).

## Run it

Start the dev server:

```bash
veryfront dev
```

Send a chat message from another terminal. The `-N` flag tells curl to flush
each chunk as it arrives:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is Veryfront in one sentence?"}]}]}'
```

## Verify it worked

The response is an AG-UI SSE stream. `data:` lines arrive progressively between
`message-start` and `message-finish` events.

If the whole body lands at once after a delay, curl or a TLS proxy may be
buffering. Run the same request without `-N` to confirm.

If the dev server logs a missing-provider error, check that the provider key is
set in the shell running `veryfront dev`.

## Next

Continue with [Create API](./create-api.md).
