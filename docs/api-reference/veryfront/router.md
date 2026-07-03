---
title: "veryfront/router"
description: "React router exports for client navigation and route context."
order: 24
---

## Import

```ts
import { Link, Router, RouterProvider, useRouter } from "veryfront/router";
```

## Examples

```tsx
import { Link, RouterProvider, useRouter } from "veryfront/router";
```

## Exports

### Components

| Name             | Description                                                                                                                                                                                                                                                                                                                                                                                                          | Source                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Link`           | Renders an anchor element annotated for Veryfront prefetch handling.                                                                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L388) |
| `Router`         | Provides the router context. On the server it renders the static `router` snapshot verbatim so SSR output and the first client render match. On the client it delegates to `ReactiveRouterProvider`, whose `pathname`/`query` track the navigation store - so `useRouter()` re-renders on client-side navigation. Page context (frontmatter/slug/headings) is a separate concern, provided by `PageContextProvider`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L313) |
| `RouterProvider` | Provides the router context. On the server it renders the static `router` snapshot verbatim so SSR output and the first client render match. On the client it delegates to `ReactiveRouterProvider`, whose `pathname`/`query` track the navigation store - so `useRouter()` re-renders on client-side navigation. Page context (frontmatter/slug/headings) is a separate concern, provided by `PageContextProvider`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L313) |

### Functions

| Name        | Description                                                                                                                                                                              | Source                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `useRouter` | Reads the router context: `pathname`, `query`, `params`, and the navigation actions. Reactive across client-side navigation - this is the single hook for location and navigation state. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L383) |

### Types

| Name                  | Description                                 | Source                                                                                        |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `LinkProps`           | Props accepted by `<Link>`.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L30) |
| `RouterProviderProps` | Props accepted by `<RouterProvider>`.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L36) |
| `RouterValue`         | Router state exposed through `useRouter()`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/runtime/core.ts#L4)  |
