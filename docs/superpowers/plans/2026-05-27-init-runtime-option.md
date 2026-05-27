# `init --runtime` option implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `runtime` option (`node` | `bun` | `deno`, default `node`) to `veryfront init` that drives the install command, the printed next-steps, and — for `deno` — an additional thin `deno.json` in the scaffold.

**Architecture:** A small, isolated extension to `cli/commands/init/`. A new `InitRuntime` enum on `InitOptions` is parsed from a `--runtime` CLI flag and from a `runtime` field in the optional `--config` JSON file. It's also surfaced as a new wizard prompt step. The runtime is passed as the `preference` argument to the existing `detectPackageManager`, which already knows how to map `node|bun|deno` to install and run commands. When `runtime === "deno"`, a new `createDenoConfig` function writes a thin `deno.json` next to `package.json` (no other scaffold changes).

**Tech Stack:** Deno (test runner: BDD describe/it from `#veryfront/testing/bdd.ts`), Veryfront CLI shared parsers (`cli/shared/args.ts`).

**Spec:** `docs/superpowers/specs/2026-05-27-init-runtime-option-design.md`.

---

## File map

**New files:**

- `cli/commands/init/runtime.ts` — `InitRuntime` enum + `parseRuntime(value: unknown): InitRuntime` validator.
- `cli/commands/init/runtime.test.ts` — unit tests for `parseRuntime`.
- `cli/commands/init/deno-config-generator.ts` — `createDenoConfig(projectDir): Promise<void>`.
- `cli/commands/init/deno-config-generator.test.ts` — unit tests for `createDenoConfig`.

**Modified files:**

- `cli/commands/init/types.ts` — add `InitRuntime` re-export + `runtime?: InitRuntime` field to `InitOptions`.
- `cli/commands/init/handler.ts` — parse `args.runtime` and `config.runtime`, thread into `initCommand`.
- `cli/commands/init/init-command.ts` — resolve runtime default, conditional `createDenoConfig` call, pass `runtime` to both `detectPackageManager` call sites (lines 420 and 503).
- `cli/commands/init/init-command.test.ts` — add `InitOptions.runtime` type assertions.
- `cli/commands/init/init.integration.test.ts` — add `--runtime node|bun|deno` cases (run under Deno test runner; no real `bun install` performed because tests pass `--skip-install`).
- `cli/commands/init/interactive-wizard.ts` — add the new prompt step, `runtime` field on `WizardResult`, optional `presetRuntime` parameter, runtime in all return branches.
- `cli/commands/init/interactive-wizard.test.ts` — add coverage of the non-TTY/skipped branch returning `runtime: "node"`.
- `docs/getting-started/create-project.md` — document the `--runtime` flag.

---

## Phase 1 — Foundation: types, validator, handler

### Task 1: Add `InitRuntime` enum and option field

**Files:**

- Modify: `cli/commands/init/types.ts`
- Modify: `cli/commands/init/init-command.test.ts`

- [ ] **Step 1: Add the type and option to `cli/commands/init/types.ts`.**

Append below the existing `EnvValues` type:

```ts
export type InitRuntime = "node" | "bun" | "deno";
```

And add the `runtime?: InitRuntime` field to `InitOptions`. Final file:

```ts
import type { FeatureName, IntegrationName } from "../../templates/types.ts";

export type InitTemplate =
  | "ai-agent"
  | "docs-agent"
  | "multi-agent-system"
  | "agentic-workflow"
  | "coding-agent"
  | "saas-starter"
  | "minimal";

export type EnvValues = Record<string, string>;

export type InitRuntime = "node" | "bun" | "deno";

export interface InitOptions {
  name?: string;
  template?: InitTemplate;
  skipInstall?: boolean;
  skipEnvPrompt?: boolean;
  features?: FeatureName[];
  integrations?: IntegrationName[];
  env?: EnvValues;
  /** Suppress output messages */
  quiet?: boolean;
  /** Deploy to cloud after scaffolding */
  deploy?: boolean;
  /** Overwrite existing directory */
  force?: boolean;
  /** Runtime for the scaffolded project. Defaults to "node". */
  runtime?: InitRuntime;
}
```

- [ ] **Step 2: Add type-level coverage to `cli/commands/init/init-command.test.ts`.**

Inside the `describe("InitOptions", ...)` block (just before the closing `});` at line 84), add:

```ts
it("should allow runtime option", () => {
  const options: InitOptions = { runtime: "deno" };
  assertEquals(options.runtime, "deno");
});

it("should accept all three runtime values", () => {
  const node: InitOptions = { runtime: "node" };
  const bun: InitOptions = { runtime: "bun" };
  const deno: InitOptions = { runtime: "deno" };
  assertEquals(node.runtime, "node");
  assertEquals(bun.runtime, "bun");
  assertEquals(deno.runtime, "deno");
});
```

