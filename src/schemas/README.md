# Schemas Module

This directory contains shared validation schemas used across multiple modules in the Veryfront codebase.

## Architecture

The Veryfront codebase follows a **schema-first approach** where:

1. **`defineSchema` schemas are the single source of truth** for types
2. **TypeScript types are inferred** from schemas using `InferSchema<ReturnType<typeof getSchema>>`
3. **Module-local schemas** live in `{module}/schemas/` directories
4. **Shared schemas** (cross-module) live in `src/schemas/` (this directory)

## Naming Conventions

- **Schema files**: `{name}.schema.ts` (e.g., `config.schema.ts`)
- **Shared schema files**: `common.ts`, `primitives.ts` (no `.schema` suffix since they're collections)
- **Schema getters**: Use `get` + PascalCase (e.g., `getUserSchema`)
- **Schema exports**: Compatibility constants use `lazySchema` (e.g.,
  `export const UserSchema = lazySchema(getUserSchema)`) so importing a module
  does not require a registered `SchemaValidator`
- **Type exports**: Infer types from schema getters (e.g., `type User = InferSchema<ReturnType<typeof getUserSchema>>`)

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
import { CommonSchemas, defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    email: CommonSchemas.email,
    name: v.string().min(1),
    createdAt: v.string().datetime(),
  })
);
export const UserSchema = lazySchema(getUserSchema);

export type User = InferSchema<ReturnType<typeof getUserSchema>>;
```

### 2. Discriminated Union (Event Types)

```typescript
// schemas/events.schema.ts
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getEventSchema = defineSchema((v) =>
  v.discriminatedUnion("type", [
    v.object({
      type: v.literal("user_created"),
      userId: v.string(),
      email: v.string().email(),
    }),
    v.object({
      type: v.literal("user_deleted"),
      userId: v.string(),
    }),
  ])
);
export const EventSchema = lazySchema(getEventSchema);

export type Event = InferSchema<ReturnType<typeof getEventSchema>>;
```

### 3. Composing Schemas

```typescript
// schemas/api.schema.ts
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

const getBaseResponseSchema = defineSchema((v) =>
  v.object({
    success: v.boolean(),
    timestamp: v.string().datetime(),
  })
);

export const getSuccessResponseSchema = defineSchema((v) =>
  getBaseResponseSchema().extend({
    success: v.literal(true),
    data: v.unknown(),
  })
);

export const getErrorResponseSchema = defineSchema((v) =>
  getBaseResponseSchema().extend({
    success: v.literal(false),
    error: v.object({
      message: v.string(),
      code: v.string().optional(),
    }),
  })
);

export const getApiResponseSchema = defineSchema((v) =>
  v.union([
    getSuccessResponseSchema(),
    getErrorResponseSchema(),
  ])
);
export const ApiResponseSchema = lazySchema(getApiResponseSchema);

export type ApiResponse = InferSchema<ReturnType<typeof getApiResponseSchema>>;
```

### 4. Recursive/Lazy Schemas

```typescript
// schemas/tree.schema.ts
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, Schema } from "#veryfront/extensions/schema/index.ts";

export const getTreeNodeSchema = defineSchema((v) => {
  const schema: Schema<{ id: string; children?: TreeNode[] }> = v.lazy(() =>
    v.object({
      id: v.string(),
      children: v.array(schema).optional(),
    })
  );
  return schema;
});
export const TreeNodeSchema = lazySchema(getTreeNodeSchema);

export type TreeNode = InferSchema<ReturnType<typeof getTreeNodeSchema>>;
```

### 5. Using with Runtime Validation

Calling a schema getter directly materializes the schema. Use direct getter
invocation only after application or extension bootstrap has registered a
`SchemaValidator`. Use `lazySchema(getUserSchema)` for module-scope exports.

```typescript
import { getUserSchema } from "./schemas/user.schema.ts";

// This code runs after SchemaValidator registration.
const UserSchema = getUserSchema();

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
    console.error("Validation failed:", result.issues);
    return null;
  }

  return result.data;
}
```

## Migration Guidelines

When converting existing `types.ts` files to schemas:

1. **Create the schema file** in `{module}/schemas/`
2. **Define schemas** using `defineSchema` for each type
3. **Export inferred types** using `InferSchema<ReturnType<typeof getSchema>>`
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
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    email: v.string().email(),
    name: v.string().min(1),
  })
);
export const UserSchema = lazySchema(getUserSchema);

export type User = InferSchema<ReturnType<typeof getUserSchema>>;
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

The `_test-setup.ts` side-effect import registers the test validator before the
schema getter runs, so direct getter invocation is safe in this example.

```typescript
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getUserSchema } from "./user.schema.ts";

const UserSchema = getUserSchema();

describe("UserSchema", () => {
  it("validates correct user data", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      email: "test@example.com",
      name: "John Doe",
    });

    assertEquals(result.success, true);
  });

  it("rejects invalid email", () => {
    const result = UserSchema.safeParse({
      id: "550e8400-e29b-41d4-a716-446655440000",
      email: "not-an-email",
      name: "John Doe",
    });

    assertEquals(result.success, false);
  });
});
```

## References

- [defineSchema Contract](../extensions/schema/schema-validator.ts)
- [TypeScript Handbook - Type Inference](https://www.typescriptlang.org/docs/handbook/type-inference.html)
