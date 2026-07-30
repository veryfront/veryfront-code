# Plan: `veryfront/ui` + `veryfront/chat` to spec

> **North star:** an amazing component library for open-source Veryfront users —
> so they can easily build and compose agentic apps. Bring `veryfront/ui` and
> `veryfront/chat` fully to spec (PRs #2980 + #3090), backward-compatibly, with a
> bring-your-own-engine adapter system, a complete primitive set, and full docs +
> stories + tests.

Everything for this effort lives here. Start with the handoff.

## Documents

| File                                                                                                             | What it is                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`handoff.md`](./handoff.md)                                                                                     | **The brief.** Repos/setup, spec-doc paths, locked decisions, current state, full work-breakdown, the 10 goals, per-iteration protocol, key files + gotchas. Read this first. |
| [`loop-goal.md`](./loop-goal.md)                                                                                 | The `/loop` prompt — paste it after `/loop` to run the plan autonomously.                                                                                                     |
| [`target-file-tree.md`](./target-file-tree.md)                                                                   | What this branch's file tree should look like when the goal is met.                                                                                                           |
| [`ui-spec.md`](./ui-spec.md) · [`ui-matrix.md`](./ui-matrix.md)                                                  | `veryfront/ui` definition-of-done + per-primitive tracker.                                                                                                                    |
| [`chat-spec.md`](./chat-spec.md) · [`chat-matrix.md`](./chat-matrix.md) · [`chat-tickets.md`](./chat-tickets.md) | `veryfront/chat` DoD + the 25-component / 33-hook tracker + batch tickets.                                                                                                    |

## The deterministic gate (TDD — red first, work to green)

The source of truth for "done" is a **coverage test suite** that enumerates every
component/hook and asserts it is exported, has a Storybook story, is documented,
(if interactive) is adapter-covered, and meets the composition rules (one node,
`forwardRef`, `{...props}` spread, `asChild`, no `xxxClassName`/`xxxProps` bags):

- `src/react/components/ui/coverage.test.tsx`
- `src/react/components/chat/coverage.test.tsx`

These start mostly **RED**. Each loop iteration turns rows green. Run them:

```bash
DENO_TESTING=1 VF_DISABLE_LRU_INTERVAL=1 NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all --unstable-worker-options --unstable-net \
  src/react/components/ui/coverage.test.tsx src/react/components/chat/coverage.test.tsx
```

## Spec sources (RFCs)

- **#3090** (ui adapters, MERGED): `docs/rfcs/0001-ui-primitive-adapters.md` (on `main`).
- **#2980** (chat API shape, OPEN): only on branch `rfc/chat-api-shape` —
  `git show rfc/chat-api-shape:docs/rfcs/29-chat-api-shape.md`.
