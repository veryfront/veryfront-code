# Bun template smoke design

Date: 2026-05-26
Status: Approved (brainstorming)
Branch context: follow-up to the Node template smoke pass that produced commits
3240029b8, e1c1275a6, b83f425c9.

## Goal

Verify that every starter template scaffolded by `veryfront init` boots and serves
`/` under Bun. Produce both a one-time manual sweep (modeled on the Node pass)
and an ongoing automated nightly check.

## Scope

In scope:

- All seven templates: `minimal`, `ai-agent`, `docs-agent`, `multi-agent-system`,
  `agentic-workflow`, `coding-agent`, `saas-starter`.
- Bun only.
- Local manual walkthrough that produces small targeted fix commits.
- Automated test using the locally-built `veryfront` tarball.
- Nightly CI workflow with path-filtered PR runs.

Out of scope:

- Adding `bun` to the existing `cicd.yml` PR pipeline.
- Generating `deno.json` from `veryfront init` (would be needed for Deno smoke;
  explicitly deferred).
- Testing prod build (`bun run build`) — smoke covers `dev` only, matching the
  existing Deno test.
- Cross-platform CI; Linux-only.

## Background

- `cli/templates/files/<name>/` ships runtime-agnostic source (app/, README,
  tsconfig.json) — no `package.json`, no `deno.json`.
- `cli/commands/init/config-generator.ts` writes only a Node `package.json`
  with `scripts.dev = "veryfront dev"`. Same scaffold for every detected
  package manager.
- The npm bin wrapper (`scripts/build/bin-wrapper.js`) uses `node:` imports
  and a native binary fallback. Bun runs it through Node compatibility.
- `cicd.yml` is Deno-only; no Bun setup step today.
- The existing `tests/integration/templates/starter-templates-smoke.test.ts`
  boots the dev server in-process via `context.startDevServer` — Deno-only by
  construction.

## Manual walkthrough (Phase 1)

Per template:

1. Build the local npm package once: `deno task build:npm` → `./npm/`.
2. Scaffold via the local CLI:
   `deno run -A cli/main.ts init <name> -t <template> --skip-install --skip-env-prompt`.
3. Rewrite the scaffolded `package.json` so the `veryfront` dependency points
   at `file:<abs-path-to-./npm>`.
4. `bun install` in the scaffolded dir.
5. `bun run dev` in the background.
6. Poll `http://127.0.0.1:<port>/` until 200 or 30s timeout.
7. Click through any obvious in-app links the rendered page exposes (login
   → dashboard, doc URLs visible on the page), matching the Node sweep’s
   click-depth.
8. Kill the dev process.

For each finding, ship one small targeted fix commit (style of 3240029b8 and
e1c1275a6). One concern per commit.

Watch list:

- `pnpm.onlyBuiltDependencies` is ignored by Bun (cosmetic warning at worst).
- `esbuild` postinstall: Bun gates lifecycle scripts behind
  `trustedDependencies` by default. If `esbuild` is not trusted in the
  scaffolded `package.json`, its postinstall will not run and the dev server
  may fail at first import. If the manual sweep surfaces this, add `esbuild`
  (and `veryfront`) to `trustedDependencies` in the scaffold and re-test.
- Native binary fallback in `bin-wrapper.js`: JS fallback must work even when
  no native binary is bundled for the current target.
- `node:` prefix imports: supported by Bun.

## Automated test (Phase 2)

### Files

- New: `tests/integration/templates/bun-templates-smoke.test.ts`.
- New: `tests/_helpers/bun-runner.ts` — detect `bun` on PATH, spawn
  `bun install`, spawn `bun run dev`, poll for HTTP ready, kill the process
  tree.
- New: `tests/_helpers/local-tarball.ts` — resolve the path to `./npm/`. Hard
  fail with an actionable message ("Run `deno task build:npm` first") if missing.
- Extracted: `tests/_helpers/scaffold-template.ts` — pulled out of the existing
  Deno smoke test so both runtimes share one code path. Update the Deno test to
  consume it.

### Test shape

