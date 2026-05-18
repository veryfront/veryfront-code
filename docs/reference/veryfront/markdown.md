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
| `Markdown` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L183) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CodeBlockProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L17) |
| `MarkdownProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L6) |

## Related

Reference modules:

- [`veryfront/chat`](./chat.md): Used in chat message rendering
- [`veryfront/mdx`](./mdx.md): For static MDX pages

User guides:

- [chat-ui](../../guides/chat-ui.md): Render markdown in chat
