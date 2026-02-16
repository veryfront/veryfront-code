---
title: "Tools"
description: "Define tools with Zod schemas that agents can call."
order: 7
---

# Tools

Define tools with Zod schemas that agents can call.

## Define a tool

Create a file in `tools/`:

```ts
// tools/get-weather.ts
import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  description: "Get the current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("City name"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  execute: async ({ city, units }) => {
    const response = await fetch(`https://api.weather.com/v1?city=${city}&units=${units}`);
    const data = await response.json();
    return { temperature: data.temp, conditions: data.conditions };
  },
});
```

The filename becomes the tool's ID. This tool registers as `"get-weather"` (hyphens from the filename are preserved).

## How agents use tools

When you add a tool to an agent, the framework sends the Zod schema to the model. The model decides when to call the tool and provides the parameters:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  model: "openai/gpt-4o",
  system: "You are a weather assistant. Use the getWeather tool to answer weather questions.",
  tools: { getWeather: true },
  maxSteps: 3,
});
```

When a user asks "What's the weather in Tokyo?", the agent:
1. Sends the question to the model
2. The model calls `getWeather({ city: "Tokyo" })`
3. The tool returns `{ temperature: 22, conditions: "sunny" }`
4. The model formats a natural language response

## Tool configuration

| Property | Type | Description |
|----------|------|-------------|
| `description` | `string` | What the tool does (shown to the model) |
| `inputSchema` | `z.ZodSchema` | Zod schema for input validation |
| `execute` | `(params) => Promise<unknown>` | Function that runs when the tool is called |
| `id` | `string` | Override the auto-generated ID |

## Writing good descriptions

The `description` field is what the model reads to decide when to call your tool. Be specific, and use `.describe()` on Zod fields to help the model understand what to pass:

```ts
export default tool({
  description: "Search the product catalog by name, category, or price range",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search term"),
    category: z.string().optional().describe("Filter by category"),
    maxPrice: z.number().optional().describe("Maximum price in USD"),
  }),
  execute: async ({ query, category, maxPrice }) => { /* ... */ },
});
```

## Returning errors

Throw from `execute` to signal an error. The agent sees the error message and can retry or respond accordingly:

```ts
export default tool({
  description: "Look up a user by email",
  inputSchema: z.object({ email: z.string().email() }),
  execute: async ({ email }) => {
    const user = await db.users.findByEmail(email);
    if (!user) throw new Error(`No user found with email ${email}`);
    return { id: user.id, name: user.name };
  },
});
```

## Tools with context

The `execute` function receives an optional second argument with runtime context:

```ts
export default tool({
  description: "List repos for the current user",
  inputSchema: z.object({
    sort: z.enum(["created", "updated"]).default("updated"),
  }),
  execute: async ({ sort }, context) => {
    const userId = context?.endUserId ?? "anonymous";
    return await fetchRepos(userId, { sort });
  },
});
```

| Context field | Type | Description |
|---------------|------|-------------|
| `agentId` | `string` | ID of the agent that called the tool |
| `projectId` | `string` | Current project identifier |
| `endUserId` | `string` | End-user identity for per-user token resolution |
| `blobStorage` | `BlobStorage` | Blob storage access (if configured in workflow) |

Pass context from the API route:

```ts
// app/api/chat/route.ts
const result = await agent.stream({
  messages,
  context: { endUserId: "user-123" },
});
```

## Inline tools

For one-off tools that don't need auto-discovery, define them inline:

```ts
import { agent } from "veryfront/agent";
import { tool } from "veryfront/tool";
import { z } from "zod";

export default agent({
  model: "openai/gpt-4o",
  system: "You are a math tutor.",
  tools: {
    calculate: tool({
      description: "Evaluate a math expression",
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) => ({ result: eval(expression) }),
    }),
  },
});
```

## Next

- [Memory & Streaming](./memory-and-streaming.md) — persist conversations across requests
- [MCP Server](./mcp-server.md) — expose tools over Model Context Protocol

## Related

- [`veryfront/tool`](../reference/tool.md) — tool API reference
