# Schemas module

This directory contains shared validation schemas used across multiple modules in the veryfront codebase.

## Architecture

The veryfront codebase follows a **schema-first approach** where:

1. **`defineSchema` schemas are the single source of truth** for types
2. **TypeScript types are inferred** from schemas using `InferSchema<ReturnType<typeof getSchema>>`
3. **Module-local schemas** live in `{module}/schemas/` directories
4. **Shared schemas** (cross-module) live in `src/schemas/` (this directory)

## Naming conventions

- **Schema files**: `{name}.schema.ts` (e.g., `config.schema.ts`)
- **Shared schema files**: `common.ts`, `primitives.ts` (no `.schema` suffix since they're collections)
- **Schema getters**: Use `get` + PascalCase (e.g., `getUserSchema`)
- **Schema exports**: Backward-compat constant (e.g., `export const UserSchema = getUserSchema()`)
- **Type exports**: Infer types from schema getters (e.g., `type User = InferSchema<ReturnType<typeof getUserSchema>>`)

## Directory structure

```
src/
├── schemas/                    # Shared schemas (cross-module)
│   ├── index.ts                # Barrel export
│   ├── common.ts               # Common validators (email, url, pagination, etc.)
│   ├── define.ts               # Lazy, memoized schema factories
│   ├── json-schema.ts          # Adapter-neutral JSON Schema helpers
│   ├── json-value.ts           # Defensive JSON value validation
│   ├── lazy.ts                 # Import-safe schema facade
│   ├── primitives.ts           # Primitive validators
│   └── *.test.ts               # Colocated behavior and regression tests
│
├── config/
│   ├── schemas/                # Module-local schemas
│   │   ├── index.ts            # Barrel export
│   │   └── config.schema.ts    # Config-specific schemas
│   └── ...
│
└── [other modules follow same pattern]
```

## Shared schema constraints

| Schema        | Accepted input and limits                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email         | Valid email string, at most 255 characters                                                                                                                                                                                                                                                             |
| Slug          | 1 to 100 lowercase ASCII letters, digits, or hyphens                                                                                                                                                                                                                                                   |
| URL           | Valid URL string, at most 2,048 characters                                                                                                                                                                                                                                                             |
| Phone number  | E.164 digits with an optional leading `+`                                                                                                                                                                                                                                                              |
| Pagination    | `page` and `limit` accept numbers or decimal digit strings of at most 16 characters. `page` is a positive safe integer. `limit` is 1 to 100. Defaults are 1 and 10.                                                                                                                                    |
| File path     | Non-empty, no null bytes, at most 4,096 characters                                                                                                                                                                                                                                                     |
| Absolute path | Filesystem-rooted, no null bytes, at most 4,096 characters                                                                                                                                                                                                                                             |
| JSON value    | Data-only JSON with at most 128 levels, 100,000 nodes, and 4 MiB serialized size. A string is at most 1 MiB and an object key is at most 16 KiB in UTF-8. Cycles, accessors, symbol keys, non-enumerable properties, and plain-object prototypes other than `Object.prototype` or `null` are rejected. |

Raw JSON Schema compilation and adapter-generated JSON Schema documents use
the same bounded, data-only snapshot. Only that canonical snapshot crosses the
helper boundary, so later reads cannot observe different Proxy values. Invalid
adapter results fail with a `TypeError`.

## JSON Schema conversion

The built-in adapter preserves these representable constraints:

- Integer, inclusive range, and exclusive range checks
- String and array length checks
- Regular expressions without flags
- Email, URI, UUID, and date-time formats
- Literal defaults, including defaults on union schemas
- Optional, nullable, object, array, tuple, record, enum, and union structure

Dynamic default callbacks are not executed during conversion and do not appear
in the generated document. Runtime transforms, arbitrary refinements, and
regular-expression flags have no exact JSON Schema equivalent and are omitted.
Recursive lazy cycles are cut off with an unconstrained schema instead of
emitting `$ref`. JavaScript-only values such as `bigint`, `Date`, functions,
and class instances also have no faithful JSON representation and should not
be exposed as JSON tool inputs. Runtime validation remains authoritative for
those constraints.
Conversion stops with a clear error above 128 active schema levels or 100,000
visited schema nodes instead of exhausting the call stack or allocating an
unbounded document.

## When to use shared vs module-local schemas

### Use `src/schemas/` (shared) for

- **Cross-cutting validators** used by 3+ modules
  - Examples: email, URL, UUID, slug validation
  - Pagination patterns
  - Date/time schemas
  - Common primitive types

### Use `{module}/schemas/` (module-local) for

- **Domain-specific schemas** used primarily within one module
  - Examples: `AgentConfig`, `WorkflowStep`, `CacheKeyContext`
- **Module business logic** types
- **Module-specific enums** and discriminated unions

## Schema patterns

### 1. Basic schema with inferred type

```typescript
// schemas/user.schema.ts
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import { CommonSchemas } from "#veryfront/schemas";

export const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    email: CommonSchemas.email,
    name: v.string().min(1),
    createdAt: v.string().datetime(),
  })
);
export const UserSchema = getUserSchema();

export type User = InferSchema<ReturnType<typeof getUserSchema>>;
```

### 2. Discriminated union (event types)

```typescript
// schemas/events.schema.ts
import { defineSchema } from "#veryfront/schemas/index.ts";
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
export const EventSchema = getEventSchema();

export type Event = InferSchema<ReturnType<typeof getEventSchema>>;
```

### 3. Composing schemas

```typescript
// schemas/api.schema.ts
import { defineSchema } from "#veryfront/schemas/index.ts";
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
export const ApiResponseSchema = getApiResponseSchema();

export type ApiResponse = InferSchema<ReturnType<typeof getApiResponseSchema>>;
```

### 4. Recursive and lazy schemas

```typescript
// schemas/tree.schema.ts
import { defineSchema } from "#veryfront/schemas/index.ts";
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
export const TreeNodeSchema = getTreeNodeSchema();

export type TreeNode = InferSchema<ReturnType<typeof getTreeNodeSchema>>;
```

### 5. Runtime validation

```typescript
import { getUserSchema } from "./schemas/user.schema.ts";

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

## Migration guidelines

When converting existing `types.ts` files to schemas:

1. **Create the schema file** in `{module}/schemas/`
2. **Define schemas** using `defineSchema` for each type
3. **Export inferred types** using `InferSchema<ReturnType<typeof getSchema>>`
4. **Update imports** throughout the module to use the schemas
5. **Delete old `types.ts`** file (no legacy cruft)
6. **Run `deno task verify`** to ensure everything works

### Before (old pattern)

```typescript
// types.ts
export interface User {
  id: string;
  email: string;
  name: string;
}
```

### After (new pattern)

```typescript
// schemas/user.schema.ts
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    email: v.string().email(),
    name: v.string().min(1),
  })
);
export const UserSchema = getUserSchema();

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

## Testing schemas

```typescript
import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect";
import { getUserSchema } from "./user.schema.ts";

const UserSchema = getUserSchema();

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

- [defineSchema Contract](../extensions/schema/schema-validator.ts)
- [TypeScript Handbook - Type Inference](https://www.typescriptlang.org/docs/handbook/type-inference.html)
