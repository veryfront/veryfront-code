# PR 5379 review status repair

## Problem
A mutable review summary retains historical findings after they are resolved. Updating it after a clean exact-head receipt incorrectly resets source review status and fails its active merge-group status.

## Solution
Treat historical findings as blocking unless their unresolved state is explicitly false. Do not promote a historical summary to clean proof. Require a separate valid clean receipt or other existing accepted proof.

## Implementation and tests
1. Add regression coverage for resolved code and security findings updated after a clean receipt. Assert summary alone cannot approve.
2. Change only the summary blocking predicate.
3. Run the review gate suite and replay captured PR evidence.
4. Document the missing required check separately. Restoring enforcement is a repository settings decision; preserve its existing admin exception if enabled.

## Verification criteria
Resolved history plus clean exact-head receipt passes. Unresolved and unknown findings remain blocking. Full review gate tests pass. Real incident evidence resolves to a clean receipt.

## Demo runbook
Prerequisite: Deno and repository dependencies. Run `deno task test:file scripts/ci/automated-review-gate.test.ts`. Pass criterion: all tests pass, including resolved-history regression. This is a backend CI policy change with no UI demo. GitHub main remains affected until the repair lands and statuses are reconciled. Do not claim live recovery before that verification.

See issue-5379-research.md for evidence and links.

## Verification results
- Regression failed before the predicate change: expected codex-comment, got undefined.
- After repair: `deno task test:file scripts/ci/automated-review-gate.test.ts` passed 11 suites and 194 steps.
- Captured real PR comments, reviews, and timeline replay now returns the clean exact-head receipt 6359081336; before repair it returned undefined.
- `git diff --check` passed.
- Targeted Deno lint reports three existing require-await errors. Running lint on the unchanged HEAD module reproduces the same three errors. No unrelated cleanup included.
- Tests ran with local Deno 2.9.4. No generated artifacts were rebuilt; CI pins 2.9.7.
- Live main status recovery has not been performed. The parser must land before normal reconciliation can safely restore the status. Repository enforcement restoration was presented as a separate decision.
