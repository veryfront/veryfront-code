# Dedicated Proxy Memory Footprint Implementation Plan

> **For implementing agents:** Execute each task as a vertical red-green slice. Do not edit either repository's main checkout.

**Goal:** Ship a dedicated Linux proxy artifact that preserves the universal Veryfront binaries, starts reliably below the existing 1536 MiB cap, and is selected by the staging server image with temporary rollout headroom.

**Architecture:** Reconcile the tested producer from draft veryfront-code PR #3280 onto current main, then add the missing ARM64 release leg and cgroup memory gate. In veryfront-server, complete the already-landed asset consumer by selecting the proxy executable in proxy mode, retain the universal fallback, and encode the staging resource envelope.

**Tech stack:** Deno, TypeScript, Bash, GitHub Actions, Docker cgroups, Helm, Kubernetes.

## Confirmed test seams

- Build/release seam: `scripts/build/compile-binary.test.ts` observes compile arguments, release asset names, lock/SBOM contracts, and CI gate wiring.
- Runtime seam: the exact compiled Linux x64 proxy answers `/_proxy/health` inside a 1536 MiB Docker cgroup.
- Container seam: the built veryfront-server image selects the correct PID 1 executable from `VERYFRONT_MODE` and preserves SIGTERM delivery.
- Configuration seam: a rendered staging Helm chart contains the approved proxy memory request and limit.

## Constraints

- Work only in isolated worktrees.
- Preserve all existing universal binary names, contents, commands, and public behavior.
- Add no dependencies.
- Reuse draft PR #3280 instead of rebuilding the proxy lifecycle.
- Keep each new behavior change red before green.
- Use Lore commit messages and record exact verification in `Tested:` trailers.
- Do not publish, merge, or mutate staging during local implementation verification.

## Task 1: Reconcile the existing proxy producer

**Files imported from PR #3280:**

- `.github/workflows/cicd.yml`
- `cli/commands/serve/command.ts`
- `cli/commands/serve/proxy-extension-composition.ts`
- `cli/commands/serve/proxy-extension-composition.test.ts`
- `cli/commands/serve/proxy-runtime.ts`
- `cli/commands/serve/proxy-runtime.test.ts`
- `cli/proxy-main.ts`
- `deno.json`
- `scripts/build/build-all.js`
- `scripts/build/compile-binary.ts`
- `scripts/build/compile-binary.test.ts`
- `scripts/build/generate-sbom.ts`
- `scripts/build/generate-sbom.test.ts`
- `scripts/build/proxy-deno.lock`
- `scripts/build/smoke-proxy-binary.sh`

- [ ] Record `origin/main`, `origin/codex/proxy-specific-binary`, and worktree status.
- [ ] Merge the draft producer into this implementation branch.
- [ ] Resolve conflicts by retaining current-main BDD/import conventions plus the proxy profile, graph lock, shared runtime, exact SBOM, and current test task inventory.
- [ ] Run the imported producer tests:

```bash
deno test --config=scripts/test.deno.json --no-check --allow-read --allow-write --allow-run scripts/build/compile-binary.test.ts scripts/build/generate-sbom.test.ts
deno test --no-check --allow-all cli/commands/serve/proxy-runtime.test.ts cli/commands/serve/proxy-extension-composition.test.ts
bash -n scripts/build/smoke-proxy-binary.sh
git diff --check origin/main...HEAD
```

- [ ] Commit the reconciliation with a Lore merge commit.

## Task 2: Publish both Linux proxy architectures

**Files:** `scripts/build/compile-binary.test.ts`, `.github/workflows/cicd.yml`

- [ ] Add a failing release-contract assertion requiring both `veryfront-proxy-linux-x64` and `veryfront-proxy-linux-arm64`.
- [ ] Assert the ARM64 asset uses `aarch64-unknown-linux-gnu`, `cli/proxy-main.ts`, and the proxy profile.
- [ ] Run RED:

```bash
deno test --config=scripts/test.deno.json --no-check --allow-read --allow-write --allow-run scripts/build/compile-binary.test.ts
```

Expected: failure because only the x64 proxy asset exists.

- [ ] Add the ARM64 proxy matrix leg. Keep executable smoke tests restricted to native x64.
- [ ] Run GREEN, `deno fmt --check scripts/build/compile-binary.test.ts`, and `git diff --check`.
- [ ] Commit test and workflow together with a Lore message.

## Task 3: Gate cold-start memory under 1536 MiB

**Files:** `scripts/build/compile-binary.test.ts`, new `scripts/build/smoke-proxy-memory.sh`, `.github/workflows/cicd.yml`

- [ ] Add a failing contract requiring the memory script, PR-job invocation, x64 release invocation, a 1536 MiB Docker limit, and three attempts.
- [ ] Run RED with the focused compile-binary test.
- [ ] Implement `smoke-proxy-memory.sh`. For each attempt it must:

  - run the exact mounted binary in `debian:trixie-slim` with `--memory=1536m`;
  - use `CACHE_TYPE=memory` and a published loopback port;
  - poll `/_proxy/health` with bounded host `curl` calls;
  - capture logs on failure;
  - inspect `.State.OOMKilled` before removal;
  - stop cleanly and remove its exact container through a trap.

