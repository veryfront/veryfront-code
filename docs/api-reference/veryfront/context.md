---
title: "veryfront/context"
description: "React page-context exports for MDX and route-aware rendering."
order: 5
---

## Import

```ts
import { PageContextProvider, usePageContext } from "veryfront/context";
```

## Examples

```tsx
import { PageContextProvider, usePageContext } from "veryfront/context";
```

## Exports

### Components

| Name                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Source                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `PageContextProvider` | Provides page context to route and MDX descendants. Page-authored fields (`frontmatter`, `slug`, `headings`) come from the `pageContext` prop; the location fields (`path`, `query`, `params`) are derived from the router so they stay reactive and there is a single source of truth - `usePageContext()` exposes the same `query`/`pathname` as `useRouter()`. When rendered outside a `RouterProvider` (no live router) it falls back to the seed's own location. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L392) |

### Functions

| Name             | Description                     | Source                                                                                         |
| ---------------- | ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `usePageContext` | Reads the current page context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L412) |

### Types

| Name                       | Description                                       | Source                                                                                        |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `MdxHeading`               | Heading metadata extracted from MDX content.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L52) |
| `PageContextProviderProps` | Props accepted by `<PageContextProvider>`.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L80) |
| `PageContextValue`         | Page context exposed to route and MDX components. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L62) |
