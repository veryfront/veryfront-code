# Veryfront Renderer Module Refactoring Plan

## Objective
Systematically refactor all 32 modules in `src/` to eliminate technical debt, add colocated unit tests, and ensure clean code principles.

## Acceptance Criteria
- [ ] All 32 modules analyzed and refactored
- [ ] Each file has colocated unit tests (`*.test.ts`)
- [ ] `deno task verify` passes after each module
- [ ] No hacks, fallbacks, or bandaid fixes remain
- [ ] All platform-specific code uses adapter layer
- [ ] Zero `any` types, zero empty catch blocks
- [ ] Functions ≤ 30 lines, files ≤ 200 lines

---

## Module Queue (32 modules)

### Foundation Layer (1-6)
- [x] 1. `types` - TypeScript type definitions
- [x] 2. `errors` - Error handling utilities
- [x] 3. `utils` - General utilities
- [x] 4. `platform` - Cross-runtime adapters
- [x] 5. `cache` - Caching utilities
- [ ] 6. `config` - Configuration

### Infrastructure Layer (7-12)
- [ ] 7. `observability` - Tracing, logging
- [ ] 8. `security` - Security utilities
- [ ] 9. `routing` - File-based routing
- [ ] 10. `middleware` - Request middleware
- [ ] 11. `modules` - Module resolution
- [ ] 12. `transforms` - Code transforms

### Core Layer (13-18)
- [ ] 13. `html` - HTML utilities
- [ ] 14. `data` - Data fetching
- [ ] 15. `react` - React components
- [ ] 16. `rendering` - SSR, RSC, client rendering
- [ ] 17. `server` - Dev & production servers
- [ ] 18. `cli` - CLI commands

### Build Layer (19-21)
- [ ] 19. `build` - Production builds
- [ ] 20. `oauth` - OAuth utilities
- [ ] 21. `mcp` - MCP integration

### AI/Agent Layer (22-27)
- [ ] 22. `agent` - Agent runtime
- [ ] 23. `workflow` - Workflow/agent workflows
- [ ] 24. `tool` - Tool utilities
- [ ] 25. `prompt` - Prompt utilities
- [ ] 26. `provider` - Providers
- [ ] 27. `resource` - Resources

### Integration Layer (28-32)
- [ ] 28. `exports` - Framework exports
- [ ] 29. `lib` - Library utilities
- [ ] 30. `studio` - Studio integration
- [ ] 31. `embeddings` - Embeddings
- [ ] 32. `testing` - Test utilities

---

## Per-Module Process

### Phase 1: Analysis
For each module, identify:
1. All files and their responsibilities
2. Dead code / unused exports
3. Duplicate logic
4. Hacks/workarounds (try/catch swallowing, fallback chains, TODO/FIXME/HACK)
5. Functions > 50 lines, files > 300 lines
6. Missing colocated tests
7. Platform-specific code not using adapters

### Phase 2: Refactoring
Apply these principles:
- **Single Responsibility**: Each function/class does ONE thing
- **DRY**: Extract duplicates to shared utilities
- **Early Return**: Guard clauses, avoid nesting
- **Explicit > Implicit**: Clear naming, no magic
- **Fail Fast**: Validate inputs, throw early
- **No Silent Failures**: Log or propagate errors

Rules:
- Functions ≤ 30 lines
- Files ≤ 200 lines
- Max 3 levels of nesting
- No `any` types
- No empty catch blocks
- Remove unused code, commented code, console.log

### Phase 3: Add Colocated Tests
Create `{filename}.test.ts` next to each source file:
```typescript
import { describe, it } from "@veryfront/testing/bdd";
import { assertEquals, assertThrows } from "@veryfront/testing/assert";

describe("{Module}", () => {
  describe("{function}", () => {
    it("should {behavior} when {condition}", () => {
      // Arrange, Act, Assert
    });
  });
});
```

Coverage requirements:
- All public functions/methods
- All error paths
- Edge cases

### Phase 4: Verification
```bash
deno task verify  # Must pass
deno task test --filter="{module}"  # Module tests pass
```

---

## Anti-Patterns to Eliminate

### Fallback Chains (BAD)
```typescript
try { return primary(); }
catch { try { return fallback(); } catch { return default; } }
```

### God Functions (BAD)
```typescript
function handleRequest(req) { /* 200+ lines */ }
```

### Swallowed Errors (BAD)
```typescript
catch (e) { /* ignore */ }
catch { return null; }
```

### Type Assertions (BAD)
```typescript
const data = response as MyType;
```

### Duplicate Logic (BAD)
```typescript
// Same code in multiple files
```

---

## Platform Adapter Usage

Always use adapters for runtime-specific APIs:
```typescript
// File system
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";

// HTTP
import { createHttpServer } from "#veryfront/platform/compat/http/index.ts";

// Path
import { join, resolve } from "#veryfront/platform/compat/path/index.ts";

// Process
import { getEnv, cwd } from "#veryfront/platform/compat/process.ts";

// Crypto
import { randomUUID } from "#veryfront/platform/compat/crypto.ts";
```

Never use `Deno.*`, `process.*`, or Node APIs directly.

---

## Commit Strategy

After each module:
```bash
git add src/{MODULE}/
git commit -m "refactor({MODULE}): simplify and add colocated tests

- Remove N lines of dead code
- Extract X shared utilities
- Add tests for Y files
- Fix: {specific issues}"
```

---

## Current Progress

**Status**: In Progress
**Current Module**: config (6/32)
**Modules Completed**: 5/32
**Last Updated**: 2026-01-23

### Completed Modules

1. **types** (2026-01-23)
   - Removed 80 lines of duplicate CSS types (re-exported from css-optimizer/types)
   - Added backwards-compatible export for MiddlewareFunction
   - Created colocated tests for global-guards.ts
   - Files: branded.ts (existing tests), global-guards.ts (new tests)

2. **errors** (2026-01-23)
   - Deleted 275 lines of dead code (compat.ts - unused backwards compatibility shim)
   - Created colocated tests for: error-handlers.ts, agent-errors.ts, build-errors.ts, system-errors.ts
   - Existing tests: veryfront-error.test.ts, error-context.test.ts, error-identifier.test.ts, factory.test.ts

3. **utils** (2026-01-23)
   - Created colocated tests for: id.ts, format-utils.ts, cookie-utils.ts
   - Existing tests: base64url.test.ts, bundle-manifest.test.ts, hash-utils.test.ts, memoize.test.ts, feature-flags.test.ts, route-path-utils.test.ts, lru-wrapper.test.ts, file-discovery.test.ts
   - No dead code found (circuit-breaker is actively used)

4. **platform** (2026-01-23)
   - Extensive existing test coverage (70 test files)
   - Cross-runtime adapter layer with proper abstraction
   - No refactoring needed - module well-architected

5. **cache** (2026-01-23)
   - Created colocated tests for: keys.ts, cache-key-builder.ts
   - Existing tests: backend.test.ts
   - Well-documented key building functions with clear conventions
