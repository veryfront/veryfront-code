# Eval run report implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor eval Run reporting into one private `src/eval/run-report.ts` Module without changing the `veryfront eval` command contract.

**Architecture:** `src/eval/run-report.ts` owns Run ids, artifact planning and serialization, billing-before-export ordering, baseline gates, suite and model comparison orchestration, and exit decisions. `cli/commands/eval/command.ts` keeps argument parsing, runtime discovery, auth hydration, extension lifecycle, Agent and Tool adapters, human output, JSON envelopes, and process exit.

**Tech Stack:** Deno, TypeScript, `#veryfront/testing/bdd.ts`, `#veryfront/testing/assert.ts`, existing eval primitives in `src/eval/`, existing CLI utilities in `cli/commands/eval/`.

## Global Constraints

- Preserve public API compatibility. Do not export `src/eval/run-report.ts` from `src/eval/index.ts` or package exports.
- Preserve exact CLI human output, JSON envelopes, artifact paths, exit codes, and extension teardown behavior.
- Keep `cli/commands/eval/handler.ts` unchanged unless an existing parser test fails.
- Keep comparison-policy parsing and validation in `cli/commands/eval/command.ts`.
- Keep Agent and Tool adapter creation in `cli/commands/eval/command.ts`.
- Do not add dependencies.
- Write failing tests before moving implementation.
- Use Lore commit messages for every commit.

---

Date: 2026-07-24

Branch: `refactor/architecture-eval-run-report`

## Scope

Refactor eval Run reporting into private `src/eval/run-report.ts` while preserving the CLI command contract.

Expected touched files:

- `src/eval/run-report.ts`
- `src/eval/run-report.test.ts`
- `cli/commands/eval/command.ts`
- `cli/commands/eval/command.test.ts`

Do not modify public exports. If CLI needs a named internal import, add only a
private import-map entry such as `#veryfront/eval/run-report` and keep it out of
`deno.json` package exports. The simpler first choice is a relative import from
`cli/commands/eval/command.ts` to `../../../src/eval/run-report.ts`, matching
existing CLI imports of private source modules.

## Stop condition

Stop when:

- `runEvalReport` owns single, suite, and model comparison report semantics.
- CLI output and exit behavior are unchanged.
- New run-report tests pass.
- Existing eval command tests pass.
- No public `veryfront/*` export changes were made.
- Verification commands below pass or any blocker is documented.

## Test-first plan

### Red 1: single eval report outcome

Add `src/eval/run-report.test.ts`.

Test a single eval report with deterministic adapters:

- fixed time and suffix from `adapters.clock`, with the Module calling
  `createEvalRunId(now, createSuffix)` to own the resulting Run id.
- report directory defaults to `.veryfront/evals/<timestamp>-answers`.
- target runner receives `baseDir`, Run id, metadata provenance, selected model when present, and a target adapter.
- billing adapter wraps execution before exporter adapter runs.
- exporter receives the finalized report.
- artifacts written:
  - `summary.json`
  - `results.jsonl`
  - `report.md`
  - optional `--report`
  - optional `--junit`
  - optional `--write-baseline`
- outcome includes report, summary, baseline when present, artifacts, output hints, and exit code.
- failed records, baseline regression, and required export failure produce exit code `1`.
- best-effort export failure still writes local artifacts and returns exit code `0`
  when export is not required.
- required export failure writes local artifacts and returns exit code `1`.

Expected failure before implementation: missing `src/eval/run-report.ts` and missing `runEvalReport`.

### Green 1: pure helpers and single mode

Create `src/eval/run-report.ts`.

Move or copy with minimal changes:

- `createDefaultEvalReportDir`
- `createEvalArtifactPaths`
- model path sanitizer and model artifact paths if needed by tests
- `summarizeReportForCli`
- `createSummaryArtifact`
- `createResultsJsonl`
- `createEvalMarkdownReport`
- `createJunitXml`
- `writeEvalArtifacts`
- `createEvalExitCode`
- baseline comparison using a ready `EvalReportComparisonPolicy` from CLI. Keep
  flag-derived policy construction in `cli/commands/eval/command.ts`.

Then implement `runEvalReport` for `kind: "single"`.

