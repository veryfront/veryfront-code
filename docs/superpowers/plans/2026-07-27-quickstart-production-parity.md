# Quickstart Production Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a fresh scaffold's first deploy return only when its production URL serves a correctly styled application.

**Architecture:** Release CSS compilation will consume the same generated framework candidate set as dev and local production builds. Deploy will add one shared environment-readiness probe after canonical deployment verification, with bounded retries, protected-environment authentication, and a strict credential boundary for custom domains.

**Tech Stack:** Deno 2, TypeScript, Tailwind CSS 4, Veryfront CLI, Veryfront release asset manifests, BDD tests, mock fetch, agent-browser.

## Global Constraints

- Preserve the existing scaffold, project creation, automatic linking, non-Git source push, release verification, and protected-output behavior.
- Do not add dependencies.
- Never send or print a Veryfront token for a custom domain.
- Use “quickstart deploy flow” or “first deploy experience” in implementation notes and commits.
- Do not use external-product comparison language.
- Add each regression test before its production change and observe the expected failure.
- Keep human and JSON deploy behavior aligned.
- Completion requires a released package and a fresh production browser verification.

---

### Task 1: Include framework component utilities in release CSS

**Files:**
- Modify: `src/release-assets/build-executor.test.ts`
- Modify: `src/release-assets/build-executor.ts`

**Interfaces:**
- Consumes: `FRAMEWORK_CANDIDATES: readonly string[]` from `src/server/handlers/dev/framework-candidates.generated.ts`
- Produces: `collectClassCandidates(sourceByPath): Set<string>` containing project and framework candidates

- [x] **Step 1: Extend the existing candidate regression test**

Update `passes helper-composed Tailwind candidates to compileProjectCss` so its
project fixture still contributes `h-16`, `md:h-[4.5rem]`, and
`lg:h-[5rem]`, and add:

```ts
assert(
  candidates.has("rounded-full"),
  "framework chat candidates must be included in release CSS compilation",
);
```

The fixture must not contain `rounded-full`; the test must prove the candidate
comes from the framework set.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```sh
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  src/release-assets/build-executor.test.ts \
  --filter "passes helper-composed Tailwind candidates"
```

Expected: FAIL with `framework chat candidates must be included`.

- [x] **Step 3: Add framework candidates at the shared release boundary**

Import the generated candidate set:

```ts
import { FRAMEWORK_CANDIDATES } from
  "#veryfront/server/handlers/dev/framework-candidates.generated.ts";
```

Update candidate collection:

```ts
function collectClassCandidates(sourceByPath: Map<string, string>): Set<string> {
  const candidates = extractCandidatesFromFiles(
    [...sourceByPath.entries()].map(([path, content]) => ({ path, content })),
  );
  for (const candidate of FRAMEWORK_CANDIDATES) candidates.add(candidate);
  return candidates;
}
```

- [x] **Step 4: Run the focused release asset suite and verify GREEN**

Run:

```sh
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  src/release-assets/build-executor.test.ts
```

Expected: all release asset tests pass.

- [x] **Step 5: Commit the CSS parity slice**

```sh
git add src/release-assets/build-executor.ts \
  src/release-assets/build-executor.test.ts
git commit
```

Use a Lore commit whose intent is to preserve framework styling in cloud
releases. Record the local/cloud candidate divergence in `Constraint:` and the
focused test in `Tested:`.

---

### Task 2: Wait for the environment URL before reporting deploy success

**Files:**
- Modify: `cli/commands/deploy/command.test.ts`
- Modify: `cli/commands/deploy/command.integration.test.ts`
- Modify: `cli/commands/deploy/command.ts`

**Interfaces:**
- Produces:

```ts
export interface EnvironmentReadinessOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface EnvironmentReadinessTarget {
  projectSlug: string;
  environmentName: string;
  url: string;
  protected: boolean;
  apiToken: string;
}

export async function waitForEnvironmentReady(
  target: EnvironmentReadinessTarget,
  options?: EnvironmentReadinessOptions,
): Promise<void>;
```

- Extends internal `DeployOptions` with:

```ts
environmentPollIntervalMs?: number;
environmentTimeoutMs?: number;
```

- [x] **Step 1: Add unit tests for retry and authentication behavior**

Add a `describe("environment URL readiness", ...)` block covering:

```ts
it("retries a transient 404 before accepting the environment URL", async () => {
  const statuses = [404, 200];
  let requests = 0;

  await withMockFetch(
    () => new Response("ready", { status: statuses[requests++] }),
    () =>
      waitForEnvironmentReady(
        {
          projectSlug: "my-project",
          environmentName: "production",
          url: "https://my-project.production.veryfront.com",
          protected: false,
          apiToken: "test-token",
        },
        { pollIntervalMs: 1, timeoutMs: 1_000 },
      ),
  );

  assertEquals(requests, 2);
});
```

