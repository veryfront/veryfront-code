# Bun template smoke implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify every starter template scaffolded by `veryfront init` boots under Bun via (1) a manual sweep that produces targeted fix commits, (2) an automated Deno-driven smoke suite, and (3) a nightly GitHub Actions workflow.

**Architecture:** Tests live alongside the existing Deno smoke suite under `tests/integration/templates/`. New thin helpers under `tests/_helpers/` wrap Bun subprocess management and local-tarball resolution. CI runs the suite nightly (cron) and on PRs touching template/init/build/workflow paths only. The suite soft-skips when `bun` is unavailable locally and hard-fails when `VF_REQUIRE_BUN=1` is set (the workflow sets it).

**Tech Stack:** Deno test runner (BDD describe/it), `Deno.Command` for subprocesses, Bun 1.1.x, GitHub Actions, `oven-sh/setup-bun@v2`.

**Spec:** `docs/superpowers/specs/2026-05-26-bun-template-smoke-design.md`.

---

## File map

**New files:**

- `tests/_helpers/scaffold-template.ts` — extracted from the existing Deno smoke test; one shared scaffolder.
- `tests/_helpers/local-tarball.ts` — resolves `./npm/`, asserts presence, rewrites the `veryfront` dep in a scaffolded `package.json` to `file:` form.
- `tests/_helpers/bun-runner.ts` — detects `bun`, runs `bun install`, runs `bun run dev`, polls HTTP readiness, kills process trees, writes per-template logs.
- `tests/integration/templates/bun-templates-smoke.test.ts` — the Bun smoke suite.
- `.github/workflows/template-bun-smoke.yml` — nightly + path-filtered PR workflow.

**Modified files:**

- `tests/integration/templates/starter-templates-smoke.test.ts` — switch to shared `scaffoldTemplate` helper (one-line behavior change, no test changes).

---

## Phase 1 — Manual sweep

The output is fix commits, not test infra. The procedure below is what the engineer runs by hand; each finding becomes one small commit in the style of 3240029b8, e1c1275a6.

### Task 1: Build the local npm tarball

**Files:** None (produces `./npm/`).

- [ ] **Step 1: Run the npm build.**

```bash
deno task build:npm
```

Expected: completes successfully, ends with `./npm/` populated. Check:

```bash
ls -la ./npm/package.json ./npm/esm ./npm/script ./npm/bin
```

- [ ] **Step 2: Capture the absolute tarball path for reuse.**

```bash
NPM_TARBALL="$(realpath ./npm)"
echo "$NPM_TARBALL"
```

Keep this in the shell for the rest of Phase 1.

### Task 2: Run the seven-template smoke sweep

**Files:** None (writes to ephemeral temp dirs).

- [ ] **Step 1: Write a one-off sweep script that you run interactively.**

Save as `scripts/_sweep/bun-sweep.sh` (gitignored — do not commit):

```bash
#!/usr/bin/env bash
set -u
NPM_TARBALL="${NPM_TARBALL:-$(realpath ./npm)}"
TEMPLATES=(minimal ai-agent docs-agent multi-agent-system agentic-workflow coding-agent saas-starter)
RESULTS=()
for t in "${TEMPLATES[@]}"; do
  WORK="$(mktemp -d -t "bun-sweep-${t}-XXXX")"
  echo "==> ${t} in ${WORK}"
  pushd "$WORK" >/dev/null

  deno run -A "$OLDPWD/cli/main.ts" init "${t}-app" \
    -t "${t}" --skip-install --skip-env-prompt --force \
    || { RESULTS+=("${t}: scaffold-failed"); popd >/dev/null; continue; }

  cd "${t}-app"

  # Repoint veryfront at the local tarball.
  node -e "
    const p = require('./package.json');
    p.dependencies.veryfront = 'file:' + process.env.NPM_TARBALL;
    require('fs').writeFileSync('package.json', JSON.stringify(p, null, 2));
  " || { RESULTS+=("${t}: rewrite-failed"); popd >/dev/null; continue; }

  bun install --no-summary > install.log 2>&1 \
    || { RESULTS+=("${t}: bun-install-failed (see ${WORK}/${t}-app/install.log)"); popd >/dev/null; continue; }

  PORT="$(( ( RANDOM % 5000 ) + 41000 ))"
  PORT="$PORT" bun run dev > dev.log 2>&1 &
  DEV_PID=$!

  # Poll up to 30s.
  READY=0
  for i in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${PORT}/" -o /dev/null 2>/dev/null; then
      READY=1; break
    fi
    sleep 0.5
  done

  if [ "$READY" = "1" ]; then
    RESULTS+=("${t}: OK")
  else
    RESULTS+=("${t}: not-ready (see ${WORK}/${t}-app/dev.log)")
  fi

  kill -- -"$DEV_PID" 2>/dev/null || kill "$DEV_PID" 2>/dev/null || true
  sleep 1

  popd >/dev/null
done

printf '\n=== SUMMARY ===\n'
printf '%s\n' "${RESULTS[@]}"
```