Keep CLI `command.ts` helpers as re-exporting shims or local wrappers until tests migrate.

- [ ] Run `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all src/eval/run-report.test.ts`.
- [ ] Expected after Green 1: single-mode tests pass; suite and comparison tests are not written yet.

### Red 2: suite orchestration

Add run-report tests for suite mode:

- evals are sorted by id then file path.
- child directories use `001-<sanitized-id>`, `002-<sanitized-id>`.
- child Run ids use `<suiteRunId>_001`, `<suiteRunId>_002`.
- each child runs sequentially.
- per-child target lookup errors become result `status: "error"` and do not stop later evals.
- passing and failing reports become `passed` and `failed`.
- suite summary writes `summary.json`, `results.jsonl`, `report.md`.
- optional suite JUnit writes the existing XML structure.
- suite exit is `0` only when `summary.failed === 0`.
- export failure required by `--require-export` records a failed child result
  without stopping later evals.

Expected failure before implementation: `runEvalReport` does not support `kind: "suite"`.

### Green 2: suite mode

Move suite-only helpers:

- `createEvalSuiteArtifactPaths`
- `createEvalSuiteChildDirectory`
- `createEvalSuiteSummary`
- `createEvalSuiteMarkdown`
- `createEvalSuiteResultsJsonl`
- `createEvalSuiteJunitXml`
- `writeEvalSuiteArtifacts`

Implement suite mode using adapters for target lookup and execution.

Keep human logging in CLI by returning enough output hints to print current lines exactly.

- [ ] Run `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all src/eval/run-report.test.ts`.
- [ ] Expected after Green 2: single and suite run-report tests pass.

### Red 3: model comparison orchestration

Add run-report tests for model comparison mode:

- parent Run id is generated once.
- report directory defaults to the parent Run id plus eval label.
- model order preserves unique baseline plus candidates.
- per-model Run ids use `<parentRunId>_<sanitizedModel>`.
- model artifact paths include `models/<sanitizedModel>/summary.json`, `results.jsonl`, `report.md`, and `junit.xml`.
- each model report is billed, exported, written, and has per-model JUnit.
- comparison artifact writes `comparison.json` and `comparison.md`.
- optional `--report` writes comparison JSON, not a single report.
- outcome includes reports, comparison, artifacts, and exit code based on evaluated reports plus required export.
- `--baseline`, `--write-baseline`, `--model`, and comparison-policy validation
  are not tested here because the CLI keeps those usage gates.

Expected failure before implementation: comparison mode unsupported.

### Green 3: comparison mode

Move model comparison helpers:

- `createEvalModelArtifactPaths`
- `createEvalModelComparisonArtifactPaths`
- `createEvalModelComparisonArtifact`
- `createEvalModelComparisonExitCode`
- `writeEvalModelComparisonArtifacts`

Implement comparison mode with adapter-provided model Agent runners.

Keep comparison-policy parsing in CLI because it is flag/file validation. Pass the resolved policy into the Module.

- [ ] Run `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all src/eval/run-report.test.ts`.
- [ ] Expected after Green 3: single, suite, and comparison run-report tests pass.

### Red 4: CLI compatibility

Update or add tests in `cli/commands/eval/command.test.ts`:

- `runEvalCommand` still returns the same codes for single, suite, comparison, usage error, missing eval, missing Agent, missing Tool.
- JSON envelope keys remain unchanged:
  - single: `{ report, summary, baseline, artifacts }`
  - suite: `{ suite, artifacts }`
  - comparison: `{ reports, comparison, artifacts }`
- human output preserves existing line order for single, suite, and comparison.
- extension setup is skipped for list mode and torn down for run modes.
- exact source policy remains active across tool evals and every model comparison run.
- runtime auth hydration still happens before discovery.
- CLI-only helper tests remain in `command.test.ts` for:
  - `normalizeEvalCliId`
  - `findEvalForCliId`
  - `normalizeEvalInputForAgent`
  - `resolveToolTargetId`
  - `normalizeUsage`
  - `normalizeToolCalls`
  - `createAgentAdapter`
  - `createToolAdapter`
  - `createEvalCliExportConfig`
  - `resolveEvalExporterIds`
  - `resolveEvalExportRequired`
  - `resolveEvalExportRedactionFromEnv`
  - `hydrateEvalRuntimeAuth`
  - `loadEvalModelComparisonPolicy`
  - `createResolvedEvalModelComparisonConfig`