```ts
// Computed at module load so both `it.ignore` and the require-bun
// gate apply consistently. `await` is allowed at module top level.
const bunAvailable = await isBunAvailable();
const requireBun = Deno.env.get("VF_REQUIRE_BUN") === "1";
if (requireBun && !bunAvailable) {
  throw new Error("VF_REQUIRE_BUN=1 but `bun` is not on PATH");
}
const itMaybe = bunAvailable ? it : it.ignore;

describe("bun templates smoke", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  if (bunAvailable) {
    beforeAll(() => assertLocalTarballExists());
  }

  for (const template of STARTER_TEMPLATES) {
    itMaybe(`renders ${template} root route under bun`, async () => {
      await withTestContext(`bun-${template}`, async (ctx) => {
        await scaffoldTemplate(ctx.projectDir, template);
        await rewriteVeryfrontDep(ctx.projectDir, tarballPath);
        const port = await ctx.allocatePort();
        await bunInstall(ctx.projectDir);
        const proc = await bunRunDev(ctx.projectDir, { port });
        try {
          await waitForReady(`http://127.0.0.1:${port}/`, { timeoutMs: 30_000 });
          const res = await fetch(`http://127.0.0.1:${port}/`);
          assertEquals(res.status, 200);
        } finally {
          await killTree(proc);
        }
      });
    });
  }
});
```

### Behavior decisions

- Missing `bun`: every per-template test is registered with `it.ignore` so
  the suite is dormant locally without `bun` on PATH. When `VF_REQUIRE_BUN=1`
  is set (by the nightly workflow), absence of `bun` is a hard module-load
  error instead.
- Missing `./npm/` tarball: hard-fail in `beforeAll` with an actionable
  message ("Run `deno task build:npm` first") only when the suite is active.
- HTTP readiness timeout: 30s, polled inside `waitForReady`.
- Per-template overall budget: 90s, enforced by an `AbortController` that
  wraps the whole test body and triggers `killTree` on timeout. The Deno
  test runner’s default permissions are inherited; no `--timeout` flag
  manipulation.
- Cleanup kills the whole process group so the orphaned esbuild children
  do not hold ports.
- Templates run sequentially (no `it.concurrent`) to keep port races out of
  the picture.
- Each test writes dev-server stdout/stderr to a stable
  `${VF_BUN_SMOKE_LOG_DIR}/<template>.log` location (default
  `Deno.makeTempDirSync` root + `bun-smoke-logs/`). The path is logged at
  the start of the suite so the workflow can upload it as an artifact.
- Sanitizers off (`sanitizeOps: false, sanitizeResources: false`) to match
  the existing Deno smoke; child-process FDs are not worth fighting.

## Nightly workflow (Phase 3)

New file: `.github/workflows/template-bun-smoke.yml`.

```yaml
name: template-bun-smoke

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
  pull_request:
    paths:
      - "cli/templates/**"
      - "scripts/build/**"
      - "cli/commands/init/**"
      - ".github/workflows/template-bun-smoke.yml"

concurrency:
  group: template-bun-smoke-${{ github.ref }}
  cancel-in-progress: true

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-deno
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.1.x # pin; bump manually
      - run: deno task build:npm
      - run: mkdir -p "$RUNNER_TEMP/bun-smoke-logs"
      - env:
          VF_REQUIRE_BUN: "1"
          VF_BUN_SMOKE_LOG_DIR: ${{ runner.temp }}/bun-smoke-logs
        run: |
          deno task test:integration \
            -- tests/integration/templates/bun-templates-smoke.test.ts \
            --no-lock
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: bun-smoke-logs
          path: ${{ runner.temp }}/bun-smoke-logs/**/*.log
```

Notes:

- Bun version is pinned in the YAML; bumped manually, not via Dependabot, for
  now.
- No matrix across Node/Bun/Deno (Bun-only) and no OS matrix (Linux-only).
- No caching of `bun install` between templates within a single run.
- Failure notification reuses whatever scheme nightly workflows in this repo
  already inherit; no new wiring.

## Build sequence

Three deliverables, in order. Each is independently mergeable.

1. Phase 1: manual sweep. Land template fixes one commit at a time.
2. Phase 2: automated test, helpers, and `scaffoldTemplate` extraction.
   The test suite goes green in default CI because it soft-skips when
   `VF_REQUIRE_BUN` is unset.
3. Phase 3: nightly workflow. Validate via `workflow_dispatch` from the PR
   branch before merge.

Phase 1 first because the manual sweep historically produces fixes; landing
those first keeps the Phase 2 test green on day one.

## Error handling

| Condition                             | Behavior                                                                |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `bun` not on PATH, local              | Every per-template test registered via `it.ignore`; suite reports skips |
| `bun` not on PATH, `VF_REQUIRE_BUN=1` | Module-load error before any test runs                                  |
| `./npm/` not present (suite active)   | `beforeAll` throws with "Run `deno task build:npm` first"               |
| HTTP not ready in 30s                 | Test fails; dev-server log captured to `VF_BUN_SMOKE_LOG_DIR`           |
| Per-template > 90s overall            | `AbortController` cancels, `killTree` runs, test fails with timeout msg |
| `bun install` non-zero exit           | Test fails; install log captured                                        |
| Dev server exits early                | Test fails; stderr captured                                             |
| Cleanup fails to kill children        | Logged warning; test result unchanged                                   |

## Testing

The new test _is_ the testing for this work. No additional meta-tests planned.
The helpers (`bun-runner`, `local-tarball`, `scaffold-template`) are exercised
end-to-end by the seven template cases; no unit tests beyond that.

## Risks and open items

- **Bun version drift.** Pinning to `1.1.x` accepts patch-level drift between
  runs. If a Bun 1.1.x release breaks compatibility we will see it as a
  nightly red and pin tighter. Acceptable risk.
- **Tarball size.** `./npm/` may include large bundled assets; `bun install
  file:` copies, not links, so each of seven templates pays the copy cost.
  If it becomes painful, switch to `bun link` in a follow-up.
- **CI cost.** ~3–5 min per nightly run. Acceptable for the signal.
- **No Deno smoke.** Deferred; tracked as a separate concern (needs init to
  generate a `deno.json`).