Make executable and run:

```bash
mkdir -p scripts/_sweep && chmod +x scripts/_sweep/bun-sweep.sh
echo 'scripts/_sweep/' >> .git/info/exclude     # local-only, do not commit
NPM_TARBALL="$(realpath ./npm)" ./scripts/_sweep/bun-sweep.sh
```

Expected: a `=== SUMMARY ===` block listing each of seven templates as `OK` or with a failure reason and a log path.

- [ ] **Step 2: For each non-OK template, open the captured log and read the actual error.**

```bash
less /tmp/bun-sweep-<template>-XXXX/<template>-app/dev.log
# or
less /tmp/bun-sweep-<template>-XXXX/<template>-app/install.log
```

Triage each finding into one of three buckets:

- **In-scope fix here**: small, template-local (e.g. dead link, wrong import path, missing default). Continue to Task 3.
- **Out-of-scope fix**: requires touching `cli/`, `src/`, or `scripts/build/`. File an issue or follow-up PR; do not fix in this branch.
- **Known-broken Bun gap**: e.g. esbuild postinstall blocked by `trustedDependencies`. If the fix is small and template-scoped (adding `trustedDependencies` to the scaffolded `package.json`), do it in Task 3. Otherwise file a follow-up.

### Task 3: Ship one fix commit per finding

**Files:** Variable per finding. Typical edits:

- `cli/templates/files/<template>/...` for in-template content fixes.
- `cli/commands/init/config-generator.ts` for scaffold-wide adjustments (e.g. adding `trustedDependencies`).
- `cli/templates/manifest.json` — regenerated automatically when template files change; do **not** edit by hand. See Step 4 below.

- [ ] **Step 1: For each finding, reproduce it by hand outside the sweep script.**

This forces you to write a minimal failing case before fixing. Use a temp dir, scaffold one template, repoint to the tarball, install, run dev, observe the failure.

- [ ] **Step 2: Make the smallest possible code change to fix it.**

One concern per commit. If you find yourself also "cleaning up" surrounding code, stop — that goes in a follow-up.

- [ ] **Step 3: Regenerate the templates manifest if you touched any file under `cli/templates/files/`.**

```bash
deno run -A scripts/build/generate-templates-manifest.ts
```

- [ ] **Step 4: Re-run the sweep script to confirm the fix.**

```bash
NPM_TARBALL="$(realpath ./npm)" ./scripts/_sweep/bun-sweep.sh
```

Expected: the previously failing template now reports `OK`.

- [ ] **Step 5: Commit, one finding per commit.**

```bash
git add cli/templates/files/<template>/<file> cli/templates/manifest.json
git commit -m "$(cat <<'EOF'
<imperative one-liner>

<2-3 line explanation of the bug, what the fix does, and a "Discovered while
smoke-testing every starter template via veryfront init under Bun." trailer.>
EOF
)"
```

- [ ] **Step 6: After all findings are fixed, re-run the sweep one final time.**

Expected: every template reports `OK`.

- [ ] **Step 7: Commit a Phase 1 completion checkpoint.**

If there's nothing left to commit, skip. Otherwise:

```bash
git status     # confirm clean
git log --oneline -10
```

Take a screenshot of the summary block (or paste it into the PR comment) so reviewers can see the final state.

---

## Phase 2 — Automated test infrastructure

TDD discipline: write the end-to-end test that drives the API, watch it fail, implement helpers minimally, watch it pass, commit. The `bun-templates-smoke.test.ts` file is the spec for the helpers.

### Task 4: Extract `scaffoldTemplate` into a shared helper

**Files:**

- Create: `tests/_helpers/scaffold-template.ts`
- Modify: `tests/integration/templates/starter-templates-smoke.test.ts`

- [ ] **Step 1: Create the shared helper.**

`tests/_helpers/scaffold-template.ts`:

```ts
import { dirname, join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { getTemplate } from "../../cli/templates/index.ts";
import type { TemplateName } from "../../cli/templates/types.ts";

export async function scaffoldTemplate(
  projectDir: string,
  templateName: TemplateName,
): Promise<void> {
  const files = await getTemplate(templateName);
  if (!files) {
    throw new Error(`Template ${templateName} was not found`);
  }
  for (const file of files) {
    const targetPath = join(projectDir, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeTextFile(targetPath, file.content);
  }
}
```

- [ ] **Step 2: Update the existing Deno smoke test to use it.**

In `tests/integration/templates/starter-templates-smoke.test.ts`:

Remove the local `scaffoldTemplate` function (lines 21-32 in the current file) and replace the import block at the top:

```ts
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { writeTextFile } from "#veryfront/testing/deno-compat.ts";

import type { TemplateName } from "../../../cli/templates/types.ts";
import { scaffoldTemplate } from "../../_helpers/scaffold-template.ts";
import { withTestContext } from "../../_helpers/context.ts";
import { createTestDenoConfig } from "../../_helpers/import-maps.ts";
```

- [ ] **Step 3: Run the existing Deno smoke to confirm no behavior change.**

```bash
deno task test:integration -- tests/integration/templates/starter-templates-smoke.test.ts --no-lock
```

Expected: all 7 cases pass (same as before).

- [ ] **Step 4: Commit.**

```bash
git add tests/_helpers/scaffold-template.ts tests/integration/templates/starter-templates-smoke.test.ts
git commit -m "Extract scaffoldTemplate into shared test helper"
```

### Task 5: Add `local-tarball` helper with failing assertions

**Files:**

- Create: `tests/_helpers/local-tarball.ts`

- [ ] **Step 1: Implement the helper.**

`tests/_helpers/local-tarball.ts`:

```ts
import { resolve } from "#veryfront/compat/path";
import { exists } from "../../src/platform/compat/fs.ts";
import { readTextFile, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { join } from "#veryfront/compat/path";

/** Repo-root-relative path to the dnt-built npm package. */
export function getLocalTarballPath(): string {
  return resolve(Deno.cwd(), "npm");
}

export async function assertLocalTarballExists(): Promise<void> {
  const tarball = getLocalTarballPath();
  const pkgJson = join(tarball, "package.json");
  if (!(await exists(pkgJson))) {
    throw new Error(
      `Local npm tarball not found at ${tarball}/package.json. ` +
        `Run \`deno task build:npm\` before running the Bun smoke suite.`,
    );
  }
}

/**
 * Rewrites the scaffolded package.json so the `veryfront` dependency
 * points at the locally-built tarball directory via Bun's `file:` spec.
 */
export async function rewriteVeryfrontDep(
  projectDir: string,
  tarballPath: string,
): Promise<void> {
  const pkgPath = join(projectDir, "package.json");
  const raw = await readTextFile(pkgPath);
  const pkg = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    trustedDependencies?: string[];
  };
  pkg.dependencies = pkg.dependencies ?? {};
  pkg.dependencies.veryfront = `file:${tarballPath}`;

  // Bun gates lifecycle scripts behind trustedDependencies. esbuild
  // needs its postinstall to materialize the native binary.
  const trusted = new Set(pkg.trustedDependencies ?? []);
  trusted.add("veryfront");
  trusted.add("esbuild");
  pkg.trustedDependencies = [...trusted].sort();

  await writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}
```

- [ ] **Step 2: Lint and typecheck.**

```bash
deno fmt tests/_helpers/local-tarball.ts
deno check tests/_helpers/local-tarball.ts
```

Expected: both succeed.

- [ ] **Step 3: Commit.**

```bash
git add tests/_helpers/local-tarball.ts
git commit -m "Add local-tarball helper for Bun smoke test"
```

### Task 6: Add `bun-runner` helper

**Files:**

- Create: `tests/_helpers/bun-runner.ts`

- [ ] **Step 1: Implement the helper.**

`tests/_helpers/bun-runner.ts`:

```ts
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/testing/deno-compat.ts";

export interface BunProc {
  child: Deno.ChildProcess;
  pid: number;
  logPath: string;
}

export async function isBunAvailable(): Promise<boolean> {
  try {
    const cmd = new Deno.Command("bun", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    });
    const { code } = await cmd.output();
    return code === 0;
  } catch {
    return false;
  }
}

