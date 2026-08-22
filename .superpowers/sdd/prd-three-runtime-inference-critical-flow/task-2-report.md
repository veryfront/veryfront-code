# Task 2 Report: Shared Three-Runtime Inference Critical-Flow Contract

## Status

DONE with concerns.

Implemented the shared critical-flow contract harness and pure contract tests for private issue #735. The Node tracer passed against a freshly generated npm package build and packed npm consumer install. Bun and Deno journeys are implemented in the same entry point but were not run in this Task 2 slice after the parent narrowed completion to the Node tracer.

## Changed Files

- `scripts/test/runtime-inference-critical-flow.ts`
  - Added exported public contract helpers:
    - `parseRuntimeSelection(args: string[]): RuntimeName[]`
    - `artifactClaim(runtime: RuntimeName): string`
    - `waitForTerminalRun(url: URL, deadlineMs: number): Promise<WorkflowRunDetail>`
    - `validateAnthropicRequest(request: Request, expectedMarker: string): Promise<void>`
    - `runRuntimeInferenceCriticalFlow(args = Deno.args): Promise<void>`
  - Reused Task 1 helpers from `scripts/test/template-runtime-e2e.ts` for command availability, package packing, scaffold, install, dev server start/stop, and readiness polling.
  - Added the real journey:
    - scaffolds `agentic-workflow`
    - replaces scaffold demo workflow API routes with `createWorkflowHandler`
    - writes a one-node `content-pipeline` workflow using `MemoryBackend`
    - keeps fixture agent config at `anthropic/claude-haiku-4-5-20251001`
    - validates provider-native wire model `claude-haiku-4-5-20251001`
    - starts loopback Anthropic-compatible provider on `127.0.0.1:0`
    - sets `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, and `VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS=true` for the dev process
    - asserts start/detail/list/root-health public HTTP behavior
    - releases dev process, provider server, hanging provider responses, env mutations, and temp dirs in `finally`
  - Added development-only `--provider-mode=respond` negative control.

- `scripts/test/runtime-inference-critical-flow.test.ts`
  - Added pure public orchestration tests for:
    - default runtime selection
    - explicit runtime selection
    - missing/unknown/duplicate runtime rejection
    - exact artifact label claims, including Deno `packed CLI` and no `npm install`
    - valid Anthropic request acceptance
    - wrong method/path/key/body/model/marker rejection
    - terminal poll success for failed runs
    - terminal success rejection
    - deadline diagnostics preserving last observed state
    - per-poll fetch abort signal wiring
    - import inertness for the executable harness module

## TDD Evidence

### RED

Command:

```sh
deno test --config=scripts/test.deno.json --no-check --allow-all scripts/test/runtime-inference-critical-flow.test.ts
```

Initial result:

```text
error: Module not found ".../scripts/test/runtime-inference-critical-flow.ts".
    at .../scripts/test/runtime-inference-critical-flow.test.ts:13:8
```

This was the intended RED for the missing public contract module/exports.

### GREEN

Command:

```sh
deno test --config=scripts/test.deno.json --no-check --allow-all scripts/test/runtime-inference-critical-flow.test.ts
```

Final result:

```text
ok | 1 passed (10 steps) | 0 failed (455ms)
```

## Runtime Journey Evidence

### Node tracer with fresh package build

Command:

```sh
deno run --config=scripts/test.deno.json --no-check --allow-all scripts/test/runtime-inference-critical-flow.ts --runtime=node
```

Result:

```text
runtimes: node
provider mode: black-hole
build npm package
pack npm package
node/packed npm consumer: scaffold
node/packed npm consumer: install
node/packed npm consumer: readiness http://127.0.0.1:63649/
node/packed npm consumer: passed
```

### Development negative control

Command:

```sh
deno run --config=scripts/test.deno.json --no-check --allow-all scripts/test/runtime-inference-critical-flow.ts --runtime=node --skip-build --provider-mode=respond
```

Expected RED result:

```text
Run reached unexpected terminal status completed
```

The valid immediate Anthropic response makes the workflow complete, proving the black-hole test is sensitive to the timeout/cancellation path rather than merely accepting any terminal run.

## Verification

- Pure tests:

```sh
deno test --config=scripts/test.deno.json --no-check --allow-all scripts/test/runtime-inference-critical-flow.test.ts
```

Result: `ok | 1 passed (10 steps) | 0 failed (455ms)`.

- Lint:

```sh
deno lint --config=scripts/test.deno.json scripts/test/runtime-inference-critical-flow.ts scripts/test/runtime-inference-critical-flow.test.ts
```

Result: `Checked 2 files`.

- Format:

```sh
deno fmt --check --no-config scripts/test/runtime-inference-critical-flow.ts scripts/test/runtime-inference-critical-flow.test.ts
```

Result: `Checked 2 files`.

- Typecheck:

```sh
deno check --config=scripts/test.deno.json scripts/test/runtime-inference-critical-flow.ts scripts/test/runtime-inference-critical-flow.test.ts
```

Result: failed in the pre-existing helper import graph:

```text
TS2307: Import "#cli/ui" not a dependency and not in import map from cli/utils/terminal-select.ts
TS2307: Import "veryfront/platform" not a dependency and not in import map from cli/utils/terminal-select.ts
```

No local strictness errors remained in the new Task 2 files after the first typecheck pass fixed local issues.

## Self-Review

- Scope: edits are limited to the two owned Task 2 source/test files plus this report.
- Task 1 seam: reused `template-runtime-e2e.ts` helpers; did not duplicate package/scaffold/install/dev-server mechanics.
- Provider model contract: fixture agent config remains provider-prefixed, while the validator asserts the provider-native Anthropic wire model.
- Fixture route contract: removed scaffold demo workflow routes from each throwaway project so the public `createWorkflowHandler` catch-all owns start/detail/list behavior.
- Cleanup: dev server, provider server, hanging provider response, env mutations, and temp directory are all released through `finally`.
- No live provider: all provider traffic is loopback-only with fake key `vf-runtime-critical-flow-key`.

## Concerns

- Bun and Deno journeys were not executed in this Task 2 continuation; the same harness supports them and defaults to all three runtimes when no runtime flag is provided.
- `deno check` is blocked by the existing Task 1 helper import graph through `cli/utils/terminal-select.ts`, outside the allowed edit scope.
- CI wiring for the three named runtime matrix checks is not part of this Task 2 file scope.
