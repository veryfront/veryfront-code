---
title: "veryfront/router"
description: "Client-side routing, navigation, and links."
order: 3
---

Client-side routing, navigation, and links.

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
import { useRouter, Link } from "veryfront/router";

function Nav() {
  const router = useRouter();
  return (
    <nav>
      <Link href="/about">About</Link>
      <p>Current path: {router.pathname}</p>
    </nav>
  );
}
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `Link` | Navigation link (with prefetching) |
| `Router` | Internal router managing nav state |
| `RouterProvider` | Provide router context to tree |

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

- [`veryfront/head`](./head.md) — Manage document head
- [`veryfront/context`](./context.md) — Access route params and context
