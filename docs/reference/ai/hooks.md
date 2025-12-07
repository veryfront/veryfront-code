---
title: "Hooks Reference"
category: "reference"
level: "intermediate"
keywords: ["hooks", "useChat", "useAgent", "useCompletion", "react"]
ai_summary: "API reference for React hooks (useChat, useAgent) to build AI interfaces."
related: ["reference/ai/agent", "reference/ai/tools", "reference/ai/integrations"]
version: "0.1.0"
last_updated: "2025-12-07"
---

# Hooks Reference

React hooks for building AI-powered interfaces.

## Import

```typescript
import { useChat, useAgent, useCompletion } from "veryfront/ai/react";
```

## useChat

Manage state for a multi-turn chat interface.

### Syntax

```typescript
const chat = useChat(options?: ChatOptions);
```

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `api` | `string` | `"/api/chat"` | Chat endpoint URL |
| `id` | `string` | — | Unique chat ID for persistence |
| `initialMessages` | `Message[]` | `[]` | Initial message history |
| `onFinish` | `(msg: Message) => void` | — | Called when response completes |
| `onError` | `(err: Error) => void` | — | Called on error |

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `Message[]` | Current message list |
| `input` | `string` | Current input value |
| `handleInputChange` | `(e: ChangeEvent) => void` | Input change handler |
| `handleSubmit` | `(e: FormEvent) => void` | Form submit handler |
| `append` | `(msg: Message) => Promise<void>` | Add a message programmatically |
| `isLoading` | `boolean` | True while generating |
| `stop` | `() => void` | Cancel current generation |
| `reload` | `() => void` | Regenerate last response |
| `setMessages` | `(msgs: Message[]) => void` | Replace message history |

### Example

```tsx
"use client";

import { useChat } from "veryfront/ai/react";

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

  return (
    <div>
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={m.role}>
            {m.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Sending..." : "Send"}
        </button>
      </form>
    </div>
  );
}
```

### With Custom Endpoint

```tsx
const { messages, handleSubmit } = useChat({
  api: "/api/assistant",
  onFinish: (message) => {
    console.log("Response:", message.content);
  },
  onError: (error) => {
    console.error("Chat error:", error);
  },
});
```

### With Initial Messages

```tsx
const { messages } = useChat({
  initialMessages: [
    { id: "1", role: "assistant", content: "Hello! How can I help you?" },
  ],
});
```

## useAgent

Execute single-turn agent tasks or background operations.

### Syntax

```typescript
const agent = useAgent(agentId: string, options?: AgentOptions);
```

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `api` | `string` | `"/api/agent"` | Agent endpoint URL |
| `onFinish` | `(result: any) => void` | — | Called when execution completes |
| `onError` | `(err: Error) => void` | — | Called on error |

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `result` | `any` | Execution result |
| `isLoading` | `boolean` | True while executing |
| `error` | `Error \| null` | Error if execution failed |
| `execute` | `(input: string) => Promise<any>` | Run the agent |
| `reset` | `() => void` | Clear result and error |

### Example

```tsx
"use client";

import { useAgent } from "veryfront/ai/react";

export default function Calculator() {
  const { result, isLoading, execute, error } = useAgent("math-agent");

  const handleCalculate = async () => {
    await execute("What is 15% of 250?");
  };

  return (
    <div>
      <button onClick={handleCalculate} disabled={isLoading}>
        {isLoading ? "Calculating..." : "Calculate"}
      </button>

      {error && <p className="error">{error.message}</p>}
      {result && <p className="result">{result}</p>}
    </div>
  );
}
```

### Trigger on Form Submit

```tsx
export default function EmailSummarizer() {
  const { result, isLoading, execute } = useAgent("email-agent");
  const [query, setQuery] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await execute(query);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="What would you like to know about your emails?"
      />
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Processing..." : "Ask"}
      </button>
      {result && <div className="result">{result}</div>}
    </form>
  );
}
```

## useCompletion

Generate text completions (non-chat).

### Syntax

```typescript
const completion = useCompletion(options?: CompletionOptions);
```

### Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `api` | `string` | `"/api/completion"` | Completion endpoint URL |
| `onFinish` | `(text: string) => void` | — | Called when generation completes |
| `onError` | `(err: Error) => void` | — | Called on error |

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `completion` | `string` | Generated text |
| `input` | `string` | Current prompt |
| `handleInputChange` | `(e: ChangeEvent) => void` | Input change handler |
| `handleSubmit` | `(e: FormEvent) => void` | Form submit handler |
| `isLoading` | `boolean` | True while generating |
| `stop` | `() => void` | Cancel generation |
| `complete` | `(prompt: string) => Promise<string>` | Generate programmatically |

### Example

```tsx
"use client";

import { useCompletion } from "veryfront/ai/react";

export default function TextGenerator() {
  const { completion, input, handleInputChange, handleSubmit, isLoading } =
    useCompletion();

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={handleInputChange}
          placeholder="Enter a prompt..."
          rows={4}
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Generating..." : "Generate"}
        </button>
      </form>

      {completion && (
        <div className="output">
          <h3>Generated Text</h3>
          <p>{completion}</p>
        </div>
      )}
    </div>
  );
}
```

## Message Type

The `Message` type used by `useChat`:

```typescript
interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: Date;
}
```

## Backend Integration

### Chat Endpoint

```typescript
// app/api/chat/route.ts
import { assistant } from "@/ai/agents/assistant";

export async function POST(req: Request) {
  return await assistant.respond(req);
}
```

### Agent Endpoint

```typescript
// app/api/agent/route.ts
import { agent } from "@/ai/agents/task-agent";

export async function POST(req: Request) {
  const { input } = await req.json();
  const result = await agent.generate(input);
  return Response.json({ result: result.text });
}
```

## Related Documentation

- [Agent Reference](./agent.md) - Configure AI agents
- [Tools Reference](./tools.md) - Define custom tools
- [Integrations](./integrations.md) - Pre-built service integrations
