# Project Creation Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give CLI, App, MCP, and demo callers one deterministic project-creation interface with an observable result.

**Architecture:** Add `cli/shared/project-creation.ts` as the deep local creation module. Keep `initCommand()` as the interactive and presentation compatibility adapter, then move deterministic App, MCP, and demo callers to the shared interface. The module returns non-fatal install and Git outcomes and accepts only one narrow environment-file interaction seam plus semantic install events.

**Tech Stack:** Deno, TypeScript, existing Veryfront template loaders, filesystem adapter, package-manager utilities, Git utility, BDD test helpers.

## Global Constraints

- Preserve public CLI arguments, output wording, MCP schema, template identifiers, generated files, and non-fatal deploy behavior.
- Preserve public API compatibility.
- Use `veryfront/*` for public imports and `#cli/*` or relative imports for CLI internals.
- Add no dependencies.
- Keep prompts, terminal progress and result formatting, JSON and MCP formatting, remote registration, source push, and deployment outside the shared module.
- Keep diffs small and do not refactor unrelated init behavior.

---

## File structure

- Create `cli/shared/project-creation.ts`: deterministic creation request, result, semantic install events, template assembly, filesystem writes, install, and Git initialization.
- Create `cli/shared/project-creation.test.ts`: interface-level result and filesystem behavior tests.
- Modify `cli/commands/init/init-command.ts`: retain wizard, existing-directory preflight, environment prompting, spinner, warnings, optional deployment, and success output; delegate creation to the shared module.
- Modify `cli/commands/init/init-command.test.ts`: characterize compatibility output and prove returned creation data drives presentation.
- Modify `cli/app/operations/project-creation.ts`: use the shared result instead of rebuilding the project path.
- Modify `cli/mcp/tools/catalog-tools.ts`: use the shared result while preserving the MCP response.
- Modify `cli/mcp/tools/catalog-tools.test.ts`: prove MCP path and result compatibility.
- Modify `cli/commands/demo/demo.ts`: use the shared result before existing registration and push behavior.

### Task 1: Deterministic project creation contract

**Files:**
- Create: `cli/shared/project-creation.ts`
- Create: `cli/shared/project-creation.test.ts`
- Move implementation from: `cli/commands/init/init-command.ts`

**Interfaces:**
- Consumes: `InitTemplate`, `InitRuntime`, `FeatureName`, `IntegrationName`, `EnvVarConfig`, `EnvPromptResult`, and `PackageManager`.
- Produces:

```ts
export interface CreateProjectRequest {
  name?: string;
  parentDir: string;
  template: InitTemplate;
  runtime: InitRuntime;
  features: FeatureName[];
  integrations: IntegrationName[];
  environmentValues: Record<string, string>;
  conflictPolicy: "fail" | "overwrite";
  installDependencies: boolean;
  initializeGit: boolean;
  includePackageMetadata: boolean;
}

export interface CreateProjectResult {
  projectDir: string;
  projectName?: string;
  createdPaths: string[];
  packageManager: PackageManager;
  dependencyInstallation: "installed" | "failed" | "skipped";
  gitInitialization: "initialized" | "failed" | "skipped";
  featureTips: string[];
}

export type ProjectCreationEvent =
  | { kind: "dependency-installation-started"; packageManager: PackageManager }
  | {
      kind: "dependency-installation-finished";
      packageManager: PackageManager;
      status: "installed" | "failed";
    };

export interface ProjectCreationObserver {
  onEvent(event: ProjectCreationEvent): void | Promise<void>;
}

export interface CreateProjectDependencies {
  observer?: ProjectCreationObserver;
  resolveEnvironmentFiles?: (
    variables: EnvVarConfig[],
    values: Record<string, string>,
  ) => Promise<Pick<EnvPromptResult, "envContent" | "envExampleContent">>;
}

export function createProject(
  request: CreateProjectRequest,
  dependencies?: CreateProjectDependencies,
): Promise<CreateProjectResult>;
```

- [ ] **Step 1: Write failing interface tests**

Add tests that create a minimal project in a temporary parent directory and assert the structured result:

```ts
const result = await createProject({
  name: "contract-project",
  parentDir,
  template: "minimal",
  runtime: "node",
  features: [],
  integrations: [],
  environmentValues: {},
  conflictPolicy: "fail",
  installDependencies: false,
  initializeGit: false,
  includePackageMetadata: true,
});

assertEquals(result.projectDir, join(parentDir, "contract-project"));
assertEquals(result.projectName, "contract-project");
assertEquals(result.packageManager, "npm");
assertEquals(result.dependencyInstallation, "skipped");
assertEquals(result.gitInitialization, "skipped");
assertEquals(result.createdPaths.includes("app/page.tsx"), true);
assertEquals(result.createdPaths.includes("package.json"), true);
assertEquals(result.createdPaths.includes(".gitignore"), true);
```

Add separate tests for:

