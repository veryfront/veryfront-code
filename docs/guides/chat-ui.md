---
title: "Chat UI"
description: "Pre-built chat components and React hooks for AI interfaces."
order: 9
---

# Chat UI

Pre-built chat components and React hooks for AI interfaces.

## Quick setup

The fastest path — one component, one hook, one API route:

```tsx
// app/page.tsx
'use client'
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} placeholder="Ask me anything..." />;
}
```

```ts
// app/api/chat/route.ts
import { getAgent } from "veryfront/agent";

export async function POST(request: Request) {
  const { messages } = await request.json();
  const agent = getAgent("assistant");
  const result = await agent.stream({ messages });
  return result.toDataStreamResponse();
}
```

The `Chat` component renders a full chat interface with input, message list, loading indicators, and scroll management.

## useChat hook

For custom UIs, use the hook directly:

```tsx
'use client'
import { useChat } from "veryfront/chat";

export default function CustomChat() {
  const {
    messages,
    input,
    isLoading,
    error,
    handleInputChange,
    handleSubmit,
    reload,
    stop,
  } = useChat({ api: "/api/chat" });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id} className={msg.role}>
          {msg.parts.map((part, i) => {
            if (part.type === "text") return <p key={i}>{part.text}</p>;
            return null;
          })}
        </div>
      ))}

      {error && <p className="error">{error.message}</p>}

      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        {isLoading ? (
          <button type="button" onClick={stop}>Stop</button>
        ) : (
          <button type="submit">Send</button>
        )}
      </form>
    </div>
  );
}
```

### useChat options

| Property | Type | Description |
|----------|------|-------------|
| `api` | `string` | URL of the chat API route |
| `initialMessages` | `UIMessage[]` | Pre-populate the conversation |
| `body` | `Record<string, unknown>` | Extra data sent with each request |
| `headers` | `Record<string, string>` | Custom request headers |
| `onFinish` | `(message) => void` | Called when the assistant finishes responding |
| `onError` | `(error) => void` | Called on stream errors |
| `onToolCall` | `(toolCall) => void` | Called when the agent calls a tool |

## Rendering tool calls

When an agent calls a tool, the message contains a tool part. Render it with `renderTool`:

```tsx
<Chat
  {...chat}
  renderTool={(toolCall) => {
    if (toolCall.toolName === "getWeather") {
      return (
        <WeatherCard
          city={toolCall.input?.city}
          data={toolCall.output}
          loading={toolCall.state === "output-streaming"}
        />
      );
    }
    return null;
  }}
/>
```

Tool parts have a `state` property:

| State | Description |
|-------|-------------|
| `"input-streaming"` | Model is generating the tool call arguments |
| `"input-available"` | Arguments ready, tool executing |
| `"output-streaming"` | Tool result streaming back |
| `"output-available"` | Tool call complete |
| `"output-error"` | Tool execution failed |

## useAgent hook

For direct agent invocation (without the chat protocol), use `useAgent`:

```tsx
'use client'
import { useAgent } from "veryfront/chat";

export default function AgentPanel() {
  const { messages, invoke, isLoading, status, toolCalls } = useAgent({
    agent: "assistant",
    onToolCall: (tc) => console.log("Tool called:", tc),
  });

  return (
    <div>
      <button onClick={() => invoke("Analyze this data")} disabled={isLoading}>
        Analyze
      </button>
      <p>Status: {status}</p>
      {messages.map((m, i) => <p key={i}>{m.content}</p>)}
    </div>
  );
}
```

## useCompletion hook

For simple text completion without conversation context:

```tsx
'use client'
import { useCompletion } from "veryfront/chat";

export default function Autocomplete() {
  const { completion, complete, isLoading } = useCompletion({
    api: "/api/complete",
  });

  return (
    <div>
      <button onClick={() => complete("Write a tagline for a coffee shop")}>
        Generate
      </button>
      {completion && <p>{completion}</p>}
    </div>
  );
}
```

## Theming

Customize the `Chat` component with a theme object:

```tsx
<Chat
  {...chat}
  theme={{
    container: "bg-gray-50 rounded-lg",
    input: "border-gray-300 focus:border-blue-500",
    message: "py-3 px-4",
    button: "bg-blue-600 text-white rounded",
    loading: "text-gray-400 animate-pulse",
  }}
/>
```

## Next

- [Workflows](./workflows.md) — orchestrate multi-step agent tasks
- [Multi-Agent](./multi-agent.md) — compose agents together

## Related

- [`veryfront/chat`](../reference/chat.md) — chat API reference
- [`veryfront/agent`](../reference/agent.md) — agent API reference
