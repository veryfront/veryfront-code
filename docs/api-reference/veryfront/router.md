---
title: "veryfront/router"
description: "React router exports for client navigation and route context."
order: 24
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
| `Link` | Renders an anchor element annotated for Veryfront prefetch handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L390) |
| `Router` | Provides the router context. `pathname`/`query` track the live URL through the shared navigation store's `useSyncExternalStore` surface; `params`/`domain` are seeded from the `router` prop. One component serves both sides: React uses `getServerSnapshot` (the seed href) during SSR and the live store on the client, so there is no environment branch - the server render and the first client render match by construction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L282) |
| `RouterProvider` | Provides the router context. `pathname`/`query` track the live URL through the shared navigation store's `useSyncExternalStore` surface; `params`/`domain` are seeded from the `router` prop. One component serves both sides: React uses `getServerSnapshot` (the seed href) during SSR and the live store on the client, so there is no environment branch - the server render and the first client render match by construction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L282) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useRouter` | Reads the router context: `pathname`, `query`, `params`, and the navigation actions. Reactive across client-side navigation - this is the single hook for location and navigation state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L385) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `LinkProps` | Props accepted by `<Link>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L30) |
| `RouterProviderProps` | Props accepted by `<RouterProvider>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L36) |
| `RouterValue` | Router state exposed through `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L4) |
