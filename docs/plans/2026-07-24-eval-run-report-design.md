# Eval run report architecture design

Date: 2026-07-24

Branch: `refactor/architecture-eval-run-report`

## Target result

Create one private deep Module for eval Run reporting in `src/eval/run-report.ts`.
Keep it outside `src/eval/index.ts`, `deno.json` package exports, and the
public `veryfront/eval` surface.

The Module exposes one private Interface:

```ts
export async function runEvalReport(
  input: EvalRunReportInput,
  adapters: {
    targets: EvalRunReportTargetAdapters;
    artifacts: EvalRunReportArtifactAdapters;
    billing: EvalRunReportBillingAdapters;
    exporters: EvalRunReportExporterAdapters;
    clock?: EvalRunReportClock;
  },
): Promise<EvalRunReportOutcome>;
```

The Module owns Run identifiers, artifact path planning, artifact serialization, gateway billing finalization ordering, baseline comparison, export invocation, suite orchestration, model comparison orchestration, and exit decisions.

The CLI keeps argument parsing, project discovery, runtime auth, source context,
extension lifecycle, Agent and Tool adaptation, human output, JSON envelopes,
and process exit. `cli/commands/eval/command.ts` may import the private Module
with a relative source import such as `../../../src/eval/run-report.ts`. Do not
add `veryfront/eval/run-report` as a public export.

## Evidence from current implementation

- `cli/commands/eval/command.ts` currently mixes CLI responsibilities with report semantics. The same file owns artifact path helpers, JSONL and Markdown renderers, JUnit XML, gateway billing retries, exporter resolution, baseline policy, suite execution, model comparison execution, and final command routing.
- `runEvalCommand` discovers project runtime, hydrates auth, validates command usage, initializes extensions, resolves Agent or Tool targets, executes single evals, suites, and comparisons, writes artifacts, prints output, emits JSON envelopes, and returns exit codes.
- Existing tests in `cli/commands/eval/command.test.ts` directly import helpers from the CLI command, including artifact path helpers, summary serialization, billing finalization, export execution, suite JUnit, baseline exit codes, model comparison output, comparison-policy validation, export config resolution, redaction, runtime auth hydration, Agent and Tool adapters, and exact source policy behavior.
- `src/eval/report.ts`, `src/eval/baseline.ts`, `src/eval/model-comparison.ts`, `src/eval/run-id.ts`, and `src/eval/provenance.ts` already provide reusable eval primitives. The new Module should compose those primitives instead of duplicating them.

## Current architecture problem

The CLI command is a shallow Module because its Interface is argument-shaped while its implementation contains broad report policy. Small changes to report artifacts, billing, export gates, or comparison behavior require editing CLI routing code and retesting command output paths. The CLI also exports many internal helpers only so command tests can reach behavior that is not really CLI-specific.

This hurts Locality:

- Eval report policy lives beside CLI output and extension setup.
- Artifact decisions are repeated across single Run, suite, and model comparison paths. Current model comparison logic writes each model under `models/<sanitized-model>/` and writes `comparison.json` plus `comparison.md` from the parent directory.
- Billing-before-export order is implicit in command flow.
- Exit-code policy is spread across helper functions and command branches.
- Suite and comparison orchestration depend on CLI-only details even though their result is an eval Run report concern.

## Proposed Module boundary

`src/eval/run-report.ts` is a private Module. It is not exported from `src/eval/index.ts` or any public `veryfront/*` surface.

### Interface shape

`EvalRunReportInput` should be mode-based:

```ts
type EvalRunReportInput =
  | EvalRunReportSingleInput
  | EvalRunReportSuiteInput
  | EvalRunReportModelComparisonInput;
```

Required shared fields:

- `projectDir`
- `frameworkVersion`
- `datasetBase`
- `reportDir`
- `report`
- `junit`
- `baseline`
- `writeBaseline`
- `baselinePolicy`
- `exportRequired`
- `exportContext`
- `provenance`

