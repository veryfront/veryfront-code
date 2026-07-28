# Quickstart to Deploy Experience Design

## Purpose

Make the first Veryfront project feel immediate and dependable:

```text
npm create veryfront@latest my-agent
cd my-agent
npm run dev
npx veryfront push
npx veryfront deploy
```

Each command must leave the project in a predictable state, print only information needed for the next action, and preserve exact source provenance without requiring developers to repair CLI-generated Git changes.

## Product Contract

### Create

`npm create veryfront@latest my-agent` creates a runnable project, installs dependencies, and then creates the initial Git commit when Git initialization is enabled.

The initial commit includes the package-manager lockfile. A successful scaffold finishes with a clean working tree. Installation failures leave the project usable and print the exact install command, but Git initialization still runs after the failed install attempt so any package-manager output is represented honestly in the initial commit.

The normal completion output contains:

- the project-ready result;
- the commands needed to enter and run the project;
- the deploy command.

Project trees and diagnostic details remain available under `--verbose`.

### Local project identity

Automatically generated cloud identity is local CLI state, not application source.

Veryfront stores it in:

```text
.veryfront/project.json
```

The file uses a versioned schema:

```json
{
  "version": 1,
  "controlPlane": "https://api.veryfront.com",
  "projectId": "1592a177-39b1-422e-846f-1499417e1a4a",
  "projectSlug": "my-agent"
}
```

`projectId` is the canonical remote identity. `projectSlug` is the current human-readable name used for URLs and output. `controlPlane` prevents a local link created against one API from silently selecting a project on another API.

The file is written atomically. Existing symlink protections for `.veryfront` local state apply to project links as well as push receipts.

`.veryfront/` is already:

- generated in `.gitignore`;
- excluded from source scanning;
- excluded from Git provenance;
- local to the current checkout.

The CLI must never write an inferred or collision-adjusted slug into `veryfront.json`.

### Explicit configuration

`veryfront.config.ts`, `veryfront.config.js`, and `veryfront.json` remain user-authored, shareable configuration. Existing `veryfront.json` files continue to work without migration.

Project reference precedence is:

1. command argument;
2. explicit environment configuration;
3. `veryfront.config.ts` or `veryfront.config.js`;
4. `veryfront.json`;
5. tenant environment variables;
6. `.veryfront/project.json`;
7. package name or directory inference.

An explicit source configuration overrides local link state. An inferred name never authorizes access to an existing project.

When no explicit reference or local link exists, `push` or `deploy` atomically reserves a new project. A claimed slug receives the control plane's collision-safe alternative. The returned project ID and canonical slug are persisted before source upload so a retry targets the same project.

When a local link exists, API operations resolve the project by `projectId`, then refresh the stored slug if the project was renamed.

If the active control plane differs from the stored control plane, the command stops with an actionable error instead of ignoring or reusing the link.

### Push and preview

`veryfront push` uploads the current source to the selected branch and returns:

```text
Studio:  <studio URL>
Preview: <preview URL>
```

The command accepts committed or uncommitted local source. It records:

- control plane;
- project ID and canonical slug;
- branch;
- Git commit when available;
- Git cleanliness as metadata;
- exact source digest;
- push timestamp.

The source digest, not Git cleanliness, identifies the bytes available for release.

### Deploy and production

`veryfront deploy` creates a release from the last verified Push receipt and deploys it to `production` by default. If no Push receipt exists yet, it first runs a quiet Push so first deploy still works as one command.

`--env` and `--environment` select another environment.

Before changing an environment, deploy verifies:

- the push targeted the same control plane, project, and branch;
- the release source digest equals the pushed source digest;
- the deployment references the verified release and project.

Git commit and cleanliness remain visible provenance metadata. They do not reject a byte-exact local deployment. This supports:

- a new scaffold with no manual repair;
- uncommitted local preview or production deployments;
- non-Git projects;
- CI deployments with commit metadata.

Uncommitted source mutations after Push remain local and do not change the production candidate. Deploy promotes the exact remote digest recorded by the last verified Push; users run Push again when they want new local bytes to replace that candidate. A different checked-out Git commit still invalidates the receipt.

### Default log policy

Normal `veryfront dev` output is an operator view, not an internal trace.

Default-visible output:

- local and MCP readiness URLs;
- rebuild start, success, and failure;
- actionable configuration or security warnings;
- user-code errors;
- failed requests;
- slow-request warnings;
- shutdown.

Debug-only output:

- extension discovery, capabilities, registration, and load details;
- tool schema conversion details;
- module, transform, and distributed cache initialization;
- HMR subscriptions;
- successful request lines and request context;
- primitive discovery success details;
- API import-map and handler-build internals;
- runtime model remapping;
- retry and cache diagnostics.