export function getLogDir(): string {
  return Deno.env.get("VF_BUN_SMOKE_LOG_DIR") ??
    join(Deno.env.get("TMPDIR") ?? "/tmp", "bun-smoke-logs");
}

async function ensureLogDir(): Promise<string> {
  const dir = getLogDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function bunInstall(projectDir: string, label: string): Promise<void> {
  const logDir = await ensureLogDir();
  const logPath = join(logDir, `${label}.install.log`);
  const cmd = new Deno.Command("bun", {
    args: ["install", "--no-summary"],
    cwd: projectDir,
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  const dec = new TextDecoder();
  await writeTextFile(logPath, dec.decode(stdout) + "\n----STDERR----\n" + dec.decode(stderr));
  if (code !== 0) {
    throw new Error(`bun install failed (exit ${code}) — log: ${logPath}`);
  }
}

export async function bunRunDev(
  projectDir: string,
  opts: { port: number; label: string },
): Promise<BunProc> {
  const logDir = await ensureLogDir();
  const logPath = join(logDir, `${opts.label}.dev.log`);
  // Open log file for streamed writes via Deno.open.
  const file = await Deno.open(logPath, { create: true, write: true, truncate: true });
  const cmd = new Deno.Command("bun", {
    args: ["run", "dev"],
    cwd: projectDir,
    env: { ...Deno.env.toObject(), PORT: String(opts.port) },
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  // Pipe both streams into the log file in the background.
  child.stdout.pipeTo(file.writable, { preventClose: true }).catch(() => {});
  child.stderr.pipeTo(file.writable, { preventClose: true }).catch(() => {});
  return { child, pid: child.pid, logPath };
}

export async function waitForReady(
  url: string,
  opts: { timeoutMs: number },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      // Drain the body so the connection closes.
      await res.body?.cancel();
      if (res.status >= 200 && res.status < 500) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Server at ${url} not ready within ${opts.timeoutMs}ms` +
      (lastError ? ` (last error: ${String(lastError)})` : ""),
  );
}

export async function killTree(proc: BunProc): Promise<void> {
  // Best-effort process-group kill on POSIX, falls back to single-process kill.
  try {
    // Negative PID targets the group when the child started a new session.
    // We didn't request a new session; kill the parent and its tree via SIGTERM.
    proc.child.kill("SIGTERM");
  } catch { /* already dead */ }
  // Give it 2s to exit, then SIGKILL.
  const done = await Promise.race([
    proc.child.status,
    new Promise<{ code: number }>((r) => setTimeout(() => r({ code: -1 }), 2000)),
  ]);
  if (done.code === -1) {
    try {
      proc.child.kill("SIGKILL");
    } catch { /* already dead */ }
    await proc.child.status;
  }
}
```

- [ ] **Step 2: Lint and typecheck.**

```bash
deno fmt tests/_helpers/bun-runner.ts
deno check tests/_helpers/bun-runner.ts
```

Expected: both succeed.

- [ ] **Step 3: Commit.**

```bash
git add tests/_helpers/bun-runner.ts
git commit -m "Add bun-runner helper (spawn, wait, kill)"
```

### Task 7: Write the failing Bun smoke test with `minimal` only

Use a single template first to drive the full pipeline. The other six come in Task 8.

**Files:**

- Create: `tests/integration/templates/bun-templates-smoke.test.ts`

- [ ] **Step 1: Write the test.**

`tests/integration/templates/bun-templates-smoke.test.ts`:

```ts
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import type { TemplateName } from "../../../cli/templates/types.ts";
import { scaffoldTemplate } from "../../_helpers/scaffold-template.ts";
import { withTestContext } from "../../_helpers/context.ts";
import {
  assertLocalTarballExists,
  getLocalTarballPath,
  rewriteVeryfrontDep,
} from "../../_helpers/local-tarball.ts";
import {
  bunInstall,
  bunRunDev,
  isBunAvailable,
  killTree,
  waitForReady,
} from "../../_helpers/bun-runner.ts";

const STARTER_TEMPLATES: TemplateName[] = ["minimal"];

const bunAvailable = await isBunAvailable();
const requireBun = Deno.env.get("VF_REQUIRE_BUN") === "1";
if (requireBun && !bunAvailable) {
  throw new Error(
    "VF_REQUIRE_BUN=1 but `bun` is not on PATH. Install bun in the runner.",
  );
}
const itMaybe = bunAvailable ? it : it.ignore;

describe("bun templates smoke", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  if (bunAvailable) {
    // Hard-fail early if the tarball is missing.
    void assertLocalTarballExists();
  }

  for (const template of STARTER_TEMPLATES) {
    itMaybe(`renders ${template} root route under bun`, async () => {
      await withTestContext(`bun-${template}`, async (ctx) => {
        await scaffoldTemplate(ctx.projectDir, template);
        await rewriteVeryfrontDep(ctx.projectDir, getLocalTarballPath());

        const port = await ctx.allocatePort();
        await bunInstall(ctx.projectDir, template);
        const proc = await bunRunDev(ctx.projectDir, { port, label: template });

        const abort = new AbortController();
        const budget = setTimeout(() => abort.abort(), 90_000);
        try {
          await waitForReady(`http://127.0.0.1:${port}/`, { timeoutMs: 30_000 });
          const res = await fetch(`http://127.0.0.1:${port}/`);
          await res.body?.cancel();
          assertEquals(res.status, 200);
        } finally {
          clearTimeout(budget);
          await killTree(proc);
        }
      });
    });
  }
});
```

- [ ] **Step 2: Run the test (it should fail until the tarball exists).**

```bash
deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
```

Expected: depends on local state.

- If `bun` is not installed: the `it.ignore` branch fires and the suite is reported as 0 passed / 0 failed / 7 ignored… but with only 1 template here, just 1 ignored. **Verify `it.ignore` behavior matches this expectation** — if the runner reports a hard failure instead, switch to a top-level `if (!bunAvailable) return;` guard around `describe`.
- If `bun` is installed but `./npm/` is missing: the `assertLocalTarballExists()` call inside `describe` throws and the suite fails with the "Run `deno task build:npm` first" message.
- If both are present: the test should actually run end-to-end and (assuming Phase 1 fixed everything) pass.

- [ ] **Step 3: Build the tarball if you haven't already, then re-run.**

```bash
deno task build:npm
deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
```

Expected: `minimal` template passes.

- [ ] **Step 4: Commit.**

```bash
git add tests/integration/templates/bun-templates-smoke.test.ts
git commit -m "Add Bun smoke suite skeleton (minimal template only)"
```

### Task 8: Expand the suite to all seven templates

**Files:**

- Modify: `tests/integration/templates/bun-templates-smoke.test.ts`

- [ ] **Step 1: Replace the template list.**

In `tests/integration/templates/bun-templates-smoke.test.ts`, change:

```ts
const STARTER_TEMPLATES: TemplateName[] = ["minimal"];
```

to:

```ts
const STARTER_TEMPLATES: TemplateName[] = [
  "minimal",
  "ai-agent",
  "docs-agent",
  "multi-agent-system",
  "agentic-workflow",
  "coding-agent",
  "saas-starter",
];
```

- [ ] **Step 2: Run the full suite locally.**

```bash
deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
```

Expected: all 7 pass. If any fail, treat as a Phase 1 finding that slipped through — fix in a follow-up commit (still on this branch), then re-run until clean.

Total time budget for the run: ≤ 7 templates × 90s = ~10 min worst case, typically 3-5 min.

- [ ] **Step 3: Commit.**

```bash
git add tests/integration/templates/bun-templates-smoke.test.ts
git commit -m "Run Bun smoke suite against all seven templates"
```

### Task 9: Verify soft-skip and hard-fail behavior

**Files:** None (verification only).

- [ ] **Step 1: Verify soft-skip when `bun` is hidden.**

```bash
PATH="$(echo $PATH | tr ':' '\n' | grep -v bun | paste -sd:)" \
  deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
