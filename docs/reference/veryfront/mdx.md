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

| Name | Description |
|------|-------------|
| `MDXProvider` | Override MDX components |

### Functions

| Name | Description |
|------|-------------|
| `useMDXComponents` | Get current MDX overrides |

### Types

| Name | Description |
|------|-------------|
| `MDXProviderProps` | `<MDXProvider>` props |

## Related

Reference modules:

- [`veryfront/markdown`](./markdown.md): For runtime markdown rendering

User guides:

- [pages-and-routing](../../guides/pages-and-routing.md): Author MDX pages
