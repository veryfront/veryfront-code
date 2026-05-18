---
title: "veryfront/markdown"
description: "Markdown rendering with syntax highlighting and diagrams."
order: 7
---

# veryfront/markdown

Markdown rendering with syntax highlighting and diagrams.

## Import

```ts
import { Markdown } from "veryfront/markdown";
```

## Examples

```tsx
import { Markdown } from "veryfront/markdown";

<Markdown># Hello{"\n\n"}Some **bold** text with `code`.</Markdown>
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `Markdown` | Render markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L186) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CodeBlockProps` | Props accepted by code block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L19) |
| `MarkdownProps` | Props accepted by markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L7) |

## Related

Reference modules:

- [`veryfront/chat`](./chat.md): Used in chat message rendering
- [`veryfront/mdx`](./mdx.md): For static MDX pages

User guides:

- [chat-ui](../../guides/chat-ui.md): Render markdown in chat
