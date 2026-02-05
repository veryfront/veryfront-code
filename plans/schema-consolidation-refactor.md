# Schema Consolidation Refactoring Plan

**Created:** 2026-02-05
**Status:** In Progress (37% complete)
**Last Updated:** 2026-02-05

---

## Problem Statement

The veryfront-code codebase has **inconsistent schema management** across its 35 modules:

### Current Issues

1. **Type Duplication**: Types are manually defined in `types.ts` files AND has Zod schemas in `schema.ts` files. When one changes, the other can drift out of sync.
   - Example: `src/config/types.ts` has 300+ lines of manual TypeScript interfaces
   - Example: `src/config/schema.ts` has equivalent Zod schemas
   - These are maintained separately, creating maintenance burden and potential inconsistencies

2. **Scattered Schema Locations**: Zod schemas are defined inline in implementation files, making them hard to find and reuse.
   - `src/cache/cache-key-builder.ts` - `CacheKeyContextSchema` buried in implementation
   - `src/agent/streaming/stream-events.ts` - `AgentStreamEventSchema` mixed with emitter logic
   - `src/server/services/rsc/endpoints/action-parser.ts` - Dynamic import with inline schema

3. **Inconsistent Patterns**: Different modules use different approaches:
   - **Good pattern** (to emulate): `src/platform/adapters/veryfront-api-client/schemas.ts` - schemas with inferred types
   - **Problematic pattern**: `src/config/` - separate types.ts and schema.ts that must stay synchronized
   - **No schemas at all**: Many modules have only manual types with no runtime validation

4. **No Shared Schema Location**: Common patterns like email, URL, pagination, date range are redefined or missing across modules.

### Impact

- **Runtime/Compile-time Mismatch**: TypeScript types can diverge from Zod runtime validation
- **Maintenance Burden**: Changes require updates in multiple locations
- **Discovery Difficulty**: Developers can't easily find what schemas exist
- **Inconsistent Validation**: Some code paths validate, others don't

---

## Approach

### Target Architecture

```
src/
├── schemas/                           # Shared schemas (cross-module)
│   ├── index.ts                       # Barrel export
│   ├── common.ts                      # email, url, uuid, slug, pagination, dates
│   └── primitives.ts                  # Non-empty string, positive int, etc.
│
├── config/
│   ├── schemas/                       # Module-local schemas
│   │   ├── index.ts                   # Barrel export
│   │   └── config.schema.ts           # veryfrontConfigSchema + inferred types
│   └── ...                            # No types.ts - schemas ARE the types
│
├── agent/
│   ├── schemas/
│   │   ├── index.ts
│   │   ├── stream-events.schema.ts    # AgentStreamEventSchema + inferred type
│   │   └── config.schema.ts           # AgentConfig validation
│   └── ...
│
└── [other modules follow same pattern]
```

### Key Principles

1. **Single Source of Truth**: Zod schema IS the type definition
   ```typescript
   // schemas/config.schema.ts
   export const VeryfrontConfigSchema = z.object({ ... });
   export type VeryfrontConfig = z.infer<typeof VeryfrontConfigSchema>;
   ```

2. **Module-Local `schemas/` Folders**: Each module owns its schemas
   - Easy discovery: `src/{module}/schemas/`
   - Clear ownership and cohesion
   - Import as `import { SomeSchema } from './schemas'`

3. **Shared `src/schemas/`**: Cross-cutting schemas used by multiple modules
   - Common validators (email, URL, UUID, slug)
   - Pagination patterns
   - Date/time schemas
   - Import as `import { CommonSchemas } from '#veryfront/schemas'`

4. **Naming Convention**: `{name}.schema.ts` for schema files
   - Clear distinction from implementation files
   - Predictable file discovery

5. **Clean Break**: Delete old `types.ts` files, update all imports directly
   - No re-exports or deprecation shims
   - Update all import statements in one pass per module
   - Simpler codebase, no legacy cruft

---

## Module Inventory & Schema Locations

### Modules with Existing Schema Files (Need Refactoring)

| Module | Current Location | Schemas | Status |
|--------|-----------------|---------|--------|
| `config` | `schema.ts` + `types.ts` | `veryfrontConfigSchema` | Types duplicated, need consolidation |
| `issues` | `schema.ts` + `types.ts` | `issueMetadataSchema`, `createIssueSchema`, `updateIssueSchema`, `listIssuesSchema` | Partial inference, some duplication |
| `security/input-validation` | `schemas.ts` | `CommonSchemas` (email, uuid, slug, url, pagination, etc.) | Good pattern, move to `src/schemas/` |
| `platform/adapters/veryfront-api-client` | `schemas.ts` | `ProjectSchema`, `ProjectFileSchema`, `PageInfoSchema`, `EnvironmentSchema`, etc. | **Exemplary** - already uses inferred types |
| `platform/adapters/fs/github` | `schemas.ts` | `GitHubTreeEntrySchema`, `GitHubContentItemSchema`, etc. | **Exemplary** - already uses inferred types |

