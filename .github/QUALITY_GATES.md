# Mandatory quality gates

Veryfront uses exactly three mandatory quality gates. Each gate has a stable
check name, fails closed when an expected dependency does not succeed, and
protects a distinct delivery boundary.

## 1. Merge correctness

`quality gate (merge)` requires source checks, unit tests, the existing
eight-shard coverage dependency with its 80 percent floor, integration tests,
the full Node and Bun runtime suites, binary end-to-end tests, and RSC browser
end-to-end tests to succeed for pull requests, merge queue runs, and main
pushes. Sonar analysis is also mandatory for merge queue runs, main pushes,
manually dispatched runs, and trusted pull requests. The scanner waits for the
server-side SonarQube Cloud Quality Gate, so the required
`SonarQube Cloud quality gate` check fails when that gate fails rather than only
when report upload fails. This uses only the scoped Execute Analysis
token and does not query private measures. A failed, skipped, or cancelled
dependency fails the aggregate check, except that Sonar is intentionally
skipped and ignored for fork and Dependabot pull requests because those runs
cannot receive `SONAR_TOKEN`. Fork pull requests still skip other protected
dependency jobs and therefore fail this aggregate gate closed. Codecov
reporting remains advisory.

A main push whose exact commit already passed a green merge queue run of this
workflow, with that run's artifacts still available, inherits the test results
from that run instead of re-running them. Both gates accept a skipped test
dependency only in that case. The Sonar scan still runs and still blocks, using
the merge queue run's coverage, and the release publishes that run's npm
artifact. Without such a run, main runs the full pipeline. Evidence:
[tested merge-queue run contract](../tests/integration/ci/tested-merge-queue-run-workflow.test.ts).

The scanner emits the diagnostic `SonarQube Cloud scan` check.
`SonarQube Cloud quality gate` is the only Sonar check required by the ruleset
and depends on that scanner result. Merge queue scans analyze the exact
generated commit as a pull-request analysis: `sonar.pullrequest.key` is the PR
number parsed from `gh-readonly-queue/main/pr-N-<sha>`,
`sonar.pullrequest.branch` is that queue ref, and `sonar.pullrequest.base` is
`main`. Unexpected queue refs fail before the scanner runs. PR mode reuses the
JS/TS analysis cache and evaluates new-code gate conditions. The current gate
contains only new-code conditions; main still runs its full branch analysis.

Queue scans share the originating PR's Sonar analysis identity. A queue rebuild
replaces that PR's earlier decoration instead of creating a SHA-isolated
branch. Each scan still waits for its server-side quality gate, and queue
analyses never target main's analysis. Sonar does not auto-detect `merge_group`
events, so the explicit PR properties are required. Ordinary pull requests and
main pushes retain Sonar's automatic detection.
The 28-minute scan budget, 20-minute server wait, required quality gate, and
single infrastructure-error retry remain unchanged.

The active merge queue ruleset gives required checks at least 70 minutes to
report a conclusion. This covers the longest configured dependency path: 60
minutes for binary end-to-end tests and 2 minutes for the aggregate merge gate,
plus 8 minutes of runner scheduling headroom. The sequential coverage and Sonar
path has a 62-minute maximum. The Sonar coverage report is merged in a
token-free job before the scan job, which holds `SONAR_TOKEN` and runs no
repository code.

Evidence: [CI workflow](workflows/cicd.yml) and
[merge gate contract](../tests/integration/ci/merge-quality-gate-workflow.test.ts).

## 2. Same-build artifact compatibility

`quality gate (artifact)` builds and packs one SHA-addressed npm artifact. Its
manifest records package versions and SHA-256 digests. Clean-room npm install
smoke tests and the Deno, Node, and Bun critical-flow lanes consume that same
artifact, and release jobs publish its verified tarballs directly. Veryfront
retains the canonical artifact for 30 days so production approval can publish
the exact tested package set.

