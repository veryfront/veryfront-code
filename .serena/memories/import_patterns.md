# Import Patterns - Quick Reference

## Import Alias Systems

| Prefix | Usage | Example |
|--------|-------|---------|
| `#veryfront/*` | ✅ **Internal standard** | `import { logger } from "#veryfront/utils"` |
| `@veryfront/*` | ⚠️ Defined but NOT used | (avoid - use # instead) |
| `veryfront/*` | User-facing public API | `import { useChat } from "veryfront/agent/react"` |

**Always use `#veryfront/*` for internal imports.**

## Common Import Mistakes

```typescript
// ❌ WRONG - Deep relative imports
import { foo } from "../../../../utils/logger.ts";

// ✅ CORRECT - Use alias
import { foo } from "#veryfront/utils";

// ❌ WRONG - Missing file extension for local
import { Bar } from "./bar";

// ✅ CORRECT - Include extension for relative
import { Bar } from "./bar.ts";
```

## NPM Packages
```typescript
// Use npm: specifier
import { z } from "npm:zod";

// Or use deno.json mapped version
import { z } from "zod";  // Maps to npm:zod@3.25.76
```

## Deno Std Library
```typescript
import { join } from "#std/path";
import { assertEquals } from "#std/assert";
```

## Module Resolution for Browser vs SSR
- Browser: `/_vf_modules/...` (transformed)
- SSR: `?ssr=true` query triggers server-side resolution
- NPM: Resolved via esm.sh CDN in browser

See `src/transforms/import-rewriter/README.md` for full details.