### Modules with Inline Schemas (Need Extraction)

| Module | File | Inline Schema | Action |
|--------|------|--------------|--------|
| `agent` | `streaming/stream-events.ts` | `AgentStreamEventSchema` | Extract to `agent/schemas/stream-events.schema.ts` |
| `agent` | `composition/composition.ts` | Tool inputSchema (z.object) | Extract to `agent/schemas/tool.schema.ts` |
| `cache` | `cache-key-builder.ts` | `CacheKeyContextSchema` | Extract to `cache/schemas/cache-key.schema.ts` |
| `server` | `services/rsc/endpoints/action-parser.ts` | Payload schema (dynamic import) | Extract to `server/schemas/action.schema.ts` |
| `platform` | `adapters/fs/veryfront/proxy-manager.ts` | `GetAdapterParamsSchema` | Move to `platform/adapters/fs/veryfront/schemas/` |
| `routing` | `api/openapi/mcp-tools.ts` | Dynamic z.object construction | Keep inline (dynamic by design) |

### Modules with types.ts but No Schemas (Need Schema Creation)

| Module | Has types.ts | Priority | Notes |
|--------|-------------|----------|-------|
| `agent` | Yes (extensive) | High | Core module, runtime validation valuable |
| `cache` | Yes | Medium | Partial schemas exist inline |
| `cli` | Yes (multiple) | Low | CLI args, less runtime validation need |
| `middleware` | Yes (multiple) | Medium | Request/response types |
| `workflow` | Yes | Medium | Workflow definitions |
| `rendering` | Yes (multiple) | Low | Internal types |
| `routing` | Yes (multiple) | Medium | Route definitions |
| `observability` | Yes | Low | Metrics/tracing configs |
| `transforms` | Yes | Low | Internal pipeline types |
| `mcp` | Yes | Medium | Protocol types |
| `tool` | Yes | High | Tool definitions need validation |
| `oauth` | Yes | Medium | Auth types |
| `server` | Yes (multiple) | Medium | Handler types |
| `build` | Yes | Low | Build config types |
| `data` | Yes | Low | Data layer types |
| `embeddings` | Yes | Medium | Vector types |
| `html` | Yes | Low | HTML generation types |
| `modules` | Yes | Low | Module loader types |
| `prompt` | Yes | Medium | Prompt templates |
| `provider` | Yes | Medium | AI provider types |
| `react` | Yes | Low | React compat types |
| `repositories` | Yes | Low | Repository patterns |
| `resource` | Yes | Low | Resource types |
| `studio` | Yes | Low | Studio integration |

---

## Example Refactoring: `src/agent` Module

### Before (Current State)

```
src/agent/
├── types.ts                          # 150+ lines of manual TypeScript interfaces
├── streaming/
│   └── stream-events.ts              # AgentStreamEventSchema inline with emitter
├── composition/
│   └── composition.ts                # Tool schema inline
└── ...
```

**`types.ts` (excerpt):**
```typescript
export type AgentStatus = "idle" | "thinking" | "tool_execution" | "streaming" | "completed" | "error";

export interface AgentConfig {
  id?: string;
  model: ModelString;
  system: string | (() => string) | (() => Promise<string>);
  tools?: true | Record<string, Tool | boolean>;
  maxSteps?: number;
  // ... 20+ more fields manually typed
}
```

**`streaming/stream-events.ts` (excerpt):**
```typescript
import { z } from "zod";

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("content"), content: z.string() }),
  z.object({ type: z.literal("tool_call_start"), toolCall: z.object({ id: z.string(), name: z.string() }) }),
  // ... more variants
]);

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;

// Emitter implementation follows in same file...
```

### After (Refactored)

```
src/agent/
├── schemas/
│   ├── index.ts                      # Barrel export
│   ├── config.schema.ts              # AgentConfig schema + inferred type
│   ├── stream-events.schema.ts       # Stream event schemas + inferred types
│   ├── message.schema.ts             # Message, MessagePart schemas
│   └── tool-call.schema.ts           # ToolCall, ToolCallPart schemas
├── streaming/
│   └── stream-events.ts              # Only emitter logic, imports schema
└── ...
```

> **Note:** `types.ts` is deleted entirely - schemas ARE the types.

**`schemas/index.ts`:**
```typescript
// Agent module schemas - single source of truth for types
export * from './config.schema.ts';
export * from './stream-events.schema.ts';
export * from './message.schema.ts';
export * from './tool-call.schema.ts';
```

