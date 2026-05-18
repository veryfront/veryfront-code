---
title: "veryfront/context"
description: "React page-context exports for MDX and route-aware rendering."
order: 4
---

# veryfront/context

React page-context exports for MDX and route-aware rendering.

## Import

```ts
import { usePageContext, PageContextProvider } from "veryfront/context";
```

## Examples

```tsx
import { PageContextProvider, usePageContext } from "veryfront/context";
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `PageContextProvider` | Provide page context to children |

### Functions

| Name | Description |
|------|-------------|
| `usePageContext` | Get params, frontmatter, headings |

### Types

| Name | Description |
|------|-------------|
| `MdxHeading` | MDX heading (text, id, level) |
| `PageContextProviderProps` | `<PageContextProvider>` props |
| `PageContextValue` | Page context value shape |

## Related

Reference modules:

- [`veryfront/router`](./router.md): Client-side navigation
- [`veryfront/head`](./head.md): Manage document head

User guides:

- [pages-and-routing](../../guides/pages-and-routing.md): Page context for routes and MDX
