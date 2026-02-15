# Veryfront

The full-stack React framework for agentic AI apps. Works with Node.js, Deno, and Bun.

```bash
npm create veryfront
```

<details>
<summary>pnpm, yarn, bun, deno</summary>

```bash
pnpm create veryfront
yarn create veryfront
bun create veryfront
deno init --npm veryfront
```

</details>

## What You Get

Agents, tools, and workflows are files. Auto-discovered, no registration needed.

```
my-app/
  agents/
    assistant.ts      # AI agent with model, system prompt, tools
  tools/
    search.ts         # Zod-validated tool the agent can call
  prompts/
    assistant.ts      # System prompt (versioned, swappable)
  workflows/
    pipeline.ts       # DAG workflow with branching + parallelism
  app/
    layout.tsx        # Root layout
    page.tsx          # Chat UI
    api/
      chat/
        route.ts      # Streaming chat endpoint
```

## Define Agent

Agents have a model, system prompt, and optional tools and memory.

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful assistant.",
  tools: true,       // auto-attach all discovered tools
  maxSteps: 10,
});
```

## Define Tool

Tools are Zod-validated functions an agent can call.

```ts
// tools/search.ts
import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "search",
  description: "Search the knowledge base",
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    // your logic here
    return { results: [] };
  },
});
```

## Expose Chat Endpoint

One-line API route via `createChatHandler`, or use `getAgent` for full control.

```ts
// app/api/chat/route.ts
import { createChatHandler } from "veryfront/agent";

export const POST = createChatHandler("assistant");
```

<details>
<summary>Manual handler with getAgent</summary>

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const agent = getAgent("assistant");
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

</details>

## Add Chat UI

Pre-built `<Chat />` component with streaming and tool call rendering.

```tsx
// app/page.tsx
"use client"
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

## Features

| | |
|---|---|
| **Agents** | Model, system prompt, tools, memory, streaming |
| **Tools** | Zod-validated, auto-discovered |
| **Prompts** | Versioned, `{{variable}}` interpolation, MCP-exposed |
| **Workflows** | DAG orchestration, branching, parallelism, human approval |
| **Multi-agent** | Agent-as-tool composition and delegation |
| **Chat UI** | `<Chat />` component, `useChat` hook |
| **Providers** | OpenAI, Anthropic, Google via unified interface |
| **OAuth** | 37 pre-configured providers |
| **Routing** | File-based with layouts, SSR, RSC |
| **Middleware** | CORS, rate limiting, auth, custom pipelines |
| **MDX** | Markdown pages with React components |
| **Deploy** | `veryfront deploy` to managed cloud |

## Templates

```bash
npx veryfront init my-app
```

| Template | Description |
|----------|-------------|
| **chat** | AI chatbot with agent, tools, streaming UI |
| **rag** | Chat with your docs via retrieval-augmented generation |
| **multi-agent** | Agents that delegate to each other as tools |
| **workflow** | Multi-step AI pipeline with approvals and parallelism |
| **coding-agent** | AI code assistant with file read/write/edit tools |
| **saas** | AI SaaS with auth, per-user chat, memory |
| **minimal** | Blank canvas |

## Documentation

- [Quickstart](https://veryfront.com/code/guides/quickstart)
- [Project Structure](https://veryfront.com/code/guides/project-structure)
- [Agents](https://veryfront.com/code/guides/agents)
- [Tools](https://veryfront.com/code/guides/tools)
- [Workflows](https://veryfront.com/code/guides/workflows)
- [Chat UI](https://veryfront.com/code/guides/chat-ui)
- [API Reference](https://veryfront.com/code/api)

## License

Apache-2.0
