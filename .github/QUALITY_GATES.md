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
manually dispatched runs, and trusted pull requests. A failed, skipped, or
cancelled dependency fails the aggregate check, except that Sonar is
intentionally skipped and ignored for fork and Dependabot pull requests because
those runs cannot receive `SONAR_TOKEN`. Fork pull requests still skip other
protected dependency jobs and therefore fail this aggregate gate closed.
Codecov reporting remains advisory.

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
rules to require. Those external branch protection or ruleset settings are not
configured or asserted by this document.

Evidence: [artifact implementation](../scripts/ci/npm-compatibility-artifact.ts),
[artifact contract](../tests/integration/ci/npm-compatibility-artifact.test.ts),
and [workflow contract](../tests/integration/ci/npm-compatibility-artifact-workflow.test.ts).

## 3. Registry release integrity

`quality gate (registry)` verifies the exact published package versions,
commit identity, npm provenance, configured registry, and clean-room package
behavior. Retries are bounded to registry propagation. Release dispatches run
only after this gate succeeds, so a failed registry check prevents every
downstream deployment dispatch.

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
