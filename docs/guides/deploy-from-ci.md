---
title: "Deploy from CI"
description: "Push a reviewed Git commit to Veryfront and deploy it from a serialized CI job."
order: 46
---

Use this guide to make a reviewed Git commit the source of a Veryfront
deployment. The CI job pushes the checked-out source, creates an immutable
release, and deploys that release to an environment.

## How the CI workflow works

This workflow keeps repository access and deployment credentials inside
repository-owned CI/CD. The trusted runner checks out the reviewed Git commit,
tests it, pushes the source to Veryfront, and deploys an immutable release.
Repository and protected-environment access remain with the trusted runner.

Git `main` acts as the desired source state, similar to a GitOps workflow. Use
one serialized CI writer for each Veryfront project, protect its API key, and
use immutable releases for Studio-to-Git handoffs.

Use these operating controls:

- Treat Git `main` as the canonical source.
- Do not edit or publish directly from Studio `main`. Make citizen-developer
  changes on a non-main Studio branch and hand them to Git through an immutable
  release.
- After every Git merge, wait for CI to push the new `main` source into
  Veryfront before anyone starts new Studio work.
- Start with staging. Enable production only after an Admin or Owner
  approves the staging evidence described below.

## Prerequisites

- A Veryfront project with the `veryfront` package pinned in its lockfile.
- A dedicated project API key stored in the CI secret manager.
- The project slug stored as a CI variable.
- A protected `staging` environment in Veryfront.
- A protected `production` environment in Veryfront before promotion.
- A CI job that runs after changes merge to `main`.
- `.veryfront/` in `.gitignore` so local project links, Push receipts, and sync
  baselines are never committed.

See [Configuration](./configuration.md) for the Cloud bootstrap environment
variables.

CI should use explicit project configuration, such as `VERYFRONT_PROJECT_SLUG`
or committed config. Project reference precedence is
`VERYFRONT_PROJECT_SLUG` or environment configuration, then
`veryfront.config.ts`, then legacy `veryfront.json`, then lower-level tenant or
project-ID environment references such as `VERYFRONT_PROJECT_ID`, then the
ignored local link in `.veryfront/project.json`.

## Define the managed source set

Push uploads supported text files only and preserves remote-only files by
default. In Git-authoritative CI, use `push --prune` to reconcile remote
deletions. `pull --prune` performs the corresponding destructive local
reconciliation. The managed set includes TypeScript, JavaScript, JSON,
stylesheets, HTML, Markdown, MDX, text, SVG, YAML, and TOML.
Binary images, fonts, archives, and other unsupported files remain outside
this handoff. Manage those files through another reviewed delivery path.

Both commands use the same `.vfignore` rules. Ignored files and unsupported
extensions are not reconciled with Veryfront.

If the project has a `.vfignore`, keep it as a regular file inside the project
and commit it to Git so the managed source set is reproducible. Symlinked
`.vfignore` files are rejected. Push records a digest of the managed source set
it uploaded, and Git cleanliness alongside it as provenance metadata, measured
over the project directory only. Deploy promotes the source digest recorded by
Push rather than recomputing production bytes from the working tree, and refuses
a receipt this directory no longer matches.

## Preview the Push

Preview the source reconciliation before it changes Veryfront:

```bash title="Terminal"
veryfront push --branch main --prune --force --dry-run
```

Push dry-run reads the local and remote source needed for the comparison but
makes no mutation. It does not create a missing project or branch, upload or
delete files, or write `.veryfront/push-receipt.json`. `--prune` includes
remote-only managed files in the preview so CI can verify the exact mirror
before applying it.

This serialized job gives Git `main` intentional overwrite authority. It uses
`--force` because an ephemeral runner has no persisted pull or push baseline
for comparison. Do not copy `--force` into interactive developer pushes. A
normal push rejects remote changes made since the last pull or push and tells
you to reconcile them with Git.

## Start with staging

Run Push and Deploy from the same Git checkout and CI job:

