---
title: "Create an agent"
description: "Define an AI agent and invoke it from server code in under five minutes."
order: 4
---

Define an agent in a Veryfront project, send it a message, and stream the response back. For tools, memory, skills, and hosted runs, see [Agents](../guides/agents.md).

## Prerequisites

- [Veryfront installed](./installation.md) and a project created with [Create a project](./create-a-project.md). The `ai-agent` template gives you the file layout below by default.
- An `agents/` directory in the project root. If you started from the `minimal` template, create one: `mkdir agents`.
- A provider configured for inference. The simplest path is to set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`; the framework picks the matching provider automatically. See [Providers](../guides/providers.md) for other options.

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

Mount the agent through `createAgUiHandler` to get a streaming chat endpoint:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

The handler validates the request, runs the agent, and returns an AG-UI Server-Sent Events response. Pair it with `useChat({ api: "/api/ag-ui" })` in a React client (see [Chat UI](../guides/chat-ui.md)) and tokens appear in the UI as the model produces them.

For a buffered JSON response (cron jobs, batch calls, unit tests), resolve the agent yourself and call `generate`:

```ts
// app/api/ask/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { question } = await request.json();
  const assistant = getAgent("assistant");

  const result = await assistant.generate({ input: question });
  return Response.json({ answer: result.text, usage: result.usage });
}
```

App-router handlers receive the raw `Request`. The same route on the pages router lives at `pages/api/ag-ui.ts` (or `pages/api/ask.ts`) and receives an `APIContext`. See [API routes](../guides/api-routes.md). For lower-level streaming surfaces that are not AG-UI chat, see [Memory and streaming](../guides/memory-and-streaming.md).

## Run it

Start the dev server:

```bash
veryfront dev
```

Send a chat message from another terminal. The `-N` flag tells curl to flush each chunk as it arrives:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is Veryfront in one sentence?"}]}]}'
```

## Verify it worked

The response is an AG-UI Server-Sent Events stream. `data:` lines arrive progressively: a `message-start` event opens the run, text-delta events stream the model's reply piece by piece, and a `message-finish` event closes the message.

If the whole body lands at once after a delay, that is curl or a TLS proxy buffering rather than the route. Run the same request without `-N` to confirm.

If the dev server logs a missing-provider error, check that `OPENAI_API_KEY` (or your provider's variable) is exported in the shell running `veryfront dev`.

## Next

- [Agents](../guides/agents.md): full agent surface (tools, dynamic system prompts, multi-step runs, memory, AG-UI handlers, hosted runs).
- [Tools](../guides/tools.md): let the agent call typed functions.
- [Chat UI](../guides/chat-ui.md): drop a streaming chat interface into a React page that talks to this agent.
