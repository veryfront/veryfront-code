---
name: vf-error-handling
description: Use when creating new errors, migrating error classes to registry, catching/handling errors, or working with the VeryfrontError system
---

# Veryfront Error Handling

## Overview

Veryfront uses a centralized error registry with slug-based identification. All errors extend `VeryfrontError` and are created via `defineError()`.

**Core principle:** Never throw raw `Error`. Use the registry. Never identify errors by class name. Use slugs.

## Error Registry Pattern

### Defining New Errors

```typescript
// In src/errors/error-registry.ts
import { defineError } from "./define-error.ts";

export const MY_NEW_ERROR = defineError(
  "my-new-error",        // slug (kebab-case, unique)
  "RUNTIME",             // category: CONFIG | BUILD | RUNTIME | ROUTE | MODULE | SERVER | BOUNDARY | DEV | DEPLOY | AGENT | GENERAL
  500,                   // default HTTP status
  "Something went wrong", // title (human-readable)
  "Try doing X instead"  // suggestion (actionable fix)
);
```

### Throwing Errors

```typescript
import { MY_NEW_ERROR } from "#veryfront/errors";

throw MY_NEW_ERROR.create({
  detail: "Specific description of what happened",
  context: { key: "value", relevantData: data },
  cause: originalError,  // optional: chain the original error
});
```

### Catching Errors

```typescript
import { VeryfrontError } from "#veryfront/errors";

try {
  riskyOperation();
} catch (error) {
  if (error instanceof VeryfrontError && error.slug === "my-new-error") {
    // Handle specific error
    console.log(error.context.relevantData);
  }
  throw error; // Re-throw unknown errors
}
```

## Migrating Class-Based Errors to Registry

When replacing `class FooError extends Error`:

### Step 1: Define in Registry

```typescript
// src/errors/error-registry.ts
export const FOO_ERROR = defineError(
  "foo-error",
  "RUNTIME",
  500,
  "Foo operation failed",
  "Check the foo configuration"
);
```

### Step 2: Update Usage Sites

```typescript
// Before
throw new FooError("something failed", { details: data });

// After
throw FOO_ERROR.create({
  detail: "something failed",
  context: { details: data },
});
```

### Step 3: Update Error Checks

```typescript
// Before
if (error instanceof FooError) { ... }

// After
if (error instanceof VeryfrontError && error.slug === "foo-error") { ... }
```

### Step 4: Update Export Chains

Follow the re-export chain and update each level:
1. `src/module/types.ts` — remove class, add registry import if needed
2. `src/module/index.ts` — change export
3. Parent `index.ts` files up the chain
4. `src/module/index.test.ts` — change `typeof X === "function"` to `typeof X === "object"`

### Step 5: Remove Old Class

Delete the old error class file entirely. No backwards-compatibility shims.

## VeryfrontError Fields

| Field | Type | Purpose |
|-------|------|---------|
| `slug` | `string` | Unique identifier (kebab-case) |
| `category` | `ErrorCategory` | Error domain |
| `status` | `number` | HTTP status code |
| `title` | `string` | Human-readable title |
| `suggestion` | `string` | Actionable fix |
| `detail` | `string` | Specific instance description |
| `context` | `Record<string, unknown>` | Structured metadata |
| `cause` | `Error` | Original error (chain) |
| `instance` | `string` | Request/instance identifier |

## RFC 9457 Support

```typescript
// Convert to Problem Details format for HTTP APIs
const problemDetails = error.toRFC9457();
// Returns: { type, title, status, detail, instance, ...extensions }
```

## Intentionally Local Errors

Five errors remain as local classes by design (not in registry):
- `SemaphoreTimeoutError`
- `TransformTreeTimeoutError`
- `NotSupportedError`
- `TimeoutError`
- `StreamTimeoutError`

Do not migrate these to the registry.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| `throw new Error("msg")` | Use registry: `MY_ERROR.create({ detail: "msg" })` |
| `instanceof FooError` | `instanceof VeryfrontError && error.slug === "foo-error"` |
| Storing data in `error.message` | Use `error.detail` and `error.context` |
| Forgetting to update index.test.ts | Change function→object type check |
| Creating error class in module | Define in `src/errors/error-registry.ts` |
