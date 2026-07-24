# Module hardening ledger

This ledger tracks the production-hardening review of the 58 `src` audit
units: 56 top-level module directories plus `src/index.ts` and
`src/version.ts`.

The current snapshot covers branch `codex/module-reconcile-20260723` through
commit `75cd010d2`, rebased onto `origin/main` commit `100a47c70`.

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
| Touched, revalidation required |    36 |      62.1% | Substantive recovered or current work exists        |
| Pending current review         |    20 |      34.5% | No current authoritative-branch review delta exists |
| Total                          |    58 |     100.0% | All audit units                                     |

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
- `data`
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

`config` is the active unit. Its declarative evaluator and bounded one-shot
worker boundary have focused tests, npm packaging coverage, minimum-supported
Node coverage, and independent lifecycle review. The unit remains open until
the hosted remote-filesystem loader uses that boundary and the complete module
is revalidated.

Update this ledger in the same commit that closes or reopens an audit unit.
