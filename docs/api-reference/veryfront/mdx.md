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
import { MDXProvider } from "veryfront/mdx";

<MDXProvider components={{ h1: CustomH1, code: CustomCode, a: CustomLink }}>
  {children}
</MDXProvider>
```

For runtime markdown string rendering, use `veryfront/markdown` instead.

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `MDXProvider` | Render MDX provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L13) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useMDXComponents` | React hook for mdxcomponents. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L21) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MDXProviderProps` | Props accepted by MDX provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L7) |