```bash title="Terminal"
veryfront push --branch main --prune --force --yes
veryfront deploy --branch main --env staging --yes
```

Push records the checked-out commit, the digest of the source it uploaded, and
whether the checkout was clean in `.veryfront/push-receipt.json`. Deploy uses
that last verified Push receipt and requires it to match the same control plane,
project, branch, and Git commit, then verifies the release source digest before
assigning it to the environment. A receipt from a different commit is refused
rather than replaced, so committed work is never uploaded behind the operator's
back: check out the pushed commit, or run Push again from the commit you want
deployed.

Uncommitted edits are the one change no commit check can see, because they leave
`HEAD` where the receipt left it. Deploy recomputes the source digest from the
directory and refuses the promotion when it no longer matches the receipt, so an
accidentally dirty checkout fails instead of promoting bytes no Push reviewed.
The digest covers exactly the files Push uploads, so an edit `.gitignore` hides
is still caught and an edit to a file Push never sends is not a mismatch. Run
Push again to deploy the current source. Deploying a project named with
`--project` promotes what that project already has and never uploads the working
directory, so local edits are neither pushed nor treated as a mismatch on that
path.

`veryfront up` makes the current directory live rather than promoting a reviewed
Push, so it refreshes a stale receipt with a quiet Push instead of refusing. That
refresh is an ordinary push: it keeps the remote-conflict checks that `--force`
would waive. In a Git checkout, it prunes only files the checkout deleted from
Git, so remote-only files stay in place. In a non-Git directory whose source
digest changed, the refresh performs a full prune and removes remote-only files
because the local directory is authoritative. The first refresh of a legacy
receipt without a local source digest preserves remote-only files because the
CLI cannot prove that the directory changed. Do not use `veryfront up` as a CI
promotion step.

If no receipt exists, Deploy bootstraps one with a quiet Push. That first Push
has no receipt to check the checkout against, so it uploads the working tree as
it stands, including uncommitted edits. CI must keep the explicit Push step so
review and production promotion remain separate, and so the first deploy of a
project is not the one that decides what its source is. Do not split the two
commands across CI jobs or clean the checkout between them.

A receipt written by a CLI older than the source digest carries no digest to
recompute, so Deploy falls back to the recorded Git cleanliness for it. That
fallback cannot see an edit `.gitignore` hides while `.vfignore` does not. Run
Push once after upgrading: the receipt it writes carries the digest, and the
full check applies from then on.

Deploy creates an immutable release from the pushed source, then assigns that
release to `staging`.

This workflow uses `--prune` and `--force` because Git `main` is the canonical
managed source and the serialized CI job is its only writer. Interactive
pushes must omit `--force`. They should also omit `--prune` when Studio-only
files must remain available.

The current directory is the Veryfront project directory. It maps to the Git
repository root by default. For a monorepo, run both commands from the same
project subdirectory so Deploy finds the config and Push receipt created there.
For example, set the GitHub Actions job default:

```yaml title="Monorepo job excerpt"
defaults:
  run:
    working-directory: apps/storefront
```

## Add a GitHub Actions workflow

Add a workflow that serializes main updates and keeps the API key scoped to the
deployment step. Keep this staging target until production delivery is
approved:

```yaml title=".github/workflows/deploy-veryfront.yml"
name: Deploy Veryfront

on:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: veryfront-main-${{ github.repository }}
  cancel-in-progress: false

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Check out the merged commit
        uses: actions/checkout@v4
        with:
          ref: ${{ github.sha }}
          persist-credentials: false

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm

      - name: Install the locked dependencies
        run: npm ci

      - name: Test
        run: npm test --if-present

      - name: Push and deploy
        env:
          GH_TOKEN: ${{ github.token }}
          VERYFRONT_API_TOKEN: ${{ secrets.VERYFRONT_API_TOKEN }}
          VERYFRONT_PROJECT_SLUG: ${{ vars.VERYFRONT_PROJECT_SLUG }}
        run: |
          set -euo pipefail
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain=v1 --untracked-files=all)"

          CURRENT_MAIN_SHA="$(gh api "repos/${GITHUB_REPOSITORY}/commits/main" --jq .sha)"
          if [ "$CURRENT_MAIN_SHA" != "$GITHUB_SHA" ]; then
            echo "Skipping superseded main commit $GITHUB_SHA"
            exit 0
          fi

          npx --no-install veryfront push --branch main --prune --force --yes
          npx --no-install veryfront deploy --branch main --env staging --yes
```

