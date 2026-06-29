---
title: "Tools"
description: "Define tools with schema-backed inputs that agents can call."
order: 20
---

A tool is a typed function an agent can call. It declares input, describes when to use it, and runs server-side code.

## Prerequisites

- A Veryfront project running locally (see [Create project](../getting-started/create-project.md)).
- An agent that will call the tool, or an API route that invokes the tool
  directly (see [Agents](./agents.md) and [API routes](./api-routes.md)).
- `defineSchema` is available from `veryfront/schemas`.

## Define a tool

Create a file in `tools/`:

```ts
// tools/get-weather.ts
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

export default tool({
  description: "Get the current weather for a city",
  inputSchema: defineSchema((v) =>
    v.object({
      city: v.string().describe("City name"),
      units: v.enum(["celsius", "fahrenheit"]).default("celsius")
        .describe("Temperature unit"),
    })
  )(),
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

In most projects, you can omit `model` and use `openai/gpt-5.4-nano`. Set
`model: "auto"` when you want runtime defaults to choose local or Veryfront
Cloud inference automatically.

When a user asks "What's the weather in Tokyo?", the agent:

1. Sends the question to the model
2. The model calls `getWeather({ city: "Tokyo" })`
3. The tool returns `{ temperature: 22, conditions: "sunny" }`
4. The model formats a natural language response

## Tool surfaces in agent config

Agent config separates tools by execution boundary:

| Config field    | Use it for                                              | Executes in                         |
| --------------- | ------------------------------------------------------- | ----------------------------------- |
| `tools`         | Local project tools from `tools/` or inline `tool(...)` | Veryfront runtime                   |
| `providerTools` | Provider-native tools such as `web_search`              | Selected model provider             |
| `mcpServers`    | Remote MCP-compatible tool servers                      | Remote MCP server through Veryfront |
| `skills`        | Reusable skill packs that can load skill instructions   | Veryfront runtime                   |

Use `tools` for functions you define in the project. Do not add provider-native
tools or skill loader tools to `tools`.

Use `providerTools` for provider-executed capabilities:

```ts
// agents/researcher.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "researcher",
  system: "Research current information before answering.",
  providerTools: ["web_search"],
});
```

Use `mcpServers` for remote MCP tools. Put remote visibility policy on the MCP
server. When `tools` is an explicit object, also list the remote tool name in
`tools` so the model can use it.

```ts
// agents/docs.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "docs",
  system: "Use the docs server when the user asks about internal docs.",
  tools: { search_docs: true },
  mcpServers: [
    {
      id: "docs",
      transport: {
        type: "http",
        url: "https://docs.example.com/mcp",
      },
      auth: {
        type: "bearer",
        token: () => process.env.DOCS_MCP_TOKEN ?? "",
      },
      toolPolicy: {
        allow: ["search_docs"],
        approval: "never",
      },
    },
  ],
});
```

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
import { defineSchema } from "veryfront/schemas";

export default tool({
  description: "Search the product catalog by name, category, or price range",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v.string().min(1).describe("Search term"),
      category: v.string().optional().describe("Product category filter"),
      maxPrice: v.number().optional().describe("Maximum price in USD"),
    })
  )(),
  execute: async ({ query, category, maxPrice }) => {/* ... */},
});
```

## Returning errors

Throw from `execute` to signal an error. The agent sees the error message and can retry or respond accordingly:

```ts
import { defineSchema } from "veryfront/schemas";

export default tool({
  description: "Look up a user by email",
  inputSchema: defineSchema((v) =>
    v.object({
      email: v.string().email().describe("User email address"),
    })
  )(),
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
import { defineSchema } from "veryfront/schemas";

export default tool({
  description: "List repos for the current account",
  inputSchema: defineSchema((v) =>
    v.object({
      sort: v.enum(["created", "updated"]).default("updated")
        .describe("Repository sort order"),
    })
  )(),
  execute: async ({ sort }, context) => {
    const accountId = typeof context?.accountId === "string" ? context.accountId : "anonymous";
    return await fetchRepos(accountId, { sort });
  },
});
```

| Context field | Type          | Description                                     |
| ------------- | ------------- | ----------------------------------------------- |
| `agentId`     | `string`      | ID of the agent that called the tool            |
| `projectId`   | `string`      | Current project identifier                      |
| `runId`       | `string`      | Current agent run identifier                    |
| `toolCallId`  | `string`      | Current tool call identifier                    |
| `blobStorage` | `BlobStorage` | Blob storage access (if configured in workflow) |
| custom fields | `unknown`     | Host-provided application metadata for the tool |

Pass context from the API route:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant", {
  context: {
    accountId: "account-123",
  },
});
```

## Inline tools

For one-off tools that don't need auto-discovery, define them inline:

```ts
import { agent } from "veryfront/agent";
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

export default agent({
  system: "You are a math tutor.",
  tools: {
    calculate: tool({
      description: "Evaluate a math expression",
      inputSchema: defineSchema((v) =>
        v.object({
          expression: v.string().describe("Math expression to evaluate"),
        })
      )(),
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
