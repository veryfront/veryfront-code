---
title: "Create an agent"
description: "Define an AI agent and invoke it from server code in under five minutes."
order: 37
---

Define an agent in a Veryfront project, send it a message, and stream the response back. For tools, memory, skills, and hosted runs, see [Agents](./agents.md).

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

From an API route, resolve the agent by id and call `stream`:

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

App-router handlers receive the raw `Request`. The same route on the pages router lives at `pages/api/ask.ts` and receives an `APIContext`. See [API routes](./api-routes.md).

`stream` emits chunks as the model produces them. `toDataStreamResponse()` returns a `Response` with `Content-Type: text/event-stream` that the AI SDK chat hooks (`useChat`, `useAgent`) and any AG-UI client consume directly, so the user sees tokens appear instead of waiting for the full reply.

For a single buffered JSON object (cron jobs, batch calls, unit tests), use `generate` instead and return `Response.json({ answer: result.text })`. See [Memory and streaming](./memory-and-streaming.md) for both paths.

## Run it

Start the dev server:

```bash
veryfront dev
```

Send a request from another terminal. The `-N` flag tells curl to flush each chunk as it arrives:

```bash
curl -N -X POST http://localhost:3000/api/ask \
  -H "content-type: application/json" \
  -d '{"question":"What is Veryfront in one sentence?"}'
```

## Verify it worked

The response is a Server-Sent Events stream. You should see `data:` lines arrive in three phases:

1. Metadata events that open the run.
2. `text-delta` chunks that assemble the model's reply.
3. A final `finish` event with token usage.

If the whole body lands at once after a delay, that is curl or a TLS proxy buffering rather than the route. Run the same request without `-N` to confirm.

If the dev server logs a missing-provider error, check that `OPENAI_API_KEY` (or your provider's variable) is exported in the shell running `veryfront dev`.

## Next

- [Agents](./agents.md): full agent surface — tools, dynamic system prompts, multi-step runs, memory, AG-UI handlers, hosted runs.
- [Tools](./tools.md): let the agent call typed functions.
- [Chat UI](./chat-ui.md): drop a streaming chat interface into a React page that talks to this agent.
