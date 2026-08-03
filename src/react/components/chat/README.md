# Veryfront Chat Styled Components

**Status**: Phase 6 Complete (Styled Components)
**Module**: `veryfront/react`
**Layer**: 3 (Styled - Production-ready)

## Overview

Production-ready, fully styled components built on Layer 2 primitives. Get started in seconds with sensible defaults.

**Uses Veryfront's parts-based UI message format** for chat content.

## Philosophy

- **Production-ready** - Fully styled with Tailwind CSS
- **Customizable** - Theme system and render props
- **Dark mode** - Built-in dark mode support
- **Accessible** - ARIA attributes from primitives
- **Composable** - Composition API for advanced use

## Available Components

### Chat

Complete chat interface with messages, input, and loading states.

```tsx
import { Chat } from "veryfront/react";
import { useChat } from "veryfront/agent/react";

export default function ChatPage() {
  const chat = useChat();

  return (
    <Chat
      chat={chat}
      placeholder="Ask anything..."
      maxHeight="80vh"
    />
  );
}
```

The `Chat` component handles the parts-based UI message format internally, extracting text from the `parts` array automatically.

**Customization via theme:**

```tsx
<Chat
  chat={chat}
  theme={{
    container: "bg-gradient-to-b from-gray-50 to-white",
    message: {
      user: "bg-indigo-600 text-white rounded-2xl",
      assistant: "bg-gray-100 text-gray-900 rounded-2xl",
    },
    input: "border-2 border-indigo-500",
    button: "bg-indigo-600 hover:bg-indigo-700",
  }}
/>;
```

**Customization via render props:**

```tsx
import type { ChatMessage } from "veryfront/agent/react";

// Helper to extract text from the parts array
function getTextContent(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

<Chat
  chat={chat}
  renderMessage={(msg) => (
    <CustomMessage
      id={msg.id}
      role={msg.role}
      content={getTextContent(msg)}
      parts={msg.parts}
    />
  )}
/>;
```

**Composition API:**

```tsx
import { Chat } from "veryfront/react";

<Chat.Root
  messages={messages}
  input={input}
  setInput={setInput}
  onSubmit={onSubmit}
>
  <header>
    <h1>Customer Support</h1>
    <Status />
  </header>

  <Chat.MessageList messages={messages} />

  <Chat.Input.Root
    input={input}
    onChange={onChange}
    onSubmit={onSubmit}
  >
    <Chat.Input.Field placeholder="How can we help?" />
    <Chat.Input.Toolbar>
      <Chat.Input.Export messages={messages} />
      <Chat.Input.Send />
    </Chat.Input.Toolbar>
  </Chat.Input.Root>

  <footer>Powered by Veryfront</footer>
</Chat.Root>;
```

### AgentCard

Agent status and tool visualization.

```tsx
import { AgentCard } from "veryfront/react";
import { useAgent } from "veryfront/agent/react";

export default function AgentInterface() {
  const agent = useAgent({ agent: "support" });

  return (
    <AgentCard
      {...agent}
      theme={{
        thinking: "bg-amber-50 border-amber-500",
        tool: "bg-blue-50 border-blue-500",
      }}
    />
  );
}
```

### Message

Message component for the parts-based `ChatMessage` format. Use the default
anatomy or include only the compound parts your layout needs.

```tsx
import { Message } from "veryfront/react";

<Message.Root message={msg}>
  <Message.Header />
  <Message.Content />
  <Message.Sources />
  <Message.Actions />
</Message.Root>;
```

### Streaming

Pass `isStreaming` to `<Message>` to surface the "Continuing..." shimmer while
the turn is still generating.

```tsx
import { Message } from "veryfront/react";

<Message message={message} isStreaming />;
```

## Theme System

All components support theme customization:

### Chat Theme

```typescript
interface ChatTheme {
  container?: string;
  message?: {
    user?: string;
    assistant?: string;
    system?: string;
    tool?: string;
  };
  input?: string;
  button?: string;
  loading?: string;
}
```

### Agent Theme

```typescript
interface AgentTheme {
  container?: string;
  status?: string;
  thinking?: string;
  tool?: string;
  toolResult?: string;
}
```

## Dark Mode

All components support dark mode automatically via CSS custom properties. Dark mode activates through `prefers-color-scheme: dark`, a `.dark` class, or `[data-theme="dark"]` on a parent element. No `dark:` Tailwind variants are needed. The token system handles it:

