---
title: "Move Studio changes into Git"
description: "Pull an immutable Veryfront Studio release into a Git feature branch and open a reviewed pull request."
order: 45
---

Use this guide to hand a Studio change to a professional developer for Git
review. The Studio release is the immutable handoff, while Git remains the
place where developers review and resolve conflicts.

## Prerequisites

- An immutable release created from the completed Studio change.
- The release version supplied by the Studio editor.
- A clean local clone of the Git repository.
- A dedicated Veryfront API key and project slug in your environment.
- Permission to push a Git feature branch and open a pull request.
- `.veryfront/` in `.gitignore` so the local Push receipt cannot enter the pull request.

## Create the Studio handoff

When the Studio change is ready, publish it to a non-production environment,
such as staging. Publish creates the immutable release used for the handoff and
deploys it only to that selected environment.

Open the Releases panel in Studio, open the new release, and copy its Version
value. Give that version to the professional developer. You do not need to
deploy the unreviewed change to production.

## Create a Git feature branch

Start from the latest reviewed `main` branch:

```bash title="Terminal"
git fetch origin main
git switch --create veryfront/studio-release origin/main
git status --short
```

`git status --short` must print no changes. Never pull a Studio release directly
into the Git `main` branch.

## Preview the release

Set the immutable release version and preview the file reconciliation:

```bash title="Terminal"
VERYFRONT_RELEASE="<VERSION>"
veryfront pull --release "$VERYFRONT_RELEASE" --prune --dry-run
```

`--prune` includes managed local files that exist in Git but not in the Studio
release. It does not delete ignored files, unsupported files, or Git metadata.
Push and pruning Pulls share the project `.vfignore` rules. Commit `.vfignore`
as a regular file when the project uses one.

Use a release version instead of a mutable Studio branch name. Repeating the
Pull for the same release retrieves the same source snapshot.

## Apply the release

Apply the additions, updates, and deletions to the clean feature branch:

```bash title="Terminal"
veryfront pull --release "$VERYFRONT_RELEASE" --prune --yes
```

Pull fetches every managed remote file before it writes locally. A content
download failure leaves the feature branch unchanged. A local write or delete
failure can leave a partial Git diff. In that case, inspect `git status`, return
the feature branch to a clean state with your normal Git recovery workflow, and
then run Pull again. Do not discard unrelated local work.

## Review and test

Inspect every change before committing it:

```bash title="Terminal"
git status --short
git diff --check
git diff
```

Run the project's normal format, lint, test, and build commands. Treat the
pulled release like any other proposed source change.

## Commit and open a pull request

Commit the reviewed snapshot and push the feature branch:

```bash title="Terminal"
git add --all
git commit -m "Apply Veryfront Studio release"
git push --set-upstream origin HEAD
```

Open a pull request against `main` in the Git provider. Include the Veryfront
release version in the pull request description so reviewers can trace the
handoff.

## Resolve conflicts in Git

If `main` changes before the pull request merges, update the feature branch in
Git:

```bash title="Terminal"
git fetch origin main
git merge origin/main
git diff --name-only --diff-filter=U
```

Resolve each listed file, run `git add --all`, commit the merge, and push the
feature branch again. Do not resolve Git conflicts by overwriting Git `main`
from Studio.

After the pull request merges, the normal CI workflow pushes the reviewed Git
`main` source to Veryfront and creates the production release and deployment.

## Verify it worked

1. Confirm the pull request diff matches the immutable Studio release.
2. Confirm required Git reviews and checks pass.
3. Merge the pull request.
4. Confirm the serialized CI job pushes and deploys the merged commit.

## Next

- [Deploy from CI](./deploy-from-ci.md): Push and deploy the merged Git commit.
- [Build and deploy](./deploying.md): Review the full deployment workflow.

## Related

- [veryfront/cli](../api-reference/veryfront/cli.md): Pull, Push, and Deploy command catalog
- [Configuration](./configuration.md): Veryfront authentication and project configuration