Add separate tests asserting:

- Protected `*.veryfront.com` and `*.veryfront.org` requests include
  `Cookie: authToken=test-token`.
- A protected custom URL is checked without credentials before the canonical
  Veryfront environment URL is checked with the token.
- A public custom URL is requested directly and has no `Cookie` header.
- A redirect to `https://veryfront.com/sign-in` rejects with a message that
  recommends `veryfront login`.
- A bounded sequence of `404` responses rejects with the URL and last status.

Use `assertRejects` and request inspection. Never use a real token in tests.

- [x] **Step 2: Run the readiness tests and verify RED**

Run:

```sh
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  cli/commands/deploy/command.test.ts \
  --filter "environment URL readiness"
```

Expected: type/check failure because `waitForEnvironmentReady` does not exist.

- [x] **Step 3: Implement the bounded readiness primitive**

Add constants:

```ts
const DEFAULT_ENVIRONMENT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_ENVIRONMENT_TIMEOUT_MS = 120_000;
```

Add a canonical URL helper:

```ts
function buildCanonicalEnvironmentUrl(
  projectSlug: string,
  environmentName: string,
): string {
  return `https://${projectSlug}.${environmentName}.veryfront.com`;
}
```

Resolve the ordered probes inside `waitForEnvironmentReady`:

```ts
function buildEnvironmentReadinessProbes(
  target: EnvironmentReadinessTarget,
): EnvironmentReadinessProbe[] {
  if (target.protected && !isVeryfrontHostedUrl(target.url)) {
    return [
      {
        url: target.url,
        authenticate: false,
        acceptAuthenticationChallenge: true,
      },
      {
        url: buildCanonicalEnvironmentUrl(
          target.projectSlug,
          target.environmentName,
        ),
        authenticate: true,
        acceptAuthenticationChallenge: false,
      },
    ];
  }
  return [{
    url: target.url,
    authenticate: target.protected,
    acceptAuthenticationChallenge: false,
  }];
}
```

Implement `waitForEnvironmentReady` with:

```ts
const response = await fetch(probe.url, {
  method: "GET",
  redirect: "manual",
  headers: probe.authenticate
    ? { Cookie: `authToken=${target.apiToken}`, "Cache-Control": "no-cache" }
    : { "Cache-Control": "no-cache" },
});
```

Treat `200..299` and non-sign-in application redirects as ready. Retry network
errors, `404`, `408`, `425`, `429`, and `500..599` until the deadline. Reject
other statuses immediately with actionable text. An unauthenticated custom
probe for a protected environment may accept a sign-in redirect, `401`, or
`403` before the authenticated canonical probe. Cancel the response body
best-effort before continuing.

- [x] **Step 4: Wire readiness into human deploy output**

After `verifyDeployment` succeeds:

```ts
const environmentUrl = buildEnvironmentUrl(verification.projectSlug, environment);
spinner.update(`Waiting for ${env} URL...`);
await waitForEnvironmentReady(
  {
    projectSlug: verification.projectSlug,
    environmentName: environment.name,
    url: environmentUrl,
    protected: environment.protected,
    apiToken: config.apiToken,
  },
  {
    pollIntervalMs: environmentPollIntervalMs,
    timeoutMs: environmentTimeoutMs,
  },
);
```

Reuse `environmentUrl` when printing `URL:`. Do not report success before the
readiness promise resolves.

- [x] **Step 5: Wire readiness into JSON deploy output**

Emit:

```ts
streamJsonLine({
  type: "step",
  name: "wait-environment-url",
  status: "started",
});
```

Run the same readiness helper, then emit `completed`. Reuse the same
`environmentUrl` in the result envelope.

- [x] **Step 6: Update deploy integration mocks and prove call ordering**

In the canonical human/JSON integration test, make the environment host return
`404` once and `200` next. Set `environmentPollIntervalMs: 1` and
`environmentTimeoutMs: 1_000`. Assert the environment URL requests occur after
the final control-plane environment read and before deploy resolves.

For other successful deploy integration fixtures, return `200` for the
expected environment hostname. Do not modify fixtures that fail before
readiness.

- [x] **Step 7: Run focused deploy suites and verify GREEN**

Run:

```sh
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts
```

Expected: all deploy tests pass with no timer leaks.

- [x] **Step 8: Commit the readiness slice**

```sh
git add cli/commands/deploy/command.ts \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts
git commit
```

Use a Lore commit whose intent is to make the printed environment URL truthful.
Record the protected custom-domain credential boundary in `Constraint:` and
the rejected control-plane-only verification in `Rejected:`.

---

### Task 3: Release and repository verification

**Files:**
- Modify: `deno.json`
- Modify: `src/utils/version-constant.ts`

**Interfaces:**
- Produces: the next patch version in both authoritative version files

- [ ] **Step 1: Verify the current release and queue state**

Run:

```sh
git fetch origin main
git show origin/main:deno.json | rg '"version"'
gh release list --repo veryfront/veryfront-code --limit 3
gh pr list --repo veryfront/veryfront-code --search "is:open" \
  --json number,title,headRefName,mergeStateStatus
