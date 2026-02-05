# Schema Consolidation Migration Guide

**Date:** February 5, 2026\
**Status:** Complete (Phase 4)\
**Progress:** 88% (28/43 tasks)

## Overview

This document describes the schema consolidation refactor completed in Phases 1-4, which established a **schema-first development approach** using Zod for runtime validation and TypeScript type inference.

## What Changed

### Before: Dual Maintenance Problem

Previously, types were defined in two places that needed to stay synchronized:

```typescript
// types.ts - Manual TypeScript types
export interface AgentConfig {
  model: string;
  maxSteps?: number;
  // ... more fields
}

// schema.ts - Separate Zod schemas
export const AgentConfigSchema = z.object({
  model: z.string(),
  maxSteps: z.number().positive().optional(),
  // ... more fields - must match types.ts!
});
```

**Problems:**

- Type drift: Changes to one file could be missed in the other
- Maintenance burden: Updates required in multiple locations
- No single source of truth

### After: Schema-First Architecture

Now, Zod schemas ARE the type definitions:

```typescript
// schemas/agent.schema.ts - Single source of truth
export const AgentConfigSchema = z.object({
  model: z.string(),
  maxSteps: z.number().int().positive().optional(),
  // ... more fields
});

// Type is inferred from schema
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

**Benefits:**

- ✅ Single source of truth
- ✅ Runtime validation matches TypeScript types
- ✅ No type drift possible
- ✅ Easier maintenance

## Architecture

### Directory Structure

```
src/
├── schemas/                      # Shared schemas (cross-module)
│   ├── index.ts                  # Barrel export
│   ├── common.ts                 # email, url, uuid, slug, pagination
│   └── primitives.ts             # Reusable base schemas
│
├── {module}/
│   ├── schemas/                  # Module-local schemas
│   │   ├── index.ts              # Barrel export
│   │   └── {name}.schema.ts      # Zod schemas + inferred types
│   ├── types.ts                  # Re-exports + interfaces with methods
│   └── ...                       # Implementation files
```

### types.ts Role

**Important:** `types.ts` files were NOT deleted. They now serve three purposes:

1. **Re-export schema-inferred types** for convenience
2. **Define interfaces with methods** (which Zod cannot represent)
3. **Provide utility functions** for working with types

#### Example: types.ts Pattern

```typescript
// Re-export schema-based types (data structures)
export type { AgentResponse, Message, ToolCall } from "./schemas/index.ts";

// Import for use in interfaces
import type { AgentResponse, Message } from "./schemas/index.ts";

// Keep interfaces with methods as TypeScript
export interface Agent {
  id: string;
  generate(input: { input: string }): Promise<AgentResponse>;
  stream(input: { messages?: Message[] }): Promise<AgentStreamResult>;
}

// Utility functions
export function getTextFromParts(parts: MessagePart[]): string {
  return parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
```

## Modules Converted (Phase 4)

### Successfully Converted

11 modules were converted to schema-first architecture:

| Module         | Key Schemas                                                  | Notes                                           |
| -------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `agent`        | Message, MessagePart, ToolCall, AgentResponse                | Hybrid: kept Agent interface (methods)          |
| `mcp`          | MCPServerConfig, MCPStats                                    | Clean conversion                                |
| `embeddings`   | EmbeddingProviderConfig, EmbeddingRequest, EmbeddingResponse | Clean conversion                                |
| `oauth`        | OAuthProviderConfig, OAuthTokens, OAuthState                 | Clean conversion                                |
| `prompt`       | PromptConfig                                                 | Hybrid: kept Prompt interface (methods)         |
| `provider`     | ProviderConfig, CompletionRequest, CompletionResponse        | Hybrid: kept Provider interface (methods)       |
| `resource`     | CachePolicy, McpConfig                                       | Hybrid: kept ResourceConfig/Resource interfaces |
| `html`         | HTMLGenerationOptions, HydrationData                         | Clean conversion                                |
| `errors`       | ErrorCode                                                    | Special: dual export (const + type)             |
| `studio`       | MessageFromRenderer, MessageFromStudio                       | Discriminated unions                            |
| `repositories` | RepositoryContext, CacheStats                                | Hybrid: kept repository interfaces              |

### Not Converted (By Design)

11 modules were intentionally not converted because they are not suitable for Zod:

**Function-Heavy APIs** (Zod cannot represent function signatures):

- `middleware` - Function-based middleware handlers
- `workflow` - Extensive generics and function properties
- `cache` - Interfaces with methods (get, set, del)
- `data` - Interfaces with methods (getServerData, getStaticPaths)
- `rendering`, `transforms` - Internal pipeline types with functions
- `react` - React types from external libraries

**Low Priority/Deferred:**

- `cli` - CLI args validated by framework
- `routing`, `server` - Complex handler types
- `observability`, `build`, `modules` - Internal configuration

## Migration Patterns

### Pattern 1: Clean Data Structures

**When:** Pure data structures with no methods

```typescript
// schemas/config.schema.ts
export const ServerConfigSchema = z.object({
  port: z.number().int().positive(),
  host: z.string(),
  ssl: z.boolean().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
```

**Usage:**

```typescript
// Validate at runtime
const config = ServerConfigSchema.parse(userInput);

// Type is automatically correct
const port: number = config.port; // ✓ TypeScript knows this is a number
```

### Pattern 2: Discriminated Unions

**When:** Message types or polymorphic data

```typescript
// schemas/message.schema.ts
export const MessageFromRendererSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("appLoaded"),
    url: z.string(),
  }),
  z.object({
    action: z.literal("appUpdated"),
    url: z.string(),
    id: z.string(),
  }),
  // ... more variants
]);

