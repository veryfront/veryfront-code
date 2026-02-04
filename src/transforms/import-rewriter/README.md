# Import Rewriter

The import rewriter transforms import specifiers for different execution contexts (browser vs SSR). It uses a strategy pattern where each import type has a dedicated handler.

## Module Resolution Overview

| Import Pattern | Example | Browser Resolution | SSR Resolution |
|----------------|---------|-------------------|----------------|
| **Framework** | `veryfront/head` | `/_vf_modules/_veryfront/react/components/Head.js` | `/_vf_modules/_veryfront/...?ssr=true` |
| **Internal** | `#veryfront/react/...` | `/_vf_modules/_veryfront/...` | `/_vf_modules/_veryfront/...?ssr=true` |
| **Relative** | `./Button` | `/_vf_modules/...` | Kept as-is (resolved by loader) |
| **NPM Package** | `lodash` | `https://esm.sh/lodash` | `https://esm.sh/lodash` |
| **Cross-Project** | `acme-ui@1.0/@/Button` | Registry URL | Registry → local cache |
| **Node Builtin** | `node:fs` | Polyfill or noop | Kept as-is |
| **URL** | `https://esm.sh/...` | Kept as-is | Kept as-is |

## URL Prefixes

### `/_vf_modules/`

Served by the local module server. Contains:

| Path | Contents |
|------|----------|
| `/_vf_modules/_veryfront/*` | Framework internal modules (from `src/`) |
| `/_vf_modules/*` | User project modules |
| `/_vf_modules/_batch` | Batch module loading endpoint |

### External URLs

| URL | Purpose |
|-----|---------|
| `https://esm.sh/*` | NPM packages via CDN |
| `https://registry.veryfront.com/*` | Cross-project imports |

## Import Strategies

Strategies are applied in priority order (lower number = higher priority):

| Priority | Strategy | Handles |
|----------|----------|---------|
| 1 | `ReactStrategy` | `react`, `react-dom`, `react/*` |
| 2 | `NodeBuiltinStrategy` | `node:*` builtins |
| 3 | `VeryfrontStrategy` | `veryfront/*`, `#veryfront/*`, `@veryfront/*` |
| 4 | `CrossProjectStrategy` | `project@version/@/path` |
| 5 | `RelativeStrategy` | `./`, `../` paths |
| 6 | `BareStrategy` | NPM packages (`lodash`, `@org/pkg`) |
| 7 | `URLStrategy` | `https://`, `http://` URLs |

## Framework Imports

User-facing imports map to internal framework paths via `deno.json`:

```json
{
  "imports": {
    "veryfront/head": "./src/react/components/Head.tsx",
    "veryfront/router": "./src/react/router/index.tsx",
    "veryfront/image": "./src/react/components/Image.tsx"
  }
}
```

The import rewriter transforms these:

```
veryfront/head
    ↓ (deno.json lookup)
./src/react/components/Head.tsx
    ↓ (path transformation)
/_vf_modules/_veryfront/react/components/Head.js
```

The `_veryfront` segment in the URL identifies **framework-provided modules** as distinct from user project modules.

## Cross-Project Imports

Import from other Veryfront projects:

```typescript
// With specific version
import { Button } from "acme-ui@1.0.0/@/components/Button";

// Latest version
import { utils } from "shared-lib/@/utils";
```

**Pattern:** `{project-slug}@{version}/@/{path}` or `{project-slug}/@/{path}`

**Resolution:**
- **Browser:** Rewrites to registry URL (`https://registry.veryfront.com/acme-ui@1.0/@/components/Button`)
- **SSR:** Fetches from registry, transforms, caches locally as `file://` path

## SSR-Specific Handling

For SSR, framework imports get `?ssr=true` appended:

```
/_vf_modules/_veryfront/react/components/Head.js?ssr=true
```

This signals to the `ssrVfModulesPlugin` to:
1. Identify the import as needing server-side resolution
2. Resolve the source file from the framework (`src/react/components/Head.tsx`)
3. Transform and cache it locally
4. Rewrite to a `file://` path for Deno's module loader

## Node Builtins

| Context | Handling |
|---------|----------|
| **SSR** | Kept as `node:*` (Deno supports these) |
| **Browser** | Replaced with polyfills or noop modules |

Polyfill mappings:
- `node:async_hooks` → `/_vf_modules/_veryfront/platform/polyfills/node-async-hooks.js`
- Other builtins → noop module

## Architecture

```
src/transforms/import-rewriter/
├── index.ts              # Main rewriteImports() function
├── types.ts              # TypeScript interfaces
├── url-builder.ts        # URL construction helpers
├── strategies/
│   ├── index.ts          # Strategy exports
│   ├── react-strategy.ts
│   ├── node-builtin-strategy.ts
│   ├── veryfront-strategy.ts
│   ├── cross-project-strategy.ts
│   ├── relative-strategy.ts
│   ├── bare-strategy.ts
│   └── url-strategy.ts
└── __tests__/
    └── hydration-parity.test.ts
```

## Testing

```bash
# Run import rewriter tests
deno test src/transforms/import-rewriter/

# Run hydration parity tests (browser/SSR consistency)
deno test src/transforms/import-rewriter/__tests__/hydration-parity.test.ts
```

## Related

- [`src/modules/README.md`](../../modules/README.md) - Module loading system
- [`src/transforms/pipeline/`](../pipeline/) - Transform pipeline stages
- [`src/server/handlers/request/module/`](../../server/handlers/request/module/) - Module HTTP handler
