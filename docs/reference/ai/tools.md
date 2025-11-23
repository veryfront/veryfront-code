---
title: "Tools API Reference"
category: "reference"
level: "advanced"
keywords: ["tools", "ai", "functions", "zod", "schema"]
ai_summary: "API reference for defining AI tools using Zod schemas."
related: ["guides/ai/getting-started", "reference/ai/agent"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Tools API Reference

Tools allow AI agents to interact with the outside world (APIs, databases, calculations). They are defined using the `tool()` function and Zod schemas for type safety.

## Import

```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';
```

## Signature

```typescript
function tool<T extends z.ZodType>(config: ToolConfig<T>): Tool<T>
```

## Configuration Object (`ToolConfig`)

| Property | Type | Required | Description |
|----------|------|:--------:|-------------|
| `description` | `string` | ✅ | Clear description of what the tool does (used by the LLM to decide when to call it). |
| `inputSchema` | `ZodSchema` | ✅ | Zod schema defining the expected arguments. |
| `execute` | `(args, context) => Promise<any>` | ✅ | The implementation function. |

### `execute` Function

The execute function receives two arguments:

1.  **`args`**: The validated arguments matching your Zod schema.
2.  **`context`**: The execution context (contains `agentId`, `model`, etc.).

## Examples

### Basic Tool

```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export const getWeather = tool({
  description: 'Get current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name (e.g., "London")'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: async ({ location, unit }) => {
    // Fetch real data...
    return { temp: 22, unit, condition: 'Sunny' };
  },
});
```

### Tool with Context

Access metadata about the calling agent.

```typescript
export const getUserData = tool({
  description: 'Get current user profile',
  inputSchema: z.object({}),
  execute: async (_args, context) => {
    // Use context injected by middleware
    const userId = context.data?.userId;
    if (!userId) throw new Error("User not authenticated");
    
    return await db.users.find(userId);
  },
});
```

## Auto-Discovery

Tools placed in the `ai/tools/` directory are automatically registered with the system.

**File:** `ai/tools/search.ts`
```typescript
// ... tool definition ...
export default tool({ ... });
```

**Usage in Agent:**
```typescript
agent({
  tools: {
    search: true // Enables the auto-discovered tool named "search"
  }
});
```