Mode-specific fields:

- Single: discovered eval item, target kind, target adapter, optional selected model, optional max output tokens.
- Suite: sorted discovered eval items plus per-eval target adapter lookup.
- Model comparison: discovered eval item, baseline model, candidate models, resolved comparison policy, Agent adapter factory.

`EvalRunReportOutcome` should describe work done without printing:

```ts
type EvalRunReportOutcome =
  | {
      kind: "single";
      report: EvalReport;
      summary: CliEvalSummary;
      baseline?: EvalReportComparison;
      artifacts: EvalArtifactPaths;
      exitCode: 0 | 1;
      outputHints: EvalRunReportOutputHints;
    }
  | {
      kind: "suite";
      suite: EvalSuiteSummary;
      artifacts: EvalSuiteArtifactPaths;
      exitCode: 0 | 1;
      outputHints: EvalRunReportOutputHints;
    }
  | {
      kind: "model-comparison";
      reports: EvalReport[];
      comparison: EvalModelComparison;
      artifacts: EvalModelComparisonArtifactPaths;
      exitCode: 0 | 1;
      outputHints: EvalRunReportOutputHints;
    };
```

The output hints are structured values the CLI can use to preserve current human output without moving `cliLogger` into `src/eval`.

### Adapters

`targets`:

- Runs a discovered eval with a provided Agent or Tool adapter.
- Resolves per-suite targets by eval item.
- Creates per-model Agent adapters for comparison.
- Keeps exact source policy and project runtime scoping in the CLI caller by wrapping `runEvalReport` in `runWithProjectAgentRuntime`.

`artifacts`:

- Reads baseline report files.
- Writes text files and ensures directories.
- Writes explicit output files requested by CLI flags after core artifact writes:
  `--report`, `--junit`, and `--write-baseline` for single Runs, suite JUnit
  for suite mode, and comparison JSON for model comparison `--report`.
- Optionally delegates to `Deno` in production and in-memory fakes in tests.

`billing`:

- Runs an eval operation inside a billing group.
- Applies gateway finalization before export.
- Handles failure-after-usage finalization.

`exporters`:

- Exports a finalized report with an already-resolved exporter config.
- The CLI remains responsible for exporter id resolution, redaction env, extension setup, and registry lifetime.

`clock`:

- Supplies the current time and eval Run id suffix for deterministic tests.
  Production delegates to `createEvalRunId(now, createSuffix)` so the Module
  owns Run id creation without adding a sixth top-level Adapter group.

## Ownership table

| Concern | Current owner | New owner |
| --- | --- | --- |
| Arg parsing and aliases | `cli/commands/eval/handler.ts` | unchanged |
| JSON envelope and human logs | `cli/commands/eval/command.ts` | unchanged |
| Process exit | `evalCommand` | unchanged |
| Project source context | `runEvalCommand` | unchanged |
| Runtime auth | `runEvalCommand` | unchanged |
| Runtime discovery | `runEvalCommand` | unchanged |
| Extension lifecycle | `runEvalCommand` | unchanged |
| Agent and Tool adapters | `command.ts` | unchanged |
| Exporter id resolution and redaction env | `command.ts` | unchanged |
| Comparison-policy flag and file validation | `command.ts` | unchanged |
| Run id generation | `command.ts` | `src/eval/run-report.ts` |
| Report directory and file paths | `command.ts` | `src/eval/run-report.ts` |
| Summary, JSONL, Markdown, JUnit | `command.ts` | `src/eval/run-report.ts` |
| Baseline comparison and write-baseline | `command.ts` | `src/eval/run-report.ts` |
| Billing finalization order | `command.ts` | `src/eval/run-report.ts` |
| Export-after-billing | `command.ts` | `src/eval/run-report.ts` |
| Suite orchestration | `command.ts` | `src/eval/run-report.ts` |
| Model comparison orchestration | `command.ts` | `src/eval/run-report.ts` |
| Exit decision | `command.ts` helpers | `src/eval/run-report.ts` |

