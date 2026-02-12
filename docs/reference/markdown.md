---
title: "veryfront/markdown"
description: "Markdown rendering with syntax highlighting and diagrams."
order: 7
---

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

| Name | Description |
|------|-------------|
| `Markdown` | Render markdown with highlighting + diagrams |

### Types

| Name | Description |
|------|-------------|
| `CodeBlockProps` | Code block rendering props |
| `MarkdownProps` | `<Markdown>` props |

## Related

- [`veryfront/chat`](./chat.md) — Used in chat message rendering
- [`veryfront/mdx`](./mdx.md) — For static MDX pages