And inside the `describe("Default behaviors", ...)` block, add:

```ts
it("should default runtime to undefined when not specified", () => {
  assertEquals(options.runtime, undefined);
});
```

- [ ] **Step 3: Run the type tests.**

```bash
deno task test -- cli/commands/init/init-command.test.ts --no-lock
```

Expected: all tests pass; the new cases are visible in the output. If you see "Cannot find name 'InitRuntime'", you missed the export.

- [ ] **Step 4: Commit.**

```bash
git add cli/commands/init/types.ts cli/commands/init/init-command.test.ts
git commit -m "Add InitRuntime type and runtime option to InitOptions"
```

### Task 2: Add `parseRuntime` validator with TDD

**Files:**

- Create: `cli/commands/init/runtime.ts`
- Create: `cli/commands/init/runtime.test.ts`

- [ ] **Step 1: Write the failing test first.**

Create `cli/commands/init/runtime.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

import { parseRuntime } from "./runtime.ts";

describe("parseRuntime", () => {
  it("returns 'node' for input 'node'", () => {
    assertEquals(parseRuntime("node"), "node");
  });

  it("returns 'bun' for input 'bun'", () => {
    assertEquals(parseRuntime("bun"), "bun");
  });

  it("returns 'deno' for input 'deno'", () => {
    assertEquals(parseRuntime("deno"), "deno");
  });

  it("throws on unknown string", () => {
    assertThrows(
      () => parseRuntime("rust"),
      Error,
      'Invalid runtime value: "rust"',
    );
  });

  it("throws on number", () => {
    assertThrows(() => parseRuntime(42), Error, "Invalid runtime value");
  });

  it("throws on null", () => {
    assertThrows(() => parseRuntime(null), Error, "Invalid runtime value");
  });

  it("error message lists valid values", () => {
    try {
      parseRuntime("foo");
      throw new Error("should have thrown");
    } catch (e) {
      assertEquals(
        (e as Error).message.includes("node, bun, deno"),
        true,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails for the right reason.**

```bash
deno task test -- cli/commands/init/runtime.test.ts --no-lock
```

Expected: FAIL with "Module not found" or "Cannot find module './runtime.ts'".

- [ ] **Step 3: Implement `cli/commands/init/runtime.ts`.**

```ts
import type { InitRuntime } from "./types.ts";

const VALID_RUNTIMES: readonly InitRuntime[] = ["node", "bun", "deno"];

/**
 * Validate an unknown value (from CLI args or a config file) and return it
 * as an `InitRuntime`. Throws with an actionable error when the value is
 * not one of `node | bun | deno`.
 */
