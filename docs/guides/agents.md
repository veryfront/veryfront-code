---
title: "Agents"
description: "Create an AI agent with a system prompt, tools, and memory."
order: 6
---

An agent is an AI model with instructions, tools, and memory. Define one in a file, and the framework handles discovery, registration, and routing.

## Define an agent

Create a file in `agents/`:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful assistant. Answer concisely.",
});
```

The `id` is how you reference the agent later with `getAgent("assistant")`.

## Add tools

Agents call tools to take actions or fetch data. Reference tools by name — the framework resolves them from the `tools/` directory:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: "You are a weather assistant.",
  tools: { getWeather: true },
  maxSteps: 5,
});
```

`maxSteps` limits how many tool-call iterations the agent can perform per request. See [Tools](./tools.md) for how to define `getWeather`.

## Connect to a route

Use `getAgent()` to retrieve a registered agent and stream its response:

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { messages } = await request.json();
  const agent = getAgent("assistant");
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

## Non-streaming response

For server-side generation (e.g., in `getServerData`), use `generate()`:

```ts
import { getAgent } from "veryfront/agent";

const agent = getAgent("assistant");
const result = await agent.generate({
  input: "Summarize the latest news about AI.",
});

console.log(result.text);       // The agent's response
console.log(result.toolCalls);  // Tools the agent called
console.log(result.usage);      // Token usage
```

## Dynamic system prompts

The `system` property accepts a string, a function, or an async function:

```ts
export default agent({
  id: "assistant",
  model: "openai/gpt-4o",
  system: async () => {
    const date = new Date().toLocaleDateString();
    return `You are a helpful assistant. Today is ${date}.`;
  },
});
```

## Agent configuration

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique identifier used with `getAgent()` |
| `model` | `string` | Provider and model (e.g. `"openai/gpt-4o"`, `"anthropic/claude-sonnet-4-5-20250929"`) |
| `system` | `string \| () => string \| Promise<string>` | System prompt |
| `tools` | `Record<string, boolean \| Tool>` | Tools the agent can use |
| `maxSteps` | `number` | Max tool-call iterations per request |
| `memory` | `MemoryConfig` | Conversation memory settings |
| `streaming` | `boolean` | Enable streaming (default: `true`) |
| `middleware` | `AgentMiddleware[]` | Execution middleware |

## Next

- [Tools](./tools.md) — define the tools your agent calls
- [Memory & Streaming](./memory-and-streaming.md) — add conversation memory

## Related

- [`veryfront/agent`](../reference/agent.md) — agent API reference