```ts
assertRejects(
  () => createProject({ ...request, conflictPolicy: "fail" }),
  Error,
  'Directory "contract-project" already exists',
);

const overwritten = await createProject({
  ...request,
  conflictPolicy: "overwrite",
});
assertEquals(overwritten.projectDir, result.projectDir);

const metadataFree = await createProject({
  ...request,
  name: "metadata-free",
  includePackageMetadata: false,
});
assertEquals(metadataFree.createdPaths.includes("package.json"), false);
```

Also assert that an integration requiring environment variables calls the supplied `resolveEnvironmentFiles` once, writes `.env` and `.env.example`, and records both paths.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
deno test --no-check --allow-all cli/shared/project-creation.test.ts
```

Expected: fail because `cli/shared/project-creation.ts` does not exist.

- [ ] **Step 3: Implement the shared module**

Move creation-only helpers and behavior from `init-command.ts`:

- integration status route generation
- feature and integration validation and assembly
- environment requirement de-duplication
- template and agent-guide loading
- scaffold file writes and created-path tracking
- package metadata generation
- `.env`, `.env.example`, and `.gitignore` generation
- package-manager selection and optional dependency installation
- optional Git initialization

Use the deterministic default environment resolver:

```ts
const resolveEnvironmentFiles = dependencies.resolveEnvironmentFiles ??
  ((variables, values) =>
    promptForEnvVars(variables, {
      skipPrompt: true,
      prefilledValues: values,
    }));
```

Emit install events before and after `installDependencies()`. Return `"failed"` without throwing when installation fails. Catch Git initialization failures and return `"failed"` without throwing.

Do not add deployment, remote project registration, source push, terminal spinners, or success copy.

- [ ] **Step 4: Run focused GREEN and static checks**

Run:

```bash
deno test --no-check --allow-all cli/shared/project-creation.test.ts
deno fmt --check cli/shared/project-creation.ts cli/shared/project-creation.test.ts
deno lint cli/shared/project-creation.ts cli/shared/project-creation.test.ts
deno check cli/shared/project-creation.ts cli/shared/project-creation.test.ts
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 1**

Commit the shared module and tests with a Lore message. Record the RED and GREEN commands in `Tested:` and the compatibility migration as `Not-tested:`.

### Task 2: Init compatibility adapter

**Files:**
- Modify: `cli/commands/init/init-command.ts`
- Modify: `cli/commands/init/init-command.test.ts`
- Test: `cli/commands/init/init.integration.test.ts`
- Test: `cli/commands/init/init-deploy.integration.test.ts`

**Interfaces:**
- Consumes: `createProject(request, dependencies): Promise<CreateProjectResult>` from Task 1.
- Produces: unchanged `initCommand(options, dependencies): Promise<void>`.

- [ ] **Step 1: Add failing compatibility assertions**

Extend `init-command.test.ts` so the compatibility facade proves:

```ts
await initCommand({
  name,
  parentDir,
  template: "minimal",
  skipInstall: true,
  skipEnvPrompt: true,
  quiet: true,
});

assertEquals(await exists(join(parentDir, name, "app")), true);
assertEquals(await exists(join(parentDir, name, "package.json")), false);
```

Retain the existing deploy test and add an assertion that the verified deploy URL still prints after creation is delegated.

Add focused assertions to the integration suite that a failing fake npm still prints:

```text
Run 'npm install' manually to install dependencies.
```

and that initialized Git remains clean.

- [ ] **Step 2: Run the compatibility tests and verify the characterization**

Run:

```bash
deno test --no-check --allow-all cli/commands/init/init-command.test.ts
```

Expected before adapter migration: pass, proving the existing behavior is locked.

After replacing the creation body with an unimplemented shared call, rerun and verify it fails before completing the adapter.

- [ ] **Step 3: Convert `initCommand()` into an adapter**

Keep in `init-command.ts`:

- initial existing-directory preflight and existing red error copy
- interactive wizard and cancellation
- request defaulting
- `renderProjectStructure()`
- dependency-install spinner presentation
- install and Git failure warnings
- optional authenticated deployment and its non-fatal messages
- final structure, next steps, tips, and live/deploy output

Build the shared request:

```ts
const result = await createProject(
  {
    name: projectName,
    parentDir,
    template,
    runtime,
    features,
    integrations,
    environmentValues: options.env ?? {},
    conflictPolicy: options.force ? "overwrite" : "fail",
    installDependencies: !options.skipInstall,
    initializeGit: initGit,
    includePackageMetadata: !quiet,
  },
  {
    observer: installObserver,
    resolveEnvironmentFiles: (variables, values) =>
      promptForEnvVars(variables, {
        skipPrompt: options.skipEnvPrompt,
        prefilledValues: values,
      }),
  },
);
```

Use `result.packageManager`, `result.createdPaths`, and `result.featureTips` for all subsequent presentation. Remove the `_featureTips` mutation and duplicated creation helpers from `init-command.ts`.

- [ ] **Step 4: Run init regression coverage and static checks**

Run:

