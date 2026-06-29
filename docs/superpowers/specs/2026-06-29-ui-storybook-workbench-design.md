# UI Storybook workbench design

Date: 2026-06-29
Owner: Codex
Status: approved for execution

## Goal

Create a Storybook review surface for the UI components shipped by Veryfront Code without moving those components out of the framework runtime source tree and without adding Storybook to the public framework API.

## Decisions

Keep shipped UI source under `src/react`.

Add Storybook as a dev-only workbench in a top-level `storybook/` package. That package imports the real source modules through Vite aliases, but Storybook dependencies remain scoped to `storybook/package.json`.

Keep existing public imports stable:

- `veryfront/chat`
- `veryfront/head`
- `veryfront/mdx`
- `veryfront/router`
- Existing compatibility imports in `deno.json#imports`, including `veryfront/react/components/chat` and `veryfront/components/chat`

Do not add a public `./react` export in this pass. The runtime default import map currently treats `veryfront/react` as a browser-side convenience barrel, while package metadata does not expose it as a public npm subpath. Changing that needs a separate API audit.

Do not move UI to a sibling `ui/` directory. Moving the shipped source would increase import churn, generated build risk, and public API risk without making the components easier to review. The review problem is better solved by adding Storybook around the source that already ships.

## Workbench scope

The first Storybook pass must cover these families:

- Chat preset: `Chat`, loading, error, empty, tool, source, and model states
- Chat composition: `ChatRoot`, `ChatMessageList`, `Message`, `ChatComposer`, `ChatEmpty`, and `ErrorBanner`
- Chat subcomponents: tool cards, sources, reasoning, quick actions, message actions, model selector, upload pills, and status badges
- Chat with sidebar: conversations, tabs, attachments, quick actions, and model picker wiring
- React primitives: containers, message list primitives, input box, submit button, agent status, and tool primitives
- Framework components: `OptimizedImage`, `MDXProvider`, and `Head`

## Constraints

- No Storybook dependency can be added to the framework runtime imports, exports, or browser-safe export patch list.
- Storybook must import real Veryfront source modules, not local duplicated component implementations.
- Root tasks can launch Storybook, but they must delegate into the isolated `storybook/` package.
- The workbench must be buildable for review with `deno task build:storybook`.
- Tests must prove the package boundary and story coverage.

## Acceptance criteria

- `deno task storybook` starts the review server.
- `deno task build:storybook` builds the static Storybook.
- `deno task storybook:check` passes.
- Current public exports/imports for chat and browser-safe modules remain unchanged.
- Storybook stories render all current UI component families through real source imports.
