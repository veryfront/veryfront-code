# Schema validation runs against pristine built-ins

Status: accepted (veryfront/veryfront-issue-inbox#2147)

## Context

Task modules run in the runtime's shared realm. A module can replace a built-in, such as
`Array.prototype.map`, while it is discovered. veryfront-code#4701 hardened the runtime's own
schema code: identity, canonical serialization, JSON Pointer escaping and error formatting
capture the built-ins they need at module load.

The registered validator adapter (`extensions/ext-schema-zod`) and zod itself still call mutable
built-ins inside `safeParse` and inside compiled JSON Schema validators. With a replaced built-in,
input validation threw. The run failed with a generic task error instead of
`INPUT_VALIDATION_FAILED` and structured errors.

## Options

1. Evaluate task modules in a separate realm or worker. Deno has no `ShadowRealm`. A worker
   would need every schema, including zod schemas with closures and refinements, to cross a
   structured-clone boundary, and would move task execution out of the current process model.
2. Rewrite adapter code against captured built-ins. The adapter can do this, but zod and the
   JSON Schema compiler are third-party libraries, so their calls stay exposed.
3. Snapshot the built-ins at module load and swap them back in for the synchronous part of each
   validator call.

## Decision

Option 3. `src/schemas/pristine-intrinsics.ts` snapshots the own properties of the built-in
constructors and prototypes, plus named global bindings, when the runtime loads, before any
project module runs. `withPristineIntrinsics(callback)` puts back each snapshotted property that
was replaced or deleted, runs the callback, then re-applies the project's replacements.
`checkDeclaredSchema` runs adapter work through it for task input and output checks.

JavaScript runs one callback at a time, so no other code sees the swap, and the task still sees its
own replacements when `run()` executes.

## Consequences

- Validator adapters need no changes. A new adapter is covered when it calls built-ins listed in
  the snapshot.
- Refinements and transforms in a contract schema see the pristine built-ins while they validate.
- Only synchronous work is covered. An asynchronous JSON Schema (`$async`) validator starts under
  the guard; its deferred work runs after the swap is undone.
- A property the project made non-configurable, or a frozen built-in, cannot be swapped back. Its
  validation fails closed as before.
- Properties a project adds to built-ins are left in place.