## Compatibility invariants

- Keep all public imports from `veryfront/eval`, `veryfront/extensions/eval`, and `veryfront/agent` compatible.
- Do not add a `veryfront/eval/run-report` export. If a stable internal alias is
  needed, add only a `#veryfront/eval/run-report` import-map entry and keep it
  out of package exports.
- Keep `cli/commands/eval/handler.ts` argument parsing unchanged.
- Keep `evalCommand(options)` behavior unchanged, including `exitProcess(exitCode)`.
- Keep `runEvalCommand(options, dependencies)` return values unchanged.
- Preserve all human output text, line ordering, and conditional lines.
- Preserve JSON envelope shape for list, errors, single eval, suite, and comparison.
- Preserve exit codes:
  - Usage errors return `2`.
  - Missing eval, Agent, or Tool returns `1`.
  - Passing reports return `0`.
  - Failed records, baseline regression, required export failure, suite failure, or comparison failed report return `1`.
- Preserve artifact paths and filenames:
  - `summary.json`
  - `results.jsonl`
  - `report.md`
  - suite child dirs like `001-alpha`
  - model dirs like `models/anthropic__claude-opus-4-6`
  - `comparison.json`
  - `comparison.md`
  - per-model `junit.xml`
- Preserve exact report directory labels and model path sanitization.
- Preserve billing-before-export order for single eval, suite children, and each model comparison child report.
- Preserve best-effort export behavior unless `--require-export` or environment makes export required.
- Preserve baseline gate semantics and comparison policy validation.
- Preserve source policy scoping by keeping CLI runtime wrapping around the call.
- Preserve extension teardown in `finally`.

## Implementation strategy

Use strangler extraction.

1. Add tests for `src/eval/run-report.ts` that describe existing single, suite, and model comparison behavior with deterministic adapters.
2. Move pure helpers first: path planning, summary artifact, JSONL, Markdown, JUnit, exit-code policy, suite summary, suite Markdown, model comparison path planning, and comparison artifact construction.
3. Move orchestration next: single, suite, model comparison.
4. Leave CLI-specific validation and output in `command.ts`.
5. Convert exported CLI helper tests to run-report tests where the behavior is no longer CLI-specific.
6. Keep or add CLI tests for parsing, discovery, auth hydration, extension lifecycle, exporter id resolution, redaction env, comparison-policy validation, source policy, output envelopes, output text, target lookup errors, unsupported flag errors, and process exit.

## Rejected options

- Export `runEvalReport` from `veryfront/eval`: rejected because the requested Interface is private and the public API does not need a new stable contract.
- Move CLI parsing into `src/eval`: rejected because flags, JSON envelopes, and exit behavior belong to the CLI layer.
- Keep billing helpers in the CLI: rejected because billing-before-export is a core Run report invariant across all modes.
- Build a generic report framework for all commands: rejected because the current problem is eval-specific and no new dependency or broad abstraction is needed.

## Risks

- Snapshot drift in human output and JSON envelopes if output hints are too lossy.
- Hidden dependency on direct helper exports from `command.ts` in tests.
- Accidental public API change if `src/eval/index.ts` exports the private Module.
- Deno permissions in focused tests may need `--allow-env`, `--allow-read`, and `--allow-write` because current eval tests already touch env, files, and fetch.
- Model comparison has several coupled decisions: model order, per-model Run id, comparison baseline model, comparison artifact paths, and report override behavior.

## Rollback plan

Each extraction step is reversible:

- Keep old helper names in `command.ts` as shims during the transition.
- If orchestration extraction destabilizes output, keep rendering in CLI and move only pure report planning first.
- If suite or comparison extraction becomes too broad, land single eval extraction first and defer suite/comparison behind unchanged CLI code.
