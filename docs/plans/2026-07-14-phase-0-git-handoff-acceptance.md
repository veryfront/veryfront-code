# Phase 0 Git handoff acceptance

_Created: 2026-07-14_

_Status: acceptance evidence pending_

## Purpose

Qualify the supported Phase 0 bridge between Git, Veryfront Studio, and
Veryfront deployments before a project uses it in production.

Phase 0 uses the professional developer and serialized CI as the bridge. It
does not connect Veryfront to a canonical repository, verify an exact Git SHA
on the server, create pull requests automatically, or prevent direct Studio
main edits. This checklist verifies the implemented safety controls and records
the operating controls that remain manual.

Do not mark this plan complete from unit-test counts alone. Run the manual
scenarios against an installed release and retain the evidence named below.

## Release under test

| Field                  | Evidence                   |
| ---------------------- | -------------------------- |
| Compatibility baseline | `v0.1.1063`                |
| Candidate version      | `<VERSION>`                |
| Candidate commit       | `<GIT_SHA>`                |
| npm artifact           | `<NPM_ARTIFACT_URL>`       |
| Binary artifact        | `<BINARY_ARTIFACT_URL>`    |
| Veryfront project      | `<PROJECT_SLUG>`           |
| Staging environment    | `<STAGING_ENVIRONMENT>`    |
| Production environment | `<PRODUCTION_ENVIRONMENT>` |
| Git repository         | `<REPOSITORY>`             |
| Test start             | `<TIMESTAMP>`              |
| Test owner             | `<OWNER>`                  |

Use a dedicated pilot project and non-production data. Store API credentials in
the CI secret manager and never paste them into this record.

## Evidence requirements

For each manual scenario, retain:

- the command or workflow revision used
- the CI run URL and Git SHA
- sanitized human output or NDJSON artifact
- the Veryfront project, branch, release, deployment, and environment IDs that
  apply
- the expected and actual result
- the tester and timestamp
- a linked defect or explicit pass result

## Automated qualification

- [ ] Install the candidate npm artifact in a clean fixture and verify
      `veryfront --version` reports `<VERSION>`.
      Evidence: `<NPM_SMOKE_RUN>`
- [ ] Run the binary artifact in a clean fixture and verify the same version.
      Evidence: `<BINARY_SMOKE_RUN>`
- [ ] Verify `veryfront pull --help` describes `--prune`, clean-worktree
      requirements, exact-byte behavior, and dry-run safety.
      Evidence: `<PULL_HELP_OUTPUT>`
- [ ] Verify `veryfront push --help` describes text-only source management and
      a non-mutating dry-run.
      Evidence: `<PUSH_HELP_OUTPUT>`
- [ ] Record the focused Pull, Push, Deploy, ignore-policy, docs-contract, and
      docs-example test results for the candidate commit.
      Evidence: `<TEST_RUN_URL>`
- [ ] Verify the published Deploy from CI and Move Studio changes into Git
      guides match the candidate commands.
      Evidence: `<DOCS_URLS>`

## A. Staging-first CI pilot

### A1. Establish one writer

- [ ] Configure one serialized workflow for the pilot project with
      `cancel-in-progress: false`.
- [ ] Scope its API key to the project and store the project slug as a CI
      variable.
- [ ] Protect the staging environment.
- [ ] Add `.veryfront/` to `.gitignore` and confirm Git does not track a Push
      receipt.
- [ ] Confirm no other scheduled job or developer process pushes to Veryfront
      main for this project.

Evidence: `<SERIALIZED_WORKFLOW_URL>`

### A2. Preview without mutation

From a clean checkout of reviewed Git main, run:

```bash
veryfront push --branch main --dry-run
```

- [ ] Confirm the command reports the planned source changes.
- [ ] Confirm it creates no missing Veryfront project or branch.
- [ ] Confirm it uploads and deletes no remote files.
- [ ] Confirm it writes no `.veryfront/push-receipt.json`.
- [ ] Repeat against an existing project and confirm its source is unchanged.

Evidence: `<PUSH_DRY_RUN_EVIDENCE>`

### A3. Push and deploy staging

From one clean checkout and CI job, run:

```bash
veryfront push --branch main --yes
veryfront deploy --branch main --env staging --yes --json
```

- [ ] Confirm Push uploads the expected supported text files and applies the
      committed `.vfignore` rules.
- [ ] Confirm `.veryfront/push-receipt.json` names the expected project,
      branch, Git SHA, source digest, and checkout.
- [ ] Confirm Deploy accepts that receipt from the same checkout.
- [ ] Confirm Deploy creates an immutable release and assigns it to staging.
- [ ] Confirm the final NDJSON result names the project, Git SHA, source digest,
      release, environment, and deployment.
- [ ] Confirm the staging behavior matches the reviewed Git commit.

Evidence: `<STAGING_CI_RUN_URL>`, `<STAGING_NDJSON_ARTIFACT>`,
`<STAGING_RELEASE_ID>`, `<STAGING_DEPLOYMENT_ID>`

