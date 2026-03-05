---
title: "Chat UI"
description: "Pre-built chat components and React hooks for AI interfaces."
order: 9
---

# Chat UI

Pre-built chat components and React hooks for AI interfaces. Three levels of control:

1. **Preset** — `<Chat>` renders a complete chat UI with one component
2. **Composition** — `<Chat.Root>`, `<Chat.MessageList>`, `<Chat.Composer>` for custom layouts
3. **Compound** — `<Message.Root>`, `<Message.Content>`, `<Message.Actions>` for per-message control

## Quick setup

The fastest path — one component, one hook, one API route:

```tsx
// app/page.tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat" });
  return (
    <Chat
      messages={chat.messages}
      input={chat.input}
      onChange={chat.handleInputChange}
      onSubmit={chat.handleSubmit}
      isLoading={chat.isLoading}
      stop={chat.stop}
      placeholder="Ask me anything..."
    />
  );
}
```

```ts
// app/api/chat/route.ts
import { createChatHandler } from "veryfront/agent";

export const POST = createChatHandler("assistant");
```

`createChatHandler` handles request validation, message transformation, and automatic browser fallback when no AI provider is available. The `Chat` component renders a full chat interface with input, message list, loading indicators, and scroll management.

When you need RAG/auth preprocessing, use `beforeStream` without re-implementing the route internals:

```ts
import { createChatHandler } from "veryfront/agent";

export const POST = createChatHandler("rag", {
  beforeStream: async ({ lastUserText }) => {
    const context = `Search results for: ${lastUserText}`;
    return {
      prepend: [
        {
          role: "system",
          parts: [{ type: "text", text: context }],
        },
      ],
    };
  },
});
```

## Custom layout (composition)

Use `Chat.Root` + building blocks to control the layout while keeping the wiring automatic:

```tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function CustomLayout() {
  const chat = useChat({ api: "/api/chat" });
  const isEmpty = chat.messages.length === 0;

  return (
    <Chat.Root
      messages={chat.messages}
      input={chat.input}
      setInput={chat.setInput}
      onSubmit={chat.handleSubmit}
      onStop={chat.stop}
      isLoading={chat.isLoading}
    >
      {/* Custom header */}
      <header className="border-b p-4">
        <h1>AI Assistant</h1>
      </header>

      {/* Message area */}
      {isEmpty ? (
        <Chat.Empty
          title="What can I help with?"
          suggestions={["Explain React hooks", "Write a regex"]}
          onSuggestionClick={(s) => chat.setInput(s)}
        />
      ) : (
        <Chat.MessageList
          messages={chat.messages}
          isLoading={chat.isLoading}
          showMessageActions
          showSources
        />
      )}

      {/* Input area */}
      <Chat.Composer
        input={chat.input}
        onChange={chat.handleInputChange}
        onSubmit={chat.handleSubmit}
        isLoading={chat.isLoading}
        stop={chat.stop}
      />
    </Chat.Root>
  );
}
```

Available composition components:

| Component | Description |
|-----------|-------------|
| `Chat.Root` | Context provider + container. Wraps all other pieces. |
| `Chat.MessageList` | Renders messages with auto-scroll, editing, branching. |
| `Chat.Composer` | Input area with attachments, model selector, voice, submit. |
| `Chat.Empty` | Empty state with icon, title, suggestions. |
| `Chat.If` | Conditional rendering helper that reads chat context. |
| `Chat.ErrorBanner` | Error display with retry button. |

## Per-message control (compound)

For full control over how individual messages render, use the `Message` compound:

```tsx
import { Message } from "veryfront/chat";

function CustomMessage({ msg }) {
  return (
    <Message.Root message={msg}>
      <Message.Avatar />
      <div className="flex-1">
        <Message.Content showSteps showSources />
        <div className="flex items-center gap-1 mt-1">
          <Message.Actions />
          <Message.Feedback />
        </div>
        <Message.BranchPicker />
      </div>
    </Message.Root>
  );
}
```

When `Message.Root` is nested inside `Chat.Root`, it automatically picks up callbacks (editMessage, getBranches, switchBranch, onFeedback) from context. You can also pass them as props to override.

| Sub-component | Description |
|---------------|-------------|
| `Message.Root` | Wraps a `UIMessage` and provides `MessageContext`. |
| `Message.Avatar` | Model avatar (Claude, OpenAI, or default). Hidden for user messages. |
| `Message.Content` | Renders text (markdown), reasoning, tool calls, steps, sources. |
| `Message.Actions` | Copy and edit buttons (appears on hover). |
| `Message.Feedback` | Thumbs up/down feedback buttons. |
| `Message.BranchPicker` | Branch navigation (prev/next variant). |

## useChat hook

For fully custom UIs, use the hook directly:

```tsx
"use client";
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
        {isLoading
          ? <button type="button" onClick={stop}>Stop</button>
          : <button type="submit">Send</button>}
      </form>
    </div>
  );
}
```

### useChat options

