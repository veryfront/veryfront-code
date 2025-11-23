# Veryfront AI Primitives

**Status**: Phase 5 Complete (Unstyled Primitives)
**Module**: `veryfront/ai/primitives`
**Layer**: 2 (Unstyled - Maximum flexibility)

## Overview

Unstyled, composable UI primitives built on **Radix UI patterns** (shadcn-compatible). Bring your own styles, perfect for design systems.

## Philosophy

- **Zero styling opinions** - Just structure and accessibility
- **Maximum composability** - Mix with any design system
- **Radix UI patterns** - Same foundation as shadcn/ui
- **TypeScript first** - Full type safety
- **Accessible by default** - ARIA attributes built-in

## Available Primitives

### Chat Primitives

#### ChatContainer

Root container for chat interfaces.

```tsx
<ChatContainer className="flex flex-col h-screen bg-white dark:bg-gray-900">
  {children}
</ChatContainer>;
```

#### MessageList

Container for message list with accessibility.

```tsx
<MessageList className="flex-1 overflow-y-auto p-4 space-y-4">
  {messages.map((msg) => <MessageItem key={msg.id} {...msg} />)}
</MessageList>;
```

#### MessageItem

Individual message with role-based data attributes.

```tsx
<MessageItem
  role={msg.role}
  className={cn(
    "flex",
    msg.role === "user" ? "justify-end" : "justify-start",
  )}
>
  <div className={userStyles}>{msg.content}</div>
</MessageItem>;
```

#### MessageRole

Role indicator.

```tsx
<MessageRole className="font-semibold text-sm uppercase">
  {message.role}
</MessageRole>;
```

#### MessageContent

Content wrapper.

```tsx
<MessageContent className="prose dark:prose-invert">
  {message.content}
</MessageContent>;
```

### Input Primitives

#### InputBox

Text input with submit on Enter.

```tsx
<InputBox
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onSubmit={handleSubmit}
  placeholder="Type a message..."
  className="w-full px-4 py-2 border rounded-lg"
  multiline={false} // or true for textarea
/>;
```

#### SubmitButton

Submit button with loading state.

```tsx
<SubmitButton
  onClick={handleSubmit}
  isLoading={isLoading}
  disabled={!input.trim()}
  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
>
  Send
</SubmitButton>;
```

#### LoadingIndicator

Loading spinner.

```tsx
{
  isLoading && <LoadingIndicator className="animate-spin h-4 w-4 border-2 border-blue-600" />;
}
```

### Agent Primitives

#### AgentContainer

Root agent UI container.

```tsx
<AgentContainer className="border rounded-lg p-6 space-y-4">
  {children}
</AgentContainer>;
```

#### AgentStatus

Status indicator with formatted text.

```tsx
<AgentStatus
  status={agent.status}
  className="text-sm font-medium text-gray-600"
/>;
```

#### ThinkingIndicator

Shows agent reasoning.

```tsx
{
  agent.thinking && (
    <ThinkingIndicator className="italic text-gray-500 bg-yellow-50 p-3 rounded">
      {agent.thinking}
    </ThinkingIndicator>
  );
}
```

### Tool Primitives

#### ToolInvocation

Tool call display.

```tsx
<ToolInvocation
  name={tool.name}
  args={tool.args}
  status={tool.status}
  className="border-l-4 border-blue-500 pl-4 my-2"
>
  <ToolResult result={tool.result} />
</ToolInvocation>;
```

#### ToolResult

Tool result display with optional custom renderer.

```tsx
<ToolResult
  result={tool.result}
  renderResult={(result) => <CustomResultDisplay data={result} />}
  className="mt-2 p-2 bg-gray-100 rounded font-mono text-sm"
/>;
```

#### ToolList

List of tool calls.

```tsx
<ToolList
  toolCalls={agent.toolCalls}
  className="space-y-2"
  renderTool={(tool) => <CustomToolCard tool={tool} />}
/>;
```