```

Expected: all 7 cases reported as ignored, exit code 0.

- [ ] **Step 2: Verify hard-fail when `VF_REQUIRE_BUN=1` and `bun` is hidden.**

```bash
PATH="$(echo $PATH | tr ':' '\n' | grep -v bun | paste -sd:)" \
VF_REQUIRE_BUN=1 \
  deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
```

Expected: non-zero exit, error message mentions `VF_REQUIRE_BUN=1`.

- [ ] **Step 3: Verify hard-fail when tarball is missing.**

```bash
mv ./npm ./npm.bak
deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
EXIT=$?
mv ./npm.bak ./npm
[ "$EXIT" != "0" ] || echo "BUG: expected non-zero exit when tarball is missing"
```

Expected: non-zero exit, message mentions "Run `deno task build:npm` first".

- [ ] **Step 4: Restore everything and re-run the green case.**

```bash
deno task test:integration -- tests/integration/templates/bun-templates-smoke.test.ts --no-lock
```

Expected: all 7 pass.

- [ ] **Step 5: No commit needed (verification only). Push.**

```bash
git push
```

---

## Phase 3 — Nightly workflow

### Task 10: Add the workflow file

**Files:**

- Create: `.github/workflows/template-bun-smoke.yml`

- [ ] **Step 1: Write the workflow.**

`.github/workflows/template-bun-smoke.yml`:

```yaml
name: template-bun-smoke