- [ ] Wire the script after provider smoke in the PR job and the x64 main release leg. Do not execute ARM64 on x64.
- [ ] Run static GREEN:

```bash
deno test --config=scripts/test.deno.json --no-check --allow-read --allow-write --allow-run scripts/build/compile-binary.test.ts
bash -n scripts/build/smoke-proxy-memory.sh
git diff --check
```

- [ ] Build and run the behavioral gates:

```bash
deno task build:prepare
deno task build:proxy-lock
git diff --exit-code -- scripts/build/proxy-deno.lock
proxy_artifact_dir="$(mktemp -d)"
deno run -A scripts/build/compile-binary.ts --profile proxy --target x86_64-unknown-linux-gnu --output "${proxy_artifact_dir}/veryfront-proxy-linux-x64"
bash scripts/build/smoke-proxy-binary.sh "${proxy_artifact_dir}/veryfront-proxy-linux-x64"
bash scripts/build/smoke-proxy-memory.sh "${proxy_artifact_dir}/veryfront-proxy-linux-x64"
deno run -A scripts/build/compile-binary.ts --profile proxy --target aarch64-unknown-linux-gnu --output "${proxy_artifact_dir}/veryfront-proxy-linux-arm64"
```

- [ ] Commit the memory gate with binary sizes and smoke outcomes in `Tested:`.

## Task 4: Complete the veryfront-server runtime selector

**Worktree:** isolated server branch `fix/proxy-memory-footprint`, based on server `origin/main`.

**Files:** `scripts/test-container-entrypoint.sh`, `Dockerfile`

- [ ] Create the isolated server worktree and confirm it is clean.
- [ ] Change the container test first so production, dedicated proxy, and unavailable-proxy fallback all use the image's real default command.
- [ ] Preserve PID 1 and SIGTERM marker assertions for every case. Remove the test-only selector fragment.
- [ ] Run RED against `veryfront-server:entrypoint-test`. Expected: proxy mode still selects the universal binary.
- [ ] Update the Docker command:

  - proxy mode executes `/usr/local/bin/veryfront-proxy` when executable;
  - proxy mode falls back to `/usr/local/bin/veryfront` otherwise;
  - production/default mode always executes `/usr/local/bin/veryfront`;
  - every path uses `exec` and preserves the existing arguments.

- [ ] Rebuild the fixture image and run GREEN:

```bash
bash -n scripts/test-container-entrypoint.sh
./scripts/test-container-entrypoint.sh veryfront-server:entrypoint-test
```

- [ ] Commit test and Dockerfile together with a Lore message.

## Task 5: Encode staging resource headroom

**Files:** new `scripts/test-staging-proxy-resources.sh`, `.github/workflows/cicd.yml`, `chart/values-staging.yaml`

- [ ] Add a rendered-chart test requiring proxy memory request `1Gi` and limit `2Gi`.
- [ ] Add it to the validate job after Helm setup.
- [ ] Run RED:

```bash
bash -n scripts/test-staging-proxy-resources.sh
./scripts/test-staging-proxy-resources.sh
```

Expected: current staging values render `768Mi` and `1536Mi`.

- [ ] Change only the staging proxy memory request and limit to `1Gi` and `2Gi`.
- [ ] Run GREEN:

```bash
helm lint ./chart
./scripts/test-staging-proxy-resources.sh
git diff --check
```

- [ ] Commit the test, CI invocation, and values together. Record that final right-sizing depends on observed staging peaks.

## Task 6: Final verification

Run in veryfront-code:

```bash
deno test --config=scripts/test.deno.json --no-check --allow-read --allow-write --allow-run scripts/build/compile-binary.test.ts scripts/build/generate-sbom.test.ts
deno test --no-check --allow-all cli/commands/serve/proxy-runtime.test.ts cli/commands/serve/proxy-extension-composition.test.ts
deno fmt --check cli/proxy-main.ts cli/commands/serve scripts/build/compile-binary.ts scripts/build/compile-binary.test.ts scripts/build/generate-sbom.ts scripts/build/generate-sbom.test.ts
deno lint cli/proxy-main.ts cli/commands/serve/proxy-runtime.ts cli/commands/serve/proxy-runtime.test.ts cli/commands/serve/proxy-extension-composition.ts cli/commands/serve/proxy-extension-composition.test.ts
deno check cli/proxy-main.ts cli/commands/serve/proxy-runtime.ts cli/commands/serve/proxy-runtime.test.ts
bash -n scripts/build/smoke-proxy-binary.sh scripts/build/smoke-proxy-memory.sh
git diff --check origin/main...HEAD
```

Run in veryfront-server:

```bash
bash -n scripts/test-container-entrypoint.sh scripts/test-resolve-framework-assets.sh scripts/test-staging-proxy-resources.sh
./scripts/test-resolve-framework-assets.sh
./scripts/test-staging-proxy-resources.sh
helm lint ./chart
./scripts/test-container-entrypoint.sh veryfront-server:entrypoint-test
git diff --check origin/main...HEAD
```

Report both branches and commits, x64 and ARM64 binary sizes, all three cgroup attempts with `OOMKilled=false`, container PID 1/SIGTERM results, and rendered staging resources. State explicitly that merge, release, image publication, and staging rollout remain follow-up actions.
