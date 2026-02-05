# Schemas Module

This directory contains shared validation schemas used across multiple modules in the veryfront codebase.

## Architecture

The veryfront codebase follows a **schema-first approach** where:

1. **Zod schemas are the single source of truth** for types
2. **TypeScript types are inferred** from schemas using `z.infer<>`
3. **Module-local schemas** live in `{module}/schemas/` directories
4. **Shared schemas** (cross-module) live in `src/schemas/` (this directory)

## Naming Conventions

- **Schema files**: `{name}.schema.ts` (e.g., `config.schema.ts`)
- **Shared schema files**: `common.ts`, `primitives.ts` (no `.schema` suffix since they're collections)
- **Schema exports**: Use PascalCase for schema objects (e.g., `UserSchema`)
- **Type exports**: Infer types from schemas (e.g., `type User = z.infer<typeof UserSchema>`)

## Directory Structure

```
src/
├── schemas/                    # Shared schemas (cross-module)
│   ├── index.ts                # Barrel export
│   ├── common.ts               # Common validators (email, url, pagination, etc.)
│   └── primitives.ts           # Primitive validators (non-empty string, positive int, etc.)
│
├── config/
│   ├── schemas/                # Module-local schemas
│   │   ├── index.ts            # Barrel export
│   │   └── config.schema.ts    # Config-specific schemas
│   └── ...
│
└── [other modules follow same pattern]
```

## When to Use Shared vs Module-Local Schemas

### Use `src/schemas/` (shared) for:

- **Cross-cutting validators** used by 3+ modules
  - Examples: email, URL, UUID, slug validation
  - Pagination patterns
  - Date/time schemas
  - Common primitive types

### Use `{module}/schemas/` (module-local) for:

- **Domain-specific schemas** used primarily within one module
  - Examples: `AgentConfig`, `WorkflowStep`, `CacheKeyContext`
- **Module business logic** types
- **Module-specific enums** and discriminated unions

## Schema Patterns

### 1. Basic Schema with Inferred Type

```typescript
// schemas/user.schema.ts
import { z } from "zod";
import { CommonSchemas } from "#veryfront/schemas";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: CommonSchemas.email,
  name: z.string().min(1),
  createdAt: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;
```

### 2. Discriminated Union (Event Types)

```typescript
// schemas/events.schema.ts
import { z } from "zod";

export const EventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("user_created"),
    userId: z.string(),
    email: z.string().email(),
  }),
  z.object({
    type: z.literal("user_deleted"),
    userId: z.string(),
  }),
]);

export type Event = z.infer<typeof EventSchema>;
```

### 3. Composing Schemas

```typescript
// schemas/api.schema.ts
import { z } from "zod";
import { CommonSchemas } from "#veryfront/schemas";

const BaseResponseSchema = z.object({
  success: z.boolean(),
  timestamp: z.string().datetime(),
});

export const SuccessResponseSchema = BaseResponseSchema.extend({
  success: z.literal(true),
  data: z.unknown(),
});

export const ErrorResponseSchema = BaseResponseSchema.extend({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    code: z.string().optional(),
  }),
});

export const ApiResponseSchema = z.union([
  SuccessResponseSchema,
  ErrorResponseSchema,
]);

export type ApiResponse = z.infer<typeof ApiResponseSchema>;
```

### 4. Recursive/Lazy Schemas

```typescript
// schemas/tree.schema.ts
import { z } from "zod";

export const TreeNodeSchema: z.ZodType<{
  id: string;
  children?: TreeNode[];
}> = z.lazy(() =>
  z.object({
    id: z.string(),
    children: z.array(TreeNodeSchema).optional(),
  })
);

export type TreeNode = z.infer<typeof TreeNodeSchema>;
```

### 5. Using with Runtime Validation

```typescript
import { UserSchema } from "./schemas/user.schema.ts";

function createUser(data: unknown) {
  // Runtime validation
  const user = UserSchema.parse(data);

  // TypeScript knows user is of type User here
  return user;
}

// Or for safer error handling
function createUserSafe(data: unknown) {
  const result = UserSchema.safeParse(data);

  if (!result.success) {
    console.error("Validation failed:", result.error);
    return null;
  }

  return result.data;
}
```

## Migration Guidelines

When converting existing `types.ts` files to schemas:

1. **Create the schema file** in `{module}/schemas/`
2. **Define Zod schemas** for each type
3. **Export inferred types** using `z.infer<>`
4. **Update imports** throughout the module to use the schemas
5. **Delete old `types.ts`** file (no legacy cruft)
6. **Run `deno task verify`** to ensure everything works

### Before (Old Pattern)

```typescript
// types.ts
export interface User {
  id: string;
  email: string;
  name: string;
}
```

### After (New Pattern)

```typescript
// schemas/user.schema.ts
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(1),
});

export type User = z.infer<typeof UserSchema>;
```

## Benefits

1. **Single Source of Truth**: Schema IS the type definition
2. **Runtime Safety**: Validate data at boundaries
3. **Type Safety**: TypeScript types derived from runtime validation
4. **Consistency**: Same validation logic everywhere
5. **Discoverability**: Clear location for all schemas
6. **Maintainability**: Change schema once, type updates automatically
7. **Documentation**: Schemas serve as living documentation

## Testing Schemas

```typescript
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect";
import { UserSchema } from "./user.schema.ts";

describe("UserSchema", () => {
  it("validates correct user data", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      email: "test@example.com",
      name: "John Doe",
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      email: "not-an-email",
      name: "John Doe",
    });

    expect(result.success).toBe(false);
  });
});
```

## References

- [Zod Documentation](https://zod.dev/)
- [TypeScript Handbook - Type Inference](https://www.typescriptlang.org/docs/handbook/type-inference.html)
