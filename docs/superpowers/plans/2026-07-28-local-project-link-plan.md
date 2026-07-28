# Local Project Link and Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep generated cloud identity in ignored local state and allow byte-exact deployments regardless of Git cleanliness.

**Architecture:** A dedicated project-link module owns the versioned `.veryfront/project.json` schema and secure atomic filesystem operations. Configuration resolution consumes explicit source configuration first, then the local link, while push/deploy use the stored project ID as the canonical API reference and source digests as the deployment admission rule.

**Tech Stack:** TypeScript, Deno/Node compatibility APIs, Veryfront schema contracts, Deno BDD tests.

## Global Constraints

- Existing `veryfront.config.ts`, `veryfront.config.js`, and `veryfront.json` behavior remains compatible.
- Automatically generated links never mutate application source.
- No new dependencies.
- Project IDs are canonical; slugs are display and URL metadata.
- Source digest verification remains mandatory.
- Tests must fail before production changes are written.

---

### Task 1: Secure versioned project-link storage

**Files:**
- Create: `cli/shared/project-link.ts`
- Create: `cli/shared/project-link.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ProjectLink {
  version: 1;
  controlPlane: string;
  projectId: string;
  projectSlug: string;
}

export function readProjectLink(projectDir: string): Promise<ProjectLink | null>;
export function writeProjectLink(projectDir: string, link: Omit<ProjectLink, "version">): Promise<ProjectLink>;
export function clearProjectLink(projectDir: string): Promise<void>;
```

- [ ] **Step 1: Write failing storage tests**

Cover valid round-trip, malformed JSON, unsupported version, missing file, symlinked `.veryfront`, symlinked `project.json`, atomic replacement, and clear.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
deno test -A cli/shared/project-link.test.ts
```

Expected: module-not-found failure for `project-link.ts`.

- [ ] **Step 3: Implement the minimal secure store**

Use `.veryfront/project.json`, normalize `controlPlane`, reject symlink traversal, write a sibling temporary file, rename it over the destination, and remove the temporary file on failure.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run:

```bash
deno test -A cli/shared/project-link.test.ts
```

Expected: all project-link tests pass.

- [ ] **Step 5: Commit**

Commit the module and focused tests using the Lore commit protocol.

### Task 2: Resolve explicit configuration before local links

**Files:**
- Modify: `cli/shared/config.ts`
- Modify: `cli/shared/config.test.ts`
- Modify: `cli/shared/runtime-auth.ts`
- Modify: `cli/shared/runtime-auth.test.ts`
- Modify: `cli/commands/config/handler.ts`
- Modify: `cli/commands/config/handler.test.ts`

**Interfaces:**
- Consumes: `readProjectLink(projectDir)`.
- Produces:

```ts
export type ProjectReferenceSource =
  | { kind: "argument"; name: "--project-slug" }
  | { kind: "environment"; name: "environment configuration" }
  | { kind: "module-config"; name: string }
  | { kind: "json-config"; name: "veryfront.json" }
  | { kind: "tenant-environment"; name: string }
  | { kind: "local-link"; name: ".veryfront/project.json" }
  | { kind: "inferred"; name: "project files" };

export interface ResolvedConfig {
  apiUrl: string;
  apiToken: string;
  apiTokenSource?: "env" | "env-file" | "config-file" | "token-store";
  projectSlug: string;
  projectId?: string;
}
```

- [ ] **Step 1: Write failing precedence and runtime-auth tests**

Assert explicit module/JSON config overrides a local link, tenant variables override a local link, a local link overrides inferred names, a mismatched control plane rejects the link, and runtime auth uses the linked slug without inferring directory identity.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
deno test -A cli/shared/config.test.ts cli/shared/runtime-auth.test.ts cli/commands/config/handler.test.ts
```

Expected: local-link assertions fail because only source config and inference exist.

- [ ] **Step 3: Implement resolution and config display**

Read local state after explicit and tenant sources, validate its control plane against the resolved API URL, include `projectId` in internal resolved configuration, and show the local link source in `veryfront config`.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same command and require all tests to pass.

- [ ] **Step 5: Commit**

Commit the resolver and runtime-auth changes using the Lore commit protocol.

### Task 3: Persist and reuse canonical project IDs

