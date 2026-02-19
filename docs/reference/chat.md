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
| `body?` | <code>Record&lt;string, unknown&gt;</code> | Extra body fields sent with each request |
| `headers?` | <code>Record&lt;string, string&gt;</code> | Custom request headers |
| `credentials?` | `RequestCredentials` | Fetch credentials mode |
| `model?` | `string` | Override model at runtime (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929") |
| `systemPrompt?` | `string` | System prompt for browser-side inference (server uses agent config) |
| `browserFallback?` | `boolean` | Enable/disable browser fallback when server can't provide AI. Default: true |
| `onResponse?` | <code>(response: Response) =&gt; void</code> | Raw response callback |
| `onFinish?` | <code>(message: UIMessage) =&gt; void</code> | Completion callback |
| `onError?` | <code>(error: Error) =&gt; void</code> | Error callback |
| `onToolCall?` | <code>(arg: OnToolCallArg) =&gt; void \\| Promise&lt;void&gt;</code> | Tool call handler for client-side execution |

### `UseChatResult`

`useChat` result

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `UIMessage[]` | All messages in the conversation |
| `input` | `string` | Current input value |
| `isLoading` | `boolean` | Whether a request is in flight |
| `error` | `Error \\| null` | Last error (if any) |
| `model` | `string \\| undefined` | Current model override (undefined = use agent default) |
| `inferenceMode` | `InferenceMode` | Where inference is currently happening |
| `browserStatus` | `BrowserInferenceStatus \\| null` | Browser-side model loading/inference status (null when not using browser fallback) |
| `setInput` | <code>(input: string) =&gt; void</code> | Set input value |
| `setModel` | <code>(model: string \\| undefined) =&gt; void</code> | Change the model for subsequent requests |
| `sendMessage` | <code>(message: &#123; text: string &#125;) =&gt; Promise&lt;void&gt;</code> | Send a message programmatically |
| `reload` | <code>() =&gt; Promise&lt;void&gt;</code> | Re-send last user message |
| `stop` | <code>() =&gt; void</code> | Abort current request |
| `setMessages` | <code>(messages: UIMessage[]) =&gt; void</code> | Replace message history |
| `addToolOutput` | <code>(output: ToolOutput) =&gt; void</code> | Submit client-side tool result |
| `data?` | `unknown` | Extra data from server response |
| `handleInputChange` | <code>(e: React.ChangeEvent&lt;HTMLInputElement \\| HTMLTextAreaElement&gt;) =&gt; void</code> | Bind to input onChange |
| `handleSubmit` | <code>(e: React.FormEvent) =&gt; Promise&lt;void&gt;</code> | Submit current input |

### `UseAgentOptions`

`useAgent` options

| Property | Type | Description |
|----------|------|-------------|
| `agent` | `string` | Agent ID or endpoint |
| `onToolCall?` | <code>(toolCall: ToolCall) =&gt; void</code> | Callback when tool is called |
| `onToolResult?` | <code>(toolCall: ToolCall, result: unknown) =&gt; void</code> | Callback when tool result received |
| `onError?` | <code>(error: Error) =&gt; void</code> | Callback when error occurs |

### `UseAgentResult`

`useAgent` result

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `Message[]` | Message history |
| `toolCalls` | `ToolCall[]` | Active tool calls |
| `status` | `AgentStatus` | Agent status |
| `thinking?` | `string` | Thinking/reasoning text |
| `invoke` | <code>(input: string) =&gt; Promise&lt;void&gt;</code> | Invoke the agent |
| `stop` | <code>() =&gt; void</code> | Stop agent execution |
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
| `ModelSelector` | Dropdown for switching models at runtime |
| `StreamingMessage` | Incrementally rendered message |

### Functions

| Name | Description |
|------|-------------|
| `useAgent` | Agent interactions with tool call tracking |
| `useAIErrorHandler` | Programmatic AI error handler |
| `useChat` | useChat hook for managing chat state with veryfront stream events. |
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
| `BrowserInferenceStatus` | Browser-side model loading and inference status |
| `ChatProps` | `<Chat>` props |
| `ChatTheme` | Theme System for Styled Components |
| `DynamicToolUIPart` | Dynamic tool call UI part |
| `InferenceMode` | Where inference is happening |
| `MessageProps` | `<Message>` props |
| `ModelOption` | A "provider/model" value and its display label. |
| `ModelSelectorProps` | Props for `<ModelSelector>`. |
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
