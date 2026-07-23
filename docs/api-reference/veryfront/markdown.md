---
title: "veryfront/markdown"
description: "Markdown rendering with GFM, syntax highlighting, and Mermaid diagrams."
order: 14
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

| Name | Description | Source |
|------|-------------|--------|
| `Markdown` | Render Markdown with GFM, syntax-highlighted code, and Mermaid diagrams. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L146) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CodeBlockProps` | Props passed to a custom fenced code block renderer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L48) |
| `Components` | Element renderers keyed by HTML tag name. Entries override built-in renderers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L11) |
| `MarkdownProps` | Props accepted by Markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L28) |
| `PluggableList` | Read-only list of remark or rehype plugins accepted by Markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L18) |
