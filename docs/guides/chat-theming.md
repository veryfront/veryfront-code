---
title: "Chat theming"
description: "Customize chat theme, feature toggles, sources, attachments, and contexts."
order: 16
---

# Chat theming

Use this guide for visual customization and optional chat UI features.

## Theme overrides

```tsx
<Chat
  {...chat}
  theme={{
    colors: {
      primary: "#2563eb",
      background: "#ffffff",
    },
  }}
/>;
```

## Attachments

```tsx
<Chat
  {...chat}
  onAttach={(files) => uploadFiles(files)}
  attachAccept=".pdf,.docx,.txt"
  attachments={uploadedFiles}
  onRemoveAttachment={(id) => removeFile(id)}
/>;
```

## Models

```tsx
<Chat
  {...chat}
  models={[
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
  ]}
  model={chat.model}
  onModelChange={chat.setModel}
/>;
```

## Sources and actions

```tsx
<Chat
  {...chat}
  showSources
  showMessageActions
  onFeedback={(messageId, feedback) => saveFeedback(messageId, feedback)}
/>;
```

## Context providers

Use chat context providers when shared state needs to cross component boundaries in a custom UI. Prefer the preset props or composition components unless a nested component needs direct context access.

## Related

- [Chat UI](./chat-ui.md) - preset component
- [Chat composition](./chat-composition.md) - custom layouts
- [`veryfront/chat`](../reference/chat.md) - chat API reference
