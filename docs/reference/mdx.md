---
title: "veryfront/mdx"
description: "Component overrides for `.mdx` page rendering."
order: 8
---

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

- [`veryfront/markdown`](./markdown.md) — For runtime markdown rendering
