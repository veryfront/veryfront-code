# Veryfront AI Styled Components

**Status**: Phase 6 Complete (Styled Components)
**Module**: `veryfront/ai/components`
**Layer**: 3 (Styled - Production-ready)

## Overview

Production-ready, fully styled components built on Layer 2 primitives. Get started in seconds with sensible defaults.

**Uses AI SDK v5 UI Message format** with parts-based content structure.

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
import { Chat } from "veryfront/ai/components";
import { useChat } from "veryfront/ai/react";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat" });

  return (
    <Chat
      {...chat}
      placeholder="Ask anything..."
      maxHeight="80vh"
    />
  );
}
```

The `Chat` component handles v5 UIMessage format internally, extracting text from the `parts` array automatically.

**Customization via theme:**

```tsx
<Chat
  {...chat}
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
import type { UIMessage } from "veryfront/ai/react";

// Helper to extract text from v5 parts array
function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

<Chat
  {...chat}
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
import { ChatComponents as Chat } from "veryfront/ai/components";

<Chat>
  <Chat.Header>
    <h1>Customer Support</h1>
    <StatusBadge />
  </Chat.Header>

  <Chat.Messages>
    {messages.map((msg) => <CustomMessage key={msg.id} {...msg} />)}
  </Chat.Messages>

  <Chat.Input
    placeholder="How can we help?"
    multiline={true}
  />

  <Chat.Footer>
    Powered by Veryfront AI
  </Chat.Footer>
</Chat>;
```

### AgentCard

Agent status and tool visualization.

```tsx
import { AgentCard } from "veryfront/ai/components";
import { useAgent } from "veryfront/ai/react";

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

Standalone message component for v5 UIMessage format.

```tsx
import { Message } from "veryfront/ai/components";

<Message
  message={msg} // UIMessage with parts array
  showRole={true}
  showTimestamp={true}
  theme={{
    message: {
      user: "bg-blue-500 text-white",
      assistant: "bg-gray-200",
    },
  }}
/>;
```

### StreamingMessage

Display streaming text with cursor.

```tsx
import { StreamingMessage } from "veryfront/ai/components";

{
  streamingText && (
    <StreamingMessage
      content={streamingText}
      showCursor={true}
    />
  );
}
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

All components support dark mode out of the box using Tailwind's `dark:` variants:

```tsx
<Chat {...chat} />;
// Automatically adapts to dark mode
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
<Chat {...chat} />;
```

### Level 2: Theme Customization

```tsx
<Chat
  {...chat}
  theme={{
    message: { user: "bg-purple-600 text-white" },
  }}
/>;
```

### Level 3: Render Props

```tsx
<Chat
  {...chat}
  renderMessage={CustomMessage}
/>;
```

### Level 4: Composition API

```tsx
<Chat>
  <Chat.Header>Custom Header</Chat.Header>
  <Chat.Messages />
  <Chat.Input />
</Chat>;
```

### Level 5: Drop to Layer 2 or 1

If you need more control, use primitives (Layer 2) or hooks only (Layer 1).

## Examples

### Quick Start (5 lines)

```tsx
import { Chat } from "veryfront/ai/components";
import { useChat } from "veryfront/ai/react";

export default function App() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

### Custom Styling

```tsx
<Chat
  {...chat}
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
  multiline={true}
/>;
```

### Integration with Agent

```tsx
import { AgentCard, Chat } from "veryfront/ai/components";
import { useAgent } from "veryfront/ai/react";

export default function AgentChat() {
  const agent = useAgent({ agent: "support" });

  return (
    <div className="grid grid-cols-2 gap-4">
      <Chat messages={agent.messages} />
      <AgentCard {...agent} />
    </div>
  );
}
```

### Working with v5 Message Parts

```tsx
import { Chat } from "veryfront/ai/components";
import { useChat } from "veryfront/ai/react";
import type { UIMessage, UIMessagePart } from "veryfront/ai/react";

// Custom renderer that handles all part types
function CustomMessage({ message }: { message: UIMessage }) {
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
  const chat = useChat({ api: "/api/chat" });

  return (
    <Chat
      {...chat}
      renderMessage={(msg) => <CustomMessage message={msg} />}
    />
  );
}
```

## Status

**Phase 6: Styled Components** **COMPLETE**

**Created:**

- Chat component with theme system (v5 UIMessage support)
- AgentCard component
- Message component
- StreamingMessage component
- Theme system with defaults
- Composition API
- Dark mode support
- Full customization options

**Total: 4 styled components** + theme system

**Next**: Phase 7 (Developer Experience)

## Migration Path

### From v4 to v5 Message Format

```tsx
// Before (v4 - deprecated)
{
  messages.map((msg) => <div key={msg.id}>{msg.content}</div>);
}

// After (v5)
import type { UIMessage } from "veryfront/ai/react";

function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

{
  messages.map((msg) => <div key={msg.id}>{getTextContent(msg)}</div>);
}

// Or just use the Chat component which handles this automatically
<Chat {...chat} />;
```

### From Custom UI → Styled Components

```tsx
// Before (custom UI)
<div className="chat-container">
  {messages.map((msg) => (
    <div key={msg.id} className="message">
      {getTextContent(msg)}
    </div>
  ))}
</div>

// After (5 seconds)
<Chat {...chat} />
```

### From Styled → Primitives (more control)

```tsx
// Styled component
<Chat {...chat} />

// Primitives (more control)
<ChatContainer>
  <MessageList>
    {messages.map((msg) => (
      <MessageItem key={msg.id} className="your-styles">
        {getTextContent(msg)}
      </MessageItem>
    ))}
  </MessageList>
</ChatContainer>
```

### From Primitives → Hooks (total control)

```tsx
// Primitives
<ChatContainer>
  <MessageList />
</ChatContainer>;

// Hooks only (v5 API)
const { messages, input, sendMessage, handleSubmit } = useChat({ api: "/api/chat" });
return <YourCompletelyCustomUI />;
```

Perfect progressive enhancement!
