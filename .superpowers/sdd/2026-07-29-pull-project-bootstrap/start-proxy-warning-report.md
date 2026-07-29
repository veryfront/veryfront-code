# Start proxy warning fix report

## Summary

Fixed the local `veryfront start` proxy warning path by adding an explicit CLI-local proxy environment marker before production bootstrap runs. Bootstrap now treats `PROXY_MODE=1` without that marker as hosted proxy mode and keeps hosted requirements strict.

## Changed files

- `cli/shared/server-startup.ts`
  - Added `prepareCliProxyModeEnvironment()`.
  - The helper sets `PROXY_MODE=1`, marks `VERYFRONT_CLI_LOCAL_PROXY_MODE=1`, and keeps the existing local `NODE_ENV=development` default when no runtime environment is set.
  - `startCliProxyModeServer()` now calls the helper before bootstrap.
- `cli/shared/server-startup.test.ts`
  - Added environment preparation tests for local CLI proxy marking and preserving an existing `DENO_ENV`.
- `src/server/bootstrap.ts`
  - Added local CLI proxy detection to production environment validation.
  - Local CLI proxy mode accepts development environment and a missing `CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY` without warning.
  - Hosted proxy mode still requires `NODE_ENV` and `CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY`.
  - Hosted non-production `NODE_ENV` warnings now use template literals so `%s` does not leak.
- `src/server/bootstrap.test.ts`
  - Added focused validation tests for local CLI proxy acceptance, hosted fatal missing `NODE_ENV`, hosted fatal missing signing key, and hosted warning interpolation.

## TDD evidence

- RED: `deno test --no-check --allow-all cli/shared/server-startup.test.ts src/server/bootstrap.test.ts`
  - Failed because `prepareCliProxyModeEnvironment` and `validateProductionEnvironmentForTests` did not exist.
- GREEN: `deno test --no-check --allow-all cli/shared/server-startup.test.ts src/server/bootstrap.test.ts`
  - Passed: 6 tests, 14 steps.

## Verification

- `deno test --no-check --allow-all cli/shared/server-startup.test.ts src/server/bootstrap.test.ts`
  - Passed: 6 tests, 14 steps.
- `deno test --no-check --allow-all tests/validation/014-deployment-modes/014.1-node-env-validation.test.ts`
  - Passed: 1 test, 7 steps.
- `deno check cli/shared/server-startup.ts cli/shared/server-startup.test.ts src/server/bootstrap.ts src/server/bootstrap.test.ts`
  - Passed.
- `deno fmt --check cli/shared/server-startup.ts cli/shared/server-startup.test.ts src/server/bootstrap.ts src/server/bootstrap.test.ts`
  - Passed.
- `git diff --check -- cli/shared/server-startup.ts cli/shared/server-startup.test.ts src/server/bootstrap.ts src/server/bootstrap.test.ts`
  - Passed.

## Notes and risks

- The marker is intentionally internal and only set by the CLI local proxy startup path.
- Hosted proxy behavior is stricter than before: `PROXY_MODE=1` without the local marker now rejects a missing signing key even when `NODE_ENV=development`.
- No new dependencies were added.
