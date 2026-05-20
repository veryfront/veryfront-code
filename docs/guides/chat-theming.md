---
title: "Chat theming"
description: "Customize chat theme, feature toggles, sources, attachments, and contexts."
order: 17
---

Customize the `Chat` component's theme, attachments, model selector, sources, and feedback actions through props. Each option is independent: turn on what you need and leave the rest at the defaults.

Start from the working `Chat` example in [Chat UI](./chat-ui.md). Apply one option at a time, run `veryfront dev`, and verify the chat still sends messages through `/api/ag-ui`.

## Prerequisites

- A working preset Chat UI (see [Chat UI](./chat-ui.md)).
- For attachments: an upload endpoint you can call from `onAttach`.
- For model switching: more than one provider configured (see
  [Providers](./providers.md)).

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

## Verify it worked

After applying each option:

- **Theme**: open the page and confirm primary and background colors match
  what you set.
- **Attachments**: drop a file matching `attachAccept` and confirm `onAttach`
  fires with the file list.
- **Models**: switch the model selector and confirm a request body sent on
  the next message includes the new `model` field.
- **Sources and actions**: confirm action buttons render under each message
  and `onFeedback` fires when you click them.

## Next

- [Workflows](./workflows.md): orchestrate multi-step AI execution
- [Multi-agent](./multi-agent.md): compose agents and delegation patterns

## Related

- [Chat UI](./chat-ui.md): preset component
- [Chat composition](./chat-composition.md): custom layouts
- [`veryfront/chat`](../reference/veryfront/chat.md): chat reference
