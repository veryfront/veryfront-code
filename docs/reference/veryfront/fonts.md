---
title: "veryfront/fonts"
description: "Load Google Fonts as a React component."
order: 5
---

# veryfront/fonts

Load Google Fonts as a React component.

## Import

```ts
import { GoogleFonts } from "veryfront/fonts";
```

## Examples

```tsx
import { GoogleFonts } from "veryfront/fonts";

<GoogleFonts
  fonts={[
    { name: "Inter", weights: [400, 500, 700], variable: "--font-inter" },
    { name: "Fira Code", weights: [400], variable: "--font-mono" },
  ]}
/>
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `GoogleFonts` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/fonts/index.ts#L84) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Font` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/fonts/index.ts#L21) |
| `GoogleFontsProps` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/fonts/index.ts#L28) |

## Related

Reference modules:

- [`veryfront/head`](./head.md): Manage document head metadata
- [`veryfront/context`](./context.md): Access page context and frontmatter

User guides:

- [head-and-seo](../../guides/head-and-seo.md): Font loading and SEO