### A4. Serialize competing commits

- [ ] Queue two main-branch workflow runs for different SHAs.
- [ ] Confirm only one Push and Deploy sequence runs at a time.
- [ ] Confirm the superseded-head check skips the older queued SHA when a newer
      Git main already exists.
- [ ] Confirm Veryfront main and staging end on the newest accepted Git SHA.

Evidence: `<CONCURRENCY_RUN_URLS>`

### A5. Gate new Studio work

- [ ] Confirm the team does not begin a new Studio change until A3 or A4 has
      pushed the latest reviewed Git main successfully.
- [ ] Record the successful Git SHA as the base of the next Studio change.
- [ ] Confirm citizen-developer work uses a non-main Studio branch.
- [ ] Confirm nobody edits or publishes directly from Studio main during the
      pilot.

Evidence: `<STUDIO_BASE_SHA>`, `<OPERATING_SIGN_OFF>`

## B. Studio release to Git pull request

### B1. Create the immutable handoff

- [ ] Make a citizen-developer change on a non-main Studio branch based on the
      Git SHA accepted in A5.
- [ ] Publish only to staging and confirm production remains unchanged.
- [ ] Record the immutable release version and the base Git SHA.
- [ ] Confirm repeating release reads returns the same source snapshot.

Evidence: `<STUDIO_RELEASE_VERSION>`, `<STUDIO_BASE_SHA>`,
`<STUDIO_STAGING_DEPLOYMENT_ID>`

### B2. Detect a stale snapshot

- [ ] Create a clean Git feature branch from current `origin/main`.
- [ ] Compare `origin/main` with the recorded Studio base SHA.
- [ ] When they match, continue to B3.
- [ ] When they differ, confirm the workflow warns that the release is a full
      snapshot and Pull will not auto-merge it.
- [ ] Exercise the safest recovery: push current Git main to Veryfront, recreate
      the Studio change, and publish a new release.
- [ ] If testing deliberate stale-snapshot reconciliation, assign a professional
      developer to review every resulting Git change.

Evidence: `<STALE_SNAPSHOT_EVIDENCE>`

### B3. Preview the full snapshot

Run:

```bash
veryfront pull --release "<VERSION>" --prune --dry-run
```

- [ ] Confirm dry-run writes and deletes no local files.
- [ ] Confirm dry-run may run outside a Git worktree because it cannot mutate
      the checkout.
- [ ] Confirm it reports every managed supported text file it would write or
      delete.
- [ ] Confirm ignored, unsupported, binary, `.git`, and `.veryfront` content is
      excluded.
- [ ] Confirm it validates invalid, duplicate, reserved, and symlink-traversing
      remote paths.

Evidence: `<PULL_DRY_RUN_EVIDENCE>`

### B4. Apply to a clean feature branch

Run:

```bash
veryfront pull --release "<VERSION>" --prune --yes
```

- [ ] Confirm a clean Git worktree is required.
- [ ] Confirm additions, updates, and managed deletions match the immutable
      release.
- [ ] Confirm ignored, unsupported, binary, `.git`, and `.veryfront` content is
      unchanged.
- [ ] Confirm file bytes are exact, including CRLF, multiple trailing newlines,
      and a missing final newline.
- [ ] Confirm `--yes` and `--force` bypass confirmation only and cannot bypass
      path, symlink, or clean-worktree checks.
- [ ] Confirm the resulting Git diff is treated as a full snapshot, not an
      automatic three-way merge.

Evidence: `<PULL_APPLY_EVIDENCE>`, `<FEATURE_BRANCH_SHA>`

### B5. Open and review the pull request

- [ ] Commit the reviewed full snapshot to the feature branch.
- [ ] Push the branch and run `gh pr create` with base `main`.
- [ ] Confirm the PR description records the immutable release version and base
      Git SHA.
- [ ] Run the project's format, lint, test, and build gates.
- [ ] Confirm required reviews and checks pass.

Evidence: `<PULL_REQUEST_URL>`, `<PR_CHECKS_URL>`

### B6. Resolve conflicts in Git

- [ ] Advance Git main while the PR is open.
- [ ] Merge current `origin/main` into the feature branch.
- [ ] Confirm professional developers resolve every conflict in Git.
- [ ] Confirm Studio does not overwrite Git main to resolve the conflict.
- [ ] Merge the reviewed PR.
- [ ] Confirm the serialized CI workflow pushes merged main and deploys staging.
- [ ] Confirm no new Studio work begins before that Push succeeds.

Evidence: `<CONFLICT_PR_URL>`, `<POST_MERGE_CI_RUN_URL>`

## C. Failure and recovery safety

### C1. Pull path safety

- [ ] Return an absolute, non-canonical, duplicate, reserved, or
      symlink-traversing remote path and confirm Pull fails before local writes.
- [ ] Place a supported local symlink in a prune candidate and confirm Pull
      refuses to mutate it.