```bash
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  cli/shared/project-creation.test.ts \
  cli/commands/init/init-command.test.ts \
  cli/commands/init/init.integration.test.ts \
  cli/commands/init/init-deploy.integration.test.ts
deno fmt --check cli/shared/project-creation.ts cli/commands/init/init-command.ts \
  cli/shared/project-creation.test.ts cli/commands/init/init-command.test.ts
deno lint cli/shared/project-creation.ts cli/commands/init/init-command.ts \
  cli/shared/project-creation.test.ts cli/commands/init/init-command.test.ts
deno check cli/shared/project-creation.ts cli/commands/init/init-command.ts \
  cli/shared/project-creation.test.ts cli/commands/init/init-command.test.ts
git diff --check
```

Expected: all pass with existing output and generated-file behavior unchanged.

- [ ] **Step 5: Commit Task 2**

Commit the adapter conversion with a Lore message. Record the focused unit and integration suite in `Tested:`.

### Task 3: Programmatic consumer migration

**Files:**
- Modify: `cli/app/operations/project-creation.ts`
- Modify: `cli/mcp/tools/catalog-tools.ts`
- Modify: `cli/mcp/tools/catalog-tools.test.ts`
- Modify: `cli/commands/demo/demo.ts`

**Interfaces:**
- Consumes: `createProject(request): Promise<CreateProjectResult>` from Task 1.
- Produces: unchanged App state transition, unchanged `vf_create_project` input and result schemas, and unchanged demo remote registration and push sequence.

- [ ] **Step 1: Add failing consumer assertions**

In `catalog-tools.test.ts`, retain path normalization assertions and add a successful tool execution assertion that checks:

```ts
assertEquals(result.success, true);
assertEquals(result.projectDir, join(parentDir, "example-app"));
assertEquals(result.nextSteps?.[0], `cd ${join(parentDir, "example-app")}`);
```

Add a conflict assertion proving the existing failure response remains:

```ts
assertEquals(result.success, false);
assertEquals(result.message, `Directory already exists: ${projectDir}`);
```

- [ ] **Step 2: Run the MCP test and verify the characterization**

Run:

```bash
deno test --no-check --allow-all cli/mcp/tools/catalog-tools.test.ts
```

Expected before migration: pass. Temporarily point the imports at the shared module and verify compilation fails until complete request objects are supplied.

- [ ] **Step 3: Migrate deterministic consumers**

For App, use:

```ts
const creation = await createProject({
  name: `projects/${slug}`,
  parentDir: cwd(),
  template,
  runtime: "node",
  features: [],
  integrations: [],
  environmentValues: {},
  conflictPolicy: "fail",
  installDependencies: false,
  initializeGit: false,
  includePackageMetadata: false,
});
```

Store `creation.projectDir` in App state.

For MCP, use the resolved name and parent directory, include package metadata, install dependencies, skip Git, and build `projectDir` and next steps from the returned result.

For demo, use overwrite conflict policy, omit package metadata, skip installation and Git, then use `creation.projectDir` for its unchanged registration, link, and push sequence.

Do not move remote registration, auth, linking, push, or deploy into the shared module.

- [ ] **Step 4: Run consumer and full verification**

Run:

```bash
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  cli/shared/project-creation.test.ts \
  cli/commands/init/init-command.test.ts \
  cli/mcp/tools/catalog-tools.test.ts
deno fmt --check cli/shared/project-creation.ts cli/commands/init/init-command.ts \
  cli/app/operations/project-creation.ts cli/mcp/tools/catalog-tools.ts \
  cli/commands/demo/demo.ts
deno lint cli/shared/project-creation.ts cli/commands/init/init-command.ts \
  cli/app/operations/project-creation.ts cli/mcp/tools/catalog-tools.ts \
  cli/commands/demo/demo.ts
deno check cli/shared/project-creation.ts cli/commands/init/init-command.ts \
  cli/app/operations/project-creation.ts cli/mcp/tools/catalog-tools.ts \
  cli/commands/demo/demo.ts
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 \
  REVALIDATION_PER_PROJECT_LIMIT=0 NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all --parallel \
  '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
git diff --check origin/main...HEAD
```

Expected: all pass. If the test run regenerates unrelated tracked files, restore only the known generated drift with `apply_patch` and rerun `git diff --check`.

- [ ] **Step 5: Commit Task 3**

Commit the programmatic consumer migration with a Lore message. Record every completed verification command and any known untested interactive path.

### Task 4: Independent final review and PR

**Files:**
- Review: `origin/main...HEAD`

**Interfaces:**
- Consumes: all completed tasks.
- Produces: a review verdict, verification evidence, pushed branch, and PR URL.

- [ ] **Step 1: Run an independent specification and quality review**

Review for:

- exact design-contract compliance
- no presentation or remote behavior in `createProject()`
- no regression in quiet package metadata behavior
- non-fatal install, Git, and deploy behavior
- stable MCP schema and response
- no unsafe casts or leaked implementation flags

- [ ] **Step 2: Resolve every actionable finding**

Apply fixes test-first, rerun the narrowest failing checks, and request re-review until the verdict is `APPROVE`, `SPEC PASS`, and `QUALITY PASS`.

- [ ] **Step 3: Push and create PR 3**

Push `codex/project-creation-module`, create a PR against `main`, include the interface rationale, changed consumers, tests, and remaining risk, and record the PR URL before starting item 4.
