---
title: "AI Hooks API Reference"
category: "reference"
level: "intermediate"
keywords: ["hooks", "useChat", "useAgent", "useCompletion", "react"]
ai_summary: "API reference for React hooks (useChat, useAgent) to build AI interfaces."
related: ["reference/ai/agent", "reference/components/README"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# AI Hooks API Reference

Headless React hooks for building custom AI interfaces (Layer 1).

## Import

```typescript
import { useChat, useAgent, useCompletion } from 'veryfront/ai/react';
```

## `useChat`

Manages state for a chat interface.

### Signature

```typescript
const chat = useChat(options?: ChatOptions);
```

### Options

| Property | Type | Description |
|----------|------|-------------|
| `api` | `string` | Endpoint URL (default: `'/api/chat'`). |
| `id` | `string` | Unique chat ID for persistence. |
| `initialMessages` | `Message[]` | Initial history. |
| `onFinish` | `(msg: Message) => void` | Callback when a response is complete. |
| `onError` | `(err: Error) => void` | Callback on failure. |

### Returns

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `Message[]` | Current list of messages. |
| `input` | `string` | Current value of the input field. |
| `handleInputChange` | `(e) => void` | Handler for input change events. |
| `handleSubmit` | `(e) => void` | Handler for form submission. |
| `append` | `(msg) => Promise` | Manually append a message. |
| `isLoading` | `boolean` | True if currently generating a response. |
| `stop` | `() => void` | Abort the current generation. |
| `reload` | `() => void` | Reload the last message. |

### Example

```tsx
export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {messages.map(m => <div key={m.id}>{m.content}</div>)}
      
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button>Send</button>
      </form>
    </div>
  );
}
```

---

## `useAgent`

Similar to `useChat`, but optimized for single-turn agent interactions or background tasks.

### Signature

```typescript
const { result, isLoading, execute } = useAgent(agentId: string);
```

### Example

```tsx
export default function Calculator() {
  const { result, isLoading, execute } = useAgent('math-agent');

  return (
    <button onClick={() => execute('Solve 2+2')}>
      {isLoading ? 'Calculating...' : result}
    </button>
  );
}
```
