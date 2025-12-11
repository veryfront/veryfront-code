# Veryfront AI React Module

**Status**: Phase 4 Complete (Headless Hooks)
**Module**: `veryfront/ai/react`
**Layer**: 1 (Headless - Complete logic control)

## Overview

This module provides **headless React hooks** for AI interactions with zero UI opinions. These hooks give you complete control over state, behavior, and rendering.

**Uses AI SDK v5 UI Message format** with parts-based content structure.

## Available Hooks

### useChat

Complete chat state management with v5 UI Message format:

```typescript
import { useChat } from "veryfront/ai/react";
import type { UIMessage } from "veryfront/ai/react";

// Helper to extract text from v5 parts array
function getTextContent(message: UIMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function MyChat() {
  const {
    messages,        // UIMessage[] with parts array
    input,           // Current input
    isLoading,       // Loading state
    setInput,        // Update input
    sendMessage,     // Send message: sendMessage({ text: "..." })
    handleSubmit,    // Form submit handler
    reload,          // Retry last
    stop,            // Stop generation
  } = useChat({
    api: "/api/chat",
  });

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          <strong>{msg.role}:</strong> {getTextContent(msg)}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={isLoading}>
          Send
        </button>
      </form>
    </div>
  );
}
```

### UIMessage Format (AI SDK v5)

Messages use the v5 parts-based structure:

```typescript
interface UIMessage {
  id: string;
  role: "system" | "user" | "assistant";
  parts: UIMessagePart[];  // Content as parts array
}

type UIMessagePart =
  | { type: "text"; text: string; state?: "streaming" | "done" }
  | { type: "reasoning"; text: string; state?: "streaming" | "done" }
  | { type: `tool-${string}`; toolCallId: string; toolName: string; state: ToolState; input?: unknown }  // AI SDK v5 pattern
  | { type: "dynamic-tool"; toolCallId: string; toolName: string; state: ToolState; input?: unknown }  // For MCP/runtime tools
  | { type: "tool-result"; toolCallId: string; toolName: string; result: unknown };

type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error";
```

### useAgent

Agent orchestration with tool visualization:

```typescript
import { useAgent } from "veryfront/ai/react";

function MyAgent() {
  const {
    messages,
    toolCalls, // Active tool invocations
    status,    // Agent status
    thinking,  // Reasoning text
    invoke,    // Start agent
    stop,      // Stop agent
  } = useAgent({
    agent: "support",
    onToolCall: (tool) => console.log("Tool:", tool.name),
  });

  return <YourAgentUI {...{ messages, toolCalls, status }} />;
}
```

### useCompletion

Single text completion:

```typescript
import { useCompletion } from "veryfront/ai/react";

function MyCompletion() {
  const {
    completion, // Generated text
    isLoading,
    complete,   // Trigger completion
    stop,       // Stop generation
  } = useCompletion({
    api: "/api/complete",
  });

  return <YourCompletionUI {...{ completion, isLoading, complete }} />;
}
```

### useStreaming

Low-level streaming control:

```typescript
import { useStreaming } from "veryfront/ai/react";

function MyStreaming() {
  const {
    data,        // Streaming data
    isStreaming,
    start,       // Start stream
    stop,        // Stop stream
  } = useStreaming({
    url: "/api/stream",
    onChunk: (chunk) => console.log("Chunk:", chunk),
  });

  return <YourStreamingUI {...{ data, isStreaming, start }} />;
}
```

## Key Features

- **Zero UI opinions** - Build any interface
- **Complete control** - Full access to state and behavior
- **TypeScript first** - Full type safety with v5 types
- **Streaming support** - Real-time responses with v5 events
- **Error handling** - Built-in error states
- **Abort support** - Cancel requests anytime
- **Flexible** - Customize everything

## Installation

These hooks are included with Veryfront:

```bash
npm install veryfront
```

```typescript
import { useChat, useAgent } from "veryfront/ai/react";
import type { UIMessage, UIMessagePart, ToolState } from "veryfront/ai/react";
```

## Next: Layer 2 & 3

After using these headless hooks, you can:

- **Layer 2**: Use unstyled primitives (`veryfront/ai/primitives`)
- **Layer 3**: Use styled components (`veryfront/ai/components`)

Or build completely custom UIs with just these hooks!

## Examples

See `examples/ai-react-hooks/` for full examples (coming soon).

## Status

**Phase 4: Headless Hooks** **COMPLETE**

- useChat - Complete chat state management (v5 format)
- useAgent - Agent orchestration
- useCompletion - Single completions
- useStreaming - Low-level streaming
- Full TypeScript support with v5 types
- Streaming support with v5 events
- Error handling
- Abort controllers

**Next**: Phase 5 (Unstyled Primitives) & Phase 6 (Styled Components)
