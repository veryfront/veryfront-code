---
title: "veryfront/fonts"
description: "Load Google Fonts as a React component."
order: 5
---

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

| Name | Description |
|------|-------------|
| `GoogleFonts` | Load Google Fonts via CSS variables |

### Types

| Name | Description |
|------|-------------|
| `Font` | Font config (name, weights, variable) |
| `GoogleFontsProps` | `<GoogleFonts>` props |

## Related

- [`veryfront/head`](./head.md) — Manage document head metadata
- [`veryfront/context`](./context.md) — Access page context and frontmatter
