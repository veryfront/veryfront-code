# Task 3 report: deploy command adapters

## Outcome

Converted the deploy command human and JSON paths into adapters over `DeployProject.execute()`.

- `cli/commands/deploy/command.ts` now translates `DeployOptions` into one `DeployProjectRequest`, renders human progress/results from `DeployProjectOutcome`, and streams JSON events/results from the same outcome.
- `cli/commands/deploy/command.integration.test.ts` extends the canonical production read-back test to compare human and JSON `DeployResult` objects and assert the public JSON completed-step order with semantic `create-deployment` mapped to `deploy`.
- `cli/shared/deployment/deploy-project.ts` keeps dry-run `source: { kind: "already-pushed" }` compatible with `skipSourcePush` by not requiring a push receipt during dry-run.

`cli/commands/deploy/index.ts` did not need changes because the public command and compatibility exports remained stable.

## TDD evidence

Initial Task 3 RED attempt:

```bash
deno test --no-check --allow-all --filter="uses canonical production read-back in human and JSON modes" cli/commands/deploy/command.integration.test.ts
```

Observed result before implementation: passed. This assertion was not valid RED evidence because the existing fixture already produced equal human and JSON results despite duplicated orchestration.

Compatibility RED found during implementation:

```bash
deno test --no-check --allow-all cli/shared/deployment/control-plane.test.ts cli/shared/deployment/deploy-project.test.ts cli/commands/deploy/command.test.ts cli/commands/deploy/command.integration.test.ts
```

Observed failure before the shared-module dry-run compatibility fix:

```text
does not rewrite an existing local project link during dry-run deploy ... FAILED
Error: No verified push found for branch "main". Run veryfront push --branch main before deploying.
```

GREEN for that compatibility fix:

```bash
deno test --no-check --allow-all --filter="does not rewrite an existing local project link during dry-run deploy" cli/commands/deploy/command.integration.test.ts
```

Observed result:

```text
ok | 1 passed | 0 failed | 16 filtered out
```

## Verification

```bash
deno test --no-check --allow-all --filter="uses canonical production read-back in human and JSON modes" cli/commands/deploy/command.integration.test.ts
```

Result: passed, 1 test, 0 failures.

```bash
deno fmt --check cli/shared/deployment cli/commands/deploy
```

Result: passed, 13 files checked.

```bash
deno check cli/shared/deployment/deploy-project.ts cli/commands/deploy/command.ts
```

Result: passed.

```bash
deno test --no-check --allow-all cli/shared/deployment/control-plane.test.ts cli/shared/deployment/deploy-project.test.ts cli/commands/deploy/command.test.ts cli/commands/deploy/command.integration.test.ts
```

Result: passed, 35 tests, 81 steps, 0 failures.

```bash
git diff --check
```

Result: passed.

## Self-review

- Scope is limited to Task 3 command adapter conversion plus one required compatibility fix in `deploy-project.ts` for the existing `skipSourcePush` dry-run contract.
- Human quiet, human verbose, JSON result, JSON step order, dry-run result shape, routing warning, JSON error exit, and `suppressJsonOutput` behavior remain covered by existing integration tests.
- The public JSON step name remains `deploy`; the internal semantic event remains `create-deployment`.
- No MCP migration was performed.
- No new dependencies were added.

## Concerns

- The requested parity assertion did not produce RED before implementation. The full suite did produce a real RED on preserved `skipSourcePush` dry-run compatibility, and that RED drove the only shared-module change.
