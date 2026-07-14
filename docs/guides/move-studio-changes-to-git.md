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
- The release version and base Git SHA supplied by the Studio editor.
- A clean local clone of the Git repository.
- A dedicated Veryfront API key and project slug in your environment.
- Permission to push a Git feature branch and open a pull request.
- `.veryfront/` in `.gitignore` so the local Push receipt cannot enter the pull request.

## Synchronize main before Studio work

Wait for the serialized CI job to push the latest reviewed Git `main` source
into Veryfront and deploy it to staging. Record that successful job's Git SHA.
Do not start a new Studio change before this Push finishes.

Create a non-main Studio branch for the citizen-developer change. Do not edit
or publish directly from Studio `main`. Phase 0 cannot enforce this rule, so the
team must apply it as part of the pilot operating procedure.

## Create the Studio handoff

When the Studio change is ready, publish it to a non-production environment,
such as staging. Publish creates the immutable release used for the handoff and
deploys it only to that selected environment.

Open the Releases panel in Studio, open the new release, and copy its Version
value. Give the professional developer that version and the Git SHA recorded
before Studio work began. You do not need to deploy the unreviewed change to
production.

## Create a Git feature branch

Start from the latest reviewed `main` branch:

```bash title="Terminal"
git fetch origin main
git switch --create veryfront/studio-release origin/main
git status --short
```

`git status --short` must print no changes. Never pull a Studio release directly
into the Git `main` branch.

Record the handoff values and check whether Git advanced after Studio work
began:

```bash title="Terminal"
VERYFRONT_RELEASE="<VERSION>"
BASE_GIT_SHA="<BASE_GIT_SHA>"
CURRENT_MAIN_SHA="$(git rev-parse origin/main)"

if [ "$CURRENT_MAIN_SHA" != "$BASE_GIT_SHA" ]; then
  echo "Studio release is based on $BASE_GIT_SHA; Git main is $CURRENT_MAIN_SHA."
  echo "Pull applies a full snapshot and will not auto-merge these changes."
fi
```

For the safest pilot path, stop when these SHAs differ. Push the latest Git
`main` source into Veryfront, recreate the Studio change, and publish a new
release. If the professional developer deliberately continues, they own the
full Git diff and every conflict resolution.

## Preview the release

Set the immutable release version and preview the file reconciliation:

```bash title="Terminal"
veryfront pull --release "$VERYFRONT_RELEASE" --prune --dry-run
```

`--prune` includes managed local files that exist in Git but not in the Studio
release. It does not delete ignored files, unsupported files, or Git metadata.
Push and pruning Pulls share the project `.vfignore` rules. Commit `.vfignore`
as a regular file when the project uses one.

Use a release version instead of a mutable Studio branch name. Repeating the
Pull for the same release retrieves the same source snapshot.

Pull dry-run may run outside a Git worktree and does not write or delete local
files. It still validates the remote path set and reports every managed file it
would write or delete. Use it before every pruning Pull.

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

A mutating `--prune` requires a clean Git worktree. `--yes` and `--force` skip
only the overwrite confirmation and never bypass the clean-worktree, path, or
symlink checks. Pull preserves the release bytes exactly, including line
endings and a missing final newline.

The release is a full managed-source snapshot, not a patch. Pull overwrites
supported text files and prunes supported text files that are absent from the
release. It does not perform a three-way merge or auto-merge a stale release
with newer Git changes. Ignored, unsupported, and binary files remain outside
the reconciliation.

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

gh pr create \
  --base main \
  --head "$(git branch --show-current)" \
  --title "Apply Veryfront Studio release ${VERYFRONT_RELEASE}" \
  --body "Veryfront Studio release: ${VERYFRONT_RELEASE}
Studio base Git SHA: ${BASE_GIT_SHA}"
```

The pull request targets `main` and records both the immutable release and its
Studio base Git SHA. Reviewers can use those values to trace the handoff and
identify a stale snapshot.

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
`main` source to Veryfront and creates the staging release and deployment
during the pilot. The approved production workflow uses the same sequence.
Wait for that Push before anyone starts another Studio change.

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