- [ ] Confirm a content-fetch failure causes no local writes and no pruning.
- [ ] Confirm a local write failure exits nonzero, performs no pruning, and
      reports that Git recovery may be required.
- [ ] Confirm a local delete failure exits nonzero and reports the partial Git
      diff.

Evidence: `<PULL_FAILURE_RUNS>`

### C2. Git worktree safety

- [ ] Run mutating prune outside Git and confirm it fails with recovery
      guidance.
- [ ] Run mutating prune in a dirty worktree and confirm it fails.
- [ ] Repeat with `--yes` and `--force` and confirm neither bypasses the checks.
- [ ] Run prune dry-run in both locations and confirm no mutation occurs.
- [ ] Run a multi-project prune and confirm every distinct Git worktree is
      checked before mutation.

Evidence: `<WORKTREE_FAILURE_RUNS>`

### C3. Ignore and upload safety

- [ ] Confirm a missing `.vfignore` uses default rules.
- [ ] Confirm a regular tracked `.vfignore` applies its rules.
- [ ] Confirm a directory or symlink at `.vfignore` fails safely.
- [ ] Confirm an ignored or untracked `.vfignore` prevents clean deployment
      provenance.
- [ ] Make one Push upload fail and confirm no remote deletions occur.

Evidence: `<IGNORE_UPLOAD_FAILURE_RUNS>`

### C4. Receipt and rollback safety

- [ ] Attempt Deploy from another checkout or job and confirm receipt validation
      rejects it.
- [ ] Change source bytes after Push and confirm Deploy rejects the stale
      receipt.
- [ ] Change the Git commit without changing source bytes and confirm Deploy
      rejects the stale receipt.
- [ ] Use the wrong project or branch and confirm Deploy rejects the receipt.
- [ ] Revert a faulty Git commit and confirm the normal serialized workflow
      creates a new immutable release and staging deployment.

Evidence: `<RECEIPT_FAILURE_RUNS>`, `<ROLLBACK_RUN_URL>`

## D. Compatibility checks

- [ ] Confirm Pull source precedence remains environment, release, branch, then
      main.
- [ ] Confirm Pull without `--prune` does not delete extra local files.
- [ ] Confirm `--force`, global `--yes`, `--quiet`, and existing noninteractive
      CI behavior remain supported.
- [ ] Confirm Deploy NDJSON remains parseable and contains no secret values.
- [ ] Confirm multi-project Pull writes each project to its configured target
      and reports aggregate failures.
- [ ] Confirm project initialization preserves an existing `.gitignore` and
      adds `.veryfront/` when missing.
- [ ] Confirm unsupported and binary files are neither uploaded nor pruned.

Evidence: `<COMPATIBILITY_RUNS>`

## E. Production promotion

Do not run this section until A through D pass and the product owner accepts the
Phase 0 limitations.

- [ ] Protect the production environment and require the approved CI identity.
- [ ] Change the serialized workflow target from staging to production without
      adding another writer.
- [ ] Push and Deploy one reviewed Git main commit from the same checkout and
      job.
- [ ] Confirm production evidence names the expected Git SHA, source digest,
      release, environment, and deployment.
- [ ] Exercise a Git-revert rollback and confirm production receives a new
      immutable release.
- [ ] Restore staging-first validation for subsequent workflow changes.

Evidence: `<PRODUCTION_RUN_URL>`, `<PRODUCTION_NDJSON_ARTIFACT>`,
`<PRODUCTION_ROLLBACK_RUN_URL>`

## Accepted Phase 0 limitations

Each owner must explicitly accept these limitations before production use:

- [ ] Veryfront does not know or enforce which repository is canonical.
- [ ] The API key can upload the supported source present in its checkout.
- [ ] The server does not fetch or verify an exact Git SHA.
- [ ] Studio permissions can still permit direct main edits.
- [ ] Pull applies a full snapshot and does not auto-merge stale Studio work.
- [ ] Pull request creation and conflict resolution remain manual Git work.
- [ ] Binary and unsupported files remain outside the managed-source handoff.
- [ ] Process controls require one serialized writer and a successful main Push
      before new Studio work.

## Sign-off

| Role                | Name     | Decision              | Date     | Evidence or notes |
| ------------------- | -------- | --------------------- | -------- | ----------------- |
| Engineering owner   | `<NAME>` | `<APPROVE_OR_REJECT>` | `<DATE>` | `<LINK>`          |
| Product owner       | `<NAME>` | `<APPROVE_OR_REJECT>` | `<DATE>` | `<LINK>`          |
| Security reviewer   | `<NAME>` | `<APPROVE_OR_REJECT>` | `<DATE>` | `<LINK>`          |
| Pilot project owner | `<NAME>` | `<APPROVE_OR_REJECT>` | `<DATE>` | `<LINK>`          |

Set the status to `complete` only after every required check passes and every
sign-off row contains evidence. Keep unresolved defects linked from the failed
check rather than describing the release as accepted with exceptions.
