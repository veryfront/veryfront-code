# Styles and Tailwind JIT Architecture Plan

## Purpose

This document proposes the next-stage architecture for Veryfront styles handling.
It is explicitly aimed at fixing preview cold-start latency without sacrificing:

- Tailwind JIT correctness
- live-edit correctness
- cross-pod CSS serving
- clean responsibility boundaries
- convention-first product ergonomics

The core principle is simple:

**project-wide style work must move off the request path, while JIT correctness stays intact through versioned candidate manifests and versioned CSS artifacts.**

## Current Problems

Today the main stylesheet path still does too much work on demand:

- `/_vf_styles/styles.css` loads the project stylesheet and then calls `extractProjectCandidates()`
- `extractProjectCandidates()` depends on `getAllSourceFiles()`
- `getAllSourceFiles()` depends on the cached full file list
- when that cache is cold, invalidated, or missing on a fresh pod, the system falls back into whole-project work on a live request

This is correct but too expensive.

The current implementation already has good building blocks:

- framework candidates are pre-extracted at build time
- project candidate manifests already exist in memory
- project CSS is already cached by project/profile/candidate hash
- hashed CSS already supports cross-pod regeneration via `/_vf/css/{hash}.css`
- websocket pokes already provide `changedPaths`

The missing piece is architectural: these parts are not yet arranged around a durable, versioned JIT pipeline.

## Constraints

Any replacement must satisfy all of the following:

- uncached preview requests must still be fast
- new classes introduced by live edits must appear reliably
- a missing CSS hash on one pod must still be recoverable from shared inputs
- runtime file resolution must remain separate from style/indexing ignore rules
- projects should not need extra config files by default
- API should remain primarily a data/control-plane service
- project-wide derivation work should live in project workers/jobs, not inline API requests
- no intentionally incomplete route-only CSS hacks

## Non-Goals

- doing Tailwind extraction in SQL
- making `runtime` route/module resolution depend on style ignore rules
- requiring `.veryfrontignore` or `veryfront.config.ts` for normal projects
- serving stale CSS after edits just to make requests look faster

## Current Pipeline

```text
request
  -> /_vf_styles/styles.css
  -> load stylesheet
  -> get all project source files
  -> extract Tailwind candidates from all source files
  -> compile CSS
  -> cache by project + stylesheet + candidates hash
```

This is safe, but whole-project candidate extraction still sits too close to the hot path.

## Target Architecture

```text
file changes / publish / preview init
  -> content version resolved
  -> candidate manifest prepared for that version
  -> CSS artifact prepared for that version

request
  -> resolve current content version
  -> fetch versioned CSS artifact
  -> serve immediately

fallback only on miss
  -> regenerate from cached manifest inputs
  -> persist artifact
```

The key change is that the request path consumes precomputed style state instead of building it from scratch.

## Responsibility Split

### API

The API remains the source of truth for:

- files
- branches
- releases
- environments
- content metadata and change events
- artifact metadata lookup
- job orchestration

The API should not become the place that performs heavy Tailwind extraction or compilation inline.

### Project Workers / Jobs

Project workers own project-wide derived style state:

- per-file candidate extraction
- project candidate manifest assembly
- project CSS artifact generation
- invalidation and recomputation after file changes or publish events

This is the right place for expensive work because it is:

- project-scoped
- versioned
- asynchronous
- reusable across pods

### Preview Runtime (`veryfront-code`)

The preview/runtime layer should only:

- resolve the active content version
- load the already-prepared candidate manifest or CSS artifact
- serve CSS quickly
- perform incremental preview-specific updates when `changedPaths` arrive
- keep a safe fallback regeneration path for misses

It should not do a full project crawl on demand unless it is recovering from an exceptional miss.

## JIT Model

Veryfront should keep a JIT architecture, but the JIT unit must become a **content version**, not an individual request.

That means:

- when a project version changes, the candidate manifest changes
- when the candidate manifest changes, the CSS artifact hash changes
- HTML and `/_vf_styles/styles.css` should resolve to the current version's artifact
- `/_vf/css/{hash}.css` remains the immutable delivery path

JIT correctness is preserved because CSS is always generated from the full candidate set for the current content version.

The architecture should not degrade into “best effort route CSS” for preview correctness.

## Candidate Manifest Model

The current in-memory manifest is the right seed, but it needs a durable shape.

### Manifest contents

A manifest should contain:

- `projectScope`
- `contentVersion`
- `styleProfileHash`
- `frameworkCandidatesHash`
- `fileCandidates`
- `projectCandidates`
- `builtAt`

### `fileCandidates`

Per-file candidates are the critical primitive because they let us update the project set incrementally.

When `changedPaths` arrives:

1. fetch only the changed files
2. re-extract candidates for those files
3. replace those file entries in the manifest
4. recompute the aggregated project candidate hash
5. rebuild the project CSS artifact