For pull requests and merge queue runs, `quality gate (artifact)` is a separate
stable required check from `quality gate (merge)`. Runtime compatibility lanes
are aggregated only by the artifact gate, so `quality-gate-merge` does not
duplicate them. The workflow exposes both stable check names for repository
rules to require. The required `SonarQube Cloud quality gate` check is the
merge-blocking SonarQube Cloud quality gate. The separate
`SonarCloud Code Analysis` decoration remains informational because
secret-dependent analysis is intentionally skipped for Dependabot and fork pull
requests.

Evidence: [artifact implementation](../scripts/ci/npm-compatibility-artifact.ts),
[artifact contract](../tests/integration/ci/npm-compatibility-artifact.test.ts),
and [workflow contract](../tests/integration/ci/npm-compatibility-artifact-workflow.test.ts).

## 3. Registry release integrity

`quality gate (registry)` verifies the exact published package versions,
commit identity, npm provenance, configured registry, and clean-room package
behavior. Retries are bounded to registry propagation. Release dispatches run
only after this gate succeeds, so a failed registry check prevents every
downstream deployment dispatch. Validation runs as Linux AMD64 in a fresh,
read-only container built from a digest-pinned Node image and a
checksum-verified Deno archive. The image build uses an empty temporary context.
Runtime access is limited to a read-only source checkout, excluding `.git` and
`node_modules`, an anonymous `/registry` volume, a bounded `/tmp` tmpfs, npm
access through isolated bridge egress, and the exact release metadata
environment. Docker's default private PID namespace remains in effect. The
host does not execute repository scripts or local actions, and the container
is removed before the final registry-job steps create the scoped
release token. Validation is independent of whether the release published a
reused merge-queue artifact or a full-pipeline artifact: it reads only the
public registry and the checked-out source.

Evidence: [registry verification](../scripts/ci/registry-release-integrity.ts),
[registry smoke](../scripts/ci/registry-release-smoke.sh), and
[release ordering contract](../tests/integration/ci/registry-release-workflow.test.ts).

## Supporting signals

CodeQL and issue or pull request metrics remain useful supporting signals. They
help maintainers find risk, security findings, and process trends, but they are
not additional mandatory quality gates.

- CodeQL continues to report security and quality findings in its dedicated
  workflow.
- Issue and pull request metrics inform maintenance and process improvements.

## Observed baseline and estimated savings

The successful baseline pull request run
[`32780918864`](https://github.com/veryfront/veryfront-code/actions/runs/32780918864)
had 12 minutes 17 seconds of active CI wall time. Its 29 non-skipped jobs used
74.9 observed runner-minutes, and `tests (node)` used 12 minutes 2 seconds.

npm-build reuse: the [npm-compatibility-artifact job](workflows/cicd.yml)
builds the npm output once per commit, and every consumer job downloads the
built artifact instead of rebuilding it. The
[workflow contract test](../tests/integration/ci/npm-compatibility-artifact-workflow.test.ts)
pins the single-build invariant and the download ordering in each consumer.

## Main release runner budget

Main pushes enforce the server-side Sonar result in the scan job and evaluate
all merge correctness results as the first publisher step. Standalone
`SonarQube Cloud quality gate` and `quality gate (merge)` jobs still report on
pull requests and merge-group events with unchanged required names. Publishers
accept skipped correctness jobs only with the authoritative tested merge-queue
run id, and always require the fresh main Sonar gate to succeed. Fallback runs
require every correctness dependency to succeed.

Stable registry validation and downstream dispatch share one runner. RC registry
validation starts after npm publication on a read-only runner, in parallel with
GitHub asset preparation and upload. The canonical `quality gate (registry)`
joins both RC paths and fails unless npm publication, asset preparation, public
upload, and registry validation all succeed. Stable validation remains inline.
Every dispatch step requires successful validation, the selected publication
job, and public release upload, retains a five-minute timeout, and stays inside
the existing `production` approval environment. The validation container
terminates before token creation; no repository script or local action runs on
the host after validation. The standalone main Sonar and merge gate runners
remain folded without removing any gate.
