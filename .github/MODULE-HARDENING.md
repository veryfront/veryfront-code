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
| Closed                         |     2 |       3.4% | Current formal closure evidence remains valid       |
| Touched, revalidation required |    37 |      63.8% | Substantive recovered or current work exists        |
| Pending current review         |    19 |      32.8% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

Closed plus touched units give current-cycle substantive coverage of 39/58
(67.2%). This is progress coverage, not a substitute for the stricter closure
count.

### Closed

- `schemas`
- `version.ts`

### Touched, revalidation required

- `agent`
- `build`
- `cache`
- `channels`
- `client`
- `config`
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
- `testing`
- `transforms`
- `trigger`
- `types`
- `utils`
- `webhook`
- `index.ts`

### Pending current review

- `chat`
- `embedding`
- `eval`
- `issues`
- `knowledge`
- `markdown`
- `mcp`
- `mdx`
- `metrics`
- `prompt`
- `repositories`
- `resource`
- `runs`
- `sandbox`
- `skill`
- `studio`
- `task`
- `tool`
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

The active checkpoint is a cross-module boundary revalidation spanning cache
identity, project credentials and source selection, import-map immutability,
hosted API isolation, OpenAPI generation, and their rendering/server
consumers. Focused evidence for a boundary change does not by itself close
every top-level unit it touches; those units remain in revalidation until their
complete module review and affected repository gates are current.

`config` remains the next module-level closure target after this checkpoint is
verified, pushed, and rebased. Its declarative evaluator and bounded one-shot
worker boundary have focused tests, npm packaging coverage,
minimum-supported-Node coverage, and independent lifecycle review. The hosted
remote-filesystem loader now uses that boundary, but the complete unit remains
open while the accepted-but-unconsumed compatibility surfaces below are
resolved and the module is revalidated.

### Recovery checkpoint verification

The current cross-module recovery checkpoint has the following reproducible
evidence:

- Cache-key and data-cache regressions: 3 files, 86 tests and 67 steps passed.
- Import-map unit review: 7 files and 85 steps passed.
- Import-map integration review: 40 files and 487 steps passed.
- API/OpenAPI isolation and serialization review: 11 files and 300 steps
  passed.
- `deno task verify:quick` passed, including formatting, linting, static policy
  ratchets, sanitizer and skipped-test baselines, dependency and module
  boundaries, documentation validation, and full entrypoint typechecking.
- `deno task typecheck:consumer` rebuilt the npm and extension packages and
  passed the documented consumer-composition typecheck.
- `deno task docs:validate` passed all documentation contracts and 714 link
  checks.

These gates certify this integration checkpoint, not the 19 pending module
reviews. The broader unit and integration portfolio remains part of the final
repository production gate.

### Config residual debt

The following compatibility surfaces remain accepted by
`src/config/schemas/config.schema.ts`, but the production tree has no consumer
outside config parsing/merging. They are retained so the review does not
silently remove an accepted configuration contract.

| Severity | Surface         | Evidence and consequence                                                                                               | Required resolution                                                                                |
| -------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Moderate | `build.esbuild` | The schema and runtime merge preserve `wasmURL`/`worker`; production bundler initialization reads shared constants     | Wire the values into one authoritative bundler initializer with integration tests, or deprecate it |
| Moderate | `theming`       | The schema accepts `brandName`/`logoHtml`; no production code reads the field, so configuration silently has no effect | Add an owned rendering consumer and sanitization tests, or deprecate it                            |
| Moderate | `assetPipeline` | The schema accepts image pipeline options; no production build/runtime code reads the field                            | Implement the pipeline contract end to end, or deprecate it                                        |

Any future removal needs an explicit compatibility decision; a module-hardening
pass must not erase these surfaces as incidental cleanup.

Update this ledger in the same commit that closes or reopens an audit unit.
