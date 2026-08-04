# Issue #240 Phase 0: Cohort Gate and URL Pinning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-armed production dependency-pinning flag inert by construction via a per-project cohort gate, and close the emission gap so unversioned esm.sh URLs already baked into user source files are pinned to exact versions.

**Architecture:** `getDependencyPinningSnapshot` in `src/transforms/esm/package-registry.ts` is the single place where `VERYFRONT_DEPENDENCY_PINNING` becomes a decision: every downstream consumer (import-rewrite strategies, render cache keys, the RSC pin header) reads the resulting `dependencyPinningCacheKey` rather than the env var. Adding a cohort check there means out-of-cohort projects fall back to the existing `FLAG_OFF_DEPENDENCY_SNAPSHOT` and produce byte-identical legacy cache keys. Separately, `UrlStrategy` already intercepts every esm.sh URL in user source to canonicalize its query parameters; version pinning slots into that existing seam using the same resolution ladder `BareStrategy` uses.

**Tech Stack:** Deno 2.6+, TypeScript, `deno test` with the repo's BDD helpers (`#veryfront/testing/bdd.ts`, `#veryfront/testing/assert.ts`), Helm chart values in `veryfront-server`.

**Scope:** This plan covers W0 and W1 of the spec, in `veryfront-code`, plus the paired chart change in `veryfront-server`. W2 (Studio install migration) and W3 (lazy codemod) are separate plans in separate repositories, and the spec's sequencing says they run in parallel with this one. W4 (production ramp) and W5 (Release 3 verification and record correction) are a rollout runbook, not implementation tasks.

**Source spec:** `docs/superpowers/specs/2026-08-04-issue-240-phase-0-close-design.md`

## Global Constraints

- Every task's requirements implicitly include this section.
- **Repository:** `veryfront-code` unless a task explicitly says `veryfront-server`.
- **Never widen the rollout by default.** An absent or malformed `VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT` resolves to `0`, meaning disabled. This is the property that disarms production; do not "helpfully" default it to 100.
- **A partial rollout fails closed on missing project identity.** A rollout of exactly 100% is universal and applies even without a `projectId`, so that a fully ramped environment never silently loses coverage on a code path that lacks project identity.
- **Flag-off and out-of-cohort behavior must stay byte-identical to today.** `buildDependencyPinningCacheVariant` deliberately returns no suffix for flag-off callers so their cache identities remain compatible with the pre-pinning format. Do not add a cohort dimension to any cache key.
- **No new seam without a consumer.** Task 1 is inert only until Task 3 lands; they ship in the same pull request.
- **Test style:** BDD via `describe`/`it` from `#veryfront/testing/bdd.ts`, assertions from `#veryfront/testing/assert.ts`, and every test file starts with `import "#veryfront/schemas/_test-setup.ts";`.
- **Prefer pure functions with explicit inputs over env mutation in tests.** `src/release-assets/dependency-artifact-mode.test.ts` is the reference: it tests the parse and resolve functions with explicit inputs and never mutates process env.
- **Local `.env` interference:** this repo's local `.env` holds a real `vf_` token that breaks roughly a dozen env-sensitive tests. Move it aside before running the full suite. Focused per-file runs in this plan are unaffected.
- **`deno fmt` and `deno lint` must pass** before every commit: `deno task fmt` then `deno task lint`.
- **Do not bump the version in these tasks.** The release bump (`deno.json` and `src/utils/version.ts` together, in one commit) is a separate release pull request after this work merges.

---

### Task 1: Dependency-pinning cohort resolver

Pure rollout-cohort logic, modeled directly on `src/release-assets/dependency-artifact-mode.ts` (deterministic hash bucket, allowlist union, domain-prefixed hash so this rollout's buckets are independent of the dependency-artifact rollout's).

**Files:**
- Create: `src/transforms/esm/dependency-pinning-cohort.ts`
- Create: `src/transforms/esm/dependency-pinning-cohort.test.ts`

**Interfaces:**
- Consumes: `hashString` from `#veryfront/cache/hash.ts`, `getHostEnv` from `#veryfront/platform/compat/process.ts`.
- Produces:
  - `DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV: "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT"`
  - `DEPENDENCY_PINNING_PROJECTS_ENV: "VERYFRONT_DEPENDENCY_PINNING_PROJECTS"`
  - `interface DependencyPinningCohortConfig { readonly rolloutBasisPoints: number; readonly projectAllowlist: readonly string[] }`
  - `parseDependencyPinningCohortConfig(input: { rolloutPercent?: string; projectAllowlist?: string }): DependencyPinningCohortConfig`
  - `resolveDependencyPinningCohort(projectId: string | null | undefined, config: DependencyPinningCohortConfig): boolean`
  - `readDependencyPinningCohortConfig(): DependencyPinningCohortConfig`
  - `isProjectInDependencyPinningCohort(projectId: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `src/transforms/esm/dependency-pinning-cohort.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type DependencyPinningCohortConfig,
  parseDependencyPinningCohortConfig,
  resolveDependencyPinningCohort,
} from "./dependency-pinning-cohort.ts";

const OFF: DependencyPinningCohortConfig = {
  rolloutBasisPoints: 0,
  projectAllowlist: [],
};

describe("parseDependencyPinningCohortConfig", () => {
  it("should default an absent percent to zero", () => {
    assertEquals(parseDependencyPinningCohortConfig({}), OFF);
  });

  it("should reject a malformed percent rather than widening the rollout", () => {
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "fifty" }).rolloutBasisPoints,
      0,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "101" }).rolloutBasisPoints,
      0,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "-5" }).rolloutBasisPoints,
      0,
    );
  });

  it("should convert percentages to basis points", () => {
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "100" }).rolloutBasisPoints,
      10_000,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "1" }).rolloutBasisPoints,
      100,
    );
    assertEquals(
      parseDependencyPinningCohortConfig({ rolloutPercent: "0.25" }).rolloutBasisPoints,
      25,
    );
  });

  it("should parse and de-duplicate the project allowlist", () => {
    assertEquals(
      parseDependencyPinningCohortConfig({
        projectAllowlist: " a , b ,a, ",
      }).projectAllowlist,
      ["a", "b"],
    );
  });
});