`npm ci` and `npx --no-install` use the Veryfront version in the project
lockfile. Replace the install and test steps when the project uses another
package manager, but keep Push and Deploy together.

The concurrency group prevents two jobs from changing Veryfront `main` at the
same time. `cancel-in-progress: false` lets an active Push and Deploy sequence
finish before the next run starts.

The SHA check skips a queued workflow when a newer `main` commit already
exists. This prevents a queued job from reconciling superseded source.

Do not start a new Studio change until this job has pushed the latest Git
`main` source successfully. A Studio release created from an older baseline is
a stale full snapshot that requires a full Git diff and conflict review.

## Promote to production

Before production promotion, require an Admin or Owner to verify and record all
of these staging results in the team's normal change-management system:

- The serialized CI job checked out the reviewed Git `main` SHA and passed the
  repository's required tests.
- Push and Deploy both succeeded from that checkout, and the deployment
  evidence names the same commit SHA, project, release, and staging environment.
- A smoke test passed against the staging deployment.
- The team successfully rehearsed rollback by reverting a Git change and
  allowing the same CI workflow to deploy the resulting commit.
- If Studio-to-Git handoff is in scope, one immutable Studio
  release completed the reviewed pull-request flow in
  [Move Studio changes into Git](./move-studio-changes-to-git.md).

After that approval, use the same serialized job pattern with the production
environment:

```bash title="Terminal"
veryfront push --branch main --prune --force --yes
veryfront deploy --branch main --env production --yes
```

Keep Push and Deploy in the same checkout and job after promotion so production
is deployed from the exact source digest pushed by that job. Do not add a second
unsynchronized writer for production.

## Capture deployment evidence

Deploy prints human-readable output by default. Add `--json` only when the CI
system needs machine-readable audit evidence. JSON mode emits NDJSON records
for each step and a final result.

Write the audit file outside the Git checkout so a later Push cannot include it
in the managed source set:

```bash title="GitHub Actions deployment step"
set -o pipefail
veryfront deploy --branch main --env staging --yes --json \
  | tee "${RUNNER_TEMP}/veryfront-staging-deploy.ndjson"
```

Store `${RUNNER_TEMP}/veryfront-staging-deploy.ndjson` as a CI artifact. The
final result includes the project, commit SHA, source digest, release,
environment, and deployment identifiers. Capture the equivalent production
artifact after promotion.

## Roll back

Revert the faulty Git commit instead of changing Veryfront `main` directly:

```bash title="Terminal"
BAD_COMMIT_SHA="<BAD_COMMIT_SHA>"
git revert "$BAD_COMMIT_SHA"
git push origin main
```

The push to Git starts the same serialized CI workflow. It creates a new
immutable release from the reverted source and deploys it to the workflow's
configured environment.

## Verify it worked

1. Confirm the staging CI job reports successful Push and Deploy steps.
2. Confirm the final deployment evidence names the merged commit and reports
   `urlVerification: "served"`, which means Deploy observed the protected
   environment answer behind its access gate.
3. Open the staging environment with `veryfront open --env staging`.
4. Check the changed route or API behavior.
5. Record the Admin or Owner staging approval before production promotion.

## Next

- [Move Studio changes into Git](./move-studio-changes-to-git.md): Turn an immutable Studio release into a reviewed pull request.
- [Build and deploy](./deploying.md): Review local build and self-hosted deployment paths.

## Related

- [veryfront/cli](../api-reference/veryfront/cli.md): CLI command catalog
- [Configuration](./configuration.md): Cloud bootstrap environment variables