```tsx
<Chat chat={chat} />;
// Automatically adapts to dark mode via CSS variables
```

## Accessibility

All components inherit accessibility from Layer 2 primitives:

- Semantic HTML
- ARIA attributes
- Keyboard navigation
- Screen reader support

## Customization Levels

### Level 1: Just Use It

```tsx
<Chat chat={chat} />;
```

### Level 2: Theme Customization

```tsx
<Chat
  chat={chat}
  theme={{
    message: { user: "bg-purple-600 text-white" },
  }}
/>;
```

### Level 3: Render Props

```tsx
<Chat
  chat={chat}
  renderMessage={CustomMessage}
/>;
```

### Level 4: Composition API

```tsx
<Chat.Root
  messages={chat.messages}
  input={chat.input}
  setInput={chat.setInput}
  onSubmit={chat.handleSubmit}
>
  <header>Custom Header</header>
  <Chat.MessageList messages={chat.messages} />
  <Chat.Input.Root
    input={chat.input}
    onChange={chat.handleInputChange}
    onSubmit={chat.handleSubmit}
  >
    <Chat.Input.Field />
    <Chat.Input.Toolbar>
      <Chat.Input.Export messages={chat.messages} />
      <Chat.Input.Send />
    </Chat.Input.Toolbar>
  </Chat.Input.Root>
</Chat.Root>;
```

### Level 5: Drop to Layer 2 or 1

If you need more control, use primitives (Layer 2) or hooks only (Layer 1).

## Examples

### Quick Start (5 lines)

```tsx
import { Chat } from "veryfront/react";
import { useChat } from "veryfront/agent/react";

export default function App() {
  const chat = useChat();
  return <Chat chat={chat} />;
}
```

### Custom Styling

```tsx
<Chat
  chat={chat}
  className="rounded-xl shadow-lg"
  theme={{
    message: {
      user: "bg-gradient-to-r from-blue-600 to-purple-600 text-white",
      assistant: "bg-gradient-to-r from-gray-100 to-gray-200",
    },
    input: "border-2 border-purple-500 focus:ring-purple-500",
    button: "bg-purple-600 hover:bg-purple-700",
  }}
  placeholder="Ask me anything..."
/>;
```

### Integration with Agent

```tsx
import { AgentCard, Chat } from "veryfront/react";
import { useAgent } from "veryfront/agent/react";

export default function AgentChat() {
  const agent = useAgent({ agent: "support" });

  return (
    <div className="grid grid-cols-2 gap-4">
      <Chat.Root messages={agent.messages} input="">
        <Chat.MessageList messages={agent.messages} />
      </Chat.Root>
      <AgentCard {...agent} />
    </div>
  );
}
```

### Working with Chat Message Parts

The built-in message renderer keeps raw message parts available, but assistant answer rendering prefers the final text emitted after tool activity. This prevents pre-tool progress narration from becoming part of the final visible answer while preserving tool calls and results for evidence, sources, and custom UI. Custom renderers should apply the same split when they present a final assistant answer.

```tsx
import { Chat } from "veryfront/react";
import { useChat } from "veryfront/agent/react";
import type { ChatMessage } from "veryfront/agent/react";

// Custom renderer that handles all part types
function CustomMessage({ message }: { message: ChatMessage }) {
  return (
    <div>
      {message.parts.map((part, i) => {
        switch (part.type) {
          case "text":
            return <p key={i}>{part.text}</p>;
          case "reasoning":
            return <blockquote key={i}>{part.text}</blockquote>;
          case "tool-call":
            return <div key={i}>Tool: {part.toolName} ({part.state})</div>;
          case "tool-result":
            return <div key={i}>Result: {JSON.stringify(part.result)}</div>;
        }
      })}
    </div>
  );
}

export default function AdvancedChat() {
  const chat = useChat();

  return (
    <Chat
      chat={chat}
      renderMessage={(msg) => <CustomMessage message={msg} />}
    />
  );
}
```

## Status

**Phase 6: Styled Components** **COMPLETE**

**Created:**

- Chat component with theme system (parts-based ChatMessage support)
- AgentCard component
- Message component
- Message streaming state
- Theme system with defaults
- Composition API
- Dark mode support
- Full customization options

**Total: 4 styled components** + theme system

**Next**: Phase 7 (Developer Experience)
