---
title: "Tools Reference"
category: "reference"
level: "advanced"
keywords: ["tools", "ai", "functions", "zod", "schema"]
ai_summary: "API reference for defining AI tools using Zod schemas."
related: ["guides/ai/getting-started", "reference/ai/agent", "reference/ai/integrations"]
version: "0.1.0"
last_updated: "2025-12-07"
---

# Tools Reference

Tools enable AI agents to perform actions: call APIs, query databases, run calculations, and interact with external services. Define tools using the `tool()` function with Zod schemas for type-safe parameters.

## Import

```typescript
import { tool } from 'veryfront/tool';
import { z } from "zod";
```

## Syntax

```typescript
function tool<T extends z.ZodType>(config: ToolConfig<T>): Tool<T>
```

## Configuration

| Property | Type | Required | Description |
|----------|------|:--------:|-------------|
| `name` | `string` | Yes | Unique identifier for the tool |
| `description` | `string` | Yes | What the tool does (LLM uses this to decide when to call it) |
| `parameters` | `ZodSchema` | Yes | Zod schema defining the input arguments |
| `execute` | `(args, context) => Promise<any>` | Yes | Function that performs the action |

## Basic Example

```typescript
import { tool } from 'veryfront/tool';
import { z } from "zod";

export const getWeather = tool({
  name: "get-weather",
  description: "Get current weather for a location",
  parameters: z.object({
    location: z.string().describe("City name, e.g., London"),
    unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
  }),
  execute: async ({ location, unit }) => {
    const response = await fetch(`https://api.weather.com/${location}`);
    const data = await response.json();
    return { temp: data.temp, unit, condition: data.condition };
  },
});
```

## Execute Function

The `execute` function receives two arguments:

### Arguments (`args`)

The validated input matching your Zod schema:

```typescript
execute: async ({ location, unit }) => {
  // location: string
  // unit: "celsius" | "fahrenheit"
}
```

### Context (`context`)

Execution metadata including agent ID, model, and custom data:

```typescript
execute: async (args, context) => {
  console.log(context.agentId);  // Agent that invoked the tool
  console.log(context.model);    // Model being used
  console.log(context.userId);   // User ID (if set by middleware)
}
```

## Auto-Discovery

Place tools in the `ai/tools/` directory for automatic registration.

### File Structure

```
my-project/
└── ai/
    └── tools/
        ├── get-weather.ts
        ├── search-web.ts
        └── calculate.ts
```

### Tool File

```typescript
// ai/tools/get-weather.ts
import { tool } from 'veryfront/tool';
import { z } from "zod";

export const getWeather = tool({
  name: "get-weather",
  description: "Get current weather for a location",
  parameters: z.object({
    location: z.string(),
  }),
  execute: async ({ location }) => {
    // Implementation
  },
});
```

### Use in Agent

Reference tools by name or glob pattern:

```typescript
import { agent } from 'veryfront/agent';

const assistant = agent({
  model: "openai/gpt-4",
  tools: ["get-weather", "search-web"],  // Specific tools
});

// Or use all tools
const assistant = agent({
  model: "openai/gpt-4",
  tools: ["*"],  // All discovered tools
});
```

## Integration Tools

Use tools from [integrations](./integrations.md) with glob patterns:

```typescript
const assistant = agent({
  model: "openai/gpt-4",
  tools: [
    "gmail/*",      // All Gmail tools
    "calendar/*",   // All Calendar tools
    "get-weather",  // Custom tool
  ],
});
```

## Tool with User Context

Access user-specific data passed through middleware:

```typescript
export const getUserProfile = tool({
  name: "get-user-profile",
  description: "Get the current user's profile",
  parameters: z.object({}),
  execute: async (_args, context) => {
    const userId = context.userId;
    if (!userId) {
      throw new Error("User not authenticated");
    }
    return await db.users.findById(userId);
  },
});
```

## Tool with OAuth Token

Access service tokens from the token store:

```typescript
import { tokenStore } from "@/lib/token-store";

export const listEmails = tool({
  name: "list-emails",
  description: "List recent emails from Gmail",
  parameters: z.object({
    maxResults: z.number().default(10),
  }),
  execute: async ({ maxResults }, context) => {
    const token = await tokenStore.get("gmail", context.userId);

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }
    );

    return response.json();
  },
});
```

## Error Handling

Throw errors to signal failures to the agent:

```typescript
export const fetchData = tool({
  name: "fetch-data",
  description: "Fetch data from an API",
  parameters: z.object({
    url: z.string().url(),
  }),
  execute: async ({ url }) => {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    return response.json();
  },
});
```

The agent receives the error message and can retry or inform the user.

## Return Values

Tools can return any JSON-serializable value:

```typescript
// Object
return { temperature: 22, unit: "celsius" };

// Array
return [{ id: 1, name: "Item 1" }, { id: 2, name: "Item 2" }];

// String
return "Operation completed successfully";

// Number
return 42;

// Boolean
return true;
```

## Parameter Descriptions

Add `.describe()` to schema fields to help the LLM understand parameters:

```typescript
parameters: z.object({
  query: z.string().describe("Search query, e.g., 'weather in Paris'"),
  limit: z.number().min(1).max(100).describe("Maximum results to return"),
  includeMetadata: z.boolean().default(false).describe("Include result metadata"),
}),
```

## Related Documentation

- [Agent Configuration](./agent.md) - Configure AI agents
- [Integrations](./integrations.md) - Pre-built service integrations
- [Hooks](./hooks.md) - React hooks for AI features
