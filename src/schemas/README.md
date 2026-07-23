# Shared schema architecture

Veryfront declares validation schemas through the `SchemaValidator` extension contract. Core
modules do not import a validator implementation such as Zod. The application bootstrap registers
the implementation before a schema is first used.

This directory owns only cross-cutting schemas. A schema used by one domain belongs beside that
domain, usually in `src/<module>/schemas/`.

## Lazy schema construction

`defineSchema(factory)` returns a memoized getter. Creating the getter has no extension dependency.
The first call resolves the registered validator, builds the schema, and caches it. A failed build is
not cached, so initialization can be retried after the extension is registered.

Use `lazySchema(getSchema)` when callers need a schema value at module scope. Do not call a schema
getter while a public module is loading. An eager call can make importing that module depend on
bootstrap order. Lazy aliases are resolved to their backing schema, and recursive alias chains fail
with a `TypeError` instead of overflowing the call stack.

```ts
import { defineSchema, type InferSchema, lazySchema } from "veryfront/schemas";

export const getUserSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string().min(1).max(100),
  })
);

export const UserSchema = lazySchema(getUserSchema);
export type User = InferSchema<ReturnType<typeof getUserSchema>>;
```

The getter is the schema definition and the inferred type is its static contract. The lazy value is
only a compatibility surface for consumers that require a `Schema<T>` value.

## Schema ownership

Place a schema in this directory when several modules share the same meaning and validation rules.
Examples include UUIDs, URLs, timestamps, pagination, JSON values, and filesystem path primitives.

Keep domain concepts in their owning module. Agent, workflow, run, task, schedule, and transport
schemas must not become generic aliases in this directory. This keeps concept names and runtime
behavior aligned.

## Boundary guarantees

Shared schemas reject values that cannot be processed safely:

- Pagination accepts positive safe integers or canonical positive decimal strings in the safe
  integer range. It does not coerce booleans, arrays, padded strings, or signed strings.
- File paths are non-empty, contain no NUL bytes, and contain at most 4,096 characters.
- Absolute paths support POSIX, Windows drive-letter, and UNC forms.
- JSON values must be finite, acyclic, at most 100 levels deep, and at most 100,000 nodes.
- Timestamps, semantic versions, passwords, URLs, emails, slugs, and pagination sort fields have
  explicit length limits.

The JSON structure limits do not cap total serialized bytes or domain-specific string lengths.
Callers that accept untrusted bodies must also enforce a transport byte limit and bound strings for
their domain.

The path primitives validate representation only. They do not authorize a path or prove that it is
contained by a project root. Filesystem boundaries must still canonicalize the path and enforce
containment before access.

The pagination `sort` field is also representation-only. Data adapters must allowlist supported
field names before using it to construct a query.

`safeParse()` returns a validation result even when hostile input or a custom refinement throws. It
does not expose the thrown value. `parse()` retains exception-based behavior for callers that choose
it explicitly.

## Extension-neutral composition

Compose schemas only through methods in the `Schema<T>` and `SchemaValidator` contracts. Do not
reach into validator-specific fields from core code. JSON Schema conversion also routes through the
registered contract so tool and MCP consumers see the same schema definition.

Recursive schemas must include an explicit resource policy. The shared JSON value schema performs
an iterative structure check before recursive validation, which prevents cycles and excessive depth
from overflowing the call stack.