Expected failure before wiring: CLI still uses old local orchestration or output hints missing fields.

### Green 4: CLI wiring

Change `runEvalCommand`:

- Keep list, usage validation, not-found handling, runtime discovery, target lookup, extension setup, and `runWithProjectAgentRuntime`.
- Build `EvalRunReportInput`.
- Provide adapters:
  - `targets.runEval` delegates to existing `runEval`.
  - `targets.createAgentAdapter` delegates to existing `createAgentAdapter`.
  - `targets.createToolAdapter` delegates to existing `createToolAdapter`.
  - `targets.resolveSuiteTarget` performs the current per-eval Agent or Tool lookup and returns the same not-found error messages.
  - `artifacts.readTextFile` and `artifacts.writeTextFileEnsuringDir` use Deno.
  - `billing.runWithGatewayBillingGroup` delegates to the moved gateway helper or a CLI shim with identical retry behavior.
  - `exporters.exportReport` delegates to exporter registry logic.
- Call `runEvalReport`.
- Print human output or JSON envelope from the outcome.
- Return `outcome.exitCode`.

Remove only duplicated helper tests that moved to `src/eval/run-report.test.ts`.

- [ ] Run `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/commands/eval/command.test.ts`.
- [ ] Expected after Green 4: existing CLI command tests pass with unchanged output and exit behavior.

## Acceptance criteria

- `cli/commands/eval/handler.ts` remains unchanged unless a parser test requires it.
- `evalCommand` still exits only through `exitProcess`.
- `runEvalCommand` still returns `number | undefined`.
- The private Module does not import from `cli/`.
- `cli/commands/eval/command.ts` imports `runEvalReport` through a relative private source path, or through a new private `#veryfront/eval/run-report` import-map alias if the implementation explicitly adds that alias. `src/eval/index.ts` and `deno.json` package exports must not export it.
- Billing finalization happens before export for:
  - single eval
  - every suite child
  - every model comparison child
- Required export failure gates exit code but does not block local artifact writes.
- Suite errors are represented as result rows and do not stop subsequent evals.
- Model comparison flags remain agent-only.
- `--model` and `--max-output-tokens` remain rejected for Tool evals.
- `--baseline` and `--write-baseline` remain rejected for model comparison.
- `--comparison-policy` validation messages remain exact.

## Verification commands

Run from this worktree.

Initial focused red/green:

```bash
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all src/eval/run-report.test.ts
```

Existing eval command coverage:

```bash
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/commands/eval/command.test.ts
```

Eval runtime coverage:

```bash
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all src/eval/report.test.ts src/eval/baseline.test.ts src/eval/model-comparison.test.ts src/eval/run-id.test.ts
```

CLI subtree smoke:

```bash
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all --parallel cli/commands/eval/ cli/help/command-definitions.ts cli/router.test.ts
```

Diff hygiene:

```bash
git diff --check
git status --short
```

Broaden if shared eval or CLI behavior changed beyond this command:

```bash
deno test --no-check --allow-all --parallel '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

## Handoff notes

- Implement in small commits: tests first, pure helper extraction, single wiring, suite wiring, comparison wiring, CLI cleanup.
- Do not delete existing CLI helper exports until migrated tests prove they are duplicate internals.
- Do not add dependencies.
- Do not change docs, examples, generated API references, or public command help because the user-visible eval command contract is preserved.
- Use Lore commit messages for every commit.
- Do not commit until the relevant red and green verification commands have
  been run and their results are recorded in the commit trailers.

## Remaining caveats

- Existing command tests assert helper behavior through `cli/commands/eval/command.ts`. Some helper exports may need temporary shims to keep the refactor reviewable.
- The exact human output is not currently snapshot-tested comprehensively. Add targeted logger capture tests before changing output-producing branches.
- Gateway billing retry defaults are slow when exercised naively. Keep retry-delay tests stubbed so focused test runs stay fast.
