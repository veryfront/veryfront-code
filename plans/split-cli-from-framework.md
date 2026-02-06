# Split CLI from Framework

Move `src/cli/` to top-level `cli/` so that `src/` becomes purely the Veryfront **framework** (server, rendering, build, agents, etc.) and `cli/` becomes the CLI application built on top of it.

**PR:** #249
**Branch:** `refactor/split-cli-from-framework`

## Motivation

`src/` currently mixes framework code (what users import via `veryfront/*`) with CLI code (the `veryfront` command-line tool). These are two distinct concerns:

- **Framework** (`src/`) — server, rendering pipeline, build system, agents, routing, config, platform compat, etc. This is what users `import` in their Veryfront projects.
- **CLI** (`cli/`) — the `veryfront dev`, `veryfront build`, `veryfront deploy` commands. An application that orchestrates the framework.

Splitting them into sibling directories makes this boundary explicit.

## Constraints

- **Single package** — distribution stays as one `veryfront` package on JSR/npm. No separate versioning.
- **No user-facing changes** — `import { agent } from "veryfront/agent"` and `veryfront dev` continue to work identically.
- **Preserve git history** — use `git mv` for the move.

## Target Structure

```
veryfront-renderer/
  cli/                    <- CLI application (moved from src/cli/)
    main.ts               <- CLI entry point
    router.ts
    commands/              <- 26 commands (dev, build, deploy, etc.)
    shared/                <- CLI-specific types, arg parsers, constants
    ui/                    <- Colors, progress, TUI
    auth/                  <- OAuth login flow, token storage
    sync/                  <- Project sync, ignore patterns
    discovery/             <- AI entity discovery (agents, tools, prompts)
    mcp/                   <- MCP server for CLI
    app/                   <- Interactive TUI application
    help/                  <- Command help system
    templates/             <- Project scaffolding templates
    test-utils/            <- VCR test fixtures
    utils/                 <- CLI utilities
  src/                     <- Framework (unchanged, minus cli/)
    index.ts               <- Public framework exports
    server/
    proxy/
    build/
    rendering/
    react/
    agent/
    config/
    platform/
    utils/
      box.ts               <- Box drawing (moved from cli/ui/)
      ...
    ... (30+ framework modules)
  deno.json                <- Single config, exports from both
```

## Coupling Audit

### CLI -> Framework (10 cross-boundary relative imports)

These relative imports in `src/cli/` reach outside the CLI boundary. They must be converted to `#veryfront/*` aliases before the move.

| File | Current Import | Target Alias |
|------|---------------|--------------|
| `cli/mcp/server.ts` | `../../issues/core.ts` | `#veryfront/issues/core.ts` |
| `cli/commands/issues/command.ts` | `../../../issues/index.ts` | `#veryfront/issues` |
| `cli/commands/issues/command.test.ts` | `../../../issues/index.ts` | `#veryfront/issues` |
| `cli/mcp/tools.ts` | `../../issues/mcp.ts` | `#veryfront/issues/mcp.ts` |
| `cli/discovery/types.ts` | `../../platform/core-platform.ts` | `#veryfront/platform/core-platform.ts` |
| `cli/discovery/discovery-engine.ts` | `../../platform/core-platform.ts` | `#veryfront/platform/core-platform.ts` |
| `cli/mcp/tools/dev-tools.ts` | `../../../server/reload-notifier.ts` | `#veryfront/server/reload-notifier.ts` |
| `cli/commands/start/command.ts` | `../../../transforms/mdx/esm-module-loader/cache/index.ts` | `#veryfront/transforms/mdx/esm-module-loader/cache/index.ts` |
| `cli/commands/dev/handler.ts` | `../../../transforms/mdx/esm-module-loader/cache/index.ts` | `#veryfront/transforms/mdx/esm-module-loader/cache/index.ts` |
| `cli/commands/init/init-command.ts` | `../../../../lib/token-store` | No action — this is a string template written to user projects, not a compile-time import. `lib/` does not exist in the repo. |

### Framework -> CLI (1 reverse dependency — eliminated in Phase 1)

Only one framework file imports from CLI:

- `src/errors/user-friendly/error-formatter.ts` imports `box` from `#veryfront/cli/ui`

Resolution: move `box.ts` from `cli/ui/` to `src/utils/` before the split, inverting the dependency. After this, `error-formatter.ts` imports from the framework (`#veryfront/utils/box.ts`), and CLI consumers import from the framework too — correct direction. **Zero reverse dependencies remain.**

### External References

| Category | Count | Files |
|----------|-------|-------|
| Scripts | 7 | `generate-templates-manifest.ts`, `release.ts`, `test-production-fix.ts`, `build-npm-dnt.ts`, `build-all.js`, `lint-platform-agnostic.ts`, `validate-architecture.ts` |
| Tests | 11 | Integration tests under `tests/integration/cli/`, `tests/integration/ai/`, `tests/e2e/` |
| Config | 3 | `deno.json`, `tsconfig.json`, `npm/package.json` |
| CI/CD | 1 | `.github/workflows/cicd.yml` |
| Docs | 6+ | `DISTRIBUTION.md`, `SHARED_TASK_NOTES.md`, `plan.md`, example READMEs |

