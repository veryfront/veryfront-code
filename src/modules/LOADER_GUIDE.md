# Module Loader Selection Guide

This guide helps you choose the right module loader for your use case.

## Quick Reference

| Loader              | Location                                  | Use Case                                 |
| ------------------- | ----------------------------------------- | ---------------------------------------- |
| esm-module-loader   | `transforms/mdx/esm-module-loader/`       | MDX content, frontmatter, JSX transforms |
| ssr-module-loader   | `modules/react-loader/ssr-module-loader/` | React SSR, distributed caching           |
| orchestrator loader | `rendering/orchestrator/module-loader/`   | Render pipeline, ESM rewriting           |
| API loader          | `routing/api/module-loader/`              | API routes, HTTP imports, security       |

## Decision Tree

```
Loading MDX content?
├─ Yes → esm-module-loader
│   - Handles frontmatter extraction
│   - JSX runtime loading
│   - Component resolution
│
└─ No
   ├─ React SSR with caching?
   │  └─ Yes → ssr-module-loader
   │      - Multi-layer caching (memory + disk)
   │      - Import rewriting for cross-project
   │      - Environment-specific strategies
   │
   ├─ In render pipeline?
   │  └─ Yes → orchestrator/module-loader
   │      - ESM rewriting for external modules
   │      - Render context integration
   │
   └─ API route handlers?
      └─ Yes → routing/api/module-loader
          - Direct import strategy
          - Transpilation fallback
          - HTTP import security
```

## Shared Patterns

Import from `#veryfront/modules/loader-shared/patterns.ts`:

```typescript
import {
  MODULE_EXTENSIONS, // [".tsx", ".ts", ".jsx", ".js", ".mdx"]
  PROJECT_ALIAS_IMPORT_PATTERN, // @/ alias imports
  REACT_IMPORT_PATTERN, // React detection
  RELATIVE_IMPORT_PATTERN, // ./path imports
  VF_MODULE_IMPORT_PATTERN, // /_vf_modules/ imports
} from "#veryfront/modules/loader-shared/patterns.ts";
```

## Loader Details

### esm-module-loader

**Location:** `src/transforms/mdx/esm-module-loader/`

**Purpose:** Primary loader for MDX content with ESM module support.

**Key Features:**

- Module caching with multi-layer validation
- Alias import transformation (@/ → absolute paths)
- JSX file import handling
- Stub module generation for missing dependencies
- Framework bundle loading

**Entry Point:** `loadModuleESM()`

**Sub-modules:**

- `metadata/` - Frontmatter and metadata extraction
- `components/` - Component import resolution
- `jsx/` - JSX runtime loading
- `cache/` - Multi-layer caching
- `transforms/` - Import transformations
- `resolution/` - File finding utilities

### ssr-module-loader

**Location:** `src/modules/react-loader/ssr-module-loader/`

**Purpose:** React SSR with distributed caching support.

**Key Features:**

- Memory + disk caching layers
- Cross-project import rewriting
- Environment-specific loading strategies (Deno vs Node)
- Lockfile integrity verification

**Entry Point:** `SSRModuleLoader` class

### orchestrator/module-loader

**Location:** `src/rendering/orchestrator/module-loader/`

**Purpose:** Render pipeline integration.

**Key Features:**

- ESM rewriting for external modules
- CDN URL resolution
- Render context integration

**Entry Point:** `ESMRewriter` class

### API module-loader

**Location:** `src/routing/api/module-loader/`

**Purpose:** API route handler loading.

**Key Features:**

- Direct import strategy (fastest)
- Transpilation fallback
- HTTP import security controls

**Entry Point:** `loadModule()`

## Migration Notes

### Consolidated Functions

The following functions were consolidated into `esm-module-loader`:

| Function                  | Old Location                          | New Location                                  |
| ------------------------- | ------------------------------------- | --------------------------------------------- |
| `extractFrontmatter`      | `module-loader/metadata-extractor.ts` | `esm-module-loader/metadata/extractor.ts`     |
| `extractMetadata`         | `module-loader/metadata-extractor.ts` | `esm-module-loader/metadata/extractor.ts`     |
| `mergeFrontmatter`        | `module-loader/metadata-extractor.ts` | `esm-module-loader/metadata/extractor.ts`     |
| `extractBalancedBlock`    | `module-loader/string-parser.ts`      | `esm-module-loader/metadata/string-parser.ts` |
| `cleanModuleCode`         | `module-loader/string-parser.ts`      | `esm-module-loader/metadata/string-parser.ts` |
| `parseJsonish`            | `module-loader/string-parser.ts`      | `esm-module-loader/metadata/string-parser.ts` |
| `extractComponentImports` | `module-loader/component-resolver.ts` | `esm-module-loader/components/resolver.ts`    |
| `resolveComponents`       | `module-loader/component-resolver.ts` | `esm-module-loader/components/resolver.ts`    |
| `loadJSXRuntime`          | `module-loader/jsx-runtime-loader.ts` | `esm-module-loader/jsx/runtime-loader.ts`     |

### Backwards Compatibility

Old imports from `module-loader/` continue to work via re-exports:

```typescript
// Still works (re-exports from new locations)
import { extractFrontmatter } from "./module-loader/metadata-extractor.ts";

// Preferred (direct import from new location)
import { extractFrontmatter } from "./esm-module-loader/metadata/index.ts";
```
