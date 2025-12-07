---
title: "Agent Reference"
category: "reference"
level: "advanced"
keywords: ["agent", "ai", "configuration", "runtime", "memory"]
ai_summary: "Complete API reference for creating and configuring AI agents in Veryfront."
related: ["guides/ai/getting-started", "reference/ai/tools", "reference/ai/integrations"]
version: "0.1.0"
last_updated: "2025-12-07"
---

# Agent Reference

The `agent()` function creates AI agents with tools, memory, and middleware.

## Import

```typescript
import { agent } from "veryfront/ai";
```

## Syntax

```typescript
function agent(config: AgentConfig): AgentRuntime
```

## Configuration

| Property | Type | Required | Description |
|----------|------|:--------:|-------------|
| `model` | `string` | Yes | Model ID (e.g., `"openai/gpt-4"`, `"anthropic/claude-3-5-sonnet"`) |
| `system` | `string` \| `() => string` | No | System prompt instructions |
| `tools` | `string[]` | No | Tool names or glob patterns (e.g., `["gmail/*", "calculator"]`) |
| `memory` | `MemoryConfig` | No | Context persistence strategy |
| `maxSteps` | `number` | No | Maximum tool execution loops (default: 5) |
| `middleware` | `AgentMiddleware[]` | No | Middleware for security, logging, etc. |
| `edge` | `EdgeConfig` | No | Settings for edge runtimes |

### MemoryConfig

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"conversation"` \| `"buffer"` \| `"summary"` | Context retention strategy |
| `maxTokens` | `number` | Maximum tokens to retain |
| `maxMessages` | `number` | Maximum messages to retain |

### EdgeConfig

| Property | Type | Description |
|----------|------|-------------|
| `enabled` | `boolean` | Enable edge optimizations |
| `maxSteps` | `number` | Step limit for edge timeouts |
| `timeoutMs` | `number` | Execution timeout in milliseconds |

## Methods

### generate(input, context?)

Generate a single response.

```typescript
const response = await myAgent.generate("What's the weather in London?");
console.log(response.text);
```

**Returns:** `Promise<AgentResponse>`

### stream(messages, context?)

Return a readable stream for real-time responses.

```typescript
const stream = await myAgent.stream(messages);
return new Response(stream);
```

**Returns:** `Promise<ReadableStream>`

### respond(request)

Handle an HTTP request directly. Useful for API routes.

```typescript
export async function POST(req: Request) {
  return await myAgent.respond(req);
}
```

**Returns:** `Promise<Response>`

## Examples

### Basic Agent

```typescript
import { agent } from "veryfront/ai";

export const assistant = agent({
  model: "anthropic/claude-3-5-sonnet",
  system: "You are a helpful assistant.",
});
```

### Agent with Integration Tools

```typescript
import { agent } from "veryfront/ai";

export const assistant = agent({
  model: "openai/gpt-4",
  system: "You help users manage email and calendar.",
  tools: ["gmail/*", "calendar/*"],
});
```

### Agent with Custom Tools

```typescript
import { agent } from "veryfront/ai";
import { calculator } from "@/ai/tools/calculator";

export const mathHelper = agent({
  model: "openai/gpt-4",
  system: "You solve math problems step by step.",
  tools: ["calculator"],
  memory: {
    type: "conversation",
    maxMessages: 20,
  },
});
```

### Production Agent

```typescript
import { agent } from "veryfront/ai";
import { rateLimit, securityMiddleware } from "veryfront/ai/middleware";

export const productionAgent = agent({
  model: "anthropic/claude-3-5-sonnet",
  system: "You are a customer support assistant.",
  tools: ["zendesk/*", "slack/*"],
  middleware: [
    rateLimit({ windowMs: 60000, max: 10 }),
    securityMiddleware({ sanitize: true }),
  ],
  edge: {
    enabled: true,
    maxSteps: 3,
    timeoutMs: 25000,
  },
});
```

### API Route Handler

```typescript
// app/api/chat/route.ts
import { assistant } from "@/ai/agents/assistant";

export async function POST(req: Request) {
  return await assistant.respond(req);
}
```

## Memory Strategies

### Conversation

Retains full message history up to a token limit:

```typescript
memory: {
  type: "conversation",
  maxTokens: 4000,
}
```

### Buffer

Retains a fixed number of recent messages:

```typescript
memory: {
  type: "buffer",
  maxMessages: 10,
}
```

### Summary

Summarizes older messages to retain context efficiently:

```typescript
memory: {
  type: "summary",
  maxMessages: 50,
}
```

## Middleware

Add middleware for cross-cutting concerns:

```typescript
import { agent } from "veryfront/ai";
import { logging, rateLimit, auth } from "veryfront/ai/middleware";

export const secureAgent = agent({
  model: "openai/gpt-4",
  middleware: [
    logging({ level: "info" }),
    rateLimit({ windowMs: 60000, max: 100 }),
    auth({ required: true }),
  ],
});
```

## Related Documentation

- [Tools Reference](./tools.md) - Define custom tools
- [Integrations](./integrations.md) - Pre-built service integrations
- [Hooks](./hooks.md) - React hooks for AI features
