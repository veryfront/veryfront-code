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

| Name | Description | Source |
|------|-------------|--------|
| `PageContextProvider` | Provides page context to route and MDX descendants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L184) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `usePageContext` | Reads the current page context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L196) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MdxHeading` | Heading metadata extracted from MDX content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L43) |
| `PageContextProviderProps` | Props accepted by `<PageContextProvider>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L71) |
| `PageContextValue` | Page context exposed to route and MDX components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L53) |

## Related

Reference modules:

- [`veryfront/router`](./router.md): Client-side navigation
- [`veryfront/head`](./head.md): Manage document head

User guides:

- [pages-and-routing](../../guides/pages-and-routing.md): Page context for routes and MDX
