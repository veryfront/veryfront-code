# Quiet Development Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make normal `veryfront dev` output show readiness and actionable events while retaining full diagnostics under debug logging.

**Architecture:** Keep `INFO` as the global default and reclassify internal call sites to `DEBUG`. Request completion chooses severity by status, and duplicate security guidance is consolidated at the configuration owner.

**Tech Stack:** TypeScript, Veryfront structured logger, Deno tests, subprocess log-capture integration tests.

## Global Constraints

- No new logging flag or dependency.
- `veryfront dev --debug`, `LOG_LEVEL=DEBUG`, and `VERYFRONT_DEBUG` retain diagnostic detail.
- Warnings and errors remain visible by default.
- Hosted production observability must not lose failed or slow request events.
- Tests must fail before production changes are written.

---

### Task 1: Define the normal-output regression contract

**Files:**
- Create: `cli/commands/dev/dev-output.integration.test.ts`
- Modify: `src/observability/production-log-noise.test.ts`

**Interfaces:**
- Exercises: built or direct `veryfront dev`.
- Observes: default and `--debug` output.

- [ ] **Step 1: Add failing default-output assertions**

Start a minimal app, wait for readiness, request `/` and one API route, then assert default output excludes:

```text
declares capabilities
loaded from
Pre-converted schema
Using pre-converted schema
Pod-level module cache initialized
Pod-level ESM cache initialized
Initialized with gateway
Subscribing to ReloadNotifier
Primitive discovery completed
Using import map
built handler
Using runtime model
GET / 200
```

Assert readiness remains visible.

- [ ] **Step 2: Add debug-output assertions**

Run with `--debug` and require representative extension, request, and API-build diagnostics.

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
deno test -A cli/commands/dev/dev-output.integration.test.ts
```

Expected: normal output contains current info-level internals.

### Task 2: Reclassify extension, tool, cache, HMR, and API internals

**Files:**
- Modify: `src/extensions/capabilities.ts`
- Modify: `src/extensions/loader.ts`
- Modify: `src/extensions/builtin-extensions.ts`
- Modify: `src/tool/factory.ts`
- Modify: `src/cache/module-cache.ts`
- Modify: `src/transforms/esm/transform-cache.ts`
- Modify: `src/server/handlers/preview/hmr.handler.ts`
- Modify: `src/server/handlers/request/api/project-discovery.ts`
- Modify: `src/routing/api/module-loader/loader.ts`
- Modify: `npm/extensions/ext-bundler-esbuild/src/index.ts`
- Modify: `npm/extensions/ext-content-mdx/src/extensions/ext-content-mdx/src/index.ts`
- Modify: `npm/extensions/ext-css-tailwind/src/index.ts`
- Modify: `npm/extensions/ext-llm-anthropic/src/index.ts`
- Modify: `npm/extensions/ext-llm-google/src/index.ts`
- Modify: `npm/extensions/ext-llm-openai/src/index.ts`
- Modify: `npm/extensions/ext-parser-babel/src/index.ts`
- Modify: `npm/extensions/ext-sandbox-shell-tools/src/index.ts`
- Modify: `npm/extensions/ext-schema-zod/src/index.ts`
- Regenerate: `npm/src/**` through the repository npm build process.

**Interfaces:**
- Existing logger methods only; no public API changes.

- [ ] **Step 1: Change internal success events from `info` to `debug`**

Keep failure and degraded-state warnings/errors unchanged.

- [ ] **Step 2: Run the focused default-output test**

Expected: remaining failures identify request, model, or security output not handled in this task.

- [ ] **Step 3: Run affected unit tests**

Run:

```bash
deno test -A \
  src/extensions \
  src/tool \
  src/cache/module-cache.test.ts \
  src/server/handlers/request/api/project-discovery.test.ts \
  src/routing/api/module-loader
```

- [ ] **Step 4: Commit**

Commit the internal lifecycle reclassification using the Lore protocol.

### Task 3: Make request and model diagnostics outcome-aware

**Files:**
- Modify: `src/server/runtime-handler/request-tracker.ts`
- Modify: `src/server/runtime-handler/request-tracker.test.ts`
- Modify: `src/agent/runtime/index.ts`
- Modify: `src/agent/runtime/*.test.ts`

**Interfaces:**
- Successful request completions use `debug`.
- HTTP 4xx completions use `warn`.
- HTTP 5xx completions use `error`.
- Existing slow-request timers remain visible.
- Runtime model remapping uses `debug`.

- [ ] **Step 1: Add failing level-selection tests**

Capture structured logger output for 200, 404, 500, slow, and model-remap events.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
deno test -A src/server/runtime-handler/request-tracker.test.ts src/agent/runtime
```

- [ ] **Step 3: Implement status-aware completion logging**

Do not duplicate stack traces or request errors already emitted by a handler. Emit one concise completion event at the selected level.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same command and require all tests to pass.

- [ ] **Step 5: Commit**

Commit the request/model changes using the Lore protocol.

### Task 4: Consolidate security configuration guidance

**Files:**
- Modify: `src/server/runtime-handler/index.ts`
- Modify: `src/server/runtime-handler/index.test.ts`
- Modify: `src/security/http/config.ts`
- Modify: `src/security/http/config.test.ts`

**Interfaces:**
- `SecurityConfigLoader` remains the single owner of security configuration guidance.

- [ ] **Step 1: Add a failing duplicate-warning test**

Initialize the default development security configuration and assert the missing-CSRF condition is emitted at most once. Explicitly unsafe or contradictory configuration must still warn.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
deno test -A src/security/http/config.test.ts src/server/runtime-handler
```

- [ ] **Step 3: Remove the runtime-handler duplicate**

Keep one actionable warning at the security configuration boundary. Do not enable CSRF globally in this change because application clients have an independent token-integration contract.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same command and require all tests to pass.

- [ ] **Step 5: Commit**

Commit the consolidation using the Lore protocol.

### Task 5: Verify packaging and create a focused PR

**Files:**
- Regenerate only npm artifacts required by `deno task build:npm`.

- [ ] **Step 1: Run static and package checks**

Run:

```bash
deno fmt --check src cli/commands/dev npm/extensions
deno lint src cli/commands/dev npm/extensions
deno task typecheck
deno task build:npm
```

- [ ] **Step 2: Run default/debug output integration tests**

Require clean default output and representative debug diagnostics.

- [ ] **Step 3: Run a local AI-agent request**

Start the generated template, submit one agent request, and confirm normal output contains the request failure if it fails but omits schema/model/request-success internals when it succeeds.

- [ ] **Step 4: Push and open the PR**

Use a narrow title about actionable development output and the Lore protocol in commits.
