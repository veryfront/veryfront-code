---
title: "Tools"
description: "Define tools with schema-backed inputs that agents can call."
order: 19
---

A tool is a typed function an agent can call. It declares input, describes when to use it, and runs server-side code.

## Prerequisites

- A Veryfront project running locally (see [Create a project](./create-a-project.md)).
- An agent that will call the tool, or an API route that invokes the tool
  directly (see [Agents](./agents.md) and [API routes](./api-routes.md)).
- `zod` is available in the project (it is bundled with `veryfront`).

## Define a tool

Create a file in `tools/`:

```ts
// tools/get-weather.ts
import { z } from "zod";
import { tool } from "veryfront/tool";

export default tool({
  description: "Get the current weather for a city",
  inputSchema: z.object({
    city: z.string().describe("City name"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature unit"),
  }),
  execute: async ({ city, units }) => {
    const temperature = units === "fahrenheit" ? 72 : 22;
    return { city, temperature, units, conditions: "sunny" };
  },
});
```

The filename becomes the tool's ID. `tools/get-weather.ts` registers as `getWeather`.

## Try a tool directly

Agents usually invoke tools, but direct execution is useful for testing and for API routes that expose a specific action:

```ts
// app/api/weather/route.ts
import getWeather from "../../../tools/get-weather.ts";

export async function GET(request: Request) {
  const city = new URL(request.url).searchParams.get("city") ?? "Tokyo";
  const result = await getWeather.execute({ city, units: "celsius" });
  return Response.json(result);
}
```

Run the dev server and call the route:

```bash
curl "http://localhost:3000/api/weather?city=Tokyo"
```

Use this pattern to verify the tool contract before giving the tool to an agent.

## How agents use tools

When you add a tool to an agent, the framework sends the input schema to the model. The model decides when to call the tool and provides the parameters:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  system: "You are a weather assistant. Use the getWeather tool to answer weather questions.",
  tools: { getWeather: true },
  maxSteps: 3,
});
```

In most projects, you can omit `model` and let runtime defaults choose local
or Veryfront Cloud inference automatically.

When a user asks "What's the weather in Tokyo?", the agent:

1. Sends the question to the model
2. The model calls `getWeather({ city: "Tokyo" })`
3. The tool returns `{ temperature: 22, conditions: "sunny" }`
4. The model formats a natural language response

## Tool configuration

| Property      | Type                           | Description                                |
| ------------- | ------------------------------ | ------------------------------------------ |
| `description` | `string`                       | What the tool does (shown to the model)    |
| `inputSchema` | `Schema<T>`                    | Schema for input validation                |
| `execute`     | `(params) => Promise<unknown>` | Function that runs when the tool is called |
| `id`          | `string`                       | Override the auto-generated ID             |

## Writing good descriptions

The `description` field is what the model reads to decide when to call your tool. Be specific, and use `.describe()` on schema fields to help the model understand what to pass:

```ts
import { z } from "zod";

export default tool({
  description: "Search the product catalog by name, category, or price range",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search term"),
    category: z.string().optional().describe("Filter by category"),
    maxPrice: z.number().optional().describe("Maximum price in USD"),
  }),
  execute: async ({ query, category, maxPrice }) => {/* ... */},
});
```

## Returning errors

Throw from `execute` to signal an error. The agent sees the error message and can retry or respond accordingly:

```ts
import { z } from "zod";

export default tool({
  description: "Look up a user by email",
  inputSchema: z.object({ email: z.string().email().describe("User email address") }),
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
import { z } from "zod";

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

| Context field | Type          | Description                                     |
| ------------- | ------------- | ----------------------------------------------- |
| `agentId`     | `string`      | ID of the agent that called the tool            |
| `projectId`   | `string`      | Current project identifier                      |
| `endUserId`   | `string`      | End-user identity for per-user token resolution |
| `blobStorage` | `BlobStorage` | Blob storage access (if configured in workflow) |

Pass context from the API route:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant", {
  context: {
    endUserId: "user-123",
  },
});
```

## Inline tools

For one-off tools that don't need auto-discovery, define them inline:

```ts
import { agent } from "veryfront/agent";
import { z } from "zod";
import { tool } from "veryfront/tool";

export default agent({
  system: "You are a math tutor.",
  tools: {
    calculate: tool({
      description: "Evaluate a math expression",
      inputSchema: z.object({ expression: z.string().describe("Math expression to evaluate") }),
      execute: async ({ expression }) => ({
        result: evaluateMathExpression(expression),
      }),
    }),
  },
});
```

`evaluateMathExpression` is your own validated math evaluator. Avoid passing
free-form input into `eval()` or `Function()`.

## Verify it worked

Restart `veryfront dev` after creating the tool file. To run the tool by
itself, expose a small debug API route:

```ts
// app/api/debug/tools/route.ts
import { toolRegistry } from "veryfront/tool";

export async function POST(request: Request) {
  const { name, input } = await request.json();
  const result = await toolRegistry.get(name)?.execute(input);
  return Response.json(result);
}
```

```bash
curl -X POST http://localhost:3000/api/debug/tools \
  -H "Content-Type: application/json" \
  -d '{"name":"getWeather","input":{"city":"Berlin"}}'
```

A working tool returns the JSON your `execute` function produced. Remove the
debug route before deploying.

## Next

- [Memory and streaming](./memory-and-streaming.md): persist conversations across requests
- [MCP server](./mcp-server.md): expose tools over Model Context Protocol

## Related

- [`veryfront/tool`](../reference/veryfront/tool.md): tool API reference
- [`veryfront/schemas`](../reference/veryfront/schemas.md): reusable schema helpers