describe("resolveDependencyPinningCohort", () => {
  it("should be disabled when the rollout is off", () => {
    assertEquals(resolveDependencyPinningCohort("project-1", OFF), false);
  });

  it("should be universal at one hundred percent even without a project id", () => {
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "100" });
    assertEquals(resolveDependencyPinningCohort("project-1", config), true);
    assertEquals(resolveDependencyPinningCohort(undefined, config), true);
    assertEquals(resolveDependencyPinningCohort(null, config), true);
  });

  it("should fail closed on missing project identity during a partial rollout", () => {
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    assertEquals(resolveDependencyPinningCohort(undefined, config), false);
    assertEquals(resolveDependencyPinningCohort(null, config), false);
    assertEquals(resolveDependencyPinningCohort("", config), false);
  });

  it("should admit an explicitly allowlisted project at zero percent", () => {
    const config = parseDependencyPinningCohortConfig({
      rolloutPercent: "0",
      projectAllowlist: "internal-1",
    });
    assertEquals(resolveDependencyPinningCohort("internal-1", config), true);
    assertEquals(resolveDependencyPinningCohort("internal-2", config), false);
  });

  it("should assign a stable bucket to the same project", () => {
    const config = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    const first = resolveDependencyPinningCohort("stable-project", config);
    assertEquals(resolveDependencyPinningCohort("stable-project", config), first);
    assertEquals(resolveDependencyPinningCohort("stable-project", config), first);
  });

  it("should widen monotonically as the percentage grows", () => {
    // A project admitted at 10% must still be admitted at 50% and 100%.
    const at10 = parseDependencyPinningCohortConfig({ rolloutPercent: "10" });
    const at50 = parseDependencyPinningCohortConfig({ rolloutPercent: "50" });
    for (let index = 0; index < 200; index++) {
      const projectId = `project-${index}`;
      if (resolveDependencyPinningCohort(projectId, at10)) {
        assertEquals(resolveDependencyPinningCohort(projectId, at50), true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/esm/dependency-pinning-cohort.test.ts
```
Expected: FAIL: `Module not found "…/dependency-pinning-cohort.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/transforms/esm/dependency-pinning-cohort.ts`:

```ts
import { hashString } from "#veryfront/cache/hash.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV =
  "VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT";
export const DEPENDENCY_PINNING_PROJECTS_ENV = "VERYFRONT_DEPENDENCY_PINNING_PROJECTS";

export interface DependencyPinningCohortInput {
  readonly rolloutPercent?: string;
  readonly projectAllowlist?: string;
}

export interface DependencyPinningCohortConfig {
  readonly rolloutBasisPoints: number;
  readonly projectAllowlist: readonly string[];
}

const ROLLOUT_BUCKETS = 10_000;
const PERCENT_RE = /^(?:100(?:\.0{1,2})?|(?:0|[1-9]\d?)(?:\.\d{1,2})?)$/;

function parseRolloutBasisPoints(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized || !PERCENT_RE.test(normalized)) return 0;
  return Math.round(Number(normalized) * 100);
}

function parseProjectAllowlist(value: string | undefined): readonly string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((projectId) => projectId.trim()).filter(Boolean))];
}

function base36ToBigInt(value: string): bigint {
  let result = 0n;
  for (const character of value) {
    result = result * 36n + BigInt(Number.parseInt(character, 36));
  }
  return result;
}

/**
 * Parse cohort settings. An absent or malformed percentage collapses to zero so
 * a typo can never widen the rollout, which is the property that keeps the
 * already-armed production flag inert.
 */
export function parseDependencyPinningCohortConfig(
  input: DependencyPinningCohortInput,
): DependencyPinningCohortConfig {
  return {
    rolloutBasisPoints: parseRolloutBasisPoints(input.rolloutPercent),
    projectAllowlist: parseProjectAllowlist(input.projectAllowlist),
  };
}

/** Stable 0..9999 bucket. The domain prefix isolates this rollout from others. */
function dependencyPinningProjectBucket(projectId: string): number {
  const hash = hashString(`dependency-pinning-rollout:${projectId}`);
  return Number(base36ToBigInt(hash) % BigInt(ROLLOUT_BUCKETS));
}

/**
 * Decide whether a project is inside the pinning cohort.
 *
 * A full rollout is universal, including for code paths that carry no project
 * identity, so a fully ramped environment never silently loses coverage. Any
 * partial rollout fails closed on missing identity instead.
 */
export function resolveDependencyPinningCohort(
  projectId: string | null | undefined,
  config: DependencyPinningCohortConfig,
): boolean {
  if (config.rolloutBasisPoints >= ROLLOUT_BUCKETS) return true;
  if (config.rolloutBasisPoints <= 0 && config.projectAllowlist.length === 0) return false;
  if (!projectId) return false;
  if (config.projectAllowlist.includes(projectId)) return true;
  return dependencyPinningProjectBucket(projectId) < config.rolloutBasisPoints;
}

/** Read host-owned cohort configuration. */
export function readDependencyPinningCohortConfig(): DependencyPinningCohortConfig {
  return parseDependencyPinningCohortConfig({
    rolloutPercent: getHostEnv(DEPENDENCY_PINNING_ROLLOUT_PERCENT_ENV),
    projectAllowlist: getHostEnv(DEPENDENCY_PINNING_PROJECTS_ENV),
  });
}

/** Small external interface for callers that do not need the parsed config. */
export function isProjectInDependencyPinningCohort(
  projectId: string | null | undefined,
): boolean {
  return resolveDependencyPinningCohort(projectId, readDependencyPinningCohortConfig());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/esm/dependency-pinning-cohort.test.ts
```
Expected: PASS, all tests green.

- [ ] **Step 5: Format, lint, commit**

```bash
deno task fmt
deno task lint
git add src/transforms/esm/dependency-pinning-cohort.ts \
        src/transforms/esm/dependency-pinning-cohort.test.ts
git commit -m "feat(deps): add dependency-pinning cohort resolver"
```

---

### Task 2: Carry projectId on the dependency pinning source

`CreateDependencyPinningSourceOptions` already accepts `projectId`, but `createDependencyPinningSource` folds it only into `cacheNamespace`, and only when an adapter filesystem is present. The cohort gate in Task 3 needs project identity on the source itself.

**Files:**
- Modify: `src/transforms/esm/package-registry.ts:158-176` (the `DependencyPinningSource` interface)
- Modify: `src/transforms/esm/package-registry.ts:203-239` (`createDependencyPinningSource`)
- Test: `src/transforms/esm/package-registry.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DependencyPinningSource.projectId?: string | null`: read by Task 3.

- [ ] **Step 1: Write the failing test**

Append to `src/transforms/esm/package-registry.test.ts`:

```ts
describe("createDependencyPinningSource project identity", () => {
  it("should carry the project id onto the source", () => {
    const source = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "project-abc",
    });
    assertEquals(source.projectId, "project-abc");
  });

  it("should carry the project id even without an adapter filesystem", () => {
    // The pre-existing cacheNamespace path only runs for adapter-backed reads;
    // the cohort gate needs identity on every source, local ones included.
    const source = createDependencyPinningSource({
      projectDir: "/project",
      projectId: "project-abc",
      isLocalProject: true,
    });
    assertEquals(source.fs, undefined);
    assertEquals(source.projectId, "project-abc");
  });

  it("should leave the project id undefined when none is supplied", () => {
    const source = createDependencyPinningSource({ projectDir: "/project" });
    assertEquals(source.projectId, undefined);
  });
});
```

If `createDependencyPinningSource` and `assertEquals`/`describe`/`it` are not already imported in that test file, add them to the existing import statements rather than creating duplicates.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  --filter "createDependencyPinningSource project identity" \
  src/transforms/esm/package-registry.test.ts
```
Expected: FAIL: `source.projectId` is `undefined` where `"project-abc"` was expected.

- [ ] **Step 3: Write minimal implementation**

In `src/transforms/esm/package-registry.ts`, add the field to the `DependencyPinningSource` interface, immediately after `cacheNamespace`:

```ts
  /** Stable project identity used to resolve the pinning rollout cohort. */
  readonly projectId?: string | null;
```

Then in `createDependencyPinningSource`, add `projectId` to the returned object alongside `projectDir`:

```ts
  return {
    projectDir: options.projectDir,
    projectId: options.projectId,
    config: options.config,
    contentSourceId: options.contentSourceId,
    releaseId: options.releaseId,
    branch: options.branch,
    dependencyWritebackTarget: options.dependencyWritebackTarget
      ? Object.freeze({ ...options.dependencyWritebackTarget })
      : undefined,
    dependencyWritebackToken: options.dependencyWritebackToken,
    ...(adapterFs
      ? {
        fs: adapterFs,
        cacheNamespace: JSON.stringify([projectKey, contentKey]),
      }
      : {}),
  };
```

Do not change `projectKey` or `cacheNamespace`: cache identity must stay byte-identical.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/esm/package-registry.test.ts
```
Expected: PASS: the three new tests plus every pre-existing test in the file.

- [ ] **Step 5: Format, lint, commit**

```bash
deno task fmt
deno task lint
git add src/transforms/esm/package-registry.ts src/transforms/esm/package-registry.test.ts
git commit -m "feat(deps): carry project identity on the dependency pinning source"
```

---

### Task 3: Gate the pinning snapshot on the cohort

This is the seam. `getDependencyPinningSnapshot` is the only place the env flag becomes a decision; everything downstream reads the resulting cache key. An out-of-cohort project returns the existing `FLAG_OFF_DEPENDENCY_SNAPSHOT`, so its cache identities stay byte-identical to today.

**Files:**
- Modify: `src/transforms/esm/package-registry.ts:616-650` (`getDependencyPinningSnapshot`)
- Test: `src/transforms/esm/package-registry.test.ts`

**Interfaces:**
- Consumes: `resolveDependencyPinningCohort` and `readDependencyPinningCohortConfig` from Task 1; `DependencyPinningSource.projectId` from Task 2.
- Produces: no new exports. Behavior change only.

- [ ] **Step 1: Write the failing test**

Append to `src/transforms/esm/package-registry.test.ts`. These tests mutate env, so they must restore it in a `finally`:

```ts
describe("getDependencyPinningSnapshot cohort gating", () => {
  async function withEnv(
    values: Record<string, string | undefined>,
    run: () => Promise<void>,
  ): Promise<void> {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
      previous.set(key, Deno.env.get(key));
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    try {
      await run();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    }
  }

  it("should stay off when the flag is on but the rollout percent is absent", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: undefined,
      VERYFRONT_DEPENDENCY_PINNING_PROJECTS: undefined,
    }, async () => {
      const snapshot = await getDependencyPinningSnapshot({
        projectDir: null,
        projectId: "project-abc",
      });
      assertEquals(snapshot.cacheKey, "off");
    });
  });

  it("should enable an explicitly allowlisted project", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "0",
      VERYFRONT_DEPENDENCY_PINNING_PROJECTS: "project-abc",
    }, async () => {
      const snapshot = await getDependencyPinningSnapshot({
        projectDir: null,
        projectId: "project-abc",
      });
      // No package.json path, so an in-cohort project reports no-project
      // rather than "off": proving the cohort admitted it.
      assertEquals(snapshot.cacheKey, "on:no-project");
    });
  });

  it("should keep a non-allowlisted project off at zero percent", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "0",
      VERYFRONT_DEPENDENCY_PINNING_PROJECTS: "project-abc",
    }, async () => {
      const snapshot = await getDependencyPinningSnapshot({
        projectDir: null,
        projectId: "project-other",
      });
      assertEquals(snapshot.cacheKey, "off");
    });
  });

  it("should apply a full rollout even to a source without project identity", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "100",
      VERYFRONT_DEPENDENCY_PINNING_PROJECTS: undefined,
    }, async () => {
      const snapshot = await getDependencyPinningSnapshot({ projectDir: null });
      assertEquals(snapshot.cacheKey, "on:no-project");
    });
  });

  it("should stay off when the flag itself is off regardless of percent", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: undefined,
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "100",
    }, async () => {
      const snapshot = await getDependencyPinningSnapshot({
        projectDir: null,
        projectId: "project-abc",
      });
      assertEquals(snapshot.cacheKey, "off");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  --filter "getDependencyPinningSnapshot cohort gating" \
  src/transforms/esm/package-registry.test.ts
```
Expected: FAIL: the first test reports `"on:no-project"` where `"off"` was expected, because no cohort check exists yet.

- [ ] **Step 3: Write minimal implementation**

Add the import near the other `#veryfront/transforms/esm/…` imports at the top of `src/transforms/esm/package-registry.ts`:

```ts
import {
  readDependencyPinningCohortConfig,
  resolveDependencyPinningCohort,
} from "./dependency-pinning-cohort.ts";
```

Then modify `getDependencyPinningSnapshot` so the cohort check sits immediately after the flag check and before any package.json work:

```ts
export async function getDependencyPinningSnapshot(
  source: DependencyPinningSourceInput,
): Promise<DependencyPinningSnapshot> {
  const normalized = normalizeDependencyPinningSource(source);
  if (getHostEnv(DEPENDENCY_PINNING_ENV_FLAG) !== "1") {
    currentDependencyPinningKeys.delete(normalized.cacheIdentity);
    return FLAG_OFF_DEPENDENCY_SNAPSHOT;
  }
  // The flag arms the rollout; the cohort decides who is in it. Returning the
  // flag-off snapshot keeps out-of-cohort projects byte-identical to today,
  // including their render cache identities.
  const projectId = typeof source === "object" && source !== null ? source.projectId : undefined;
  if (
    !resolveDependencyPinningCohort(projectId, readDependencyPinningCohortConfig())
  ) {
    currentDependencyPinningKeys.delete(normalized.cacheIdentity);
    return FLAG_OFF_DEPENDENCY_SNAPSHOT;
  }
  if (!normalized.packageJsonPath) {
    return Object.freeze({ cacheKey: "on:no-project" });
  }
  // … rest of the function unchanged …
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run the focused file, then the two subsystems most likely to be affected:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/esm/package-registry.test.ts

DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  $(find src/transforms src/cache -name '*.test.ts')
```
Expected: PASS. Pre-existing pinning tests that set `VERYFRONT_DEPENDENCY_PINNING=1` without a rollout percent will now resolve to `off` and fail. That is the expected consequence of the default; fix each by adding `VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT=100` to the env that test establishes. Do not change the production default to compensate.

- [ ] **Step 5: Format, lint, commit**

```bash
deno task fmt
deno task lint
git add src/transforms/esm/package-registry.ts src/transforms/esm/package-registry.test.ts
git commit -m "feat(deps): gate the pinning snapshot on the rollout cohort"
```

---

### Task 4: Make the strategy-level fallback cohort-aware

`BareStrategy` and `dependency-resolution.ts` each carry a private `isPinningEnabledForRewrite` that falls back to the raw env read when no cache key is present. That fallback would enable pinning for an out-of-cohort project. Consolidate the duplicated helper into one exported function and make its fallback consult the cohort.

**Files:**
- Modify: `src/transforms/import-rewriter/dependency-resolution.ts:81-88`
- Modify: `src/transforms/import-rewriter/strategies/bare-strategy.ts:19,33-41`
- Test: `src/transforms/import-rewriter/dependency-resolution.test.ts`

**Interfaces:**
- Consumes: `isProjectInDependencyPinningCohort` from Task 1.
- Produces: `isPinningEnabledForRewrite(ctx: ImportDependencyResolutionContext): boolean`, exported from `dependency-resolution.ts`: used by Task 6.

- [ ] **Step 1: Write the failing test**

Append to `src/transforms/import-rewriter/dependency-resolution.test.ts`:

```ts
describe("isPinningEnabledForRewrite", () => {
  async function withEnv(
    values: Record<string, string | undefined>,
    run: () => void,
  ): Promise<void> {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(values)) {
      previous.set(key, Deno.env.get(key));
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    try {
      run();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      }
    }
  }

  it("should trust an on cache key without consulting the cohort", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "0",
    }, () => {
      // The snapshot already decided; the strategy must not re-decide, or a
      // mid-render config change would split one render across two policies.
      assertEquals(
        isPinningEnabledForRewrite({
          dependencyPinningCacheKey: "on:abc",
          projectId: "project-abc",
        }),
        true,
      );
    });
  });

  it("should reject the unknown snapshot key", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "100",
    }, () => {
      assertEquals(
        isPinningEnabledForRewrite({
          dependencyPinningCacheKey: "on:unknown",
          projectId: "project-abc",
        }),
        false,
      );
    });
  });

  it("should apply the cohort when no cache key is present", async () => {
    await withEnv({
      VERYFRONT_DEPENDENCY_PINNING: "1",
      VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "0",
      VERYFRONT_DEPENDENCY_PINNING_PROJECTS: "project-abc",
    }, () => {
      assertEquals(isPinningEnabledForRewrite({ projectId: "project-abc" }), true);
      assertEquals(isPinningEnabledForRewrite({ projectId: "project-other" }), false);
    });
  });
});
```

Add `isPinningEnabledForRewrite` to the existing import from `./dependency-resolution.ts` in that test file.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  --filter "isPinningEnabledForRewrite" \
  src/transforms/import-rewriter/dependency-resolution.test.ts
```
Expected: FAIL: `isPinningEnabledForRewrite` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/transforms/import-rewriter/dependency-resolution.ts`, add the import:

```ts
import { isProjectInDependencyPinningCohort } from "#veryfront/transforms/esm/dependency-pinning-cohort.ts";
```

and replace the private helper with an exported, cohort-aware one:

```ts
/**
 * Decide whether pinning applies to this rewrite.
 *
 * A cache key means the snapshot already decided, and that decision is
 * authoritative: re-deciding here would let a mid-render configuration change
 * split a single render across two policies. Only the keyless fallback path
 * consults the cohort. "on:unknown" means the dependency state could not be
 * established (unreadable package.json), so it falls back to flag-off behavior.
 */
export function isPinningEnabledForRewrite(
  ctx: ImportDependencyResolutionContext,
): boolean {
  if (ctx.dependencyPinningCacheKey === "on:unknown") return false;
  if (ctx.dependencyPinningCacheKey) {
    return ctx.dependencyPinningCacheKey.startsWith("on:");
  }
  return isDependencyPinningEnabled() && isProjectInDependencyPinningCohort(ctx.projectId);
}
```

Then in `src/transforms/import-rewriter/strategies/bare-strategy.ts`, delete the local `isPinningEnabledForRewrite` function (lines 33-41), drop the now-unused `isDependencyPinningEnabled` import on line 19, and import the shared helper instead:

```ts
import {
  isPinningEnabledForRewrite,
  resolveDependencyPinForImport,
} from "../dependency-resolution.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  $(find src/transforms/import-rewriter -name '*.test.ts')
```
Expected: PASS.

- [ ] **Step 5: Format, lint, commit**

```bash
deno task fmt
deno task lint
git add src/transforms/import-rewriter/dependency-resolution.ts \
        src/transforms/import-rewriter/dependency-resolution.test.ts \
        src/transforms/import-rewriter/strategies/bare-strategy.ts
git commit -m "refactor(deps): share one cohort-aware pinning gate across rewrite strategies"
```

---

### Task 5: Chart values for staging and production

**Repository: `veryfront-server`.** The rollout percent defaults to `0`, so staging must be set to `100` explicitly or it loses the pinning coverage it already verified. Production is set to `0`, which disarms the flag merged in `veryfront-server#273`.

**Files:**
- Modify: `chart/values-staging.yaml` (both the proxy and renderer env blocks, near lines 14-15 and 50-51)
- Modify: `chart/values-production.yaml` (both env blocks, near lines 16-18 and 48-50)

**Interfaces:**
- Consumes: the env var names from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the percent to staging, both workloads**

In `chart/values-staging.yaml`, in each of the two env blocks that already contain `VERYFRONT_DEPENDENCY_PINNING`, add directly beneath it:

```yaml
    VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "100"
```

If a block sets `VERYFRONT_RELEASE_ASSET_MANIFEST` and `VERYFRONT_RELEASE_ASSET_DEPENDENCY_IMPORT_MAP` but no `VERYFRONT_DEPENDENCY_PINNING`, add both the flag and the percent so staging keeps parity with what it has been running since `veryfront-server#266`.

- [ ] **Step 2: Add the percent to production, both workloads**

In `chart/values-production.yaml`, beneath each existing `VERYFRONT_DEPENDENCY_PINNING: "1"`:

```yaml
    VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT: "0"
```

Leave `VERYFRONT_DEPENDENCY_PINNING: "1"` in place. The flag stays armed; the percent is what makes it inert.

- [ ] **Step 3: Verify the rendered chart**

```bash
helm lint ./chart

helm template veryfront-server ./chart \
  --values ./chart/values-production.yaml \
  --set proxy.image.tag=test \
  --set renderer.image.tag=test \
  --set proxySecrets.dummy=test \
  --set-string proxySecrets.VERYFRONT_PROXY_ROUTING_INVALIDATION_SECRET=test-routing-secret \
  --set rendererSecrets.dummy=test \
  --set dedicatedRuntimeSecrets.REDIS_URL=test \
  --set-string controlPlane.channelDispatchSigningPublicKey=test-signing-key \
  | grep -A1 'VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT'
```
Expected: `helm lint` reports 0 failed, and the rendered production manifest shows the percent as `"0"` for both the proxy and the renderer deployments. Repeat the template command against `values-staging.yaml` and expect `"100"`.

- [ ] **Step 4: Commit**

```bash
git add chart/values-staging.yaml chart/values-production.yaml
git commit -m "chore(chart): set dependency pinning rollout percent per environment

Staging holds the 100% coverage it already verified. Production is set to 0,
which disarms the flag merged in #273 without removing it."
```

- [ ] **Step 5: Note the deployment coupling in the pull request body**

State explicitly that this change takes effect only at the next production release promotion, and that until the runtime containing Tasks 1-4 is promoted, production runs no pinning code at all. Both facts must be visible to whoever opens the next promotion.

---

### Task 6: Pin unversioned esm.sh URLs in user source

This is W1, the emission fix. `UrlStrategy` already intercepts every esm.sh URL to canonicalize its query parameters; version pinning slots in ahead of that canonicalization.

**Files:**
- Modify: `src/transforms/import-rewriter/url-builder.ts` (add `parseEsmShUrl` and `buildPinnedEsmShUrl` beside the existing `isEsmShUrl`, around line 460)
- Modify: `src/transforms/import-rewriter/strategies/url-strategy.ts`
- Test: `src/transforms/import-rewriter/url-builder.test.ts`
- Test: `src/transforms/import-rewriter/strategies/url-strategy.test.ts`

**Interfaces:**
- Consumes: `isPinningEnabledForRewrite` and `resolveDependencyPinForImport` from `../dependency-resolution.ts` (Task 4).
- Produces:
  - `interface ParsedEsmShUrl { readonly origin: string; readonly packageName: string; readonly version: string | null; readonly subpath: string; readonly search: string; readonly hash: string }`
  - `parseEsmShUrl(url: string): ParsedEsmShUrl | null`
  - `buildPinnedEsmShUrl(parsed: ParsedEsmShUrl, version: string): string`

- [ ] **Step 1: Write the failing parser test**

Append to `src/transforms/import-rewriter/url-builder.test.ts`:

```ts
describe("parseEsmShUrl", () => {
  it("should parse an unversioned package", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/lodash"), {
      origin: "https://esm.sh",
      packageName: "lodash",
      version: null,
      subpath: "",
      search: "",
      hash: "",
    });
  });

  it("should parse a versioned package with a subpath and query", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/lodash@4.17.21/fp?target=es2022"), {
      origin: "https://esm.sh",
      packageName: "lodash",
      version: "4.17.21",
      subpath: "/fp",
      search: "?target=es2022",
      hash: "",
    });
  });

  it("should parse an unversioned scoped package", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/@dnd-kit/core"), {
      origin: "https://esm.sh",
      packageName: "@dnd-kit/core",
      version: null,
      subpath: "",
      search: "",
      hash: "",
    });
  });

  it("should parse a versioned scoped package with a subpath", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/@radix-ui/react-dialog@1.1.1/dist"), {
      origin: "https://esm.sh",
      packageName: "@radix-ui/react-dialog",
      version: "1.1.1",
      subpath: "/dist",
      search: "",
      hash: "",
    });
  });

  it("should decline non-esm.sh URLs", () => {
    assertEquals(parseEsmShUrl("https://cdn.example.com/lib.js"), null);
  });

  it("should decline esm.sh build-prefixed and non-npm paths", () => {
    // Rewriting these would corrupt the specifier; leave them untouched.
    assertEquals(parseEsmShUrl("https://esm.sh/v135/lodash@4.17.21"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/stable/react@19.2.4"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/gh/user/repo"), null);
    assertEquals(parseEsmShUrl("https://esm.sh/jsr/@std/path"), null);
  });

  it("should decline a bare scope with no package", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/@dnd-kit"), null);
  });

  it("should decline an empty path", () => {
    assertEquals(parseEsmShUrl("https://esm.sh/"), null);
  });
});

describe("buildPinnedEsmShUrl", () => {
  it("should insert the version and preserve subpath, query, and hash", () => {
    const parsed = parseEsmShUrl("https://esm.sh/lodash/fp?target=es2022#frag");
    assertEquals(
      buildPinnedEsmShUrl(parsed!, "4.17.21"),
      "https://esm.sh/lodash@4.17.21/fp?target=es2022#frag",
    );
  });

  it("should insert the version for a scoped package", () => {
    const parsed = parseEsmShUrl("https://esm.sh/@dnd-kit/core");
    assertEquals(
      buildPinnedEsmShUrl(parsed!, "6.1.0"),
      "https://esm.sh/@dnd-kit/core@6.1.0",
    );
  });
});
```

Add `parseEsmShUrl` and `buildPinnedEsmShUrl` to the existing import from `./url-builder.ts` in that test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  --filter "EsmShUrl" \
  src/transforms/import-rewriter/url-builder.test.ts
```
Expected: FAIL: `parseEsmShUrl` is not exported.

- [ ] **Step 3: Implement the parser**

In `src/transforms/import-rewriter/url-builder.ts`, directly after `isEsmShUrl`:

```ts
export interface ParsedEsmShUrl {
  readonly origin: string;
  readonly packageName: string;
  readonly version: string | null;
  readonly subpath: string;
  readonly search: string;
  readonly hash: string;
}

/**
 * esm.sh path prefixes that are not plain npm package names. Rewriting these
 * would corrupt the specifier, so they are declined rather than pinned.
 */
const ESM_SH_NON_NPM_PREFIX_RE = /^(?:v\d+|stable|gh|jsr|pr|node)$/;

/**
 * Split an esm.sh URL into its npm coordinates. Returns null for anything that
 * is not a plain `pkg` / `pkg@version` / `@scope/pkg` path.
 */
export function parseEsmShUrl(url: string): ParsedEsmShUrl | null {
  if (!isEsmShUrl(url)) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_) {
    /* expected: a malformed URL is left untouched */
    return null;
  }

  const segments = parsed.pathname.slice(1).split("/").filter(Boolean);
  const first = segments[0];
  if (!first || ESM_SH_NON_NPM_PREFIX_RE.test(first)) return null;

  const isScoped = first.startsWith("@");
  if (isScoped && segments.length < 2) return null;

  const nameSegments = isScoped ? segments.slice(0, 2) : segments.slice(0, 1);
  const subpathSegments = segments.slice(nameSegments.length);

  const last = nameSegments[nameSegments.length - 1]!;
  const versionIndex = last.lastIndexOf("@");
  const version = versionIndex > 0 ? last.slice(versionIndex + 1) : null;
  if (versionIndex > 0) {
    nameSegments[nameSegments.length - 1] = last.slice(0, versionIndex);
  }

  return {
    origin: parsed.origin,
    packageName: arrayJoin(nameSegments, "/"),
    version: version && version.length > 0 ? version : null,
    subpath: subpathSegments.length > 0 ? `/${arrayJoin(subpathSegments, "/")}` : "",
    search: parsed.search,
    hash: parsed.hash,
  };
}

/** Rebuild an esm.sh URL with an exact version, preserving every other part. */
export function buildPinnedEsmShUrl(parsed: ParsedEsmShUrl, version: string): string {
  return `${parsed.origin}/${parsed.packageName}@${version}${parsed.subpath}${parsed.search}${parsed.hash}`;
}
```

- [ ] **Step 4: Run the parser test to verify it passes**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/import-rewriter/url-builder.test.ts
```
Expected: PASS.

- [ ] **Step 5: Write the failing strategy test**

Append to the `describe("rewrite", …)` block in `src/transforms/import-rewriter/strategies/url-strategy.test.ts`:

```ts
    it("should pin an unversioned URL from the project dependency map", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(
        specifier,
        "https://esm.sh/lodash@4.17.21?external=react,react-dom&target=es2022",
      );
    });

    it("should pin an unversioned scoped URL with a subpath", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/@dnd-kit/core/dist"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { "@dnd-kit/core": "6.1.0" },
        }),
      );
      assertEquals(
        specifier,
        "https://esm.sh/@dnd-kit/core@6.1.0/dist?external=react,react-dom&target=es2022",
      );
    });

    it("should not override a version already present in the URL", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash@4.17.20"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(specifier?.includes("lodash@4.17.20"), true);
      assertEquals(specifier?.includes("4.17.21"), false);
    });

    it("should leave the URL unversioned when the flag is off", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx({
          dependencyPinningCacheKey: "off",
          dependencyPinningDependencies: { lodash: "4.17.21" },
        }),
      );
      assertEquals(specifier, "https://esm.sh/lodash?external=react,react-dom&target=es2022");
    });

    it("should leave the URL unversioned when the declaration is a range", () => {
      // Ranges are handed to the platform resolver; the render proceeds
      // unversioned until an exact declaration is written back.
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/lodash"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { lodash: "^4.17.0" },
        }),
      );
      assertEquals(specifier?.includes("@^4"), false);
      assertEquals(specifier?.includes("lodash?"), true);
    });

    it("should not pin react, which owns its own resolution ladder", () => {
      const { specifier } = urlStrategy.rewrite(
        makeInfo("https://esm.sh/react"),
        makeCtx({
          dependencyPinningCacheKey: "on:abc",
          dependencyPinningDependencies: { react: "18.0.0" },
        }),
      );
      assertEquals(specifier?.includes("react@18.0.0"), false);
    });
```

- [ ] **Step 6: Run the strategy test to verify it fails**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/import-rewriter/strategies/url-strategy.test.ts
```
Expected: FAIL: the first new test yields `https://esm.sh/lodash?external=react,react-dom&target=es2022`, with no version.

- [ ] **Step 7: Implement pinning in the strategy**

Replace the whole of `src/transforms/import-rewriter/strategies/url-strategy.ts`:

```ts
import type {
  ImportRewriteStrategy,
  ImportSpecifierInfo,
  RewriteContext,
  RewriteResult,
} from "../types.ts";
import {
  addEsmShDeps,
  buildPinnedEsmShUrl,
  isEsmShUrl,
  parseEsmShUrl,
} from "../url-builder.ts";
import {
  isPinningEnabledForRewrite,
  resolveDependencyPinForImport,
} from "../dependency-resolution.ts";

/**
 * Apply the dependency pin ladder to an esm.sh URL already baked into user
 * source. Studio's component install wrote these URLs unversioned, so without
 * this they would float forever and never enter the pinning ladder that bare
 * specifiers pass through.
 *
 * React keeps its own resolution ladder and is deliberately excluded.
 */
function pinEsmShUrlSpecifier(specifier: string, ctx: RewriteContext): string {
  if (!isPinningEnabledForRewrite(ctx)) return specifier;

  const parsed = parseEsmShUrl(specifier);
  if (!parsed || parsed.version) return specifier;
  if (parsed.packageName === "react" || parsed.packageName === "react-dom") {
    return specifier;
  }

  const pinned = resolveDependencyPinForImport(parsed.packageName, ctx);
  return pinned ? buildPinnedEsmShUrl(parsed, pinned) : specifier;
}

export class UrlStrategy implements ImportRewriteStrategy {
  readonly name = "url";
  readonly priority = 7;

  matches(specifier: string, _ctx: RewriteContext): boolean {
    return isEsmShUrl(specifier);
  }

  rewrite(info: ImportSpecifierInfo, ctx: RewriteContext): RewriteResult {
    const pinned = pinEsmShUrlSpecifier(info.specifier, ctx);
    const specifier = addEsmShDeps(pinned, ctx.reactVersion);
    return { specifier: specifier === info.specifier ? null : specifier };
  }
}

export const urlStrategy = new UrlStrategy();
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  $(find src/transforms -name '*.test.ts')
```
Expected: PASS.

- [ ] **Step 9: Format, lint, typecheck, commit**

```bash
deno task fmt
deno task lint
deno check src/transforms/index.ts
git add src/transforms/import-rewriter/url-builder.ts \
        src/transforms/import-rewriter/url-builder.test.ts \
        src/transforms/import-rewriter/strategies/url-strategy.ts \
        src/transforms/import-rewriter/strategies/url-strategy.test.ts
git commit -m "feat(deps): pin unversioned esm.sh URLs baked into user source"
```

---

### Task 7: Audit the remaining URL-construction fallbacks

The spec requires confirming that every other place that builds an esm.sh URL honors the pin ladder. Some already do so through `BareStrategy`; this task records which and closes any that do not.

**Files:**
- Read and audit: `src/transforms/import-rewriter/ssr-adapter.ts:104-140` and `:270-290`
- Read and audit: `src/routing/api/module-loader/esbuild-plugin.ts` (esm.sh URL construction)
- Read and audit: `src/transforms/esm/http-bundler.ts` (bundler plugin fallback)
- Create: `docs/superpowers/plans/2026-08-04-issue-240-url-construction-audit.md`
- Modify: whichever of the above omit the ladder

**Interfaces:**
- Consumes: `isPinningEnabledForRewrite` and `resolveDependencyPinForImport` from Task 4, `parseEsmShUrl`/`buildPinnedEsmShUrl` from Task 6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Enumerate every esm.sh URL construction site**

```bash
grep -rn 'esm\.sh/' src/ --include='*.ts' | grep -v '\.test\.' | grep -v '^src/transforms/import-rewriter/url-builder.ts'
```

Record each hit in the audit document with three columns: file and line, whether the site can receive an unversioned specifier, and whether it consults the pin ladder.

- [ ] **Step 2: Write the audit document**

Create `docs/superpowers/plans/2026-08-04-issue-240-url-construction-audit.md` with one section per site. Each section states the verdict: `honors ladder`, `unreachable when unversioned`, or `gap`: and for each `gap`, the exact change needed. This document is the evidence for spec acceptance criterion 1; a reviewer must be able to check it without re-deriving the search.

- [ ] **Step 3: Write a failing test for each gap**

For every site marked `gap`, add a test to that module's existing test file asserting that an unversioned specifier resolves to a pinned URL when `dependencyPinningCacheKey` is `on:` and `dependencyPinningDependencies` carries an exact version. Model the assertion on the Task 6 strategy tests.

If Step 2 finds no gaps, skip to Step 6 and commit the audit document alone. Record that outcome explicitly in the document rather than leaving it implied.

- [ ] **Step 4: Run the new tests to verify they fail**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  $(find src/transforms src/routing -name '*.test.ts')
```
Expected: FAIL, only on the newly added gap tests.

- [ ] **Step 5: Close each gap**

Apply the pin ladder at each gap site, using exactly the pattern from Task 6: guard on `isPinningEnabledForRewrite`, resolve via `resolveDependencyPinForImport`, and fall back to the current unversioned behavior when no exact pin is available. Never block a render on resolution.

- [ ] **Step 6: Run tests, format, lint, commit**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  $(find src/transforms src/routing -name '*.test.ts')
deno task fmt
deno task lint
git add -A
git commit -m "fix(deps): honor the pin ladder at every esm.sh URL construction site"
```

---

### Task 8: CI assertion that no unversioned dependency URL is emitted

Spec acceptance criterion 1, enforced mechanically.

**Files:**
- Create: `src/transforms/import-rewriter/__tests__/no-unversioned-emission.test.ts`

**Interfaces:**
- Consumes: `rewriteImports` (or the module's equivalent entry point) from `src/transforms/import-rewriter/index.ts`; `parseEsmShUrl` from Task 6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the public entry point**

```bash
grep -n '^export' src/transforms/import-rewriter/index.ts
```
Use whichever exported function transforms a source string with a `RewriteContext`. Name it exactly in the test rather than guessing.

- [ ] **Step 2: Write the failing test**

Create `src/transforms/import-rewriter/__tests__/no-unversioned-emission.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { parseEsmShUrl } from "../url-builder.ts";
import { urlStrategy } from "../strategies/url-strategy.ts";
import { bareStrategy } from "../strategies/bare-strategy.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";

const DEPENDENCIES = Object.freeze({
  "lodash": "4.17.21",
  "@dnd-kit/core": "6.1.0",
  "recharts": "3.2.1",
  "zod": "3.25.76",
});

function makeCtx(overrides: Partial<RewriteContext> = {}): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "emission-test",
    target: "browser",
    dev: false,
    reactVersion: "19.2.4",
    dependencyPinningCacheKey: "on:abc",
    dependencyPinningDependencies: DEPENDENCIES,
    ...overrides,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

/** Every specifier form a pinned project can present, URL and bare alike. */
const SPECIFIERS = [
  "https://esm.sh/lodash",
  "https://esm.sh/lodash/fp",
  "https://esm.sh/@dnd-kit/core",
  "https://esm.sh/recharts?target=es2022",
  "https://esm.sh/zod",
  "lodash",
  "@dnd-kit/core",
  "recharts",
  "zod",
];

describe("no unversioned dependency URL is emitted for a pinned project", () => {
  for (const specifier of SPECIFIERS) {
    it(`should emit an exact version for ${specifier}`, () => {
      const ctx = makeCtx();
      const strategy = specifier.startsWith("https://") ? urlStrategy : bareStrategy;
      const emitted = strategy.rewrite(makeInfo(specifier), ctx).specifier ?? specifier;

      const parsed = parseEsmShUrl(emitted);
      assertEquals(
        parsed !== null,
        true,
        `expected an esm.sh URL, got ${emitted}`,
      );
      assertEquals(
        parsed?.version !== null,
        true,
        `emitted an unversioned dependency URL: ${emitted}`,
      );
    });
  }
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/import-rewriter/__tests__/no-unversioned-emission.test.ts
```
Expected: PASS, because Tasks 6 and 7 already implement the behavior. This test is a regression wall, not a driver. If any case fails, that is a genuine gap in Task 6 or 7: fix the source, not the test.

- [ ] **Step 4: Verify the wall actually catches a regression**

Temporarily revert the pinning line in `url-strategy.ts` by replacing `const pinned = pinEsmShUrlSpecifier(info.specifier, ctx);` with `const pinned = info.specifier;`, re-run the command from Step 3, and confirm the five URL cases FAIL. Then restore the line and confirm they pass again. A regression wall that cannot fail is not a wall.

- [ ] **Step 5: Format, lint, commit**

```bash
deno task fmt
deno task lint
git add src/transforms/import-rewriter/__tests__/no-unversioned-emission.test.ts
git commit -m "test(deps): assert no unversioned dependency URL is emitted"
```

---

### Task 9: Determinism assertion

Spec acceptance criterion: two renders of an unchanged draft resolve byte-identical dependency sets.

**Files:**
- Create: `src/transforms/import-rewriter/__tests__/pinning-determinism.test.ts`

**Interfaces:**
- Consumes: `urlStrategy` and `bareStrategy`; `getDependencyPinningSnapshot` from `#veryfront/transforms/esm/package-registry.ts`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/transforms/import-rewriter/__tests__/pinning-determinism.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { urlStrategy } from "../strategies/url-strategy.ts";
import { bareStrategy } from "../strategies/bare-strategy.ts";
import type { ImportSpecifierInfo, RewriteContext } from "../types.ts";

const DEPENDENCIES = Object.freeze({
  "lodash": "4.17.21",
  "recharts": "3.2.1",
  "@dnd-kit/core": "6.1.0",
});

function makeCtx(): RewriteContext {
  return {
    filePath: "/project/pages/index.tsx",
    projectDir: "/project",
    projectId: "determinism-test",
    target: "browser",
    dev: false,
    reactVersion: "19.2.4",
    dependencyPinningCacheKey: "on:abc",
    dependencyPinningDependencies: DEPENDENCIES,
  };
}

function makeInfo(specifier: string): ImportSpecifierInfo {
  return {
    specifier,
    isDynamic: false,
    start: 0,
    end: 0,
    statementStart: 0,
    statementEnd: 0,
    raw: {} as ImportSpecifierInfo["raw"],
  };
}

const SPECIFIERS = [
  "https://esm.sh/lodash",
  "https://esm.sh/@dnd-kit/core",
  "recharts",
  "lodash",
];

function renderAll(): string[] {
  return SPECIFIERS.map((specifier) => {
    const strategy = specifier.startsWith("https://") ? urlStrategy : bareStrategy;
    return strategy.rewrite(makeInfo(specifier), makeCtx()).specifier ?? specifier;
  });
}

describe("dependency pinning determinism", () => {
  it("should produce byte-identical output across repeated renders", () => {
    const first = renderAll();
    for (let round = 0; round < 5; round++) {
      assertEquals(renderAll(), first);
    }
  });

  it("should not depend on the order specifiers are rewritten in", () => {
    const forward = renderAll();
    const reversed = [...SPECIFIERS].reverse().map((specifier) => {
      const strategy = specifier.startsWith("https://") ? urlStrategy : bareStrategy;
      return strategy.rewrite(makeInfo(specifier), makeCtx()).specifier ?? specifier;
    });
    assertEquals(reversed.reverse(), forward);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

```bash
DENO_TESTING=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  src/transforms/import-rewriter/__tests__/pinning-determinism.test.ts
```
Expected: PASS.

- [ ] **Step 3: Run the full affected-subsystem suite**

```bash
mv .env .env.local-backup 2>/dev/null || true
DENO_TESTING=1 VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  --preload=src/schemas/_test-setup.ts \
  $(find src/transforms src/cache src/server src/routing -name '*.test.ts')
mv .env.local-backup .env 2>/dev/null || true
```
Expected: PASS. Any failure here is a real regression from Tasks 3, 4, 6, or 7: diagnose it rather than narrowing the run.

- [ ] **Step 4: Format, lint, typecheck, commit**

```bash
deno task fmt
deno task lint
deno task typecheck
git add src/transforms/import-rewriter/__tests__/pinning-determinism.test.ts
git commit -m "test(deps): assert dependency pinning is deterministic across renders"
```

- [ ] **Step 5: Run the full unit suite before opening the pull request**

```bash
mv .env .env.local-backup 2>/dev/null || true
deno task test:unit
mv .env.local-backup .env 2>/dev/null || true
```
Expected: PASS. Two environmental failures are known and expected in fresh worktrees; anything beyond those must be diagnosed. Do not open the pull request until this run is understood.

---

## Handoff to the rollout

After this plan lands and merges:

1. Cut a release bump pull request (`deno.json` and `src/utils/version.ts` together).
2. Merge the `veryfront-server` chart change from Task 5.
3. Promote the release to production with the percent at `0`: a pure runtime upgrade with pinning inert, which also moves production off its 2026-07-27 artifact.
4. Ramp per spec W4: internal allowlist, 1%, 10%, 50%, 100%, exercising rollback at the 10% step.

W2 (Studio install migration) and W3 (lazy codemod) are separate plans and can proceed in parallel with all of the above.
