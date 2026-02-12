---
title: "veryfront/head"
description: "Declarative `<head>` metadata management."
order: 2
---

Declarative `<head>` metadata management.

## Import

```ts
import { Head } from "veryfront/head";
```

## Examples

```tsx
import { Head } from "veryfront/head";

export default function Page() {
  return (
    <>
      <Head>
        <title>My Page</title>
        <meta name="description" content="Page description" />
      </Head>
      <main>Content</main>
    </>
  );
}
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `Head` | Render `<title>`, `<meta>`, `<link>` tags |

## Related

- [`veryfront/router`](./router.md) — Client-side navigation
- [`veryfront/context`](./context.md) — Access page metadata