```

Choose the next patch version from current `origin/main`, not from stale local
history.

- [ ] **Step 2: Update both version sources**

Apply the same version to:

```text
deno.json
src/utils/version-constant.ts
```

Do not edit lockfiles or generated package metadata manually.

- [ ] **Step 3: Run formatting, lint, type checks, and focused tests**

Run:

```sh
deno fmt --check \
  src/release-assets/build-executor.ts \
  src/release-assets/build-executor.test.ts \
  cli/commands/deploy/command.ts \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts \
  src/utils/version-constant.ts \
  deno.json
deno lint \
  src/release-assets/build-executor.ts \
  src/release-assets/build-executor.test.ts \
  cli/commands/deploy/command.ts \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts
deno check \
  src/release-assets/build-executor.ts \
  src/release-assets/build-executor.test.ts \
  cli/commands/deploy/command.ts \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  src/release-assets/build-executor.test.ts \
  cli/commands/deploy/command.test.ts \
  cli/commands/deploy/command.integration.test.ts
git diff --check
```

Expected: zero failures and no formatting or lint findings.

- [ ] **Step 4: Run the production build regression surface**

Run:

```sh
VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all \
  src/build/production-build/static-generation.test.ts \
  src/html/styles-builder/tailwind-compiler.test.ts \
  src/server/handlers/dev/framework-candidates.generated.test.ts
```

Expected: local production and framework candidate tests remain green.

- [ ] **Step 5: Review the branch against current main**

Run:

```sh
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git diff origin/main...HEAD -- \
  src/release-assets/build-executor.ts \
  cli/commands/deploy/command.ts
```

Confirm there are no unrelated edits, credential literals, local paths, or
external-product comparison language.

- [ ] **Step 6: Commit the release version**

```sh
git add deno.json src/utils/version-constant.ts
git commit
```

Use a Lore commit whose intent is to publish the verified first-deploy fixes.

- [ ] **Step 7: Push and create the PR**

```sh
git push -u origin fix/quickstart-production-parity
gh pr create --repo veryfront/veryfront-code
```

The PR description must include the observed production failures, the two
root causes, automated verification, and the pending post-release production
test. Do not include tokens, local paths, or external-product comparisons.

- [ ] **Step 8: Resolve review feedback and verify CI**

Read every review thread, reproduce technical concerns, apply TDD for behavior
changes, reply inline, resolve fixed threads, and wait until required checks
pass.

---

### Task 4: Fresh production completion audit

**Files:**
- No repository edits unless production verification finds a new regression
- Temporary scaffold outside the repository

**Interfaces:**
- Consumes: the released npm `veryfront` and `create-veryfront` packages
- Produces: production URL, CLI transcript, browser/network evidence, and local/production screenshots

- [ ] **Step 1: Wait for the release to reach npm**

Run until the PR version is published:

```sh
npm view veryfront version
npm view create-veryfront version
```

Confirm `npx veryfront@latest --version` matches the expected release.

- [ ] **Step 2: Scaffold a unique fresh project**

In a new temporary parent directory:

```sh
npm create veryfront@latest -- <unique-name> \
  --template ai-agent \
  --skip-env-prompt
```

Confirm dependencies use the released patch version and no `.git` repository
is required.

- [ ] **Step 3: Verify local behavior**

Run:

```sh
npm run build
npm run dev
```

Use agent-browser at a fixed viewport to confirm:

- Title is `AI Chat`.
- No browser errors.
- Local stylesheet and favicon return `200`.
- The calculator prompt returns `16`.
- Save the local screenshot and CSS byte/rule counts.

- [ ] **Step 4: Run the exact first deploy command**

Run:

```sh
npx veryfront@latest deploy
```

Confirm output shows project creation or linking, source push, release asset
wait, deployment, environment URL wait, actual URL, and protected state.

- [ ] **Step 5: Verify production in a clean browser session**

Set the stored token as an `authToken` cookie for `.veryfront.com`, open the
printed URL, and confirm:

- The first post-command request does not return `404`.
- Hydration runtime, all modules, stylesheet, and favicon return `200`.
- No browser or console errors.
- Production CSS includes representative framework component utilities.
- Computed chat styles and screenshot match local.
- `/api/ag-ui` returns `200` and the calculator prompt returns `16`.

- [ ] **Step 6: Complete the acceptance audit**

Map fresh evidence to every acceptance criterion in the attached objective.
Do not mark completion if any criterion relies only on a unit test or earlier
release. Record any remaining risk explicitly.
