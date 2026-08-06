---
title: "veryfront/mdx"
description: "Composable component overrides for compiled `.mdx` page rendering."
order: 18
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
</MDXProvider>;
```

Nested providers inherit outer entries, with the nearest override taking
precedence. Component maps are application-owned React code; this module
does not compile or sanitize arbitrary MDX source.

For runtime markdown string rendering, use `veryfront/markdown` instead.

## Exports

### Components

| Name          | Description                                  | Source                                                                                                   |
| ------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `MDXProvider` | Provide component overrides to compiled MDX. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L20) |

### Functions

| Name               | Description                                  | Source                                                                                                   |
| ------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `useMDXComponents` | Return the memoized effective component map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L33) |

### Types

| Name               | Description                      | Source                                                                                                  |
| ------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `MDXProviderProps` | Props accepted by `MDXProvider`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/components/MDXProvider.tsx#L7) |
