---
title: "veryfront/context"
description: "Access route params, page data, and MDX frontmatter."
order: 4
---

# veryfront/context

Access route params, page data, and MDX frontmatter.

## Import

```ts
import { usePageContext, PageContextProvider } from "veryfront/context";
```

## Examples

```tsx
import { usePageContext } from "veryfront/context";

function TableOfContents() {
  const { headings, frontmatter } = usePageContext();
  return (
    <ul>
      {headings.map((h) => (
        <li key={h.id}>
          <a href={`#${h.id}`}>{h.text}</a>
        </li>
      ))}
    </ul>
  );
}
```

## Exports

### Components

| Name | Description |
|------|-------------|
| `PageContextProvider` | Provide page context to children |

### Functions

| Name | Description |
|------|-------------|
| `usePageContext` | Get params, frontmatter, headings |

### Types

| Name | Description |
|------|-------------|
| `MdxHeading` | MDX heading (text, id, level) |
| `PageContextProviderProps` | `<PageContextProvider>` props |
| `PageContextValue` | Page context value shape |

## Related

- [`veryfront/router`](./router.md) — Client-side navigation
- [`veryfront/head`](./head.md) — Manage document head
