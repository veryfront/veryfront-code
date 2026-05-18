---
title: "veryfront/mdx"
description: "Component overrides for `.mdx` page rendering."
order: 8
---

# veryfront/mdx

Component overrides for `.mdx` page rendering.

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
| `MDXProvider` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L10) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useMDXComponents` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L17) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MDXProviderProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L5) |

## Related

Reference modules:

- [`veryfront/markdown`](./markdown.md): For runtime markdown rendering

User guides:

- [pages-and-routing](../../guides/pages-and-routing.md): Author MDX pages
