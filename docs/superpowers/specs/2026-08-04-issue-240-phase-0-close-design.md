# Deterministic dependencies in production (issue #240 Phase 0 close)

## Context

Issue [veryfront-issue-inbox#240](https://github.com/veryfront/veryfront-issue-inbox/issues/240) replaces runtime esm.sh delivery with a pinned, first-party, content-addressed dependency pipeline. Phase 0 of that issue pins every emitted dependency to an exact version while esm.sh remains the backend. This document defines the milestone that closes Phase 0 and takes it to production.

State verified against the repositories on 2026-08-04, not against the issue's rollout narrative:

- **Phase 0 renderer track is complete and staging-verified.** `veryfront-code#3114` merged 2026-07-30 behind `VERYFRONT_DEPENDENCY_PINNING`, followed by `#3198` (percent-encoded file URLs), `#3201` (request-scoped writeback auth), and `#3204` (SSR singleflight race). The staging soak recorded 120 of 120 concurrent 200s with exact-version writeback proven.
- **The Phase 0 API resolve endpoint is complete.** `POST /projects/{project_reference}/dependencies/resolve` (`veryfront-api/src/api/http/rest/projects/dependencies/routes.ts:80-86`) accepts bare names, inline exact versions, and semver ranges, scoped to a branch. It has zero callers.
- **The Phase 0 Studio track was never started.** `veryfront-studio/studio/panels/code/subsystems/install/lib/convertImports.ts:26` still emits `https://esm.sh/${importInfo.importPath}` with a hardcoded host and no version, exactly as issue #240 described it on 2026-07-25. Its unit test asserts that behavior, and the `prepareInstallFiles` tests bake unversioned URLs for `recharts`, `zod`, `motion/react`, `lucide-react`, `sonner`, and the `@dnd-kit` and `@radix-ui` scopes.
- **A URL in a source file never enters the pinning ladder.** The renderer pins bare specifiers. Component install — the dominant way dependencies enter a project — writes URLs, so everything it installs is unprotected by the entire renderer track. Acceptance criterion 1 of issue #240 is therefore unmet even in staging.
- **The production flag is armed with no rollout decision.** `veryfront-server#273` merged 2026-08-03 and set `VERYFRONT_DEPENDENCY_PINNING: "1"` on both the production proxy and renderer in `chart/values-production.yaml`. `.github/production-release.json` still points at artifact `20260727215958-09eda661f829`, a 2026-07-27 build that predates `#3114`. Production therefore runs no pinning code while the flag waits.
- **Production has no chart-only apply path.** `cicd.yml` deploys staging only. `production-release.yml` triggers exclusively on changes to `.github/production-release.json`. The armed flag cannot be applied, ramped, or withdrawn except by riding a full artifact promotion, so the next production promotion — for any reason, by anyone — enables dependency pinning for every hosted project simultaneously, with no canary and no rollback independent of the runtime upgrade.
- **Three seams are inert.** `src/release-assets/dependency-artifact-mode.ts` implements a complete four-mode rollout controller with zero consumers. The `task:dependency-artifact-build` capability from `veryfront-code#3208` has no dispatcher. `ensureDependencyArtifacts` in `veryfront-api` documents itself as deliberately read-only. Phase 1 Release 3 shipped as 0.1.1185 on 2026-08-02 with no reported staging verification.

Zero of issue #240's six acceptance criteria are met in production.

## Goals

- Guarantee that no producer emits an unversioned dependency URL, enforced by a CI assertion rather than by review vigilance.
- Make the armed production flag inert by construction, so any artifact promotion is safe regardless of who performs it or why.
- Deliver dependency pinning to 100% of hosted projects through a ramped rollout whose rollback path has been exercised, not merely documented.
- Establish `pkg@exact_version` as a property that holds for every dependency in a pinned project, which is the input contract Phase 1's content-addressed store requires.
- Leave the codebase with no seam this milestone introduces lacking a consumer.
- Correct the public record on issue #240 so the remaining work is planned against the code rather than against the rollout narrative.

## Non-goals

These belong to Phase 1 and Phase 2 of issue #240 and are explicitly excluded:

- Removing esm.sh from the serving path or from the CSP `script-src` allowlist (`src/rendering/rsc/production-optimizer.ts:119`).
- Serving dependencies from the content-addressed store, including Release 4A queue orchestration and renderer artifact consumption.
- Building dependencies with a first-party transform, and the export-condition selection that would fix the `DOMParser is not defined` SSR crash diagnosed in `veryfront-code#3358`.
- Pre-warming the tier-1 registry and package closure.
- Unifying the SSR and browser dependency artifacts.
- Delivering ingest-time policy hooks. This milestone makes them cheap by collapsing resolution to one endpoint; it does not implement them.

## What this milestone does and does not fix

Issue #240 bundles two risks under one headline. This milestone separates them and closes only one.

**Version drift is eliminated.** A dependency can no longer change under a running project without an explicit action by a human or an agent. This removes the floating-major class that produced the `react-resizable-panels` `PanelGroup` SSR 500 in #220, and the nondeterministic-draft class that lets a library change mid-session under an agent iterating on a preview.

**A trusted third party in the request path is untouched.** Pinning a version does not pin the bytes. `https://esm.sh/recharts@3.2.1` is still built and served by esm.sh at request time. An esm.sh compromise still reaches every hosted project through that identical URL, cold SSR still performs internet fetches inside the request path, and an esm.sh outage remains a total outage. This milestone improves availability by zero. Content addressing is what fixes this, and that is Phase 1.

The `veryfront-code#3358` finding also survives: esm.sh selecting the `browser` export condition and crashing Deno SSR is condition selection, not version selection, and only a first-party transform fixes it.

## Design

### W0 — Cohort gate (lands first, alone)

Add `VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT` and `VERYFRONT_DEPENDENCY_PINNING_PROJECTS` to the renderer, reusing the design already written and tested in `src/release-assets/dependency-artifact-mode.ts`: a deterministic hash bucket over a rollout-specific domain prefix, a union of the percentage cohort and an explicit project allowlist, and fail-closed resolution when `projectId` is absent so framework-only requests cannot enter a rollout.

The gate ships wired into the pinning read path in the same pull request. This milestone introduces no seam without a consumer.

**The percent defaults to `0` when absent.** That default is what makes the already-armed production flag safe, and it has a consequence that must be handled in the same change: `chart/values-staging.yaml` must set the percent to `100`, or staging silently loses the pinning coverage it spent a week verifying the moment the new runtime deploys. `chart/values-production.yaml` sets the percent to `0` alongside the existing flag.

After W0 is released and promoted, an unrelated production promotion is safe. Until then the coupling is live, so production promotions should be held or must carry W0's chart change.

### W1 — Close the emission gap (renderer)

`UrlStrategy` (`src/transforms/import-rewriter/strategies/url-strategy.ts`) already intercepts every esm.sh URL in user source and rewrites it to inject `deps` parameters. It is a 22-line class, and version pinning slots into that existing seam:

```ts
rewrite(info, ctx) {
  const pinned = pinEsmShUrl(info.specifier, ctx);   // same ladder as bare-strategy
  const specifier = addEsmShDeps(pinned, ctx.reactVersion);
  return { specifier: specifier === info.specifier ? null : specifier };
}
```

This covers every existing user file the moment the cohort flips, with no per-project migration and no flag day. It also covers hand-written esm.sh URLs and any producer not yet identified.

Audit the other URL-construction fallbacks listed in the issue's Phase 0 plan and confirm each honors the pin ladder: `ssr-adapter.ts` bare-import fallback, `esbuild-plugins.ts` dev-server paths, and `http-bundler.ts`. Some may already do so through `bare-strategy`; the audit records which and closes any that do not.

Add two enforcement tests:

- **Emission assertion.** For a project in a pinned cohort, no emitted dependency URL lacks an `@version` segment.
- **Determinism assertion.** Two renders of an unchanged draft produce byte-identical import maps.

### W2 — Stop the source (Studio and API)

- Delete the URL rewrite at `convertImports.ts:26`. Installed files keep bare specifiers.
- `prepareInstallFiles` collects bare specifiers from installed files **plus** the registry item's declared `dependencies: string[]` (`shared/types/shadcn.ts:36`), which is currently dropped on the floor, and calls `POST /projects/{project_reference}/dependencies/resolve`. This rides the server round-trip the install dialog already performs, so it adds no perceived latency.
- **Resolution fails open.** If the resolve call fails, the install still completes with bare specifiers and the renderer resolves at render time. A resolver blip must not become an install outage.
- The boilerplate serverless template's baked `https://esm.sh/got@12.6.1?target=node` (`studio/panels/code/subsystems/files/hooks/useCreateFileMutation.tsx:25`) becomes a bare specifier.
- **Monaco import click-through must be repointed, and this is behavioral rather than cosmetic.** `openLink` (`studio/panels/code/hooks/useMonacoOpenLink.ts:57-65`) branches on `isRemotePackageImport` and calls `window.open(importPath)`, which works only because the specifier is currently a URL. Once installs write bare specifiers that branch stops matching and click-through silently does nothing. Bare package specifiers must resolve to their npmjs.com page.
- Rewrite the unit tests in `convertImports.unit.test.ts`, `prepareInstallFiles.unit.test.ts`, and `prepareInstallFiles.comprehensive.unit.test.ts` that currently assert esm.sh URLs as correct behavior.

### W3 — Lazy codemod (source hygiene)

Rewrite baked esm.sh URLs in existing user files back to bare specifiers, moving the version into `package.json`. Runs incrementally per project on next open or save, in the existing `scripts/codemods` workspace, and must be idempotent.

W1 already makes unmigrated files safe, so this workstream is hygiene rather than a safety fix. Its failure mode is cosmetic and it can ramp slowly.

### W4 — Production ramp

1. Promote the release containing W0 and W1 with the percent at `0`. This is a pure runtime upgrade with pinning inert, and it also moves production off its 2026-07-27 artifact.
2. Ramp through internal allowlist projects, then 1%, 10%, 50%, and 100%. Each step is a `values-production.yaml` change paired with a `production-release.json` promotion, because that is the only production apply path.
3. **Exercise rollback at the 10% step** by ramping back to 1%, and capture the evidence. A rollback that has only been described is not a rollback.

Stop conditions, evaluated at each step: preview and render 5xx rate, `Failed to transform module` log count, dependency-load failure count, and p95 render latency.

### W5 — Verify Release 3 and correct the record

Confirm that the Phase 1 Release 3 builder shipped in 0.1.1185 advertises `dependency-artifact-build-v1` and that `task:dependency-artifact-build` is dispatchable but unreachable in staging, before Phase 1 resumes on top of it.

Post a status correction to issue #240 stating that the Studio track was never started, that the production flag was armed without a rollout decision, and that Release 3 is unverified.

### Sequencing

W0 lands first and alone. W1 and W2 then run in parallel across different repositories with no shared state. W4 requires W0 and W1 to be released. W3 and W5 float.

## Risks

- **Cache invalidation at each cohort flip.** URL-form pinning changes the cache key for essentially every existing project. The ramp is the mitigation, but each of the 1%, 10%, and 50% steps carries a rebuild surge that must be measured rather than assumed.
- **Resolve-endpoint load at full rollout.** Every project's first pinned render resolves N packages. The design specifies Redis caching so a popular package is one upstream fetch platform-wide; this must be verified under real fan-out.
- **`package.json` writeback contention** when concurrent installs, or a renderer writeback and a Studio install, race the same file.
- **Studio's new dependency on the resolve endpoint**, mitigated by the fail-open requirement in W2.
- **The coupling window before W0 is promoted.** Production promotions held or W0-carrying until the gate is live.

## Verification

- CI: no unversioned dependency URL is emitted for a pinned project.
- CI: two renders of an unchanged draft produce byte-identical import maps.
- CI: the codemod is idempotent.
- Staging: a component installed through Studio produces bare specifiers in source and exact versions in `package.json`, with no esm.sh URL written to any user file.
- Staging: a registry component declaring `dependencies` resolves and pins each declared package.
- Staging: resolution failure leaves the install successful with bare specifiers.
- Staging: clicking a bare package specifier in the Monaco editor opens its npmjs.com page rather than silently doing nothing.
- Production: each ramp step holds its stop conditions across its observation window.
- Production: the 10% rollback is executed and evidenced.

## Definition of done

1. No producer can emit a floating dependency, and CI fails if one does.
2. The production flag is inert by construction at every ramp step.
3. Rollback has been exercised in production with evidence.
4. Determinism is a CI-asserted invariant.
5. No seam introduced by this milestone lacks a consumer.
6. Every dependency in a pinned project carries an exact version, satisfying the `pkg@exact_version` input contract of Phase 1's content-addressed store.

This is a defensible stopping point. If Phase 1 slipped, the platform would rest in a coherent state — deterministic, non-drifting, with one resolution choke point — rather than mid-migration with inert seams and an armed production flag.
