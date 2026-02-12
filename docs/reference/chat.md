---
title: "veryfront/chat"
description: "Chat UI components and streaming hooks."
order: 6
---

# veryfront/chat

Chat UI components and streaming hooks.

## Import

```ts
import {
  Chat,
  useChat,
  useAgent,
  AgentCard,
  Message,
  AIErrorBoundary,
} from "veryfront/chat";
```

## Examples

### Basic chat

```tsx
import { Chat, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} />;
}
```

### Custom layout

```tsx
import { ChatMessages, ChatInput, useChat } from "veryfront/chat";

export default function Page() {
  const chat = useChat({ api: "/api/chat" });
  return (
    <div>
      <ChatMessages messages={chat.messages} />
      <ChatInput value={chat.input} onChange={chat.setInput} onSubmit={chat.submit} />
    </div>
  );
}
```

### Agent card with tool calls

```tsx
import { AgentCard, useAgent } from "veryfront/chat";

function AgentUI() {
  const agent = useAgent({ agent: "assistant" });
  return (
    <AgentCard
      status={agent.status}
      messages={agent.messages}
      toolCalls={agent.toolCalls}
    />
  );
}
```

## Type Reference

### `UseChatOptions`

`useChat` options

| Property | Type | Description |
|----------|------|-------------|
| `api` | `string` | Chat API endpoint URL |
| `initialMessages?` | `UIMessage[]` | Pre-populated messages |
| `body?` | `Record<string, unknown>` | Extra body fields sent with each request |
| `headers?` | `Record<string, string>` | Custom request headers |
| `credentials?` | `RequestCredentials` | Fetch credentials mode |
| `onResponse?` | `(response: Response) => void` | Raw response callback |
| `onFinish?` | `(message: UIMessage) => void` | Completion callback |
| `onError?` | `(error: Error) => void` | Error callback |
| `onToolCall?` | `(arg: OnToolCallArg) => void \\| Promise<void>` | Tool call handler for client-side execution |

### `UseChatResult`

`useChat` result

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `UIMessage[]` | All messages in the conversation |
| `input` | `string` | Current input value |
| `isLoading` | `boolean` | Whether a request is in flight |
| `error` | `Error \\| null` | Last error (if any) |
| `setInput` | `(input: string) => void` | Set input value |
| `sendMessage` | `(message: { text: string }) => Promise<void>` | Send a message programmatically |
| `reload` | `() => Promise<void>` | Re-send last user message |
| `stop` | `() => void` | Abort current request |
| `setMessages` | `(messages: UIMessage[]) => void` | Replace message history |
| `addToolOutput` | `(output: ToolOutput) => void` | Submit client-side tool result |
| `data?` | `unknown` | Extra data from server response |
| `handleInputChange` | `(e: React.ChangeEvent<HTMLInputElement \\| HTMLTextAreaElement>) => void` | Bind to input onChange |
| `handleSubmit` | `(e: React.FormEvent) => Promise<void>` | Submit current input |

### `UseAgentOptions`

`useAgent` options

| Property | Type | Description |
|----------|------|-------------|
| `agent` | `string` | Agent ID or endpoint |
| `onToolCall?` | `(toolCall: ToolCall) => void` | Callback when tool is called |
| `onToolResult?` | `(toolCall: ToolCall, result: unknown) => void` | Callback when tool result received |
| `onError?` | `(error: Error) => void` | Callback when error occurs |

### `UseAgentResult`

`useAgent` result

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `Message[]` | Message history |
| `toolCalls` | `ToolCall[]` | Active tool calls |
| `status` | `AgentStatus` | Agent status |
| `thinking?` | `string` | Thinking/reasoning text |
| `invoke` | `(input: string) => Promise<void>` | Invoke the agent |
| `stop` | `() => void` | Stop agent execution |
| `isLoading` | `boolean` | Loading state |
| `error` | `Error \\| null` | Error state |

## Exports

### Components

| Name | Description |
|------|-------------|
| `AgentCard` | Agent status, tool calls, and messages |
| `Chat` | Full chat UI (messages + input) |
| `ChatComponents` | Compound components for custom layouts |
| `ChatFooter` | Chat footer section |
| `ChatHeader` | Chat header section |
| `ChatInput` | Text input with send button |
| `ChatMessages` | Scrollable message list |
| `Message` | Chat message bubble |
| `StreamingMessage` | Incrementally rendered message |

### Functions

| Name | Description |
|------|-------------|
| `useAgent` | Agent interactions with tool call tracking |
| `useAIErrorHandler` | Programmatic AI error handler |
| `useChat` | useChat hook for managing chat state - AI SDK v5 compatible |
| `useCompletion` | useCompletion hook for single text generation |
| `useStreaming` | Low-level streaming hook |
| `useVoiceInput` | Voice input (Web Speech API) |

### Classes

| Name | Description |
|------|-------------|
| `AIErrorBoundary` | Error boundary with retry |

### Types

| Name | Description |
|------|-------------|
| `AgentCardProps` | `<AgentCard>` props |
| `AgentTheme` | Agent card theme config |
| `AIErrorBoundaryProps` | `<AIErrorBoundary>` props |
| `ChatProps` | `<Chat>` props |
| `ChatTheme` | Theme System for Styled Components |
| `DynamicToolUIPart` | Dynamic tool call UI part |
| `MessageProps` | `<Message>` props |
| `OnToolCallArg` | `onToolCall` callback argument |
| `ReasoningUIPart` | Chain-of-thought segment |
| `StreamingMessageProps` | `<StreamingMessage>` props |
| `TextUIPart` | Text segment of a message |
| `ToolOutput` | Tool execution output |
| `ToolResultUIPart` | Tool result UI part |
| `ToolState` | Tool state (pending, running, complete) |
| `ToolUIPart` | Tool invocation UI part |
| `UIMessage` | Normalized UI message |
| `UIMessagePart` | UI message segment (text, tool, reasoning) |
| `UseAgentOptions` | `useAgent` options |
| `UseAgentResult` | `useAgent` result |
| `UseChatOptions` | `useChat` options |
| `UseChatResult` | `useChat` result |
| `UseCompletionOptions` | `useCompletion` options |
| `UseCompletionResult` | `useCompletion` result |
| `UseStreamingOptions` | `useStreaming` options |
| `UseStreamingResult` | `useStreaming` result |
| `UseVoiceInputOptions` | `useVoiceInput` options |
| `UseVoiceInputResult` | `useVoiceInput` result |

## Related

- [`veryfront/agent`](./agent.md) — Server-side agent runtime that powers chat
- [`veryfront/tool`](./tool.md) — Define tools that agents can call
