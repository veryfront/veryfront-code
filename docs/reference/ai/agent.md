---
title: "Agent API Reference"
category: "reference"
level: "advanced"
keywords: ["agent", "ai", "configuration", "runtime", "memory"]
ai_summary: "Complete API reference for creating and configuring AI agents in Veryfront."
related: ["guides/ai/getting-started"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Agent API Reference

The `agent()` function is the core primitive for defining AI behaviors. It wraps an LLM with tools, memory, and middleware to create an autonomous or semi-autonomous entity.

## Import

```typescript
import { agent } from 'veryfront/ai';
```

## Signature

```typescript
function agent(config: AgentConfig): AgentRuntime
```

## Configuration Object (`AgentConfig`)

| Property | Type | Required | Description |
|----------|------|:--------:|-------------|
| `model` | `string` | ✅ | The model ID (e.g., `'openai/gpt-4o'`, `'anthropic/claude-3.5-sonnet'`). |
| `system` | `string` \| `() => string` | ❌ | System prompt instructions. Can be a static string or a function returning a string. |
| `tools` | `Record<string, Tool>` | ❌ | Tools available to this agent. Can include auto-discovered tools referenced by name. |
| `memory` | `MemoryConfig` | ❌ | Persistence strategy. Defaults to ephemeral (no memory). |
| `maxSteps` | `number` | ❌ | Maximum number of tool execution loops (default: 5). |
| `middleware` | `AgentMiddleware[]` | ❌ | Array of middleware functions for security, observability, etc. |
| `edge` | `EdgeConfig` | ❌ | Optimization settings for edge runtimes (Cloudflare Workers). |

### `MemoryConfig`

| Property | Type | Description |
|----------|------|-------------|
| `type` | `'conversation'` \| `'buffer'` \| `'summary'` | Strategy for retaining context. |
| `maxTokens` | `number` | Maximum tokens to keep in history (for 'conversation'). |
| `maxMessages` | `number` | Maximum number of messages to keep (for 'buffer'). |

### `EdgeConfig`

| Property | Type | Description |
|----------|------|-------------|
| `enabled` | `boolean` | Enable edge optimizations. |
| `maxSteps` | `number` | Hard limit on steps to prevent timeout on edge platforms. |
| `timeoutMs` | `number` | Execution timeout in milliseconds. |

## Methods (`AgentRuntime`)

The object returned by `agent()` exposes methods to interact with the agent.

### `.generate(input, context?)`

Generates a single response (non-streaming).

```typescript
const response = await myAgent.generate("Hello world");
console.log(response.text);
```

**Returns:** `Promise<AgentResponse>`

### `.stream(messages, context?)`

Returns a readable stream for real-time responses.

```typescript
const stream = await myAgent.stream(messages);
return new Response(stream); // Compatible with AI SDK
```

**Returns:** `Promise<ReadableStream>`

### `.respond(request)`

Helper to handle a standard HTTP Request (useful for API routes).

```typescript
export async function POST(req: Request) {
  return await myAgent.respond(req);
}
```

**Returns:** `Promise<Response>`

## Examples

### Basic Agent
```typescript
export default agent({
  model: 'anthropic/claude-3-opus',
  system: 'You are a coding assistant.',
});
```

### Stateful Agent with Tools
```typescript
import { calculator } from '../tools/calculator';

export default agent({
  model: 'openai/gpt-4-turbo',
  system: 'You help with math problems.',
  tools: {
    calc: calculator,
  },
  memory: {
    type: 'summary',
    maxMessages: 20
  }
});
```

### Production-Grade Agent
```typescript
import { rateLimit, securityMiddleware } from 'veryfront/ai/production';

export default agent({
  model: 'google/gemini-pro',
  middleware: [
    rateLimit({ windowMs: 60000, max: 10 }),
    securityMiddleware({ sanitize: true })
  ],
  edge: {
    enabled: true,
    maxSteps: 3
  }
});
```
