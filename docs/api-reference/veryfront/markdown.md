---
title: "veryfront/markdown"
description: "Server-rendered CommonMark and GitHub Flavored Markdown. Semantic Markdown is rendered synchronously during SSR. Fenced source stays readable while browser-only syntax highlighting and Mermaid rendering load. Raw HTML and unsafe link protocols are not emitted by default."
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
| `Markdown` | Render CommonMark and GitHub Flavored Markdown synchronously. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L178) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CodeBlockProps` | Props passed to a custom fenced-code renderer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L60) |
| `MarkdownProps` | Props accepted by markdown. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L29) |
