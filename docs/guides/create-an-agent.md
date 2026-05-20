---
title: "Create an agent"
description: "Define an AI agent and invoke it from server code in under five minutes."
order: 37
---

Define an AI agent in a fresh Veryfront project, send it a message, and read back the response. This guide is the smallest end-to-end agent you can build with Veryfront; deeper topics — tools, memory, skills, hosting, streaming — live in [Agents](./agents.md) and the AI guides that follow it.

## Prerequisites

- [Veryfront installed](./installation.md) and a project created with [Quickstart](./quickstart.md). The `ai-agent` template gives you the file layout below by default.
- An `agents/` directory in the project root. If you started from the `minimal` template, create one: `mkdir agents`.
- A provider configured for inference. The simplest path is to set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`; the framework picks the matching provider automatically. See [Providers](./providers.md) for other options.

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

The file name (without extension) becomes the agent id. Veryfront auto-discovers every file under `agents/` at startup, so there is nothing else to register.

For a one-shot persona without TypeScript, you can write the same agent as `agents/assistant.md`:

```md
---
name: Assistant
description: Concise general-purpose assistant
---

You are a concise assistant. Answer in one short paragraph.
```

Both forms register the same `assistant` id and are interchangeable from the call sites below.

## Invoke the agent

From any server-side context (an API route, `getServerData`, a workflow step, a CLI command), resolve the agent by id and call `stream`:

```ts
// app/api/ask/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { question } = await request.json();
  const assistant = getAgent("assistant");

  const result = await assistant.stream({ input: question });
  return result.toDataStreamResponse();
}
```

App-router handlers receive the raw `Request` directly. If you prefer the pages router, the same route lives at `pages/api/ask.ts` and receives an `APIContext` (`ctx.request.json()`, `ctx.json(...)`); see [API routes](./api-routes.md).

`stream` emits chunks as the model produces them; `toDataStreamResponse()` adapts the stream to a Server-Sent Events `Response` that the AI SDK chat hooks (`useChat`, `useAgent`) and any AG-UI client consume directly — the user sees tokens fill in instead of waiting for the full reply. If you actually want a single buffered JSON object (a cron job, a batch tool call, a unit test), swap `stream` for `generate` and return `Response.json({ answer: result.text })`. The [Memory and streaming](./memory-and-streaming.md) guide covers both paths in depth.

## Run it

Start the dev server:

```bash
veryfront dev
```

Send a request from another terminal. Pass `-N` so curl flushes chunks as the model streams them rather than buffering the response itself:

```bash
curl -N -X POST http://localhost:3000/api/ask \
  -H "content-type: application/json" \
  -d '{"question":"What is Veryfront in one sentence?"}'
```

## Verify it worked

The response is a Server-Sent Events stream. You should see `data:` lines arrive progressively — first metadata events, then `text-delta` chunks that assemble the model's answer one piece at a time, then a final `finish` event with token usage. If the whole body lands at once after a delay, that is curl or your TLS proxy buffering, not the route; rerunning without `-N` confirms it. If the dev server logs an error mentioning a missing provider, recheck that `OPENAI_API_KEY` (or your provider's variable) is exported in the shell that runs `veryfront dev`.

## Next

- [Agents](./agents.md): full agent surface — tools, dynamic system prompts, multi-step runs, memory, AG-UI handlers, hosted runs.
- [Tools](./tools.md): let the agent call typed functions.
- [Chat UI](./chat-ui.md): drop a streaming chat interface into a React page that talks to this agent.
