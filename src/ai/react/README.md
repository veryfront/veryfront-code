# Veryfront AI React Module

**Status**: Phase 4 Complete (Headless Hooks)
**Module**: `veryfront/ai/react`
**Layer**: 1 (Headless - Complete logic control)

## Overview

This module provides **headless React hooks** for AI interactions with zero UI opinions. These hooks give you complete control over state, behavior, and rendering.

## Available Hooks

### useChat

Complete chat state management:

```typescript
import { useChat } from "veryfront/ai/react";

function MyChat() {
  const {
    messages, // Message history
    input, // Current input
    isLoading, // Loading state
    setInput, // Update input
    append, // Add message
    reload, // Retry last
    stop, // Stop generation
  } = useChat({
    api: "/api/chat",
  });

  return <YourCustomUI {...{ messages, input, setInput, append }} />;
}
```

### useAgent

Agent orchestration with tool visualization:

```typescript
import { useAgent } from "veryfront/ai/react";

function MyAgent() {
  const {
    messages,
    toolCalls, // Active tool invocations
    status, // Agent status
    thinking, // Reasoning text
    invoke, // Start agent
    stop, // Stop agent
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
    complete, // Trigger completion
    stop, // Stop generation
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
    data, // Streaming data
    isStreaming,
    start, // Start stream
    stop, // Stop stream
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
- **TypeScript first** - Full type safety
- **Streaming support** - Real-time responses
- **Error handling** - Built-in error states
- **Abort support** - Cancel requests anytime
- **Flexible** - Customize everything

## Installation

These hooks are included with Veryfront:

```bash
npm install veryfront
```

```typescript
import { useAgent, useChat } from "veryfront/ai/react";
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

- useChat - Complete chat state management
- useAgent - Agent orchestration
- useCompletion - Single completions
- useStreaming - Low-level streaming
- Full TypeScript support
- Streaming support
- Error handling
- Abort controllers

**Next**: Phase 5 (Unstyled Primitives) & Phase 6 (Styled Components)
