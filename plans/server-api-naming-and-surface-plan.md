# Server API Naming And Surface Plan

## Problem

Current root exports expose multiple server-related entry points:

- `createVeryfrontHandler` (embed handler)
- `startProductionServer` (standalone production server bootstrap)
- `startDevServer` / `DevServer` (dev server with HMR/watchers)

For users, this is hard to reason about:

- `create*` and `start*` are mixed with side effects.
- "Universal" is internal jargon, not user-facing intent.
- It is unclear why two standalone start paths exist.

## Goal

Make the public model simple and framework-like:

1. One embedded integration API.
2. One standalone server start API.
3. Clear naming with predictable side effects.

## Proposed Public API

### Root (`veryfront`)

- `createVeryfrontHandler(...)`
  - For Hono/Express/Fastify/custom servers.
  - No port bind.
- `startVeryfrontServer(...)`
  - One standalone starter for users.
  - `mode: "development" | "production"` option.

### Advanced Subpaths (not root-first docs)

- `veryfront/server/dev` can keep `DevServer` class for advanced/dev-internal use.
- `startProductionServer` stays subpath/internal implementation detail, not root-first docs API.

## Naming Conventions

- `create*`: construction only, no network side effects.
- `start*`: starts listeners/binds ports.
- Avoid internal jargon in root-level public API.

## Migration Plan

### Phase 1: Introduce final naming (breaking change)

1. Add `startVeryfrontServer(options)` in `src/server/index.ts`.
2. Internally delegate to:
   - dev path (`startDevServer`) when `mode === "development"`.
   - prod path (`startProductionServer`) when `mode === "production"`.
3. Export `startVeryfrontServer` from `src/index.ts`.
4. Remove `startProductionServer` and `startDevServer` from root exports (`src/index.ts`).
5. Update docs/examples to use `startVeryfrontServer` and `createVeryfrontHandler`.

### Phase 2: Remove legacy naming from public root surface

1. Do not add compatibility aliases at root.
2. Treat old root names as removed APIs.
3. Keep internal implementation modules private to docs unless intentionally public.

### Phase 3: Cleanup

1. Rename internal callsites (CLI/tests/docs) to the new names in one PR.
2. Keep `DevServer` class only on advanced subpath docs.

## Compatibility Notes

- Assume no meaningful external usage of old root names.
- Ship as a clean breaking change (or gate to next major if needed by release policy).

## Test Plan

1. Root API type-check:
   - `import { createVeryfrontHandler, startVeryfrontServer } from "veryfront"`.
2. Runtime smoke:
   - `startVeryfrontServer({ mode: "development", ... })` starts/stops.
   - `startVeryfrontServer({ mode: "production", ... })` starts/stops.
3. Handler integration smoke:
   - `createVeryfrontHandler` works in a minimal adapter/server harness.
4. Ensure renamed root APIs are the only documented root server APIs.

## Docs Plan

1. Update `README.md` quickstart:
   - Standalone: `startVeryfrontServer`.
   - Embedded: `createVeryfrontHandler`.
2. Update `src/server/README.md`:
   - Move `DevServer` details under “Advanced”.
3. Add migration note:
   - "Root server API changed: use `startVeryfrontServer`."

## Open Decision

- Keep `DevServer` class public on subpath or mark as internal-only?
  - Recommendation: keep subpath-public for advanced users, but do not advertise in root docs.
