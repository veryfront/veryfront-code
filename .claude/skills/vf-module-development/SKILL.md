---
name: vf-module-development
description: Use when creating new modules, adding exports, modifying module boundaries, or restructuring code in src/ - covers layer architecture, hash imports, barrel exports, and dependency rules
---

# Veryfront Module Development

## Overview

Veryfront has 45+ modules in `src/`, organized in strict dependency layers. Each module has a clear public API via barrel exports.

**Core principle:** Modules communicate through their public API. Never import from another module's internals.

## Dependency Layers

```
Layer 5 (top):    Orchestrators  → server/, proxy/, build/, cli/
Layer 4:          Features       → data/, html/, react/, rendering/
Layer 3:          Module System  → modules/, transforms/, cache/
Layer 2:          Infrastructure → security/, routing/, middleware/
Layer 1 (bottom): Foundation     → config/, types/, utils/, errors/, platform/
```

**Rules:**
- A module may only import from its own layer or lower layers
- Never import upward (e.g., Foundation must not import from Features)
- Validate with: `deno task validate:architecture`

## Module Structure

```
src/my-module/
├── index.ts              # Public API (barrel exports only)
├── index.test.ts         # Export verification test
├── types.ts              # Public types and interfaces
├── implementation.ts     # Core logic
├── factory.ts            # Factory functions (if needed)
├── utils.ts              # Module-internal utilities
└── sub-feature/          # Sub-directories for complex modules
    ├── index.ts
    └── implementation.ts
```

## Hash Imports

All internal imports use hash-based aliases defined in `deno.json`:

```typescript
// Correct
import { VeryfrontError } from "#veryfront/errors";
import { defineConfig } from "#veryfront/config";
import { logger } from "#veryfront/utils/logger";

// Wrong - never use relative paths across modules
import { VeryfrontError } from "../../errors/types.ts";
```

Within the same module, use relative imports:

```typescript
// Within src/my-module/
import { MyType } from "./types.ts";
import { helper } from "./utils.ts";
```

## Barrel Exports (index.ts)

Every module's `index.ts` is its public API:

```typescript
// src/my-module/index.ts

// Re-export public types
export type { MyConfig, MyOptions } from "./types.ts";

// Re-export public functions/constants
export { createMyThing } from "./factory.ts";
export { MY_ERROR_CONSTANT } from "#veryfront/errors";
```

**Rules:**
- Named exports only (no default exports)
- No logic in index.ts — only re-exports
- Every export must have JSDoc (enforced by `deno task lint:barrel-jsdoc`)
- No wildcard exports (enforced by `deno task lint:wildcard-exports`)

## Export Verification Test

Every module needs an `index.test.ts`:

```typescript
import * as mod from "./index.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";

describe("my-module/index", () => {
  it("should export expected API", () => {
    assertEquals(typeof mod.createMyThing, "function");
    assertEquals(typeof mod.MY_ERROR_CONSTANT, "object");
    // Types are verified at compile time, not here
  });
});
```

## Adding a New Module

1. Create directory: `src/my-module/`
2. Add types: `src/my-module/types.ts`
3. Add implementation
4. Add barrel: `src/my-module/index.ts`
5. Add export test: `src/my-module/index.test.ts`
6. Add hash import to `deno.json`:
   ```json
   "#veryfront/my-module": "./src/my-module/index.ts"
   ```
7. Add export to `deno.json` exports (if public API):
   ```json
   "./my-module": "./src/my-module/index.ts"
   ```
8. Verify: `deno task lint && deno task typecheck`

## Linting & Validation

```bash
deno task lint:style          # Named exports, no public keyword, casing
deno task lint:imports        # No cross-boundary relative imports
deno task lint:wildcard-exports  # No wildcard re-exports
deno task lint:barrel-jsdoc   # JSDoc on barrel exports
deno task validate:architecture  # Layer dependency rules
deno task check:circular      # No circular dependencies
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Relative import across modules | Use `#veryfront/module` hash import |
| Default export | Use named exports only |
| Logic in index.ts | Move to implementation file, re-export |
| Missing index.test.ts | Add export verification test |
| Importing from higher layer | Restructure or move shared code to lower layer |
| `export *` wildcard | List explicit named exports |
| Missing JSDoc on export | Add `/** description */` above each export |
| No `public` keyword | Omit it — enforced by linter |