**Files:**
- Modify: `cli/commands/push/command.ts`
- Modify: `cli/commands/push/command.test.ts`
- Modify: `cli/commands/deploy/command.ts`
- Modify: `cli/commands/deploy/command.test.ts`
- Modify: `cli/commands/deploy/command.integration.test.ts`
- Modify: `cli/commands/demo/demo.ts`

**Interfaces:**
- Consumes: `writeProjectLink`, `ResolvedConfig.projectId`, and `ProjectReferenceSource`.
- Produces: first push/deploy creates one project, persists its target, and retries by ID.

- [ ] **Step 1: Write failing first-link and retry tests**

Assert:

- inferred creation writes `.veryfront/project.json`, never `veryfront.json`;
- the link is written before upload so an upload failure can retry safely;
- a second command resolves the same project by ID;
- a server-side rename refreshes the stored slug;
- explicit source configuration is not rewritten;
- a collision-adjusted slug is stored with the returned ID.

- [ ] **Step 2: Run the focused command tests and confirm RED**

Run:

```bash
deno test -A cli/commands/push/command.test.ts cli/commands/deploy/command.test.ts cli/commands/deploy/command.integration.test.ts
```

Expected: assertions fail because inferred linking writes `veryfront.json` and does not carry the local project ID.

- [ ] **Step 3: Implement canonical target resolution**

Use `projectId ?? projectSlug` for API lookup, preserve canonical `projectSlug` for URLs/output, persist the returned target after creation or lookup, and remove inferred calls to `writeProjectSlug`.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same command and require all tests to pass.

- [ ] **Step 5: Commit**

Commit canonical target persistence using the Lore commit protocol.

### Task 4: Make source digest the production gate

**Files:**
- Modify: `cli/shared/deployment-provenance.ts`
- Modify: `cli/shared/deployment-provenance.test.ts`
- Modify: `cli/commands/deploy/command.ts`
- Modify: `cli/commands/deploy/command.test.ts`
- Modify: `cli/commands/deploy/command.integration.test.ts`

**Interfaces:**
- Consumes: existing `PushReceipt.sourceDigest`.
- Produces: `validatePushReceipt` verifies target metadata but does not reject dirty Git state; deploy still verifies the release and deployment source digest.

- [ ] **Step 1: Replace the clean-tree expectation with failing digest-provenance tests**

Assert dirty Git metadata is accepted when the pushed/release digest matches, while wrong control plane, project, branch, commit when explicitly required, and release digest still fail.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
deno test -A cli/shared/deployment-provenance.test.ts cli/commands/deploy/command.test.ts cli/commands/deploy/command.integration.test.ts
```

Expected: dirty production source fails with the current clean-tree error.

- [ ] **Step 3: Remove the redundant clean admission flag**

Keep `clean` in receipts and output as metadata. Remove `requireClean` from the validation expectation and deploy call sites. Do not change release/deployment digest verification.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run the same command and require all tests to pass.

- [ ] **Step 5: Commit**

Commit the provenance change using the Lore commit protocol.

### Task 5: Update docs and verify the PR

**Files:**
- Modify: `docs/getting-started/quickstart.md`
- Modify: `docs/getting-started/deploy-project.md`
- Modify: `docs/guides/deploying.md`
- Modify: `docs/guides/deploy-from-ci.md`

**Interfaces:**
- Documents `.veryfront/project.json`, source-digest provenance, and legacy explicit configuration.

- [ ] **Step 1: Update documentation**

Remove claims that inferred deploy writes `veryfront.json`. Explain local link state, explicit config precedence, preview-first push, and digest verification.

- [ ] **Step 2: Run repository checks**

Run:

```bash
deno fmt --check cli/shared cli/commands/push cli/commands/deploy cli/commands/config
deno lint cli/shared cli/commands/push cli/commands/deploy cli/commands/config
deno task typecheck
deno task build:npm
```

- [ ] **Step 3: Run all affected tests**

Run:

```bash
deno test -A \
  cli/shared/project-link.test.ts \
  cli/shared/config.test.ts \
  cli/shared/runtime-auth.test.ts \
  cli/shared/deployment-provenance.test.ts \
  cli/commands/config/handler.test.ts \
  cli/commands/push/command.test.ts \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts
```

- [ ] **Step 4: Commit and push**

Commit documentation/verification metadata with the Lore protocol and push the updated PR branch.