Warnings must represent a condition the developer can act on. The security loader emits at most one warning for an insecure or contradictory configuration. It does not emit both an informational and warning form of the same condition.

`veryfront dev --debug`, `LOG_LEVEL=DEBUG`, and `VERYFRONT_DEBUG` retain the full diagnostic stream.

## Architecture

### Project-link module

A focused CLI module owns the local link schema and filesystem lifecycle:

```ts
interface ProjectLink {
  version: 1;
  controlPlane: string;
  projectId: string;
  projectSlug: string;
}

readProjectLink(projectDir: string): Promise<ProjectLink | null>
writeProjectLink(projectDir: string, link: ProjectLink): Promise<void>
clearProjectLink(projectDir: string): Promise<void>
```

Configuration resolution consumes this module but does not own its storage. Push and deploy persist links only after the control plane returns a canonical project target.

Push receipts remain separate because they describe one source upload. Project links describe durable local-to-remote identity.

### Source provenance

`PushReceipt` continues to store Git metadata and the source digest. Receipt validation stops treating `clean` as a production admission rule. Release and deployment verification continue to compare exact source digests.

No CLI-generated file is added to the source digest after the push snapshot starts.

### Logging

The logger stays at `INFO` by default. Internal lifecycle call sites move from `info` to `debug`; the global threshold is not raised to `WARN`, because user-facing lifecycle messages and actionable information still use `INFO`.

Request completion selects level by outcome:

- successful request: `debug`;
- client/server failure: visible at `warn` or `error`;
- slow request: existing warning path.

This keeps production observability available while removing routine local request noise.

## Error Handling

Errors state the failed contract and the next action:

- invalid project link: remove or recreate the local link through the CLI;
- control-plane mismatch: use the linked API or explicitly relink;
- missing linked project: stop rather than create an unrelated replacement;
- project-name collision during first link: reserve and persist the returned alternative;
- changed source during push: rerun `veryfront push`;
- mismatched receipt or digest during deploy: rerun `veryfront push` for the target branch, then deploy again;
- dependency installation failure: run the printed package-manager command.

Normal errors omit stack traces. `--verbose` includes diagnostic context.

## Compatibility and Rollout

- Existing `veryfront.json` project references remain valid and keep their current precedence.
- Existing checkouts without `.veryfront/project.json` link on their next successful inferred push or deploy.
- Existing `.veryfront/push-receipt.json` files remain valid.
- The `create-veryfront` wrapper needs no release because it delegates to `veryfront@latest`.
- The changes require a new `veryfront` npm release. They do not require a control-plane or runtime deployment unless API tests show project lookup by ID is unsupported.
- Runtime log-level changes ship in the same npm/runtime artifact as the CLI.

## Test Strategy

### Project linking

- local links round-trip with project ID, slug, control plane, and version;
- symlinked local-state paths are rejected;
- explicit config overrides local state;
- local state overrides inference;
- a control-plane mismatch fails clearly;
- inferred first push creates one project, persists its ID, and reuses it after an upload failure;
- a renamed linked project refreshes the local slug;
- legacy `veryfront.json` remains supported.

### Scaffold

- a fake package manager creates a lockfile during install;
- Git initialization runs after install;
- the initial commit tracks the lockfile;
- the successful generated repository is clean;
- `--skip-install` remains clean and does not create a lockfile;
- install failure still produces a usable repository and exact recovery command.

### Provenance

- dirty and non-Git source can produce a valid release when the source digest matches;
- uncommitted source changes after Push remain local and do not block promotion of the verified digest;
- a different checked-out commit, wrong project, wrong branch, wrong control plane, and wrong digest still fail;
- release and deployment verification require the pushed source digest.

### Logging

- default startup excludes each internal diagnostic category;
- `--debug` includes representative extension, request, cache, and build diagnostics;
- successful requests are debug-only;
- failed and slow requests remain visible;
- default security configuration emits no duplicate warning.

### End to end

Build the npm package, install it into an isolated project, then verify:

1. scaffold;
2. clean Git status;
3. local dev page and agent API;
4. default log output;
5. push preview URL;
6. browser rendering and console errors;
7. production deploy;
8. production rendering and console errors;
9. exact project ID reuse on a second push.

## Non-goals

- changing the template's product UI;
- changing branch naming or preview URL structure;
- adding a new control-plane API;
- auto-committing user changes during push or deploy;
- weakening release source-digest verification;
- changing the generic `create-veryfront` wrapper.