export function parseRuntime(value: unknown): InitRuntime {
  if (
    typeof value === "string" &&
    (VALID_RUNTIMES as readonly string[]).includes(value)
  ) {
    return value as InitRuntime;
  }
  throw new Error(
    `Invalid runtime value: ${JSON.stringify(value)}. ` +
      `Must be one of: ${VALID_RUNTIMES.join(", ")}.`,
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes.**

```bash
deno task test -- cli/commands/init/runtime.test.ts --no-lock
```

Expected: all 7 cases PASS.

- [ ] **Step 5: Lint and format.**

```bash
deno fmt cli/commands/init/runtime.ts cli/commands/init/runtime.test.ts
deno check cli/commands/init/runtime.ts cli/commands/init/runtime.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 6: Commit.**

```bash
git add cli/commands/init/runtime.ts cli/commands/init/runtime.test.ts
git commit -m "Add parseRuntime validator for --runtime input"
```

### Task 3: Parse `--runtime` and `config.runtime` in handler

**Files:**

- Modify: `cli/commands/init/handler.ts`

- [ ] **Step 1: Read the current handler.**

Current file (`cli/commands/init/handler.ts`) parses `name`, `template`, `integrations`, `skipInstall`, `skipEnvPrompt`, `env`, `deploy`, `force`. The pattern is: CLI args first, then optional config file, with `||=` for "config provides default if CLI didn't set it".

- [ ] **Step 2: Add runtime parsing.**

Edit `cli/commands/init/handler.ts`. Add to the imports:

```ts
import type { InitRuntime, InitTemplate } from "./types.ts";
import { parseRuntime } from "./runtime.ts";
```

(Replace the existing single `import type { InitTemplate } from "./types.ts";` line with the multi-name form above.)

After the `force` declaration (line 26 in the current file), add:

```ts
let runtime: InitRuntime | undefined = args.runtime !== undefined
  ? parseRuntime(args.runtime)
  : undefined;
```

In the config-file block, expand the parsed shape and the fallback. The current block looks like:

```ts
const config = JSON.parse(configContent) as {
  name?: string;
  template?: InitTemplate;
  integrations?: IntegrationName[];
  skipInstall?: boolean;
  skipEnvPrompt?: boolean;
  env?: Record<string, string>;
};

// Config values serve as defaults, CLI args take precedence
name ||= config.name;
template ||= config.template;
integrations ||= config.integrations;
skipInstall ||= config.skipInstall ?? false;
skipEnvPrompt ||= config.skipEnvPrompt ?? false;
env = config.env;
```

Change to:

```ts
const config = JSON.parse(configContent) as {
  name?: string;
  template?: InitTemplate;
  integrations?: IntegrationName[];
  skipInstall?: boolean;
  skipEnvPrompt?: boolean;
  env?: Record<string, string>;
  runtime?: unknown;
};

// Config values serve as defaults, CLI args take precedence
name ||= config.name;
template ||= config.template;
integrations ||= config.integrations;
skipInstall ||= config.skipInstall ?? false;
skipEnvPrompt ||= config.skipEnvPrompt ?? false;
env = config.env;
if (runtime === undefined && config.runtime !== undefined) {
  runtime = parseRuntime(config.runtime);
}
```

Finally, add `runtime` to the `initCommand` call at the bottom of the function:

```ts
await initCommand({
  name,
  template,
  skipInstall,
  skipEnvPrompt,
  integrations,
  env,
  deploy,
  force,
  runtime,
});
```

- [ ] **Step 3: Format and typecheck.**

```bash
deno fmt cli/commands/init/handler.ts
deno check cli/commands/init/handler.ts
```

Expected: both exit 0.

- [ ] **Step 4: Manually verify the validation surfaces the error end-to-end.**

```bash
deno run -A cli/main.ts init test-runtime-validation --runtime rust --skip-install --skip-env-prompt
```

Expected: non-zero exit, error message contains `Invalid runtime value: "rust"`. The directory should NOT be created.

```bash
test ! -d ./test-runtime-validation && echo "directory absent — good" || (rm -rf ./test-runtime-validation && echo "BUG: directory was created")
```

Expected: `directory absent — good`.

- [ ] **Step 5: Commit.**

```bash
git add cli/commands/init/handler.ts
git commit -m "Parse --runtime and config.runtime in init handler"
```

---

## Phase 2 — Deno config generator

### Task 4: Add `createDenoConfig` with TDD

**Files:**

- Create: `cli/commands/init/deno-config-generator.ts`
- Create: `cli/commands/init/deno-config-generator.test.ts`

- [ ] **Step 1: Write the failing tests.**

Create `cli/commands/init/deno-config-generator.test.ts`:

```ts
import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "veryfront/platform/path";

import { createDenoConfig } from "./deno-config-generator.ts";

describe("deno-config-generator", () => {
  describe("createDenoConfig", () => {
    it("writes deno.json with nodeModulesDir: 'auto'", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createDenoConfig(tmpDir);
        const raw = await Deno.readTextFile(join(tmpDir, "deno.json"));
        const parsed = JSON.parse(raw);
        assertEquals(parsed.nodeModulesDir, "auto");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("writes dev, build, preview tasks invoking npm:veryfront", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createDenoConfig(tmpDir);
        const parsed = JSON.parse(
          await Deno.readTextFile(join(tmpDir, "deno.json")),
        );
        assertEquals(parsed.tasks.dev, "deno run -A npm:veryfront dev");
        assertEquals(parsed.tasks.build, "deno run -A npm:veryfront build");
        assertEquals(
          parsed.tasks.preview,
          "deno run -A npm:veryfront preview",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("writes valid JSON terminated by a newline", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await createDenoConfig(tmpDir);
        const raw = await Deno.readTextFile(join(tmpDir, "deno.json"));
        assertEquals(raw.endsWith("\n"), true);
        JSON.parse(raw); // throws if invalid
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    it("throws if deno.json already exists", async () => {
      const tmpDir = await Deno.makeTempDir();
      try {
        await Deno.writeTextFile(join(tmpDir, "deno.json"), "{}");
        await assertRejects(
          () => createDenoConfig(tmpDir),
          Error,
          "Refusing to overwrite existing deno.json",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail for the right reason.**

```bash
deno task test -- cli/commands/init/deno-config-generator.test.ts --no-lock
```

Expected: FAIL with "Module not found" or "Cannot find module './deno-config-generator.ts'".

- [ ] **Step 3: Implement `cli/commands/init/deno-config-generator.ts`.**

```ts
import { join } from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";

const DENO_CONFIG = {
  nodeModulesDir: "auto",
  tasks: {
    dev: "deno run -A npm:veryfront dev",
    build: "deno run -A npm:veryfront build",
    preview: "deno run -A npm:veryfront preview",
  },
};

/**
 * Write a thin `deno.json` to the scaffolded project directory. Relies on
 * `nodeModulesDir: "auto"` so Deno reads dependencies from the
 * sibling `package.json` and materializes `node_modules/` on first task run.
 *
 * Throws if `deno.json` already exists at the destination — no template
 * ships one today, so an existing file means something unexpected.
 */
export async function createDenoConfig(projectDir: string): Promise<void> {
  const fs = createFileSystem();
  const target = join(projectDir, "deno.json");
  if (await fs.exists(target)) {
    throw new Error(`Refusing to overwrite existing deno.json at ${target}`);
  }
  await fs.writeTextFile(target, JSON.stringify(DENO_CONFIG, null, 2) + "\n");
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

```bash
deno task test -- cli/commands/init/deno-config-generator.test.ts --no-lock
```

Expected: all 4 cases PASS.

- [ ] **Step 5: Format and typecheck.**

```bash
deno fmt cli/commands/init/deno-config-generator.ts cli/commands/init/deno-config-generator.test.ts
deno check cli/commands/init/deno-config-generator.ts cli/commands/init/deno-config-generator.test.ts
```

Expected: both exit 0.

- [ ] **Step 6: Commit.**

```bash
git add cli/commands/init/deno-config-generator.ts cli/commands/init/deno-config-generator.test.ts
git commit -m "Add createDenoConfig generator for --runtime deno"
```

---

## Phase 3 — Wire `runtime` into `initCommand`

### Task 5: Add `runtime` to `WizardResult` (no UI change)

**Files:**

- Modify: `cli/commands/init/interactive-wizard.ts`
- Modify: `cli/commands/init/interactive-wizard.test.ts`

Reason for this step: it lets the next task (`initCommand` wiring) resolve `runtime` from either `options.runtime` or `wizardResult.runtime` without a temporary `undefined` fallback. The UI prompt is added later (Task 8).

- [ ] **Step 1: Update the `WizardResult` interface.**

In `cli/commands/init/interactive-wizard.ts`, change:

```ts
export interface WizardResult {
  projectName: string | null; // null = use current directory
  template: InitTemplate;
  initGit: boolean;
  skipped: boolean;
  cancelled: boolean;
}
```

to:

```ts
import type { InitRuntime, InitTemplate } from "./types.ts";

export interface WizardResult {
  projectName: string | null; // null = use current directory
  template: InitTemplate;
  runtime: InitRuntime;
  initGit: boolean;
  skipped: boolean;
  cancelled: boolean;
}
```

(Update the existing `import type { InitTemplate }` line to include `InitRuntime`.)

- [ ] **Step 2: Thread `runtime: "node"` into every existing return statement.**

There are seven return statements in `runInteractiveWizard` today (lines 30, 70, 83, 95, 116, 139, 164 in the current file — re-verify line numbers before editing). Each currently returns an object containing `template` and `initGit`. Add `runtime: "node"` to every one.

For example, the non-TTY/skipped branch (currently lines 30-36) becomes:

```ts
if (!canRunWizard()) {
  return {
    projectName: existingName ?? null,
    template: "minimal",
    runtime: "node",
    initGit: false,
    skipped: true,
    cancelled: false,
  };
}
```

The successful-completion return at the bottom (currently line 164) becomes:

```ts
return {
  projectName,
  template,
  runtime: "node",
  initGit,
  skipped: false,
  cancelled: false,
};
```

Do the same for the five cancellation/error returns.

- [ ] **Step 3: Add a wizard test for the new field.**

In `cli/commands/init/interactive-wizard.test.ts`, append a new `describe` block before the closing `});` on line 55:

```ts
describe("runInteractiveWizard (non-TTY skipped path)", () => {
  it("returns runtime: 'node' when not interactive", async () => {
    const { runInteractiveWizard } = await import("./interactive-wizard.ts");
    // In Deno test runner `canRunWizard()` returns false; the skipped branch fires.
    const result = await runInteractiveWizard("smoke-app");
    assertEquals(result.runtime, "node");
    assertEquals(result.skipped, true);
  });
});
```

- [ ] **Step 4: Run the wizard tests.**

```bash
deno task test -- cli/commands/init/interactive-wizard.test.ts --no-lock
```

Expected: all existing cases plus the new one PASS.

- [ ] **Step 5: Format and typecheck the wizard file.**

```bash
deno fmt cli/commands/init/interactive-wizard.ts cli/commands/init/interactive-wizard.test.ts
deno check cli/commands/init/interactive-wizard.ts cli/commands/init/interactive-wizard.test.ts
```

Expected: both exit 0. If you missed a return statement, `deno check` will flag the missing `runtime` property.

- [ ] **Step 6: Commit.**

```bash
git add cli/commands/init/interactive-wizard.ts cli/commands/init/interactive-wizard.test.ts
git commit -m "Add runtime field to WizardResult (default node, no UI yet)"
```

### Task 6: Wire `runtime` through `initCommand`

**Files:**

- Modify: `cli/commands/init/init-command.ts`

- [ ] **Step 1: Capture wizard result by reference so its runtime can be read later.**

Read the current code around lines 187-223 in `cli/commands/init/init-command.ts`. The wizard result is destructured directly into `template`, `projectName`, `initGit` and the result variable is discarded. We need to keep it around so we can read `wizardResult.runtime`.

Replace:

```ts
  let template: InitTemplate;
  let projectName = name;
  let initGit = false;

  // Validate project name before doing anything else
  if (name) {
    const nameError = validateProjectName(name);
    if (nameError) {
      console.error(red(nameError));
      return;
    }
  }

  // Check if directory already exists before entering the wizard
  if (name && !options.force) {
    const fs = createFileSystem();
    const targetDir = join(cwd(), name);
    if (await fs.exists(targetDir)) {
      console.error(
        red(
          `Directory "${name}" already exists. Choose a different name or use --force to overwrite.`,
        ),
      );
```

with the same code (no change to that snippet). The actual edit is below at the wizard call site (around line 214):

Replace:

```ts
if (shouldRunWizard(options)) {
  const wizardResult = await runInteractiveWizard(name);
  if (wizardResult.cancelled) {
    return;
  }
  template = wizardResult.template;
  if (wizardResult.projectName) {
    projectName = wizardResult.projectName;
  }
  initGit = wizardResult.initGit;
} else {
  template = options.template ?? "minimal";
}
```

with:

```ts
let wizardRuntime: import("./types.ts").InitRuntime = "node";
if (shouldRunWizard(options)) {
  const wizardResult = await runInteractiveWizard(name);
  if (wizardResult.cancelled) {
    return;
  }
  template = wizardResult.template;
  if (wizardResult.projectName) {
    projectName = wizardResult.projectName;
  }
  initGit = wizardResult.initGit;
  wizardRuntime = wizardResult.runtime;
} else {
  template = options.template ?? "minimal";
}

const runtime = options.runtime ?? wizardRuntime;
```

- [ ] **Step 2: Add the `createDenoConfig` import.**

At the top of `cli/commands/init/init-command.ts`, after the `createPackageJson` import (line 12 in the current file):

```ts
import { createPackageJson } from "./config-generator.ts";
import { createDenoConfig } from "./deno-config-generator.ts";
```

- [ ] **Step 3: Call `createDenoConfig` after `createPackageJson`.**

Find the `createPackageJson` call (around line 363):

```ts
// Skip in quiet/TUI mode since local dev uses CDN and package.json can cause hydration issues
if (!options.quiet) {
  await createPackageJson(projectDir, projectName, {
    integrations: loadedIntegrations.map((integration) => ({
      name: integration.config.name,
      npmDependencies: integration.config.npmDependencies,
    })),
  });
}
```

Replace with:

```ts
// Skip in quiet/TUI mode since local dev uses CDN and package.json can cause hydration issues
if (!options.quiet) {
  await createPackageJson(projectDir, projectName, {
    integrations: loadedIntegrations.map((integration) => ({
      name: integration.config.name,
      npmDependencies: integration.config.npmDependencies,
    })),
  });
  if (runtime === "deno") {
    await createDenoConfig(projectDir);
  }
}
```

- [ ] **Step 4: Pass `runtime` to both `detectPackageManager` call sites.**

There are two call sites in `cli/commands/init/init-command.ts`:

- Line 420 (install command): `const pm = await detectPackageManager(projectDir);` → `const pm = await detectPackageManager(projectDir, runtime);`
- Line 503 (next-steps printer): `const pm = await detectPackageManager(projectDir);` → `const pm = await detectPackageManager(projectDir, runtime);`

Verify both with:

```bash
grep -n "detectPackageManager(projectDir" cli/commands/init/init-command.ts
```

Expected after the edit: both lines pass two arguments.

- [ ] **Step 5: Format and typecheck.**

```bash
deno fmt cli/commands/init/init-command.ts
deno check cli/commands/init/init-command.ts
```

Expected: both exit 0.

- [ ] **Step 6: Commit.**

```bash
git add cli/commands/init/init-command.ts
git commit -m "Wire runtime through initCommand (createDenoConfig + pm preference)"
```

### Task 7: Integration tests for the three runtimes

**Files:**

- Modify: `cli/commands/init/init.integration.test.ts`

- [ ] **Step 1: Add a `runtime selection` `describe` block.**

In `cli/commands/init/init.integration.test.ts`, after the existing `describe("template selection", ...)` block (ends around line 122 in the current file), add a new block. Use the same `runInitCommand`, `projectDir`, and `afterEach` cleanup already defined in the file.

```ts
describe("runtime selection", () => {
  it("does NOT write deno.json by default (runtime defaults to node)", async () => {
    const result = await runInitCommand([
      projectName,
      "-t",
      "minimal",
      "--skip-install",
      "--skip-env-prompt",
    ]);
    assertEquals(result.code, 0);
    assertEquals(await exists(join(projectDir, "package.json")), true);
    assertEquals(await exists(join(projectDir, "deno.json")), false);
  });

  it("does NOT write deno.json for --runtime node", async () => {
    const result = await runInitCommand([
      projectName,
      "-t",
      "minimal",
      "--runtime",
      "node",
      "--skip-install",
      "--skip-env-prompt",
    ]);
    assertEquals(result.code, 0);
    assertEquals(await exists(join(projectDir, "deno.json")), false);
  });

  it("does NOT write deno.json for --runtime bun", async () => {
    const result = await runInitCommand([
      projectName,
      "-t",
      "minimal",
      "--runtime",
      "bun",
      "--skip-install",
      "--skip-env-prompt",
    ]);
    assertEquals(result.code, 0);
    assertEquals(await exists(join(projectDir, "deno.json")), false);
  });

  it("writes both package.json and deno.json for --runtime deno", async () => {
    const result = await runInitCommand([
      projectName,
      "-t",
      "minimal",
      "--runtime",
      "deno",
      "--skip-install",
      "--skip-env-prompt",
    ]);
    assertEquals(result.code, 0);
    assertEquals(await exists(join(projectDir, "package.json")), true);
    assertEquals(await exists(join(projectDir, "deno.json")), true);

    const parsed = JSON.parse(
      await readTextFile(join(projectDir, "deno.json")),
    );
    assertEquals(parsed.nodeModulesDir, "auto");
    assertEquals(parsed.tasks.dev, "deno run -A npm:veryfront dev");
    assertExists(parsed.tasks.build);
    assertExists(parsed.tasks.preview);
  });

  it("rejects an invalid --runtime value before scaffolding", async () => {
    const result = await runInitCommand([
      projectName,
      "-t",
      "minimal",
      "--runtime",
      "rust",
      "--skip-install",
      "--skip-env-prompt",
    ]);
    // Non-zero exit; the project directory must not exist.
    assertEquals(result.code !== 0, true);
    assertEquals(await exists(projectDir), false);
    // The error message should surface the validator.
    assertEquals(
      (result.stderr ?? "").includes("Invalid runtime value"),
      true,
    );
  });
});
```

- [ ] **Step 2: Run the integration tests.**

```bash
deno task test:integration -- cli/commands/init/init.integration.test.ts --no-lock
```

Expected: existing cases plus the five new cases PASS. The `--runtime rust` case must exit non-zero and leave no directory behind.

- [ ] **Step 3: Commit.**

```bash
git add cli/commands/init/init.integration.test.ts
git commit -m "Add init --runtime integration tests (node/bun/deno + invalid)"
```

---

## Phase 4 — Interactive wizard prompt

### Task 8: Add the runtime prompt with `presetRuntime` parameter

**Files:**

- Modify: `cli/commands/init/interactive-wizard.ts`
- Modify: `cli/commands/init/interactive-wizard.test.ts`
- Modify: `cli/commands/init/init-command.ts` (pass `presetRuntime` through)

- [ ] **Step 1: Add the prompt step to `runInteractiveWizard`.**

In `cli/commands/init/interactive-wizard.ts`, change the function signature from:

```ts
export async function runInteractiveWizard(existingName?: string): Promise<WizardResult> {
```

to:

```ts
export async function runInteractiveWizard(
  existingName?: string,
  presetRuntime?: InitRuntime,
): Promise<WizardResult> {
```

In the non-TTY skipped branch at the top, the returned `runtime` should reflect the preset if provided:

```ts
if (!canRunWizard()) {
  return {
    projectName: existingName ?? null,
    template: "minimal",
    runtime: presetRuntime ?? "node",
    initGit: false,
    skipped: true,
    cancelled: false,
  };
}
```

After the template selection block and before the git prompt (currently around line 127), insert:

```ts
// Runtime selection (skipped when CLI passed --runtime explicitly)
let runtime: InitRuntime = presetRuntime ?? "node";
if (presetRuntime === undefined) {
  const runtimeChoice = await select(
    "What runtime should this project use?",
    [
      { value: "node", label: "Node.js", description: "Default" },
      { value: "bun", label: "Bun", description: "Fast JS runtime" },
      { value: "deno", label: "Deno", description: "Secure-by-default" },
    ],
    0,
  );

  if (runtimeChoice === null) {
    console.log(muted("\n  Cancelled.\n"));
    return {
      projectName: null,
      template: "minimal",
      runtime: "node",
      initGit: false,
      skipped: false,
      cancelled: true,
    };
  }

  runtime = runtimeChoice as InitRuntime;
}
```

Update the success-summary block (the one that currently logs Location/Template/Git, around line 152) to also log the runtime:

```ts
console.log(`  ${brand("Template:")} ${templateLabel}`);
console.log(`  ${brand("Runtime:")} ${runtime}`);
console.log(`  ${brand("Git:")} ${initGit ? "Yes" : "No"}`);
```

Update the final return at the bottom of the function:

```ts
return { projectName, template, runtime, initGit, skipped: false, cancelled: false };
```

- [ ] **Step 2: Pass `options.runtime` from `initCommand` into the wizard call.**

In `cli/commands/init/init-command.ts`, find the wizard invocation (already edited in Task 6). Change:

```ts
const wizardResult = await runInteractiveWizard(name);
```

to:

```ts
const wizardResult = await runInteractiveWizard(name, options.runtime);
```

This way, when a user runs `veryfront init my-app --runtime bun` without `--template`, the wizard still appears for template/git, but the runtime prompt is skipped.

- [ ] **Step 3: Add wizard tests covering `presetRuntime` and the default.**

In `cli/commands/init/interactive-wizard.test.ts`, replace the `describe("runInteractiveWizard (non-TTY skipped path)", ...)` block added in Task 5 with:

```ts
describe("runInteractiveWizard (non-TTY skipped path)", () => {
  it("returns runtime: 'node' by default when not interactive", async () => {
    const { runInteractiveWizard } = await import("./interactive-wizard.ts");
    const result = await runInteractiveWizard("smoke-app");
    assertEquals(result.runtime, "node");
    assertEquals(result.skipped, true);
  });

  it("honors presetRuntime even when not interactive", async () => {
    const { runInteractiveWizard } = await import("./interactive-wizard.ts");
    const result = await runInteractiveWizard("smoke-app", "bun");
    assertEquals(result.runtime, "bun");
    assertEquals(result.skipped, true);
  });

  it("honors presetRuntime: 'deno'", async () => {
    const { runInteractiveWizard } = await import("./interactive-wizard.ts");
    const result = await runInteractiveWizard("smoke-app", "deno");
    assertEquals(result.runtime, "deno");
    assertEquals(result.skipped, true);
  });
});
```

- [ ] **Step 4: Run the wizard tests.**

```bash
deno task test -- cli/commands/init/interactive-wizard.test.ts --no-lock
```

Expected: all cases (existing + 3 new) PASS.

- [ ] **Step 5: Run the init integration tests again to confirm nothing regressed.**

```bash
deno task test:integration -- cli/commands/init/init.integration.test.ts --no-lock
```

Expected: all cases PASS, including the runtime-selection cases from Task 7.

- [ ] **Step 6: Format and typecheck.**

```bash
deno fmt cli/commands/init/interactive-wizard.ts cli/commands/init/interactive-wizard.test.ts cli/commands/init/init-command.ts
deno check cli/commands/init/interactive-wizard.ts cli/commands/init/init-command.ts
```

Expected: both `deno check` invocations exit 0.

- [ ] **Step 7: Commit.**

```bash
git add cli/commands/init/interactive-wizard.ts cli/commands/init/interactive-wizard.test.ts cli/commands/init/init-command.ts
git commit -m "Add runtime prompt step to interactive wizard"
```

---

## Phase 5 — Documentation

### Task 9: Document `--runtime` in the getting-started guide

**Files:**

- Modify: `docs/getting-started/create-project.md`

- [ ] **Step 1: Read the current doc around the `--template` flag.**

```bash
grep -n "template\|runtime\|skip-install" docs/getting-started/create-project.md | head -30
```

The current file documents `--template` at line 20-23. Add a `--runtime` section immediately below.

- [ ] **Step 2: Add documentation for the new flag.**

Open `docs/getting-started/create-project.md`. Locate the existing
`--template` section (around line 20-23). After its fenced example, append a
new section. The new content is plain markdown with one bash fence inside;
write it directly into the doc — do not paste this plan's outer fences.

Heading and intro paragraph to add:

- Heading: `### Choose a runtime`
- First paragraph: "By default, `veryfront init` scaffolds projects for
  **Node.js**. Pass `--runtime <node|bun|deno>` to select a different
  JavaScript runtime:"

Example fence to add (one bash code fence containing two lines):

- `veryfront init test-app --template ai-agent --runtime bun`
- `veryfront init test-app --template ai-agent --runtime deno`

Bulleted "What this changes" list to add below the fence (verbatim):

- All runtimes get the same `package.json` and template files.
- `--runtime deno` additionally writes a thin `deno.json` so `deno task dev`
  / `deno task build` / `deno task preview` work without extra setup. Deno
  reads npm dependencies directly from `package.json` via
  `nodeModulesDir: "auto"`.
- The install command and the printed next-steps match your runtime
  (`npm install` / `bun install` / `deno install`).

Final paragraph:

- "You can also set `\"runtime\": \"deno\"` in the JSON file passed to
  `--config`."

Match the surrounding doc's heading depth, list style, and fence style. If
the existing `--template` content uses `##` headings, use `##` here; if it
uses `###`, use `###`. The exact wording above is the requirement; the
formatting follows the host doc's conventions.

- [ ] **Step 3: Verify the doc renders.**

```bash
test -f docs/getting-started/create-project.md && echo "doc present"
grep -q "\-\-runtime" docs/getting-started/create-project.md && echo "flag documented"
```

Expected: both echo their success message.

- [ ] **Step 4: Commit.**

```bash
git add docs/getting-started/create-project.md
git commit -m "Document --runtime flag in create-project guide"
```

---

## Final verification

### Task 10: Full local test pass + push

**Files:** None (verification only).

- [ ] **Step 1: Run the full init test suite.**

```bash
deno task test -- cli/commands/init/ --no-lock
```

Expected: all cases pass across `runtime.test.ts`, `deno-config-generator.test.ts`, `interactive-wizard.test.ts`, `init-command.test.ts`, `config-generator.test.ts`, `catalog.test.ts`, `path-utils.test.ts`.

- [ ] **Step 2: Run the init integration tests.**

```bash
deno task test:integration -- cli/commands/init/init.integration.test.ts --no-lock
```

Expected: all cases pass.

- [ ] **Step 3: Manually scaffold each runtime once and inspect output.**

```bash
TMP="$(mktemp -d -t vf-runtime-XXXX)"
for RT in node bun deno; do
  deno run -A cli/main.ts init "${RT}-app" \
    -t minimal --runtime "$RT" --skip-install --skip-env-prompt --force
  echo "---- $RT ----"
  ls "${RT}-app" | sort
done
mv node-app bun-app deno-app "$TMP/" 2>/dev/null
echo "scaffolded in $TMP"
```

Expected: `node-app` and `bun-app` show only `package.json` + template files. `deno-app` shows both `package.json` and `deno.json`. The printed next-steps differ between the three.

- [ ] **Step 4: Read the generated `deno.json`.**

```bash
cat "$TMP/deno-app/deno.json"
```

Expected: parseable JSON with `nodeModulesDir: "auto"` and three tasks (dev/build/preview).

- [ ] **Step 5: Clean up.**

```bash
rm -rf "$TMP"
```

- [ ] **Step 6: Push the branch.**

```bash
git push
```

Expected: push succeeds; CI runs the existing test suite against the branch.

---

## Self-review notes

- **Spec coverage:**
  - "New `runtime` option, valid values, default node" → Task 1.
  - "CLI flag" with validation → Tasks 2, 3.
  - "Config file `runtime` field" → Task 3.
  - "Interactive wizard prompt step" → Task 8.
  - "Scaffold delta: all runtimes get package.json" → no change needed (existing behavior preserved); Task 7 asserts.
  - "`runtime === 'deno'` writes thin `deno.json`" → Tasks 4, 6.
  - "Install command and next-steps printer pick runtime-matched commands" → Task 6 (both `detectPackageManager` call sites).
  - "Tests covering three runtimes end-to-end" → Task 7.
  - Error-handling table rows: invalid `--runtime` → Tasks 2, 3, 7; invalid `config.runtime` → Tasks 2, 3; CLI wins over config → Task 3 pattern; `--runtime deno + --skip-install` writes `deno.json` → Task 6 (deno.json written regardless of install flag); deno.json already exists → Tasks 4, 6; wizard cancelled → Task 5 (cancelled branch keeps existing behavior); non-TTY → Task 5 + Task 8 test.
  - All five "Build sequence" steps from the spec map to Phases 1–5.

- **Placeholder scan:** No "TBD" / "TODO" / "implement later" / "similar to" appear in this plan. Every code block is complete enough to paste.

- **Type consistency:**
  - `InitRuntime` defined in Task 1 (`types.ts`), imported in Tasks 2, 5, 6, 7, 8.
  - `parseRuntime(value: unknown): InitRuntime` defined in Task 2, used in Task 3 (handler).
  - `createDenoConfig(projectDir: string): Promise<void>` defined in Task 4, called in Task 6.
  - `WizardResult.runtime: InitRuntime` added in Task 5, consumed in Task 6, written by the new prompt in Task 8.
  - `runInteractiveWizard(existingName?, presetRuntime?)` signature settled in Task 8; the existing single-arg call from `init-command.ts` is updated in the same task.
  - `detectPackageManager(projectDir, preference?)` already exists in `cli/utils/package-manager.ts`; Task 6 passes `runtime` as `preference`.

- **One assumption to validate during execution:** The Deno task strings (`deno run -A npm:veryfront dev` etc.) work as expected. Verified inline by the manual sweep in Task 10 Step 4 (reads the file but does not execute the task). End-to-end execution under Deno is deferred to the follow-up template-smoke plan, per the spec's "Risks and open items" note.
