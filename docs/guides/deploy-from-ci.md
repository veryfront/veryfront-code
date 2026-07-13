---
title: "Deploy from CI"
description: "Push a reviewed Git commit to Veryfront and deploy it from a serialized CI job."
order: 44
---

Use this guide to make a reviewed Git commit the source of a Veryfront
deployment. The CI job pushes the checked-out source, creates an immutable
release, and deploys that release to an environment.

## Understand the Phase 0 boundary

This workflow is a CI-mediated bridge, not an enforced repository connection.
Veryfront does not yet know which Git repository is canonical. Existing Studio
permissions can still allow direct edits to Veryfront `main`, and a project API
key can upload the source present in its checkout. Pull request creation and
conflict resolution remain manual.

Use one serialized CI writer for each Veryfront project, protect its API key,
and use immutable releases for Studio-to-Git handoffs. The connected-repository
phase adds exact-SHA server fetches, GitHub App verification, and automated pull
requests.

## Prerequisites

- A Veryfront project with the `veryfront` package pinned in its lockfile.
- A dedicated project API key stored in the CI secret manager.
- The project slug stored as a CI variable.
- A protected `production` environment in Veryfront.
- A CI job that runs after changes merge to `main`.
- `.veryfront/` in `.gitignore` so local Push receipts are never committed.

See [Configuration](./configuration.md) for the Cloud bootstrap environment
variables.

## Define the managed source set

Push and `pull --prune` use the same supported text-file extensions and
`.vfignore` rules. Ignored and unsupported files are not reconciled with
Veryfront.

If the project has a `.vfignore`, keep it as a regular file inside the project
and commit it to Git. An untracked, Git-ignored, or symlinked `.vfignore` cannot
provide clean production provenance, so Deploy will stop instead of treating
the checkout as the reviewed commit.

## Push and deploy

Run Push and Deploy from the same Git checkout and CI job:

```bash title="Terminal"
veryfront push --branch main --yes
veryfront deploy --branch main --env production --yes
```

Push records the checked-out commit and source digest in
`.veryfront/push-receipt.json`. Deploy requires that receipt to match the same
project, branch, commit, and checkout. Do not split the two commands across CI
jobs or clean the checkout between them.

Deploy creates an immutable release from the pushed source, then assigns that
release to `production`.

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

Add a workflow that serializes production updates and keeps the API key scoped
to the deployment step:

```yaml title=".github/workflows/deploy-veryfront.yml"
name: Deploy Veryfront

on:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: veryfront-production-${{ github.repository }}
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
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

          npx --no-install veryfront push --branch main --yes
          npx --no-install veryfront deploy --branch main --env production --yes
```

`npm ci` and `npx --no-install` use the Veryfront version in the project
lockfile. Replace the install and test steps when the project uses another
package manager, but keep Push and Deploy together.

The concurrency group prevents two jobs from changing Veryfront `main` at the
same time. `cancel-in-progress: false` lets an active Push and Deploy sequence
finish before the next run starts.

The SHA check skips a queued workflow when a newer `main` commit already
exists. It is a Phase 0 race reduction, not the exact-SHA enforcement provided
by a connected repository.

## Capture deployment evidence

Deploy prints human-readable output by default. Add `--json` only when the CI
system needs machine-readable audit evidence. JSON mode emits NDJSON records
for each step and a final result.

Write the audit file outside the Git checkout so it does not make the source
dirty before the production check:

```bash title="GitHub Actions deployment step"
set -o pipefail
veryfront deploy --branch main --env production --yes --json \
  | tee "${RUNNER_TEMP}/veryfront-deploy.ndjson"
```

Store `${RUNNER_TEMP}/veryfront-deploy.ndjson` as a CI artifact. The final
result includes the project, commit SHA, source digest, release, environment,
and deployment identifiers.

## Roll back

Revert the faulty Git commit instead of changing Veryfront `main` directly:

```bash title="Terminal"
BAD_COMMIT_SHA="<BAD_COMMIT_SHA>"
git revert "$BAD_COMMIT_SHA"
git push origin main
```

The push to Git starts the same serialized CI workflow. It creates a new
immutable release from the reverted source and deploys it to production.

## Verify it worked

1. Confirm the CI job reports successful Push and Deploy steps.
2. Confirm the final deployment evidence names the merged commit.
3. Open the production environment with `veryfront open`.
4. Check the changed route or API behavior.

## Next

- [Move Studio changes into Git](./move-studio-changes-to-git.md): Turn an immutable Studio release into a reviewed pull request.
- [Build and deploy](./deploying.md): Review local build and self-hosted deployment paths.

## Related

- [veryfront/cli](../api-reference/veryfront/cli.md): CLI command catalog
- [Configuration](./configuration.md): Cloud bootstrap environment variables