## Implementation Plan

### Phase 1: Pre-move cleanup

Convert cross-boundary imports and fix the reverse dependency while everything is still in `src/cli/`. This lets us verify these changes work before the move.

1. **Convert 9 relative imports to `#veryfront/*` aliases** (7 files)
   - The `#veryfront/` catch-all alias (`"#veryfront/": "./src/"`) already resolves `#veryfront/issues/*`, `#veryfront/platform/*`, etc. No new aliases needed.
   - Replace each `../../` / `../../../` import with the corresponding alias
   - The `init-command.ts` `../../../../lib/token-store` import is a string template (generated code for user projects), not a real import — no action needed.
   - Run `deno task verify:quick` to confirm

2. **Move `box.ts` to the framework** to eliminate the reverse dependency
   - `git mv src/cli/ui/box.ts src/utils/box.ts`
   - `git mv src/cli/ui/box.test.ts src/utils/box.test.ts`
   - `box.ts` imports 6 helpers from `cli/ui/layout.ts` and `cli/ui/ansi.ts` (`lines`, `maxLineWidth`, `pad`, `repeat`, `visibleLength`, `RESET`, `ANSI_REGEX`, `stripAnsi`). These are ~30 lines of pure string functions. Inline them directly in `box.ts` to make it self-contained — no new dependency chain.
   - Update `error-formatter.ts`: `import { box } from "#veryfront/utils/box.ts"`
   - Update CLI consumers to use alias instead of relative imports:
     - `cli/ui/components/banner.ts` → `import { BORDER_STYLES, box } from "#veryfront/utils/box.ts"`
     - `cli/app/views/dashboard.ts` → `import { box } from "#veryfront/utils/box.ts"`
     - `cli/app/views/startup.ts` → `import { box } from "#veryfront/utils/box.ts"`
   - Remove `export * from "./box.ts"` from `cli/ui/index.ts`
   - Run `deno task verify:quick` to confirm

### Phase 2: The move

3. **`git mv src/cli cli`**

### Phase 3: Update all references

These are independent and can be done in parallel:

4. **Update `deno.json`**
   - `exports`: `"./cli": "./cli/main.ts"`
   - `exclude`: `cli/templates/files/`, `cli/templates/integrations/`
   - `tasks`: all 10+ tasks referencing `src/cli/main.ts` -> `cli/main.ts`
   - `lint.include` / `fmt.include`: add `cli/**/*.ts`, `cli/**/*.tsx`
   - `typecheck`: update `src/cli/main.ts` -> `cli/main.ts`

5. **Update `tsconfig.json`** — `#veryfront/cli/*` path mapping

6. **Update `npm/package.json`** — CLI entry point path

7. **Update scripts** (7 files)
   - `scripts/generate-templates-manifest.ts` — template dir paths
   - `scripts/release.ts` — import path + config-generator reference
   - `scripts/test-production-fix.ts` — CLI main path
   - `scripts/build-npm-dnt.ts` — **CRITICAL:** the `postBuild()` bin wrapper hardcodes `await import('../esm/src/cli/index.js')`. After the move, dnt outputs CLI to `npm/esm/cli/` (not `npm/esm/src/cli/`). Must update to `await import('../esm/cli/main.js')`.
   - `scripts/build-all.js` — compile target
   - `scripts/lint-platform-agnostic.ts` — exception path
   - `scripts/validate-architecture.ts` — layer definitions

8. **Update CI/CD** — `.github/workflows/cicd.yml` compile target

9. **Update test files** (11 files)
   - `tests/integration/ai/auto-discovery.test.ts`
   - `tests/integration/cli/build-command-error.test.ts`
   - `tests/integration/cli/commands/*.test.ts` (6 files)
   - `tests/integration/cli/auth.test.ts`
   - `tests/e2e/setup/binary.ts`
   - `tests/integration/compiled-binary-e2e.test.ts`

10. **Update documentation** (6+ files)
    - `SHARED_TASK_NOTES.md`, `DISTRIBUTION.md`, `plan.md`
    - `cli/README.md` (was `src/cli/README.md`)
    - `examples/agent-code-assistant/README.md`, `examples/coding-agent/README.md`

### Phase 4: Verify & ship

11. **Run full verification**
    - `deno task verify:quick` (fmt + lint + typecheck)
    - `deno task test:unit`
    - `deno task test:integration:cli`
    - Binary compile: `deno task build`

12. **Commit & push**

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Missed import reference | Low | Full grep audit completed; verification suite catches remaining |
| npm build bin wrapper breakage | **High** | `build-npm-dnt.ts` `postBuild()` hardcodes `'../esm/src/cli/index.js'` in bin wrapper — must change to `'../esm/cli/main.js'` after the move. dnt auto-generates `npm/package.json` exports from `deno.json`, so those self-correct, but the bin wrapper is manual. |
| Git history fragmentation | None | `git mv` preserves history |

## Not In Scope

- Renaming `#veryfront/*` aliases (they stay as-is)
- Adding a separate `deno.json` for `cli/` (single config is fine)
- Changing the `veryfront` package name or exports
- Moving tests from `tests/integration/cli/` (they test CLI from outside, path is appropriate)