| Property          | Type                      | Description                                                            |
| ----------------- | ------------------------- | ---------------------------------------------------------------------- |
| `api`             | `string`                  | URL of the chat API route                                              |
| `initialMessages` | `UIMessage[]`             | Pre-populate the conversation                                          |
| `body`            | `Record<string, unknown>` | Extra data sent with each request                                      |
| `headers`         | `Record<string, string>`  | Custom request headers                                                 |
| `model`           | `string`                  | Override model at runtime                                              |
| `systemPrompt`    | `string`                  | System prompt for browser-side inference                               |
| `browserFallback` | `boolean`                 | Enable browser fallback when server can't provide AI (default: `true`) |
| `onFinish`        | `(message) => void`       | Called when the assistant finishes responding                          |
| `onError`         | `(error) => void`         | Called on stream errors                                                |
| `onToolCall`      | `(toolCall) => void`      | Called when the agent calls a tool                                     |

## Rendering tool calls

When an agent calls a tool, the message contains a tool part. Render it with `renderTool`:

```tsx
<Chat
  messages={chat.messages}
  input={chat.input}
  onChange={chat.handleInputChange}
  onSubmit={chat.handleSubmit}
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

| State                | Description                                 |
| -------------------- | ------------------------------------------- |
| `"input-streaming"`  | Model is generating the tool call arguments |
| `"input-available"`  | Arguments ready, tool executing             |
| `"output-streaming"` | Tool result streaming back                  |
| `"output-available"` | Tool call complete                          |
| `"output-error"`     | Tool execution failed                       |

## Features

### Attachments

```tsx
<Chat
  {...chat}
  onAttach={(files) => handleUpload(files)}
  attachAccept=".pdf,.docx,.txt"
  attachments={uploadedFiles}
  onRemoveAttachment={(id) => removeFile(id)}
/>
```

### Model selector

```tsx
<Chat
  {...chat}
  models={[
    { value: "anthropic/claude-sonnet-4-5-20250929", label: "Claude Sonnet" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
  ]}
  model={chat.model}
  onModelChange={chat.setModel}
/>
```

### Message editing & branching

```tsx
<Chat
  {...chat}
  editMessage={chat.editMessage}
  getBranches={chat.getBranches}
  switchBranch={chat.switchBranch}
/>
```

### Sidebar with threads

```tsx
import { ChatWithSidebar, useChat } from "veryfront/chat";

function App() {
  const chat = useChat({ api: "/api/chat" });
  return (
    <ChatWithSidebar
      {...chat}
      storageKey="my-app"
      setMessages={chat.setMessages}
    />
  );
}
```

### Tabs (Chat/Uploads)

```tsx
<Chat
  {...chat}
  showTabs
  uploads={docs}
  onRemoveUpload={(id) => removeDoc(id)}
/>
```

## useAgent hook

For direct agent invocation (without the chat protocol), use `useAgent`:

```tsx
"use client";
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
"use client";
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

## Inference mode

`useChat` automatically detects where inference is running and exposes `inferenceMode` for your UI to adapt. When no API key is configured, the framework falls back through cloud → server-local → browser inference automatically.

```tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat" });

  return (
    <Chat
      messages={chat.messages}
      input={chat.input}
      onChange={chat.handleInputChange}
      onSubmit={chat.handleSubmit}
      inferenceMode={chat.inferenceMode}
      browserStatus={chat.browserStatus}
    />
  );
}
```

| `inferenceMode`  | Description                                        |
| ---------------- | -------------------------------------------------- |
| `"cloud"`        | Using a cloud provider (OpenAI, Anthropic, Google) |
| `"server-local"` | Running SmolLM2 locally via ONNX Runtime           |
| `"browser"`      | Running SmolLM2 in a browser Web Worker            |

| `browserStatus`       | Description                                |
| --------------------- | ------------------------------------------ |
| `null`                | Not using browser fallback                 |
| `"idle"`              | Browser fallback detected, not yet started |
| `"loading-runtime"`   | Loading transformers.js from CDN           |
| `"downloading-model"` | Downloading model weights                  |
| `"ready"`             | Model loaded, ready to generate            |
| `"generating"`        | Actively generating a response             |
| `"error"`             | Browser inference failed                   |

To disable browser fallback:

```tsx
const chat = useChat({ api: "/api/chat", browserFallback: false });
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

## Contexts

The compound system uses React contexts for shared state. These are set up automatically by `Chat` and `Chat.Root`.

| Context | Hook | Description |
|---------|------|-------------|
| `ChatContext` | `useChatContext()` | Root state: messages, loading, input, model, etc. |
| `MessageContext` | `useMessageContext()` | Per-message state: parts, text, actions, feedback. |
| `ComposerContext` | `useComposerContext()` | Input area: value, attachments, submit, voice. |
| `ThreadListContext` | `useThreadListContext()` | Multi-conversation navigation. |

## Next

- [Workflows](./workflows.md) — orchestrate multi-step agent tasks
- [Multi-Agent](./multi-agent.md) — compose agents together

## Related

- [`veryfront/chat`](../reference/chat.md) — chat API reference
- [`veryfront/agent`](../reference/agent.md) — agent API reference
