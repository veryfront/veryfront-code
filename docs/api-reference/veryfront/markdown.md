---
title: "veryfront/markdown"
description: "Dependency-free Markdown source presentation for React. Core renders escaped source explicitly. Semantic Markdown is an optional capability supplied by a trusted extension through `MarkdownRendererProvider` or the per-component `renderer` prop."
order: 17
---

## Import

```ts
import {
  Markdown,
  MarkdownRendererCapabilityError,
  MarkdownRendererProvider,
} from "veryfront/markdown";
```

## Examples

```tsx
import { Markdown } from "veryfront/markdown";

<Markdown># Hello{"\n\n"}Some **bold** text with `code`.</Markdown>;
```

## Exports

### Components

| Name                       | Description                                                                                                    | Source                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Markdown`                 | Present Markdown source using an injected rich renderer or the explicit dependency-free plain-source contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L175) |
| `MarkdownRendererProvider` | Provide a trusted rich-Markdown renderer to a React subtree.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L109) |

### Classes

| Name                              | Description                                                              | Source                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `MarkdownRendererCapabilityError` | Raised when parser-specific options would otherwise be silently ignored. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L69) |

### Types

| Name                            | Description                                                                 | Source                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CodeBlockProps`                | Props passed to a custom fenced-code renderer by a rich Markdown extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L17)  |
| `Components`                    | Backward-compatible type name without a react-markdown dependency.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L46)  |
| `MarkdownComponents`            | Framework-neutral element overrides consumed only by an injected renderer.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L41)  |
| `MarkdownElementRendererProps`  | Common props available to injected element overrides.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L32)  |
| `MarkdownProps`                 | Props accepted by `Markdown`.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L121) |
| `MarkdownRenderer`              | A trusted rich-Markdown renderer supplied by an extension or application.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L59)  |
| `MarkdownRendererProps`         | Input contract implemented by a trusted rich-Markdown extension.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L49)  |
| `MarkdownRendererProviderProps` | Props accepted by `MarkdownRendererProvider`.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/chat/markdown.tsx#L62)  |
