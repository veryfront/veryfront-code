# Veryfront AI Features

The `src/ai` module provides native AI capabilities.

## Agents

Agents are the core building block. They are created using the `agent()` factory.

```typescript
const myAgent = agent({
  model: "openai/gpt-4o",
  system: "You answer questions about this project.",
  tools: { myTool },
});
```

## Tools

Tools are functions that the agent can call.
They must have a Zod schema for input validation.

```typescript
const myTool = tool({
  name: 'myTool',
  description: 'Does something',
  inputSchema: z.object({ ... }),
  execute: async (input) => { ... }
});
```

## Providers

OpenAI, Anthropic, and Google are auto-initialized from environment variables
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`).

For custom providers, use `registerModelProvider()`:

```typescript
import { registerModelProvider } from "veryfront/provider";
import { createOpenAI } from "@ai-sdk/openai";

registerModelProvider("ollama", (id) =>
  createOpenAI({ apiKey: "ollama", baseURL: "http://localhost:11434/v1" })(id)
);
```