## Complete Example

```tsx
import {
  ChatContainer,
  InputBox,
  LoadingIndicator,
  MessageItem,
  MessageList,
  SubmitButton,
} from "veryfront/ai/primitives";
import { useChat } from "veryfront/ai/react";

export function DesignSystemChat() {
  const chat = useChat({ api: "/api/chat" });

  return (
    <ChatContainer className="flex flex-col h-screen max-w-2xl mx-auto">
      {/* Header */}
      <div className="border-b p-4 bg-gray-50">
        <h1 className="text-xl font-bold">Chat</h1>
      </div>

      {/* Messages */}
      <MessageList className="flex-1 overflow-y-auto p-4 space-y-4">
        {chat.messages.map((msg) => (
          <MessageItem
            key={msg.id}
            role={msg.role}
            className={cn(
              "flex",
              msg.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[70%] rounded-lg px-4 py-2",
                msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-900",
              )}
            >
              {msg.content}
            </div>
          </MessageItem>
        ))}

        {chat.isLoading && (
          <div className="flex justify-start">
            <LoadingIndicator className="w-6 h-6 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </MessageList>

      {/* Input */}
      <form onSubmit={chat.handleSubmit} className="border-t p-4">
        <div className="flex gap-2">
          <InputBox
            value={chat.input}
            onChange={chat.handleInputChange}
            placeholder="Type a message..."
            disabled={chat.isLoading}
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <SubmitButton
            isLoading={chat.isLoading}
            disabled={!chat.input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </SubmitButton>
        </div>
      </form>
    </ChatContainer>
  );
}
```

## Integration with Design Systems

Primitives work seamlessly with any design system:

### Tailwind CSS

```tsx
<MessageItem className="flex justify-end">
  <div className="bg-blue-600 text-white rounded-lg px-4 py-2">
    {content}
  </div>
</MessageItem>;
```

### CSS Modules

```tsx
<MessageItem className={styles.message}>
  {content}
</MessageItem>;
```

### Styled Components

```tsx
const StyledMessage = styled(MessageItem)`
  display: flex;
  justify-content: flex-end;
`;
```

### shadcn/ui

```tsx
import { Card } from "@/components/ui/card";
import { ChatContainer, MessageList } from "veryfront/ai/primitives";

<Card>
  <ChatContainer>
    <MessageList>
      {messages.map((msg) => (
        <MessageItem key={msg.id} className="p-4">
          {msg.content}
        </MessageItem>
      ))}
    </MessageList>
  </ChatContainer>
</Card>;
```

## Data Attributes

All primitives include data attributes for easy styling:

```css
/* Style by role */
[data-message-item][data-role="user"] {
  justify-content: flex-end;
}

/* Style by status */
[data-agent-status][data-status="thinking"] {
  color: orange;
}

/* Style tool invocations */
[data-tool-invocation] {
  border-left: 4px solid blue;
}
```

## Accessibility

All primitives include proper ARIA attributes:

- `MessageList`: `role="log"` `aria-live="polite"`
- `AgentStatus`: `role="status"` `aria-label="Agent status"`
- `ThinkingIndicator`: `role="status"` `aria-live="polite"`
- `SubmitButton`: `aria-label="Submit message"`
- `LoadingIndicator`: `role="status"` `aria-label="Loading"`

## Status

**Phase 5: Unstyled Primitives** **COMPLETE**

**Created:**

- ChatContainer
- MessageList, MessageItem, MessageRole, MessageContent
- InputBox, SubmitButton, LoadingIndicator
- AgentContainer, AgentStatus, ThinkingIndicator
- ToolInvocation, ToolResult, ToolList
- Full TypeScript support
- Accessibility built-in
- Radix UI patterns
- shadcn-compatible

**Total: 12 primitives** ready for production use!

**Next**: Phase 6 (Styled Components)
