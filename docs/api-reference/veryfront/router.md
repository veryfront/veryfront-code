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
  useParams,
  usePathname,
  useSearchParams,
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
| `Link` | Renders an anchor element annotated for Veryfront prefetch handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L424) |
| `Router` | Provides the router (and, on the client, page) context. On the server it renders the static `router` snapshot verbatim so SSR output and the first client render match. On the client it delegates to `ReactiveRouterProvider`, whose `pathname`/`query` track `veryFrontRouter` - so `useRouter()` and `usePageContext()` re-render on client-side navigation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L335) |
| `RouterProvider` | Provides the router (and, on the client, page) context. On the server it renders the static `router` snapshot verbatim so SSR output and the first client render match. On the client it delegates to `ReactiveRouterProvider`, whose `pathname`/`query` track `veryFrontRouter` - so `useRouter()` and `usePageContext()` re-render on client-side navigation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L335) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useParams` | The current route params from the initial match. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L404) |
| `usePathname` | The current URL pathname. Reactive across client-side navigation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L399) |
| `useRouter` | Reads the full router context. Kept as the backward-compatible surface; new code should prefer the granular {@link usePathname} / {@link useSearchParams} / {@link useParams} hooks, which re-render only on the slice they read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L394) |
| `useSearchParams` | The current query as a `URLSearchParams` - preserving repeated keys, unlike the flattened `useRouter().query`. Reads the live URL for full fidelity and is reactive through the router context; falls back to the router snapshot's query during SSR, where there is no live location. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L414) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `LinkProps` | Props accepted by `<Link>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L30) |
| `RouterProviderProps` | Props accepted by `<RouterProvider>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L36) |
| `RouterValue` | Router state exposed through `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L4) |
