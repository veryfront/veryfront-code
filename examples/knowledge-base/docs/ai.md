# Veryfront AI Features

The `src/ai` module provides native AI capabilities.

## Agents

Agents are the core building block. They are created using the `agent()` factory.

```typescript
const myAgent = agent({
  model: "openai/gpt-4o",
  system: "You are helpful.",
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

We support OpenAI and Anthropic out of the box.
Providers handle the API communication and streaming.
