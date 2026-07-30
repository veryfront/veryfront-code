# Project creation module design

## Goal

Give CLI, App, MCP, and demo callers one deterministic project-creation interface with an observable result. Keep prompts, terminal progress and result formatting, JSON and MCP formatting, remote registration, source push, and optional deployment in their adapters. Existing diagnostic debug and validation messages may remain beside the creation rules that produce them.

The refactor must preserve existing generated files, conflict handling, package-manager selection, dependency installation, Git initialization, non-fatal installation and Git failures, and non-fatal deployment behavior.

## Approaches considered

### Selected: deep local creation module with a compatibility adapter

Add `cli/shared/project-creation.ts`. It owns validation, template and extension assembly, environment-file generation, filesystem writes, package metadata, dependency installation, and optional Git initialization. It returns a structured result and emits only semantic lifecycle events needed by adapters.

Keep `initCommand()` as the interactive CLI compatibility adapter. It resolves wizard choices, supplies environment values, renders progress and results, and optionally deploys after local creation succeeds. App, MCP, and demo callers use the shared module directly once they already have deterministic inputs.

This concentrates creation behavior without coupling the local module to a terminal or remote service.

### Rejected: return a result from the existing `initCommand()`

This is smaller, but the shared interface would still accept interaction and presentation flags such as `quiet`, `skipEnvPrompt`, and `deploy`. Programmatic callers would continue depending on CLI behavior.

### Rejected: generic project-creation workflow or dependency-injection framework

This could model every step as a port, but it would expose more implementation knowledge than callers need. Existing filesystem, template, package-manager, and Git utilities are sufficient.

## Interface

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

`includePackageMetadata` makes the existing quiet/TUI scaffold mode explicit. Presentation state must not implicitly change generated files inside the shared module.

The observer is deliberately narrow. It preserves the current dependency-installation spinner without exposing filesystem steps or adding a generic event system.

The optional environment-file resolver is the single interaction seam. Programmatic callers use the deterministic default, which applies supplied values and defaults without prompting. `initCommand()` supplies the existing prompt adapter so the shared module can discover template and integration requirements while terminal interaction remains outside it.

## Data flow

1. An adapter resolves interactive choices into a complete `CreateProjectRequest`.
2. `createProject()` validates the name, feature list, and integration list before creating the target directory.
3. The module assembles template, feature, integration, agent-guide, environment, package metadata, and ignore files.
4. It writes the scaffold and records repo-relative created paths.
5. It optionally installs dependencies and initializes Git. Both failures remain non-fatal and are represented in the result.
6. The adapter renders warnings, next steps, and optional deployment using the returned result.

The existing `initCommand()` remains the public CLI command surface. Its deploy dependency stays outside `createProject()` because a deploy failure must not invalidate successful local creation.

## Consumer migration

- CLI handler: continues to call `initCommand()`.
- App: calls `createProject()` and uses `result.projectDir` instead of rebuilding the path.
- MCP: calls `createProject()` and builds its public response from the result.
- Demo: calls `createProject()`, then performs its existing registration, link, and push steps.

No public CLI arguments, MCP schema, template identifiers, or output wording change in this PR.

## Error handling

Invalid names, features, integrations, templates, and target conflicts throw before scaffold writes where current behavior permits. File-write failures throw.

Dependency installation and Git initialization failures do not throw. Their statuses are returned so `initCommand()` can preserve existing warnings. Optional deployment keeps its existing non-fatal handling in `initCommand()`.

## Verification

- Add focused contract tests for returned paths, package-manager selection, created-path reporting, feature tips, conflict policy, dependency-installation status, and Git status.
- Preserve existing init integration tests as regression coverage for generated files and runtime variants.
- Type-check the CLI, App, MCP, and demo consumers against the shared interface.
- Run format, lint, targeted tests, and the repository unit suite before opening the PR.

## Scope

This PR does not change templates, add dependencies, redesign the init wizard, alter remote project registration, or combine project creation with deployment.
