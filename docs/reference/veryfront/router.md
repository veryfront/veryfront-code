---
title: "veryfront/router"
description: "React router exports for client navigation and route context."
order: 3
---

# veryfront/router

React router exports for client navigation and route context.

## Import

```ts
import { useRouter, Link, Router } from "veryfront/router";
```

## Examples

```tsx
import { Link, RouterProvider, useRouter } from "veryfront/router";
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `Link` | Navigation link (with prefetching) |
| `Router` | Internal router managing nav state |

### Functions

| Name | Description |
|------|-------------|
| `useRouter` | Get pathname, params, query, navigate |

### Types

| Name | Description |
|------|-------------|
| `LinkProps` | `<Link>` props |
| `RouterProviderProps` | `<RouterProvider>` props |
| `RouterValue` | Router context value shape |

## Related

Reference modules:

- [`veryfront/head`](./head.md): Manage document head
- [`veryfront/context`](./context.md): Access route params and context

User guides:

- [pages-and-routing](../../guides/pages-and-routing.md): Pages and client-side routing
