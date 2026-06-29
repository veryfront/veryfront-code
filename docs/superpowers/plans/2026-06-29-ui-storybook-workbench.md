# UI Storybook workbench implementation plan

> **For Codex:** Execute this plan directly. Use test-driven changes, keep Storybook isolated from framework exports, and verify with the commands listed below.

**Goal:** Add a dev-only Storybook workbench for Veryfront Code UI components so the shipped components can be reviewed visually without moving UI source out of `src/react` or changing the public API.

**Architecture:** `src/react` remains the source of truth for shipped UI. A new `storybook/` package contains Storybook config, package metadata, docs preview styles, fixtures, and stories. Root Deno tasks call into that package.

**Tech stack:** Storybook React Vite, React 19, Vite 6, and Storybook 10 versions aligned with veryfront-studio.

### Step 1: Lock package-boundary behavior with tests

- Add `scripts/storybook/storybook-workbench.test.ts`.
- Assert that `deno.json` still exports `./chat` from `./src/chat/index.ts`.
- Assert that `deno.json` does not expose a public `./react` export.
- Assert that Storybook strings do not appear in public exports or imports.
- Assert that `storybook/` is excluded from Deno package scanning.
- Assert that root tasks delegate to `npm --prefix storybook`.
- Assert that required stories exist and import real source modules.

### Step 2: Add dev-only Storybook package

- Add `storybook/package.json` with `private: true`.
- Add scripts:
  - `storybook`
  - `build-storybook`
- Add dev dependencies scoped only to this package:
  - `@storybook/react-vite`
  - `@vitejs/plugin-react`
  - `storybook`
  - `typescript`
  - `vite`
  - `react`
  - `react-dom`
- Do not add Storybook dependencies to root Deno imports, exports, or runtime source.

### Step 3: Configure Storybook for Veryfront source imports

- Add `storybook/.storybook/main.ts`.
- Add `storybook/.storybook/preview.tsx`.
- Add `storybook/.storybook/veryfront-aliases.ts`.
- Configure Vite aliases for:
  - `veryfront/chat`
  - `veryfront/react/components/chat`
  - `veryfront/components/chat`
  - `veryfront/head`
  - `veryfront/mdx`
  - `#veryfront`
  - `#veryfront/*`
- Keep aliases local to Storybook.

### Step 4: Add fixtures and stories

- Add reusable fixtures under `storybook/stories/fixtures/`.
- Add chat preset stories for empty, active, loading, error, tool, source, and model states.
- Add composition stories for the compound and composition APIs.
- Add subcomponent stories for tool cards, sources, reasoning, quick actions, message actions, badges, upload pills, model selector, and markdown/code states.
- Add sidebar stories for conversation list, tabs, attachment panel, and model picker wiring.
- Add primitive stories for `src/react/primitives`.
- Add framework component stories for optimized image, MDX provider, and head usage.

### Step 5: Add root tasks and docs

- Add `storybook/` to `deno.json#exclude`.
- Add root tasks:
  - `storybook`
  - `build:storybook`
  - `storybook:check`
- Add `docs/guides/storybook-ui-workbench.md`.

### Step 6: Verify

- Run the contract test before implementation and confirm it fails for missing Storybook files.
- Run `deno task storybook:check`.
- Install Storybook package dependencies if needed with `npm --prefix storybook install`.
- Run `deno task build:storybook`.
- Run a focused Deno check for the public chat surface: `deno check src/chat/index.ts src/react/components/chat/index.ts src/react/primitives/index.ts src/react/components/index.ts`.
- Run `git diff --check`.

### Risks and mitigations

- **Storybook cannot resolve Deno import-map aliases.** Mitigate with explicit Vite aliases in `storybook/.storybook/veryfront-aliases.ts`.
- **Storybook dependencies leak into core.** Mitigate with an isolated `storybook/package.json`, contract tests, and no changes to public exports.
- **Stories diverge from real components.** Mitigate by importing `veryfront/chat` or real `src/react` barrels only.
- **`veryfront/react` public API ambiguity.** Defer any `./react` export change to a separate API compatibility task.