That keeps preview JIT live-update behavior fast without rescanning the whole project.

### `contentVersion`

The ideal version key is explicit and API-provided.

Preferred order:

1. release id for release content
2. environment release id for environment content
3. branch content version from the API
4. temporary fallback: branch-scoped file-list digest

Long term, the API should expose a first-class branch content version instead of forcing the runtime to infer it.

## CSS Artifact Model

Each artifact should be keyed by:

- `projectScope`
- `contentVersion`
- `stylesheetHash`
- `candidatesHash`
- `styleProfileHash`
- build profile bits such as `minify`, `environment`, and `buildMode`

This is already close to how `project-css-cache.ts` behaves today. The missing change is where those inputs are produced.

### Delivery paths

Keep both paths, but change their roles:

- `/_vf/css/{hash}.css`
  - immutable artifact delivery
  - cross-pod safe
  - preferred final asset path
- `/_vf_styles/styles.css`
  - compatibility endpoint for preview
  - should resolve the current version's prepared artifact
  - should not trigger a whole-project scan on a healthy path

## Conventions First, Config Optional

The default experience should not require new project files.

### Built-in conventions

For style extraction only, Veryfront should ship with a default non-runtime ignore profile.

Good default candidates:

- `knowledge/**`
- `coverage/**`
- `dist/**`
- `build/**`
- generated export folders
- `.git/**`
- `node_modules/**`

These conventions must apply only to style/indexing work, not runtime module resolution.

They also must not hide configured route roots. If a directory is being used as
`app`, `pages`, or any other configured runtime content root, it must stay in
the style candidate graph even if its name would otherwise look documentation-like.

### Optional config

If users need exceptions, they should be able to opt out or extend conventions with optional config later.

Example direction:

```ts
export default defineConfig({
  styles: {
    include: ["knowledge/design-system/**"],
    ignore: ["docs/archive/**"],
  },
});
```

This should be an override layer on top of conventions, not a requirement for normal projects.

## Live Edit Flow

For branch previews, live edits need low latency and strict correctness.

Target flow:

```text
websocket poke
  -> changedPaths received
  -> fetch only changed files
  -> update candidate manifest entries
  -> rebuild current branch CSS artifact
  -> invalidate current preview CSS pointer
  -> trigger CSS refresh / HMR
```

Important detail:

the CSS refresh should point to the new artifact only after the new artifact exists.

That avoids the “fast but stale” failure mode where HTML or HMR references a hash that another pod cannot yet serve.

## Publish / Release Flow

Release and environment content are a better fit for worker-owned upfront work.

Target flow:

```text
publish / deployment
  -> API records new content version
  -> project worker builds candidate manifest
  -> project worker builds CSS artifact
  -> artifact metadata becomes available
  -> preview/runtime serves artifact directly
```

This removes the current tendency to do first-hit generation after deploy.

## Fallback Rules

Fallbacks should exist, but they should be exceptional and observable.

### Allowed fallback

- regenerate CSS by hash from cached manifest inputs
- perform a one-off synchronous compile when artifact metadata is missing but manifest inputs are available

### Disallowed fallback

- full project rescans on every cold request
- serving stale CSS after a live edit that adds new classes
- silently shrinking candidate scope to make latency look good

## Proposed Rollout

### Phase 1: Style profile and conventions

- introduce a `StyleScopeProfile`
- bake in convention-based ignores for style extraction
- include the style profile hash in candidate/CSS cache keys
- keep runtime resolution untouched

### Phase 2: Durable candidate manifests

- persist per-file candidate manifests by project scope + content version + style profile
- continue using the existing extractor logic
- keep the current in-memory manifest as a local fast path, but back it with durable data

### Phase 3: Preview incremental JIT updates

- update branch manifests incrementally from websocket `changedPaths`
- regenerate branch CSS artifacts from the updated manifest
- make `/_vf_styles/styles.css` resolve the prepared artifact instead of rescanning

### Phase 4: Worker-generated release artifacts

- move release/environment candidate and CSS artifact generation to project workers
- make publish/deploy flows populate artifacts ahead of traffic

### Phase 5: API content-version support

- expose explicit branch content versions
- expose artifact metadata lookup
- stop relying on runtime-inferred file-list digests where possible

## Why This Is Better

This architecture keeps the things that already work:

- immutable hashed CSS
- cross-pod regeneration
- Tailwind JIT candidate-based compilation
- websocket-driven live updates

And changes the part that is currently too expensive:

- whole-project candidate preparation moves off the request path

In short:

- API stays mostly data/control plane
- workers own durable project-wide derivations
- preview/runtime becomes a fast consumer plus incremental preview updater

That is the cleanest path to fast uncached preview, correct live updates, and a JIT model that remains rock solid instead of request-path heavy.
