---
title: "veryfront/mdx"
description: "Component overrides for `.mdx` page rendering."
order: 16
---

## Import

```ts
import { MDXProvider, useMDXComponents } from "veryfront/mdx";
```

## Examples

```tsx
import type { ComponentProps } from "react";
import { MDXProvider, useMDXComponents } from "veryfront/mdx";

function ArticleHeading(props: ComponentProps<"h1">) {
  return <h1 className="article-heading" {...props} />;
}

function ArticleContent() {
  const { h1: Heading = "h1" } = useMDXComponents();
  return <Heading>Hello from MDX</Heading>;
}

export default function Article() {
  return (
    <MDXProvider components={{ h1: ArticleHeading }}>
      <ArticleContent />
    </MDXProvider>
  );
}
```

Nested providers inherit outer overrides. Inner providers and local hook
overrides take precedence.

For runtime markdown string rendering, use `veryfront/markdown` instead.

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `MDXProvider` | Provide inherited MDX component overrides to descendant content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L25) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useMDXComponents` | Return inherited MDX component overrides merged with local overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L39) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MDXComponents` | MDX component overrides keyed by element or component name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/types/index.ts#L95) |
| `MDXProviderProps` | Props accepted by MDX provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L17) |