**`schemas/config.schema.ts`:**
```typescript
import { z } from "zod";

export const AgentStatusSchema = z.enum([
  "idle", "thinking", "tool_execution", "streaming", "completed", "error"
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const MemoryConfigSchema = z.object({
  type: z.enum(["conversation", "buffer", "summary", "redis"]),
  maxTokens: z.number().positive().optional(),
  maxMessages: z.number().positive().optional(),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const EdgeConfigSchema = z.object({
  enabled: z.boolean(),
  maxSteps: z.number().positive().optional(),
  timeoutMs: z.number().positive().optional(),
  streaming: z.boolean().optional(),
});
export type EdgeConfig = z.infer<typeof EdgeConfigSchema>;

export const AgentConfigSchema = z.object({
  id: z.string().optional(),
  model: z.string(), // ModelString
  system: z.union([z.string(), z.function()]),
  tools: z.union([z.literal(true), z.record(z.unknown())]).optional(),
  maxSteps: z.number().positive().optional(),
  streaming: z.boolean().optional(),
  memory: MemoryConfigSchema.optional(),
  edge: EdgeConfigSchema.optional(),
  multimodal: z.object({
    vision: z.boolean().optional(),
    audio: z.boolean().optional(),
  }).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

**`schemas/stream-events.schema.ts`:**
```typescript
import { z } from "zod";

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("content"),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_start"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
    }),
  }),
  z.object({
    type: z.literal("tool_call_delta"),
    id: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal("tool_call_complete"),
    toolCall: z.object({
      id: z.string(),
      name: z.string(),
      arguments: z.string(),
    }),
  }),
  z.object({
    type: z.literal("finish"),
    finishReason: z.string().nullable(),
  }),
  z.object({
    type: z.literal("usage"),
    usage: z.object({
      promptTokens: z.number().optional(),
      completionTokens: z.number().optional(),
      totalTokens: z.number().optional(),
    }),
  }),
]);

export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;
```

**`streaming/stream-events.ts` (cleaned up):**
```typescript
import { AgentStreamEventSchema, type AgentStreamEvent } from '../schemas';

// Only emitter implementation - no schema definition here
export class StreamEventEmitter {
  private encoder = new TextEncoder();

  constructor(private controller: ReadableStreamDefaultController) {}

