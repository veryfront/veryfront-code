# Module hardening ledger

This ledger tracks the production-hardening review of the 58 `src` audit
units: 56 top-level module directories plus `src/index.ts` and
`src/version.ts`.

The ledger is updated in the same checkpoint as the hardening changes it
describes. Branch `codex/module-reconcile-20260723` HEAD is authoritative;
copied commit hashes are deliberately not used as a freshness signal.

## Status rules

A unit is closed only when all of these conditions are met:

- The current implementation received a deep module-level review.
- Relevant behavior, failure paths, boundaries, and tests were inspected.
- Required fixes and documentation updates are complete.
- Focused verification and affected integration gates pass.
- No later commit changed the unit without module-level revalidation.

A later source change reopens a closed unit. Recovered or mechanically applied
changes count as evidence, but do not by themselves certify the current unit.
Generated-only changes do not count as module review evidence.

## Current status

| Status                         | Count | Percentage | Meaning                                             |
| ------------------------------ | ----: | ---------: | --------------------------------------------------- |
| Closed                         |     3 |       5.2% | Current formal closure evidence remains valid       |
| Deep reviewed, fixes pending   |     2 |       3.4% | Review findings exist; remediation is not complete  |
| Touched, revalidation required |    38 |      65.5% | Substantive recovered or current work exists        |
| Pending current review         |    15 |      25.9% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed, deeply reviewed, and touched units give current-cycle substantive
coverage of 43/58 (74.1%). This is progress coverage, not a substitute for the
stricter closure count.

### Closed

- `config`
- `schemas`
- `version.ts`

### Deep reviewed, fixes pending

- `embedding`
- `metrics`

### Touched, revalidation required

- `agent`
- `build`
- `cache`
- `channels`
- `client`
- `data`
- `discovery`
- `errors`
- `extensions`
- `fs`
- `html`
- `integrations`
- `internal-agents`
- `middleware`
- `modules`
- `oauth`
- `observability`
- `platform`
- `provider`
- `proxy`
- `react`
- `registry`
- `release-assets`
- `rendering`
- `routing`
- `runtime`
- `schedule`
- `security`
- `server`
- `task`
- `testing`
- `tool`
- `transforms`
- `trigger`
- `types`
- `utils`
- `webhook`
- `index.ts`

### Pending current review

- `chat`
- `eval`
- `issues`
- `knowledge`
- `markdown`
- `mcp`
- `mdx`
- `prompt`
- `repositories`
- `resource`
- `runs`
- `sandbox`
- `skill`
- `studio`
- `workflow`

## Historical recovery context

Before the worktree loss, 46 of 58 units had formal closure evidence and all 58
had received a first-pass audit. The recovered changes remain in the branch.
That historical closure count is 79.3 percent.

The recovered snapshot was mechanical rather than a reviewed integration
commit. The current ledger therefore distinguishes preserved work from current
certification. This prevents a recovered diff, a later cross-module change, or
a passing repository-wide test from being mistaken for a fresh deep review of
every affected unit.

## Active review chain

This checkpoint closes `config` after a complete consumer map, deep
module-level review, adversarial loader and evaluator review, bounded resource
and retry normalization, public-contract documentation, and repository-wide
verification. Cross-module consumers changed by the fixes remain in
revalidation; focused evidence for a config boundary does not by itself close
their top-level units.

`embedding` and `metrics` have received deep reviews and are the next
remediation targets. Their findings include authorization, input-size,
cancellation, persistence-integrity, model-identity, batching, and remote
transaction boundaries in `embedding`; and tenant/destination identity,
cardinality, queue and payload bounds, OTLP serialization, provider lifecycle,
and application-failure isolation in `metrics`. Neither unit is closed until
those findings are fixed, regression-tested, documented where public behavior
changes, and verified through its affected integration gates.

### Config closure checkpoint verification

The current config closure checkpoint has the following reproducible evidence:

- The complete changed test surface passed 81 test groups and 773 steps with
  zero failures, including loader, evaluator, worker, schema, discovery,
  environment, paths, hosted policy, retry, token, runs, GitHub, documentation,
  and release-asset regressions.
- The repository unit suite passed 2,982 tests and 23,584 steps with zero
  failures; one intentional case remains ignored with five steps.
- `deno task verify:quick` passed, including formatting, linting, static policy
  ratchets, sanitizer and skipped-test baselines, dependency and module
  boundaries, documentation validation, and full entrypoint typechecking.
- `deno task test:scripts` passed 71 tests and 155 steps with zero failures.
- `deno task typecheck:consumer` rebuilt the npm and extension packages and
  passed the documented consumer-composition typecheck.
- The config-loader smoke passed five consecutive runs under Bun 1.3.14.
- The read-only Node 18.18.0 package smoke passed all six install, CLI,
  evaluator-worker, optional-peer, extension, and transitive-failure checks.
- `deno task docs:validate` passed all documentation contracts and 716 link
  checks.

These gates certify this integration checkpoint, not the 15 pending module
reviews or the two reviewed units whose fixes are still pending. The broader
unit and integration portfolio remains part of the final repository production
gate.

### Config residual debt

The following bounded residuals are explicitly accepted. No critical or high
config finding remains open.

| Severity | Surface                                              | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Required resolution                                                                                                                                                  |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Moderate | Compatibility-only project fields                    | The schema, merge, extension boundary, and render-cache identity preserve `title`, `description`, `directories.ai`, `theme.colors`, `build.outDir/trailingSlash/esbuild`, `dev.host/open/hmrPort`, `theming`, `assetPipeline`, tracing/metrics project config, `search`, `fs.local.baseDir`, `fs.memory`, provider defaults, `ai.work`, `ai.mcp`, Tailwind plugin/theme/custom-CSS fields, and `openapi.mcp`. Core has no documented built-in semantics for these fields; silently treating schema acceptance as implementation would mislead users, while removing them would break extension and cache contracts. | Give a field one authoritative owner plus end-to-end tests before claiming built-in behavior, or use an explicit deprecation/breaking-change process before removal. |
| Low      | Cancellation of an already-active hosted source read | Loader waiters, admission, and queued reads honor `AbortSignal`, but the current filesystem adapter `readFile` contract cannot receive a signal. When the last waiter aborts, an active adapter read therefore remains counted against the two-read limit until the adapter settles. This preserves fail-closed accounting but cannot reclaim underlying I/O early.                                                                                                                                                                                                                                                 | Evolve the filesystem adapter contract and implementations to accept cancellation, then add adapter-level abort and resource-release tests.                          |

The compatibility surfaces are also documented in `src/config/README.md` and
the public configuration guide. A module-hardening pass must not erase them as
incidental cleanup.

Update this ledger in the same commit that closes or reopens an audit unit.
