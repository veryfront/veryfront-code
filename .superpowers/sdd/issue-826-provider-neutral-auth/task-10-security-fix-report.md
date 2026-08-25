# Task 10 security fix report

## Scope

This pass fixes the Task 10 scaffold, standalone MCP, template, manifest, and CLI classification findings only. It does not include Task 11 runtime-handler or OIDC runtime changes that are present in the shared worktree.

## Changes

- Hardened scaffold writing for `scaffoldProjectFile()` and auth scaffolds:
  - resolves project roots before planning,
  - rejects symlinked project roots,
  - rejects unsafe path components, traversal, duplicate targets, NTFS ADS `:` names, Windows reserved device names, trailing dot/space aliases, and COM/LPT superscript aliases,
  - constrains real auth template manifest outputs to project-root leaf files,
  - enforces max file count, path bytes, per-file bytes, and total bytes,
  - uses exclusive creation,
  - records created object identity for rollback,
  - skips and reports rollback residuals when ownership cannot be proven,
  - verifies opened targets are still contained before writing content.
- Preserved Windows operation when `dev`/`ino` identity is unavailable by allowing contained writes but refusing destructive rollback of unproven paths.
- Made standalone MCP validate `vf_scaffold` arguments before tool execution so invalid input returns JSON-RPC `-32602`.
- Kept standalone scaffold output project-relative for non-auth and auth paths, and preserved relative `projectPath` for auth and non-auth DevEx.
- Added an additive `failureKind` to scaffold results so CLI error classification no longer depends on message text.
- Kept scaffold conflicts classified as `already-exists`; unsafe/filesystem/auth setup failures classify as `config-invalid`.
- Hardened auth templates and tests:
  - no generated auth handlers, middleware, proxy, callback, token, session, or logout files,
  - no embedded secrets, JWTs, PEM private keys, bearer tokens, or high-entropy credentials,
  - explicit issuer, callback, PKCE, Authelia, Microsoft Entra, AD FS, Active Directory, Cloud, self-hosted, and horizontally scaled deployment guidance,
  - Authelia client example defaults to the minimal `openid` scope.
- Hardened auth manifest generation:
  - unknown auth preset directories fail,
  - missing required `templates/auth/_base/files` fails when auth templates exist,
  - provider files cannot override shared base files.

## Files changed

- `cli/scaffold/engine.ts`
- `cli/scaffold/engine.test.ts`
- `cli/mcp/standalone.ts`
- `cli/mcp/standalone.test.ts`
- `cli/commands/generate/command.ts`
- `cli/commands/generate/generate.integration.test.ts`
- `scripts/build/generate-templates-manifest.ts`
- `scripts/build/generated-artifact-checks.test.ts`
- `templates/index.test.ts`
- `templates/auth/_base/files/AUTH_SETUP.md`
- `templates/auth/_base/files/veryfront.auth.config.example.ts`
- `templates/auth/authelia/files/authelia.client.example.yml`
- `templates/manifest.json`
- `templates/manifest.generated.ts`

## Security boundary

Deno does not expose an `openat`/directory-handle relative create API with no-follow traversal for race-free descendant creation. This implementation therefore does not claim full atomic containment against a malicious local actor who can replace the project root exactly between the final root check and `Deno.open`.

The implemented boundary is:

- auth template manifests are constrained to project-root leaf files,
- symlink roots and unsafe existing prefixes are rejected before writing,
- after opening the file and before writing content, the root and opened target are checked again,
- if the final-check-to-open race is hit, tests prove Veryfront writes no scaffold content outside the selected root,
- rollback never removes an unproven replacement path.

On platforms without stable file identity, rollback reports the residual project-relative path instead of deleting it.

## Verification

- `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/scaffold/engine.test.ts cli/mcp/standalone.test.ts templates/index.test.ts cli/commands/generate/generate.integration.test.ts` -> passed, 5 files, 132 steps, 0 failures.
- `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all --config=scripts/test.deno.json scripts/build/generated-artifact-checks.test.ts` -> passed, 9 steps, 0 failures.
- `deno task generate:manifests:check` -> passed, generated template, dev UI, hydration runtime, client scripts, bridge, and RSC bundles current.
- `deno fmt --check ...` on touched Task 10 files -> passed.
- `deno lint ...` on touched Task 10 files -> passed.
- `deno check ...` on touched production/test modules -> passed.
- `git diff --check` -> passed.

## Not run

- Full repository test suite. Disk space was low, and the active instruction was to run only the focused Task 10 matrix.
