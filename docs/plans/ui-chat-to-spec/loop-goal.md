# Loop goal — `veryfront/ui` + `veryfront/chat` to spec

Paste the block below after `/loop` (no interval = self-paced). Each firing does
one verified, committed slice, until the **coverage suite is fully green**.
**Full detail is in [`handoff.md`](./handoff.md)** — the goal below is deliberately
explicit about scope; the handoff has the paths, lists, decisions, and gotchas.

**The matrix and the goal are the tests.** `src/react/components/{ui,chat}/coverage.test.tsx`
enumerate every component/hook/variant and assert exported · storied · documented ·
tested · adapter-covered · composition-rules. Run them to see what's left (every red
row = a todo); "done" = the whole suite is green. There is no separate tracker to
hand-maintain.

---

**GOAL — build an amazing, complete, open-source component library for Veryfront so users can easily build and compose agentic apps: bring `veryfront/ui` + `veryfront/chat` fully to spec (PRs #2980 + #3090), backward-compatibly.**

Repo `/Users/mattboon/Sites/veryfront-code`, branch `feat/ui-chat-to-spec` (PR #3185). **First read `docs/plans/ui-chat-to-spec/handoff.md`** — it has repos/setup + LOCALDEV testing, the RFC spec-doc paths (#3090 = `docs/rfcs/0001-ui-primitive-adapters.md` on `main`; #2980 = `docs/rfcs/29-chat-api-shape*` only on branch `rfc/chat-api-shape`), locked decisions, current state, the full **Work breakdown**, and testing/CI gotchas. Treat the two RFCs as the source of truth for "to spec", and the coverage suite as the deterministic definition-of-done.

## Everything in scope (each item → build + story + docs + tests + review)

- **`veryfront/ui` — all existing components to spec** (Button, Input, Card, Popover, Dialog, DropdownMenu, Tooltip, Select, Command, Tabs, Collapsible, Drawer, AppShell, … — full list in the handoff).
- **`veryfront/ui` — new primitives** filling the gaps vs Base UI / Radix / shadcn's set: Combobox, Autocomplete, Accordion, HoverCard, ContextMenu, Toast, Toggle, ToggleGroup, Separator, Slider (+ Menubar, NumberField, AspectRatio, …).
- **`veryfront/chat` — all 25 components + ~33 hooks to spec**, with L1/L2/L3 composition (enumerated as rows in `src/react/components/chat/coverage.test.tsx`).
- **Adapters** — vendored templates under `cli/templates/ui-adapters/` for the full engines **Base UI** (flagship, finish to 5/5 first), **Radix**, **React Aria**, **Ariakit**; plus specialist per-primitive adapters **Vaul** (Drawer), **Sonner** (Toast), **cmdk** (Command/Combobox), **react-day-picker** (Calendar). Builtin is the zero-dep default. **shadcn is NOT an adapter** (a distribution posture); **no Zag.js/Ark.**
- **Storybook** — a story for every ui + chat component (`storybook/stories/{ui,chat}/`, `deno task storybook`).
- **Documentation** — a concise, focused, shadcn/Vercel-style page for every component + hook + the adapter system, written with the **`/docs-writer` skill** (`docs/guides/`).
- **Tests** — component-conformance harness, per-hook behaviour, adapter builtin-vs-swap, freeze tests (`ui/index.test.ts`, `src/chat/index.test.ts`).
- **Reproductions — `veryfront-router-testing`** — L1/L2/L3 chat example apps (L1 = no config), tests validating each, **zero client + server errors** against this branch, and an **adapter interop test bed** (swap engines via `UIAdapterProvider`, verify across builtin / Base UI / Radix / React Aria / Ariakit).
- **Reviews** — run **`/composition-patterns`, `/code-review`, `/security-audit`** (and `/code-review ultra` for the branch) over changed code; fix findings.
- **Public surface + CLI** — clean exports, no breaking changes, `@deprecated` used well; the `veryfront` CLI starter chat template uses the new components and works.

## Each loop iteration (see handoff → "Per-iteration protocol")

1. **If PR #3185 is red / conflicts with `main`:** top priority — `git fetch origin main`, rebase/reconcile the adapter layer onto `main`'s #3176/#3056 primitives, get it green. Before anything else.
2. Else run the coverage suite and pick **ONE** red row — the highest-leverage failing assertion (finish Base UI 5/5 first, then go area by area).
3. Take it fully to done: **build to the composition rules** (one node · `forwardRef` · `{...props}` · `asChild` · `data-*` · no `xxxClassName`/`xxxProps` bags) with **`/react-component` + `/react-best-practices`** → **Storybook story** (one file per component, one Story per cva variant) → **docs via `/docs-writer`** → **tests** → **review with `/composition-patterns` + `/code-review` + `/security-audit`**, fixing findings.
4. **Verify:** `deno check` + `deno fmt` + `deno lint` on changed files; tests green; both freeze tests pass.
5. **Commit + push** to `feat/ui-chat-to-spec` (revert `deno.lock`/`*.generated.ts` churn; `--no-verify` only if the sole failure is the known `mcp/tools/deploy-tool` flake).
6. **Re-run the coverage suite** — the row is now green. Repeat.

**Non-negotiables:** backward compatibility is mandatory — never delete public API; add the new shape and mark old `@deprecated`. Builtin is the zero-config default; engines are opt-in via `UIAdapterProvider` only (no config alias). No Zag.js; shadcn is not an adapter. Keep `useMessageBranches`.

**Stop when:** the coverage suite is fully green (every component/hook/variant exported · storied · documented · tested · adapter-covered · composition-rules), all 10 handoff goals meet their acceptance criteria, PR #3185 is green + reviewed, and the `veryfront-router-testing` examples pass with zero errors. On a genuine blocker or a decision only the user can make, stop and surface it rather than guessing.
