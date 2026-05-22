---
title: "Quickstart"
description: "Build and run a Veryfront agent app with a tool, chat UI, and deploy path."
order: -1
---

Build a small agent app that can call a typed tool, stream through the chat UI,
and follow the same deploy path as a production project.

## Prerequisites

- Node.js 18.18 or later.
- The Veryfront CLI installed. See [Installation](./installation.md).
- A model provider key for local inference. Use a placeholder in examples and
  put the real value in your local `.env` file.

## Create a project

```bash
veryfront init support-agent --template ai-agent
cd support-agent
```

The `ai-agent` template creates the three surfaces used in this guide:

```text
support-agent/
  agents/
    assistant.ts
  tools/
    calculator.ts
  app/
    page.tsx
    api/
      ag-ui/
        route.ts
```

Project primitives such as `agents/`, `tools/`, `skills/`, `workflows/`,
`prompts/`, and `resources/` live at the project root. They are not placed
inside `app/`.

## Configure a provider

Create `.env` with the provider key you use locally:

```bash
OPENAI_API_KEY=<API_KEY>
```

Veryfront picks a matching provider automatically. For direct vendor routing,
local models, or Veryfront Cloud routing, see [Providers](./providers.md).

## Add a tool

Create `tools/get-weather.ts`:

```ts
import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Get the current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("City name"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius")
      .describe("Temperature unit"),
  }),
  execute: async ({ city, units }) => {
    const temperature = units === "fahrenheit" ? 72 : 22;
    return { city, units, temperature, conditions: "sunny" };
  },
});
```

The filename provides the discovered tool id. In agent config, reference the
tool as `getWeather`.

## Add an agent

Update `agents/assistant.ts`:

```ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a concise support assistant. Use tools when they help.",
  tools: { getWeather: true },
  maxSteps: 5,
});
```

`maxSteps` is required when an agent uses tools. It gives the model enough
turns to call the tool, receive the result, and produce the final answer.

## Expose the chat route

Create or confirm `app/api/ag-ui/route.ts`:

```ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

The route returns an AG-UI Server-Sent Events stream for browser chat clients.

## Render chat

Create or confirm `app/page.tsx`:

```tsx
"use client";

import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/ag-ui" });
  return <Chat {...chat} placeholder="Ask about weather or your project" />;
}
```

`"use client"` is required because `useChat` is a React hook.

## Run it locally

```bash
veryfront dev
```

Open `http://localhost:3000` and ask:

```text
What is the weather in Tokyo in celsius?
```

To test the route without the UI:

```bash
curl -N -X POST http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"What is the weather in Tokyo in celsius?"}]}]}'
```

## Verify it worked

The browser should show a streamed assistant response that uses the weather
tool result. The curl response should emit `data:` lines, including a start
event, text deltas, and a finish event.

If the route returns `Agent not found`, ensure `agents/assistant.ts` is in the
project root. If the model answers without using the tool, ensure the agent
has both `tools: { getWeather: true }` and `maxSteps`.

## Deploy

Build the project before deploying:

```bash
veryfront build
```

Create a release from Veryfront Studio or deploy through the CLI when your
project is connected:

```bash
veryfront deploy
```

Preview environments update from Studio saves. Production deployments are
created through the release flow.

## Next

- [Agents](./agents.md): add memory, skills, dynamic system prompts, and hosted runs.
- [Tools](./tools.md): write production tool contracts and error handling.
- [Chat UI](./chat-ui.md): customize the preset chat component.
- [Deploy a project](./deploy-a-project.md): ship and verify a production deployment.

## Related

- [`veryfront/agent`](../reference/veryfront/agent.md): agent API reference
- [`veryfront/tool`](../reference/veryfront/tool.md): tool API reference
- [`veryfront/chat`](../reference/veryfront/chat.md): chat API reference
