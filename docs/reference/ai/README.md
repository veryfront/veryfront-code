# AI Reference

Build AI-powered applications with agents, tools, and service integrations.

## Modules

| Module | Description |
|--------|-------------|
| [Agent](./agent.md) | Configure agents with `agent()`, memory, and runtime options |
| [Tools](./tools.md) | Define tools with `tool()` and Zod schemas |
| [Hooks](./hooks.md) | React hooks: `useChat`, `useAgent` |
| [Integrations](./integrations.md) | 50+ service integrations with 235 AI tools |

## Quick Example

```typescript
import { agent } from "veryfront/ai";

const assistant = agent({
  model: "openai/gpt-4",
  system: "You are a helpful assistant.",
  tools: ["gmail/*", "calendar/*"],
});

const response = await assistant.generate("What meetings do I have today?");
```

## Coming Soon

- **Middleware** - Rate limiting, caching, and security
- **MCP Server** - Model Context Protocol configuration
