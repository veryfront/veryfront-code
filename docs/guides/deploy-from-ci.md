---
title: "Deploy from CI"
description: "Push a reviewed Git commit to Veryfront and deploy it from a serialized CI job."
order: 44
---

Use this guide to make a reviewed Git commit the source of a Veryfront
deployment. The CI job pushes the checked-out source, creates an immutable
release, and deploys that release to an environment.

## Understand the trust boundary

This workflow uses CI as the bridge between Git and Veryfront. It is
not an enforced repository connection, so Veryfront cannot verify which Git
repository is canonical. Existing Studio permissions can still allow direct
edits to Veryfront `main`, and a project API key can upload the source present
in its checkout. Veryfront does not create Git pull requests as part of this
workflow. A developer or repository-owned CI workflow runs the handoff
commands, while review and conflict resolution stay in Git.

Use one serialized CI writer for each Veryfront project, protect its API key,
and use immutable releases for Studio-to-Git handoffs.

This workflow depends on operating rules that Veryfront does not enforce:

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
- `.veryfront/` in `.gitignore` so local Push receipts are never committed.

See [Configuration](./configuration.md) for the Cloud bootstrap environment
variables.

## Define the managed source set

Push and `pull --prune` reconcile supported text files only. The managed set
includes TypeScript, JavaScript, JSON, stylesheets, HTML, Markdown, MDX, text,
SVG, YAML, and TOML. Binary images, fonts, archives, and other unsupported
files remain outside this handoff. Manage those files through another reviewed
delivery path.

Both commands use the same `.vfignore` rules. Ignored files and unsupported
extensions are not reconciled with Veryfront.

If the project has a `.vfignore`, keep it as a regular file inside the project
and commit it to Git. An untracked, Git-ignored, or symlinked `.vfignore` cannot
provide clean production provenance, so Deploy will stop instead of treating
the checkout as the reviewed commit.

## Preview the Push

Preview the source reconciliation before it changes Veryfront:

```bash title="Terminal"
veryfront push --branch main --dry-run
```

Push dry-run reads the local and remote source needed for the comparison but
makes no mutation. It does not create a missing project or branch, upload or
delete files, or write `.veryfront/push-receipt.json`.

## Start with staging

Run Push and Deploy from the same Git checkout and CI job:

```bash title="Terminal"
veryfront push --branch main --yes
veryfront deploy --branch main --env staging --yes
```

Push records the checked-out commit and source digest in
`.veryfront/push-receipt.json`. Deploy requires that receipt to match the same
project, branch, commit, and checkout. Do not split the two commands across CI
jobs or clean the checkout between them.

Deploy creates an immutable release from the pushed source, then assigns that
release to `staging`.

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

          npx --no-install veryfront push --branch main --yes
          npx --no-install veryfront deploy --branch main --env staging --yes
```

`npm ci` and `npx --no-install` use the Veryfront version in the project
lockfile. Replace the install and test steps when the project uses another
package manager, but keep Push and Deploy together.

The concurrency group prevents two jobs from changing Veryfront `main` at the
same time. `cancel-in-progress: false` lets an active Push and Deploy sequence
finish before the next run starts.

The SHA check skips a queued workflow when a newer `main` commit already
exists. This reduces races between queued CI runs, but it does not provide
server-side exact-SHA enforcement.

Do not start a new Studio change until this job has pushed the latest Git
`main` source successfully. A Studio release created from an older baseline is
a stale full snapshot, and the CLI handoff does not auto-merge it with newer
Git changes.

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
veryfront push --branch main --yes
veryfront deploy --branch main --env production --yes
```

Keep Push and Deploy in the same checkout and job after promotion. Do not add a
second unsynchronized writer for production.

## Capture deployment evidence

Deploy prints human-readable output by default. Add `--json` only when the CI
system needs machine-readable audit evidence. JSON mode emits NDJSON records
for each step and a final result.

Write the audit file outside the Git checkout so it does not make the source
dirty before Deploy verifies the Push receipt:

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
2. Confirm the final deployment evidence names the merged commit.
3. Open the staging environment with `veryfront open --env staging`.
4. Check the changed route or API behavior.
5. Record the Admin or Owner staging approval before production promotion.

## Next

- [Move Studio changes into Git](./move-studio-changes-to-git.md): Turn an immutable Studio release into a reviewed pull request.
- [Build and deploy](./deploying.md): Review local build and self-hosted deployment paths.

## Related

- [veryfront/cli](../api-reference/veryfront/cli.md): CLI command catalog
- [Configuration](./configuration.md): Cloud bootstrap environment variables