  emit(event: Record<string, unknown>): void {
    this.controller.enqueue(this.encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  // ... rest of emitter methods
}
```

---

## Phase Weights

| Phase | Weight | Description |
|-------|--------|-------------|
| **Discover** | 15% | Inventory complete - see above tables |
| **Define** | 20% | Establish patterns, create `src/schemas/`, document conventions |
| **Develop** | 50% | Execute refactoring per module, tests pass throughout |
| **Deliver** | 15% | Validate all imports work, update documentation |

---

## Execution Strategy

### Phase 1: Foundation (Define - 20%)

1. **Create `src/schemas/` shared schemas directory**
   - Move `CommonSchemas` from `src/security/input-validation/schemas.ts`
   - Add `primitives.ts` for reusable base schemas
   - Create barrel `index.ts`

2. **Document conventions in `src/schemas/README.md`**
   - Naming: `{name}.schema.ts`
   - Type inference pattern
   - When to use shared vs module-local schemas

### Phase 2: Exemplar Modules (Develop - First 15%)

Refactor these modules first as templates:

1. **`src/agent/`** (High value, demonstrates complex patterns)
2. **`src/issues/`** (Already has schemas, needs consolidation)
3. **`src/cache/`** (Small, has inline schema)

### Phase 3: Systematic Refactoring (Develop - Remaining 35%)

Apply pattern to remaining modules in priority order:
1. `config` (complex, high-impact)
2. `tool` (runtime validation critical)
3. `mcp` (protocol types)
4. `workflow` (execution validation)
5. Remaining modules...

### Phase 4: Validation & Cleanup (Deliver - 15%)

1. Verify all tests pass
2. Remove deprecated type files (optional, can defer)
3. Update import map if needed
4. Document migration in CHANGELOG

---

## Success Criteria

- [ ] All Zod schemas live in `schemas/` folders (module-local or shared)
- [ ] Types are inferred from schemas using `z.infer<>`
- [ ] Zero runtime regressions (all existing validation still works)
- [ ] All tests pass (`deno task verify`)
- [ ] Consistent naming convention (`*.schema.ts`)
- [ ] Shared schemas in `src/schemas/` for cross-module use
- [ ] All old `types.ts` files deleted (no legacy cruft)
- [ ] All imports updated to use `./schemas` directly

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing imports | Update all imports in same commit, run `deno task verify` |
| Schema/type drift during migration | Refactor one module at a time, verify after each |
| Complex nested types hard to express in Zod | Use `z.custom<T>()` or `z.lazy()` for complex recursive types |
| Large `types.ts` files daunting to convert | Prioritize high-value schemas, convert incrementally within module |

---

## Task List

> **Acceptance Criteria:** `deno task verify` must pass after completing each task.
> Do not proceed to the next task until verification passes.

### Phase 1: Foundation

- [x] Create `src/schemas/` directory
  - [x] ✓ `deno task verify` passes
- [x] Create `src/schemas/index.ts` barrel export
  - [x] ✓ `deno task verify` passes
- [x] Create `src/schemas/common.ts` (move from `security/input-validation/schemas.ts`)
  - [x] ✓ `deno task verify` passes
- [x] Create `src/schemas/primitives.ts` (non-empty string, positive int, etc.)
  - [x] ✓ `deno task verify` passes
- [x] Add `#veryfront/schemas` to import map in `deno.json`
  - [x] ✓ `deno task verify` passes
- [x] Create `src/schemas/README.md` documenting conventions
  - [x] ✓ `deno task verify` passes

### Phase 2: Modules with Existing Schemas (Consolidate)

#### High Priority
- [x] `src/config/` - Consolidate `schema.ts` + `types.ts` → `schemas/`
  - [x] ✓ `deno task verify` passes
- [x] `src/issues/` - Consolidate `schema.ts` + `types.ts` → `schemas/`
  - [x] ✓ `deno task verify` passes

#### Already Good (Verify & Minor Adjustments)
- [x] `src/platform/adapters/veryfront-api-client/` - Already exemplary, move to `schemas/` subfolder
  - [x] ✓ `deno task verify` passes
- [x] `src/platform/adapters/fs/github/` - Already exemplary, move to `schemas/` subfolder
  - [x] ✓ `deno task verify` passes
- [x] `src/security/input-validation/` - Move common schemas to `src/schemas/`, keep module-specific
  - [x] ✓ `deno task verify` passes

### Phase 3: Modules with Inline Schemas (Extract)

- [x] `src/agent/streaming/stream-events.ts` → `src/agent/schemas/stream-events.schema.ts`
  - [x] ✓ `deno task verify` passes
- [x] `src/agent/composition/composition.ts` → `src/agent/schemas/tool.schema.ts`
  - [x] ✓ `deno task verify` passes
- [x] `src/cache/cache-key-builder.ts` → `src/cache/schemas/cache-key.schema.ts`
  - [x] ✓ `deno task verify` passes
- [x] `src/server/services/rsc/endpoints/action-parser.ts` → `src/server/schemas/action.schema.ts`
  - [x] ✓ `deno task verify` passes
- [x] `src/platform/adapters/fs/veryfront/proxy-manager.ts` → `src/platform/adapters/fs/veryfront/schemas/`
  - [x] ✓ `deno task verify` passes

### Phase 4: Modules with types.ts (Create Schemas)

#### High Priority
- [ ] `src/agent/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/tool/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes

#### Medium Priority
- [ ] `src/cache/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/middleware/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/workflow/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/routing/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/mcp/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/oauth/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/server/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/embeddings/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/prompt/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/provider/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes

#### Low Priority (Internal Types)
- [ ] `src/cli/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/rendering/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/observability/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/transforms/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/build/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/data/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/html/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/modules/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/react/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/repositories/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/resource/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes
- [ ] `src/studio/` - Create schemas from `types.ts`
  - [ ] ✓ `deno task verify` passes

### Phase 5: Final Validation & Cleanup

- [ ] Delete all old `types.ts` files that have been replaced by schemas
  - [ ] ✓ `deno task verify` passes
- [ ] Update CHANGELOG with migration notes
- [ ] Final review: no duplicate type definitions remain

---

## Progress Tracking

| Phase | Tasks | Completed | Progress |
|-------|-------|-----------|----------|
| Foundation | 6 | 6 | 100% ✓ |
| Existing Schemas | 5 | 5 | 100% ✓ |
| Inline Schemas | 5 | 5 | 100% ✓ |
| Create Schemas (High) | 2 | 0 | 0% |
| Create Schemas (Medium) | 10 | 0 | 0% |
| Create Schemas (Low) | 12 | 0 | 0% |
| Final Cleanup | 3 | 0 | 0% |
| **Total** | **43** | **16** | **37%** |

> **Note:** Each task has a nested `deno task verify` checkpoint.
> A task is only complete when both the work AND verification pass.
> No backward compatibility - old `types.ts` files are deleted, imports updated directly.

---

## Next Steps

1. Review this plan
2. Adjust if needed
3. Execute when ready
