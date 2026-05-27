---
title: "veryfront/router"
description: "React router exports for client navigation and route context."
order: 22
---

## Import

```ts
import {
  useRouter,
  Link,
  RouterProvider,
  Router,
} from "veryfront/router";
```

## Examples

```tsx
import { Link, RouterProvider, useRouter } from "veryfront/router";
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `Link` | Renders an anchor element annotated for Veryfront prefetch handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L171) |
| `Router` | Provides the router context value used by `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L154) |
| `RouterProvider` | Provides the router context value used by `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L154) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useRouter` | Reads the current router context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L166) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `LinkProps` | Props accepted by `<Link>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L29) |
| `RouterProviderProps` | Props accepted by `<RouterProvider>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L35) |
| `RouterValue` | Router state exposed through `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L3) |
