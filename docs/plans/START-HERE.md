# START HERE — implementing the `veryfront/chat` composition overhaul

Kickoff handoff for the engineer/agent picking up the implementation. Read this,
then the [full plan](./2026-07-08-chat-composition-overhaul.md), then load the
`composition-patterns` skill (the canonical reference the plan maps to).

## 1. Current state — two open PRs
- **PR #2798** (`mattboon/veryfront-ui-namespace`) — promotes the 39 UI
  primitives to a public **`veryfront/ui`** package (the base-layer split).
  Green; all review rounds addressed; **basically ready — awaiting re-review**
  to clear `CHANGES_REQUESTED`. This is the base everything stacks on.
- **PR #2809** (`mattboon/chat-composition-plan`, stacked on #2798) — **this
  docs folder**: the plan + brief + this handoff.

## 2. Where everything lives
- **The plan:** [`2026-07-08-chat-composition-overhaul.md`](./2026-07-08-chat-composition-overhaul.md)
  — 13 epics (E0–E11), each with tasks / quality gates / tests / acceptance
  criteria; dependency graph; metric ratchets; smell audit; canonical alignment.
- **Source brief:** [`2026-07-08-chat-composition-handoff.md`](./2026-07-08-chat-composition-handoff.md) (§A–§K).
- **Canonical reference:** the `composition-patterns` skill (v1.0). Load first.
- **Extend, don't reinvent:** `scripts/lint/audit-chat-composability.ts` (static
  contract) + `src/react/components/chat/chat/composability.contract.test.tsx`
  (runtime contract).
- **Main smell targets:** `src/react/components/chat/chat/index.tsx` (1,153 LOC,
  26 `@deprecated`, ~117 props), `message.tsx` (970/92 props), `sidebar.tsx`,
  `chat-composer.tsx`.

## 3. Locked decisions (do not relitigate)
- **Q1** No version bump anywhere in this work — release/version is decided
  separately after merge.
- **Q2** Zero behaviour-booleans; modes are explicit *variant components*, not
  flags (`composition-patterns` §1.1/§3.1).
- **Q3** Persistence: ship server `onFinish` + client `useConversationChat`
  **together** (E3).
- **Q4** UI primitives = composable/no-black-box; three-tier stories = **chat
  components only**.
- **Q5** Docs-first: component *redesign* (E1/E4/…) waits until the design specs
  are reviewed. Infra / gates / type-fixes do **not** wait.
- **Q6** Track progress in these md plan files; no GitHub issues.

## 4. First implementation PR — E0 slice: G1 (children types) + `tsc` gate
Non-breaking; doesn't touch component design; unblocks everything.

1. **Branch off #2798:** `git checkout -b <name> mattboon/veryfront-ui-namespace`.
2. **Reproduce §G first** (disciplined — `deno check` passes today because it's a
   consumer-`tsc` issue). Environment facts: `tsc` is at
   `storybook/node_modules/.bin/tsc`; `@types/react` is **19.2.17** (React-19
   types, where `HTMLAttributes` no longer carries `children`). Write a tiny
   consumer usage (`<AppShell><div/></AppShell>`, `<ChatEmptyState.Root>…`) and
   run `tsc --noEmit`. Confirm the `children does not exist on AppShellProps /
   ChatEmptyStateRootProps` errors. **If it does not reproduce, stop and report**
   — don't invent a fix.
3. **Fix G1:** explicitly declare `children: React.ReactNode` on every compound
   props interface that `extends HTMLAttributes` (confirmed: `AppShellProps`,
   `AppShell.Sidebar/Header`, `ChatEmptyState*`; sweep for the rest).
4. **Add the gate:** a `tsc --noEmit` task/CI job over the public entry types +
   a `stories` tsconfig, wired into `verify`, so documented composition stays
   type-clean.
5. **Verify:** tsc gate green; `deno task typecheck`, `fmt:check`,
   `storybook:check`, unit tests all green.

**Then, in order (separate PRs):** rest of E0 (ratchet-lint baselines for
feature-toggle / passthrough / forwardRef; storybook three-tier harness;
composability-contract extension; K0 collections doc) → **E0.5 characterization
tests** (safety net over the god file — MUST precede E1/E3) → E2 (React-19
`forwardRef` codemod, parallelizable) → E1 (context spine) → E3 (state glue) →
E4/E5/E6 (depth) → E8/E9/E10 (breaking batch + codemod + migration guide).

## 5. Working agreement
- **Gates as ratchets:** each anti-pattern gets a lint seeded with today's
  violations as a baseline that only shrinks.
- **Ratchet-then-batch breaking:** land additive replacements + deprecate; batch
  all removals (§B/§E/§H) into one breaking PR with a codemod + migration guide.
- **The acid test is the bar:** every leaf overridable in place without
  re-implementing its parent — encode it as concrete contract tests.
- **Highest-conviction change = E3:** the shipped persistence
  `useEffect(…sink…)` is a line-for-line match for `composition-patterns` §2.3's
  "useEffect to sync state up" anti-pattern; the fix (lift into a provider) is
  prescribed.

## 6. Open flags to confirm with reviewers (carried from #2798)
- `veryfront/ui/icons` was exposed as a public subpath (surfaced by a story
  teaching a never-real `veryfront/chat/icons`). Revertible if the team doesn't
  want the icon set public yet.
- `veryfront/ui`'s theming scope is still `[data-vf-chat]` (deliberate compat
  shim, noted in `design-tokens.ts`); neutral `[data-vf-ui]` migration is a
  tracked follow-up (a candidate for the E8/E9 breaking batch).