export type MessageFromRenderer = z.infer<typeof MessageFromRendererSchema>;
```

### Pattern 3: Hybrid (Data + Methods)

**When:** Module has both data structures and interfaces with methods

```typescript
// schemas/agent.schema.ts - Data structures as schemas
export const AgentResponseSchema = z.object({
  text: z.string(),
  messages: z.array(MessageSchema),
  status: agentStatusSchema,
});
export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// types.ts - Interfaces with methods stay as TypeScript
import type { AgentResponse } from "./schemas/index.ts";

export interface Agent {
  generate(input: string): Promise<AgentResponse>; // Uses schema type
  stream(input: string): Promise<ReadableStream>; // Method
}
```

### Pattern 4: Enum-Like Constants

**When:** Need both type and runtime value access (like enums)

```typescript
// schemas/error.schema.ts
export const errorCodeSchema = z.enum([
  "CONFIG_ERROR",
  "NETWORK_ERROR",
  // ... more codes
]);

// Const object for runtime value access
export const ErrorCode = {
  CONFIG_ERROR: "CONFIG_ERROR",
  NETWORK_ERROR: "NETWORK_ERROR",
  // ... more codes
} as const;

// Type for inference
export type ErrorCodeType = z.infer<typeof errorCodeSchema>;
```

**Usage:**

```typescript
// Runtime value access (like enum)
throw new Error("Config failed", ErrorCode.CONFIG_ERROR);

// Type annotation
function handleError(code: ErrorCodeType) { ... }
```

### Pattern 5: Recursive Types

**When:** Self-referential structures (trees, nested data)

```typescript
// schemas/navigator.schema.ts
export const NavigatorNodeSchema: z.ZodType<{
  id: string;
  children: unknown[]; // Must use unknown[] for type
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    children: z.array(NavigatorNodeSchema), // Recursive reference
  })
);

export type NavigatorNode = z.infer<typeof NavigatorNodeSchema>;
```

## Import Patterns

### Before

```typescript
// Old scattered imports
import { AgentConfig } from "../types.ts";
import { AgentStreamEventSchema } from "../streaming/stream-events.ts";
import { validateInput } from "../composition/composition.ts";
```

### After

```typescript
// Clean schema imports
import { type AgentConfig, AgentConfigSchema } from "../schemas/index.ts";
import { type AgentStreamEvent, AgentStreamEventSchema } from "../schemas/index.ts";

// Or use barrel export
import {
  type AgentConfig,
  AgentConfigSchema,
  type AgentStreamEvent,
  AgentStreamEventSchema,
} from "../schemas/index.ts";
```

## Validation Examples

### Validating User Input

```typescript
import { AgentConfigSchema } from "./schemas/index.ts";

// With error handling
const result = AgentConfigSchema.safeParse(userInput);
if (!result.success) {
  console.error("Validation errors:", result.error.issues);
  return;
}
const config = result.data; // Fully typed!

// Or throw on error
const config = AgentConfigSchema.parse(userInput);
```

### Partial Validation

```typescript
// Allow partial objects (useful for updates)
const UpdateConfigSchema = AgentConfigSchema.partial();

const updates = UpdateConfigSchema.parse({ maxSteps: 10 });
// Only maxSteps is validated, other fields not required
```

### Runtime Transformation

```typescript
// Coerce string to number
const PortSchema = z.coerce.number().int().positive();

const port = PortSchema.parse("3000"); // Returns number 3000
```

## Testing

All schemas are fully tested:

- **Unit tests:** 16,000+ tests passing
- **Type checking:** Full codebase type-safe
- **E2E tests:** All integration tests passing

## Verification

To verify the refactor:

```bash
# Full verification (format, lint, typecheck, test)
deno task verify

# Quick check (format, lint, typecheck)
deno task verify:quick

# Type checking only
deno task typecheck
```

## Future Work (Phase 5)

Remaining optional cleanup tasks:

1. Consider creating schemas for deferred modules (routing, server) if needed
2. Add runtime validation to more API boundaries
3. Document schema patterns in module READMEs
4. Create schema testing utilities

## Benefits Achieved

✅ **Single source of truth** - Types inferred from schemas\
✅ **Runtime validation** - All schema types validated at runtime\
✅ **Type safety** - No type/validation drift possible\
✅ **Better DX** - Clearer imports, easier to find schemas\
✅ **Maintainability** - One place to update types\
✅ **No breaking changes** - Full backward compatibility

## Key Takeaway

**Use Zod for data, TypeScript for methods.**

This hybrid approach leverages the strengths of both:

- Zod provides runtime validation and type inference for data structures
- TypeScript interfaces define method signatures and complex function types

The result is a more robust, maintainable codebase with both compile-time and runtime type safety.
