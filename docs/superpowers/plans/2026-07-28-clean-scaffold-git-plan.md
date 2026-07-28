# Clean Scaffold Git Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure a successful generated project starts with a clean Git repository whose initial commit includes the package-manager lockfile.

**Architecture:** Keep the existing scaffold pipeline and move dependency installation before optional Git initialization. Test the real orchestration with a deterministic fake package-manager executable so no network access is required.

**Tech Stack:** TypeScript, Deno subprocess APIs, Git CLI, Deno integration tests.

## Global Constraints

- No package-manager lockfile is ignored.
- No network dependency in tests.
- `--skip-install` behavior remains unchanged.
- Installation failure keeps the generated project and prints the exact recovery command.
- Tests must fail before production changes are written.

---

### Task 1: Lock the desired lifecycle with an integration test

**Files:**
- Modify: `cli/commands/init/init.integration.test.ts`

**Interfaces:**
- Exercises: `initCommand`.
- Observes: generated lockfile, Git index, and clean status.

- [ ] **Step 1: Add a fake npm executable fixture**

The fixture writes a deterministic `package-lock.json` into its working directory and exits successfully. Prepend its directory to `PATH` for the test only.

- [ ] **Step 2: Add the clean-initial-commit test**

Run init with Node/npm and Git enabled, then assert:

```text
git ls-files package-lock.json  -> package-lock.json
git status --porcelain          -> empty
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
deno test -A cli/commands/init/init.integration.test.ts --filter "commits the lockfile"
```

Expected: the lockfile exists but is untracked.

### Task 2: Reorder install and Git initialization

**Files:**
- Modify: `cli/commands/init/init-command.ts`
- Modify: `cli/commands/init/init.integration.test.ts`

**Interfaces:**
- Keeps existing `installDependencies` and `initializeGitRepo` contracts.

- [ ] **Step 1: Move dependency installation before Git initialization**

Do not add an abstraction. Preserve spinner and recovery output, but make the sequence:

```text
write project files
install dependencies
initialize Git and create initial commit
optional deploy
print result
```

- [ ] **Step 2: Run the RED test and confirm GREEN**

Run:

```bash
deno test -A cli/commands/init/init.integration.test.ts --filter "commits the lockfile"
```

- [ ] **Step 3: Add failure and skip-install regression assertions**

Confirm a failed fake npm command still leaves a Git repository with generated files committed, and `--skip-install` does not invoke the fake package manager.

- [ ] **Step 4: Run the full init suite**

Run:

```bash
deno test -A cli/commands/init/init.integration.test.ts cli/commands/init/interactive-wizard.test.ts
```

- [ ] **Step 5: Commit**

Commit the ordering fix and tests using the Lore commit protocol.

### Task 3: Verify packaging and create a focused PR

**Files:**
- No additional production files expected.

- [ ] **Step 1: Run static checks**

Run:

```bash
deno fmt --check cli/commands/init
deno lint cli/commands/init
deno task typecheck
deno task build:npm
```

- [ ] **Step 2: Install the built package into a temporary directory**

Run the local `create-veryfront` wrapper against the built npm artifact with a fake registry/package override as supported by the repository smoke-test utilities.

- [ ] **Step 3: Verify Git state**

Require a tracked lockfile and empty `git status --porcelain`.

- [ ] **Step 4: Push and open the PR**

Use a narrow title about clean generated repositories and the Lore protocol in commits.
