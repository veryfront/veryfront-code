# Code Style

## Imports (Critical)
```typescript
// ✅ Always use #veryfront/* for internal imports
import { foo } from "#veryfront/utils";

// ❌ Never deep relative imports
import { foo } from "../../../../utils/index.ts";
```

## Formatting
Configured in `deno.json` - run `deno task fmt`.

## Naming
- Files/dirs: `kebab-case`
- Classes/Types: `PascalCase`
- Functions/vars: `camelCase`
- Constants: `UPPER_SNAKE_CASE`