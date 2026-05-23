---
title: "veryfront/context"
description: "React page-context exports for MDX and route-aware rendering."
order: 4
---

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
| `PageContextProvider` | Provides page context to route and MDX descendants. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L185) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `usePageContext` | Reads the current page context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L197) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `MdxHeading` | Heading metadata extracted from MDX content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L44) |
| `PageContextProviderProps` | Props accepted by `<PageContextProvider>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L72) |
| `PageContextValue` | Page context exposed to route and MDX components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L54) |