on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:
  pull_request:
    paths:
      - "cli/templates/**"
      - "cli/commands/init/**"
      - "scripts/build/**"
      - "tests/_helpers/scaffold-template.ts"
      - "tests/_helpers/bun-runner.ts"
      - "tests/_helpers/local-tarball.ts"
      - "tests/integration/templates/bun-templates-smoke.test.ts"
      - ".github/workflows/template-bun-smoke.yml"

concurrency:
  group: template-bun-smoke-${{ github.ref }}
  cancel-in-progress: true

jobs:
  smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup-deno
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.1.x
      - name: Build npm package
        run: deno task build:npm
      - name: Prepare log dir
        run: mkdir -p "$RUNNER_TEMP/bun-smoke-logs"
      - name: Run Bun smoke suite
        env:
          VF_REQUIRE_BUN: "1"
          VF_BUN_SMOKE_LOG_DIR: ${{ runner.temp }}/bun-smoke-logs
        run: |
          deno task test:integration \
            -- tests/integration/templates/bun-templates-smoke.test.ts \
            --no-lock
      - name: Upload logs on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: bun-smoke-logs
          path: ${{ runner.temp }}/bun-smoke-logs/**/*.log
          if-no-files-found: ignore
```

- [ ] **Step 2: Lint the YAML by parsing it.**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/template-bun-smoke.yml'))" \
  && echo "YAML OK"
```

Expected: `YAML OK`.

- [ ] **Step 3: Commit and push.**

```bash
git add .github/workflows/template-bun-smoke.yml
git commit -m "Add nightly Bun template smoke workflow"
git push
```

### Task 11: Validate the workflow via `workflow_dispatch`

**Files:** None (CI run).

- [ ] **Step 1: Trigger the workflow against this branch.**

```bash
gh workflow run template-bun-smoke.yml --ref chore/bun-template-smoke
```

- [ ] **Step 2: Watch the run.**

```bash
sleep 5
gh run list --workflow=template-bun-smoke.yml --branch chore/bun-template-smoke --limit 1
RUN_ID="$(gh run list --workflow=template-bun-smoke.yml --branch chore/bun-template-smoke --limit 1 --json databaseId -q '.[0].databaseId')"
gh run watch "$RUN_ID"
```

Expected: workflow completes green.

- [ ] **Step 3: If red, inspect the uploaded `bun-smoke-logs` artifact.**

```bash
gh run download "$RUN_ID" -n bun-smoke-logs -D /tmp/bun-smoke-logs-ci
ls /tmp/bun-smoke-logs-ci
```

Fix the issue (most likely candidates: Bun version mismatch surfacing a regression Phase 1 missed; CI-specific path handling; `oven-sh/setup-bun@v2` quirk). Commit fix, push, re-trigger.

- [ ] **Step 4: Mark the PR ready for review.**

```bash
gh pr ready 1894
```

---

## Self-review notes

- **Spec coverage:** Goal, scope, Phase 1 procedure, Phase 2 test architecture, Phase 3 workflow, error handling table — all covered by tasks above. The spec's "trusted dependencies" watch list is implemented in Task 5 (the `rewriteVeryfrontDep` helper unconditionally adds `veryfront` and `esbuild` to `trustedDependencies`).
- **Placeholder scan:** No "TBD" / "TODO" / "similar to". Concrete code or commands in every step.
- **Type consistency:** `BunProc`, `bunInstall`, `bunRunDev`, `waitForReady`, `killTree`, `isBunAvailable`, `getLocalTarballPath`, `assertLocalTarballExists`, `rewriteVeryfrontDep`, `scaffoldTemplate` — all defined in Tasks 4–6 and consumed identically in Tasks 7–8. `label` argument added to `bunInstall` and `bunRunDev` to make per-template log filenames unambiguous.
- **One open assumption:** Task 7 Step 2 relies on `it.ignore` producing reported-but-not-failing cases. If the Deno BDD runner behaves differently (e.g. errors during dynamic registration), fall back to a `describe` guard. The plan notes this explicitly.
