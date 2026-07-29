# Deploy branch default audit report

## Summary

Fixed the deploy branch default so `veryfront deploy` resolves an omitted branch to `main` in both human and JSON paths. A feature-branch push receipt is no longer promoted implicitly; users must pass `--branch <name>` to deploy a feature branch.

## Changed files

- `cli/commands/deploy/command.ts` - removed push-receipt branch fallback from deploy branch resolution and updated the module summary.
- `cli/commands/deploy/command.integration.test.ts` - replaced the hidden latest-receipt behavior test with a regression test that exercises human and JSON omitted-branch deploys against a feature-only receipt.
- `cli/commands/deploy/command-help.ts` - updated deploy help to document `main` as the default branch.

## Verification

- Red test: `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/commands/deploy/command.integration.test.ts --filter "defaults omitted deploy branch"` failed before implementation with `AssertionError: Expected function to reject.`
- Focused regression: `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/commands/deploy/command.integration.test.ts --filter "defaults omitted deploy branch"` passed after implementation.
- Deploy suite: `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/commands/deploy/` passed, 35 tests, 92 steps.
- Format: `deno fmt --check cli/commands/deploy/command.ts cli/commands/deploy/command.integration.test.ts cli/commands/deploy/command-help.ts` passed.
- Typecheck: `deno check cli/commands/deploy/command.ts cli/commands/deploy/command.integration.test.ts cli/commands/deploy/command-help.ts` passed.
- Diff check: `git diff --check -- cli/commands/deploy/command.ts cli/commands/deploy/command.integration.test.ts cli/commands/deploy/command-help.ts` passed.

## Notes

- Explicit `--branch feature-x` behavior remains covered by the existing integration test that deploys from an explicitly selected feature push receipt.
- First deploy bootstrap remains coherent because the no-receipt path still pushes the resolved branch, which now defaults to `main`.
- A lone feature receipt plus omitted branch now fails closed through the existing receipt validation message instead of creating a release or deployment.
