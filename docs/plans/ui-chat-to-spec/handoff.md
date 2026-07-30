# Handoff — `veryfront/ui` + `veryfront/chat` to spec (PRs #2980 + #3090)

> **North star:** an amazing component library for open-source users of
> Veryfront — so they can easily build and compose agentic apps. A better shadcn +
> AI Elements: drop-in at L1, compose at L2, go headless / bring-your-own-engine
> at L3, with real accessibility and complete, well-documented primitives.

You are continuing a large, multi-session effort to bring `veryfront/ui` and
`veryfront/chat` fully to the RFC spec, with a bring-your-own-engine adapter
system, a complete primitive set, full docs + stories + tests, and working
example apps. Work **backward-compatibly** throughout.

## How to use this doc (agents)

Read top-to-bottom once, then work from **[Work breakdown](#work-breakdown--everything-in-scope)**
(what to build) and the **`_impl/matrix.md` trackers** (what's left). Each section:

| Section                                                                | Use it for                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| [Repos & setup](#repos--setup)                                         | paths, remotes, PRs, how to run example apps locally  |
| [Spec documents](#spec-documents-read-these-first)                     | the RFCs = source of truth for "to spec"              |
| [Locked decisions](#locked-decisions--respect-these)                   | constraints you must not violate                      |
| [Current state](#current-state)                                        | what's done + the merge blocker (do the rebase first) |
| [Work breakdown](#work-breakdown--everything-in-scope)                 | the full explicit scope, area by area                 |
| [The goal](#the-goal-acceptance-criteria)                              | the 10 acceptance criteria                            |
| [Per-iteration protocol](#per-iteration-protocol)                      | the exact loop to run each time                       |
| [Key files](#key-files--conventions) / [Gotchas](#testing--ci-gotchas) | where things live, how not to break the build         |

---

## Repos & setup

| Repo               | Path                                                                 | Remote                              | Role                                                                                                      |
| ------------------ | -------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Framework          | `/Users/mattboon/Sites/veryfront-code`                               | `veryfront/veryfront-code`          | `veryfront/ui` + `veryfront/chat` live here                                                               |
| Reproducer harness | `/Users/mattboon/Sites/veryfront-examples/veryfront-router-testing`  | `mattboon/veryfront-router-testing` | example apps run against LOCAL framework source                                                           |
| Reference app      | `/Users/mattboon/Sites/veryfront-examples/customer-operations-agent` | —                                   | a real consumer (uses `<Chat>` + shell)                                                                   |
| Issue tracker      | (GitHub only)                                                        | `veryfront/veryfront-issue-inbox`   | file/find issues here — **NOT** `veryfront-code`; use `gh issue … --repo veryfront/veryfront-issue-inbox` |

**Open PRs (in progress):**

- Framework: **veryfront/veryfront-code#3185**, branch `feat/ui-chat-to-spec`. **Currently RED — it conflicts with `main`** (see "Merge situation" below). Commit further framework work on this branch and push.
- Harness: **mattboon/veryfront-router-testing#8**, branch `feat/chat-adoption-demos`.
- Spec PRs: **veryfront/veryfront-code#3090** (ui adapters, merged) · **#2980** (chat API shape, open).

**Run the framework locally** (from `/Users/mattboon/Sites/veryfront-code`; runtime is **Deno**, tested 2.7.x + Node 22):

```bash
deno task dev          # run the veryfront dev server on this source
deno task storybook    # the Storybook UI workbench (stories live in storybook/stories/{ui,chat})
deno task test:unit    # unit tests (src + cli)
deno check <files>     # typecheck   ·   deno fmt <files>   ·   deno lint <files>
```

Run a single test file with:

```bash
DENO_TESTING=1 VF_DISABLE_LRU_INTERVAL=1 NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all --unstable-worker-options --unstable-net <files>
```

**Running the example apps** (`veryfront-router-testing`) **against local framework
source** (from `veryfront-router-testing/LOCALDEV.md`, "Method 1"):

```bash
cd <subproject>            # e.g. chat-blackbox
rm -rf .cache
deno run --allow-all /Users/mattboon/Sites/veryfront-code/cli/main.ts dev --port <port>
```

It serves `veryfront/*` straight from your working tree — edits are live on the
next request. The dev server is a finicky TUI with no headless flag; keep it alive
with `tail -f /dev/null | <cmd>` and poll `curl` for readiness. Existing chat demo
ports: `chat-blackbox` 3020, `chat-custom-ui` 3022, `chat-full-custom` 3023.
`check-chat-demos.sh` boots all three and asserts they SSR-render.

---

## Spec documents (read these first)

The two RFCs are the source of truth for "to spec":

- **#3090 — RFC 0001, "Bring-your-own UI primitive adapters"** (MERGED):
  `docs/rfcs/0001-ui-primitive-adapters.md` (on `main`). Its §6 = the adapter
  contract; §7 = Base UI flagship + rollout order; §13 = the mid-2026 engine
  survey (Base UI / Radix / React Aria / Ariakit / Zag comparison, primitive
  coverage, SSR/Deno notes).
- **#2980 — RFC, "`veryfront/chat` API shape"** (OPEN): lives **only on branch
  `rfc/chat-api-shape`**, not on `main` or the working branch. Read it with
  `git show rfc/chat-api-shape:docs/rfcs/29-chat-api-shape.md` and the per-piece
  pages under `git show rfc/chat-api-shape:docs/rfcs/29-chat-api-shape/`
  (25 component pages + ~33 hook pages, plus the RFC's "Hard rules", "Cross-cutting
  contracts", "Conformance & testing", and "L1→L2→L3 adoption journey" sections).
  **Step zero of chat work: land those docs onto the working branch or read them
  cross-branch.**
- **Implementation tracking** (on `feat/ui-chat-to-spec`):
  `docs/plans/ui-chat-to-spec/ui-{spec,matrix}.md` and
  `docs/plans/ui-chat-to-spec/chat-{spec,matrix,tickets}.md` — the
  distilled per-piece definition-of-done + a matrix of all 25 components + 33 hooks
  with gate columns (Spec/Built/Story/Test/Styled/Verified). Update the matrix as
  you go.
- **Full plan:** `/Users/mattboon/.claude/plans/snappy-wibbling-quokka.md` (the
  approved multi-phase plan this handoff summarises).

---

## Locked decisions — respect these

1. **Backward compatibility is MANDATORY. Never delete public API.** Add the new
   canonical shape alongside the old; mark old `@deprecated`. A guard test
   (`src/react/components/chat/blackbox-contract.test.tsx`) freezes the consumed
   `<Chat>` surface. Only `<Chat>` + `AppShell`/`ChatSidebar`/`ChatThemeScope`/
   `ConversationsProvider`/`Tabs`/`TabsItem`/`AttachmentsPanel` + `useChat`/
   `useUploadsRegistry`/`createChatUploadHandler` are externally consumed — deep
   internals can be reshaped freely, but keep these importable.
2. **Default engine = builtin (zero-config, zero-dep).** `useAdapter()` returns
   builtin with no provider. **Base UI is the recommended engine you opt into**,
   not auto-applied.
3. **Adapter swap = runtime `UIAdapterProvider` ONLY.** Do NOT build a
   `ui: { adapter: "..." }` config/build-time alias — it was dropped.
4. **NO Zag.js/Ark.** Primitive expansion = our Skin + a real engine adapter
   (Base UI etc.), or a trivial builtin for pure-visual ones.
5. **`useMessageBranches` / branches is a real feature** (backed by `useChat`'s
   `getBranches`/`switchBranch` + regenerate state). Keep it.
6. **Composition rules (RFC 2980 Hard Rules)** every component must meet: renders
   **one** DOM node (or zero + context); `forwardRef` (React 19 ref-as-prop) to
   that node; spreads `{...props}`; **no `xxxClassName`/`xxxProps` bags**; `asChild`
   on behavioural parts; state via `data-*` not boolean styling props; handlers
   compose, `className` merges (consumer wins), `ref` composes.

---

## Current state

**Done + committed on `feat/ui-chat-to-spec`** (all `deno check`/lint/fmt clean,
tests green):

- Adapter layer: `src/react/components/ui/adapter/` — `contract.ts` (PopoverParts,
  DialogParts, MenuParts, TooltipParts, SelectParts), `context.tsx`
  (`UIAdapterProvider`/`useAdapter`), `token-scope.tsx` (`useTokenScope`),
  `builtin/*` (builtin adapters for all 5 overlay primitives). Conformance tests
  run each primitive on the builtin AND the `UIAdapterProvider` swap path.
- Engine-off-core CI guard in `ui/boundary.test.ts`.
- Base UI reference adapter **template** at `cli/templates/ui-adapters/base-ui.tsx`
  — **covers only `popover` + `dialog`** (menu/tooltip/select MISSING).
- Chat additive port: `ref`/`{...props}`/`asChild` across every compound; new hooks
  `useChatInput` (L3 headless + prop-getters), `useChatScroll` (superset of
  `useStickToBottom`), `useMessageBranches`, `useChatInputContext`; icon→children
  override on action leaves. Old names kept `@deprecated`.
- Docs: `docs/guides/ui-components.md` (new), `docs/guides/chat-hooks.md` (updated).
- Example apps: `chat-blackbox` (L1), `chat-custom-ui` (L2), `chat-full-custom`
  (L3, Base UI swap) — all boot + SSR-render vs local source.

**Merge situation (BLOCKING #3185):** `main` shipped overlapping work while this
branch was built — **#3176** ("anchor floating surfaces to the trigger ref instead
of a wrapper span"), **#3056** ("one `useDisclosure` and shared Modal/Anchored
surfaces"), **#2798** ("promote chat/ui primitives to a public `veryfront/ui`
package"). The adapter layer must be **rebased onto `main`'s new primitives**
(build the builtin adapter over `main`'s span-less, trigger-ref machinery). Conflicts
are in `floating.tsx`, `popover.tsx`, `dropdown-menu.tsx`, `anchored-surface.tsx`.
**First task: `git fetch origin main` and reconcile — this is the top priority.**

---

## Work breakdown — everything in scope

Every item below must reach: **spec-conformant build → Storybook story → docs
(`/docs-writer`) → tests → reviewed (`/composition-patterns` + `/code-review` +
`/security-audit`)**. Track per-item progress in `docs/plans/ui-chat-to-spec/{ui,chat}-matrix.md`.

**A. `veryfront/ui` existing components** (audit + bring to spec):
`Button`, `IconButton`, `Card`, `Badge`, `Pill`, `Tag`, `Avatar`, `Alert`,
`Status`, `List`, `Skeleton`, `Shimmer`, `ProgressBar`, `ScrollFade`, `FileType`,
`Input`, `Textarea`, `Label`, `Checkbox`, `Radio`, `Switch`, `Popover`, `Dialog`,
`Drawer`, `DropdownMenu`, `Tooltip`, `Select`, `Command`, `Tabs`, `Collapsible`,
`AppShell`, `ColorMode*`.

**B. `veryfront/ui` NEW primitives** (fill the gaps vs Base UI / Radix / shadcn):
`Combobox`, `Autocomplete`, `Accordion`, `HoverCard`, `ContextMenu`, `Toast`,
`Toggle`, `ToggleGroup`, `Separator`, `Slider` (add `Menubar`, `NumberField`,
`AspectRatio`, etc. as the survey warrants). Behavioural = Skin + engine adapter;
pure-visual = builtin Skin.

**C. `veryfront/chat` components (25) + hooks (~33)** — the full list is in
`docs/plans/ui-chat-to-spec/chat-matrix.md`. Each to spec with L1/L2/L3
composition, story, docs, tests. Register every compound in
`composability.contract.test.tsx`.

**D. Adapters** — vendored templates under `cli/templates/ui-adapters/`, each with
docs + example/story + tests on the swap path (§7/§13 of RFC #3090):

- **Builtin** — the always-present zero-dependency engine (default; no template).
- **Full engines** (cover all interactive primitives): **Base UI** (flagship —
  finish to 5/5 first, then new primitives), **Radix**, **React Aria**, **Ariakit**.
- **Specialist per-primitive adapters** (best-of-breed for one primitive, the
  "better shadcn" move — the adapter map is per-key so these mix in): **Vaul**
  (Drawer), **Sonner** (Toast), **cmdk** (Command / Combobox), **react-day-picker**
  (Calendar / DatePicker). Add others per primitive as the survey warrants.
- **NOT adapters (do not build as adapters):** **shadcn** is a token/CLI-vendoring
  _distribution_ posture, not an engine — a different axis (RFC #3090 §9); we're
  shadcn-_compatible_ by sitting on the same primitives, nothing to adapter. And
  **Zag.js / Ark** is explicitly out (locked decision #4). shadcn's component set
  is still a useful reference for _which primitives_ to add (section B).

**E. Reproductions — `veryfront-router-testing`:** L1/L2/L3 chat example apps
(scaffolded: `chat-blackbox`/`chat-custom-ui`/`chat-full-custom`; L1 = no config).
Add: tests validating every example (extend `check-chat-demos.sh`; use `sweep.sh`
/ `client-sweep.mjs` / `nav-sweep.mjs`); **zero client + server errors** against
this branch; and an **adapter interop test bed** (a subproject that swaps engines
via `UIAdapterProvider` and verifies render + behaviour across builtin / Base UI /
Radix / React Aria / Ariakit).

**F. Tests:** the shared component-conformance harness (one-node · className merge
· spread-through · handler compose · `asChild` · `ref` · `data-*` · a11y),
per-hook behaviour tests, adapter builtin-vs-swap conformance, demo boot checks,
interop. Keep the freeze tests green (`ui/index.test.ts`, `src/chat/index.test.ts`).

**G. Docs:** concise, focused, shadcn/Vercel-style via **`/docs-writer`** — one
page per component (ui + chat) + the adapter system + each engine adapter. Extend
`docs/guides/ui-components.md`, `chat-ui.md`, `chat-hooks.md`.

**H. Stories:** every ui + chat component in `storybook/stories/{ui,chat}/`.

**I. Reviews:** run `/composition-patterns`, `/code-review`, `/security-audit`
(and `/code-review ultra` for the branch) over changed code; fix findings.

**J. Public surface:** everything exported cleanly, no breaking changes,
`@deprecated` used effectively; both freeze tests pass.

**K. CLI starters:** the `veryfront` CLI starter chat template(s) use the new
components/shape and work perfectly.

## The goal (acceptance criteria)

### 1. `veryfront/ui` — all components to spec

- Every component meets the composition rules (decision #6): one node, forwardRef,
  `{...props}`, no `xxxClassName`/`xxxProps` bags, `asChild` where behavioural.
- Support **L1 / L2 / L3** composition (preset / compose-the-parts / headless).
- **Every** component has a Storybook story (`storybook/stories/ui/*.stories.tsx`;
  `deno task storybook`).
- **Every** component has concise, focused docs via the **`/docs-writer` skill**
  (shadcn/Vercel style — lead with the answer, minimal prose, real examples).

### 2. `veryfront/chat` — all components to spec

- Same as (1) for every chat component + hook. L1 (`<Chat>`), L2 (compose
  `ChatRoot`/`ChatMessageList`/`ChatInput`), L3 (`useChatInput` headless).
- Stories for every chat component (`storybook/stories/chat/`).
- Concise focused docs via `/docs-writer`.

### 3. Adapters for every interactive `veryfront/ui` primitive

- Every behavioural primitive has an adapter contract slot + adapters for the
  **4 engines** the RFC names: **Base UI** (flagship), **Radix**, **React Aria**,
  **Ariakit** — plus specialists (**Vaul** for Drawer, **Sonner** for Toast).
  (Builtin is the zero-dep 5th, always present.)
- Each engine adapter is a vendored template under `cli/templates/ui-adapters/`.
- Docs + examples/stories per adapter. All interactive components covered (finish
  Base UI to 5/5 first: menu, tooltip, select).

### 4. Complete primitive set

- Fill the gaps vs Base UI / Radix / shadcn: **Combobox, Autocomplete, Accordion,
  HoverCard, ContextMenu, Toast, Toggle, ToggleGroup, Separator, Slider** (and
  more as needed). Behavioural ones = Skin + engine adapter (per decision #4);
  pure-visual ones (Separator/Toggle) = builtin Skin.
- Each new primitive: adapter-capable, has stories + examples + docs + tests.

### 5. Tests for everything in 1–4

- Component conformance tests (the shared harness: one-node, className merge,
  spread-through, handler compose, `asChild`, `ref`, `data-*`, a11y) and per-hook
  behaviour tests. Adapters tested on builtin + swap paths.

### 6. `veryfront-router-testing` examples

- L1/L2/L3 chat examples using `veryfront/chat` primitives (L1 = no config).
  (Already scaffolded: `chat-blackbox`/`chat-custom-ui`/`chat-full-custom`.)
- Tests validating all examples (extend `check-chat-demos.sh`; use `sweep.sh` /
  `client-sweep.mjs` / `nav-sweep.mjs`).
- **Zero client or server errors** against the WIP framework branch.
- An **interop test bed for adapters** (swap engines, verify render/behaviour).

### 7. Public surface validation

- Everything exported cleanly, **no breaking changes**, `@deprecated` used
  effectively. Keep the two freeze tests passing: `ui/index.test.ts` and
  `src/chat/index.test.ts` (NOTE: `src/chat/index.ts` uses **explicit re-export
  blocks** — new public exports must be added there AND to the freeze list).

### 8. CLI starter(s) use the new components

- The `veryfront` CLI's starter chat template(s) use the new components/shape and
  work perfectly.

### 9. Every component adheres to spec

- The composition-rules bar (decision #6), verified by tests + the audit approach.

### 10. All code reviewed

- Run the review skills over the changed code and act on findings before merge:
  **`/composition-patterns`** (compound-component / render-prop / context API
  quality, React 19 patterns), **`/code-review`** (maintainability, readability,
  tech debt), **`/security-audit`** (vulnerabilities, unsafe input/DOM handling).
  Also `/code-review ultra` (a.k.a. ultrareview) for the branch/PR. Fix or
  explicitly triage every finding; nothing merges with unaddressed P0/P1s.

---

## Per-iteration protocol

Do exactly this each loop iteration (one small, fully-finished, committed slice):

1. **Rebase gate.** If PR #3185 is red / conflicts with `main`: `git fetch origin
   main`, reconcile the adapter layer onto `main`'s #3176/#3056 primitives, get it
   green. Do this before any feature work.
2. **Pick ONE item** from the [Work breakdown](#work-breakdown--everything-in-scope)
   / `_impl/matrix.md` — the highest-leverage unchecked thing (finish Base UI 5/5
   first, then go area by area).
3. **Build** it to the composition rules (decision #6).
4. **Story** — add/extend its Storybook story in `storybook/stories/{ui,chat}/`
   (`deno task storybook` to verify).
5. **Docs** — write its concise page with the **`/docs-writer` skill** (shadcn/
   Vercel style: lead with the answer, minimal prose, real examples).
6. **Tests** — component-conformance or per-hook behaviour test; adapters tested on
   builtin + swap paths.
7. **Review** — run `/composition-patterns`, `/code-review`, `/security-audit` on
   the change; fix findings.
8. **Verify** — `deno check` + `deno fmt` + `deno lint` on changed files; run the
   relevant tests green; keep both freeze tests passing.
9. **Commit + push** to `feat/ui-chat-to-spec` (revert `deno.lock` /
   `*.generated.ts` churn first; `--no-verify` only if the sole failure is the
   known `deploy-tool` flake).
10. **Tick the matrix** so the next iteration knows what's left. Repeat.

A slice is not "done" until **build + story + docs + tests + review** are all
complete for that item.

## Key files & conventions

- **UI module:** `src/react/components/ui/`. Public entry `veryfront/ui` =
  `src/react/components/ui/index.ts` (freeze test `index.test.ts` — sorted list).
  Adapter: `src/react/components/ui/adapter/`.
- **Chat module:** `src/react/components/chat/` (+ `chat/chat/`). Public entry
  `veryfront/chat` = `src/chat/index.ts` (explicit re-export blocks; freeze test
  `src/chat/index.test.ts`).
- **Shared `asChild` helper:** `src/react/components/ui/slot.tsx` (pattern:
  `const Comp = asChild ? Slot : "button"`).
- **Composability contract test:** `src/react/components/chat/chat/
  composability.contract.test.tsx` — the COMPOUNDS registry; add every new chat
  compound here.
- **Docs:** `docs/guides/*.md` with frontmatter `title`/`description`/`order`
  (unique orders), single H1, cross-links. Index at `docs/guides/index.md`. Use
  the `/docs-writer` and `vf-doc-review` skills.
- **Stories:** `storybook/stories/{ui,chat}/*.stories.tsx`; `deno task storybook`.

## Testing & CI gotchas

- **Run a test file:**
  ```bash
  DENO_TESTING=1 VF_DISABLE_LRU_INTERVAL=1 NODE_ENV=production LOG_FORMAT=text \
    deno test --no-check --allow-all --unstable-worker-options --unstable-net <files>
  ```
- **Typecheck:** `deno check <files>`. **Format:** `deno fmt <files>`.
  **Lint:** `deno lint <files>`.
- **Pre-push hook runs fmt + lint + the FULL suite.** Format/lint your changed
  files before pushing (`git diff main..HEAD --name-only | grep -E '\.(ts|tsx|md)$' | xargs deno fmt`).
- **Known flake:** `mcp/tools/deploy-tool › triggerDeploy happy path` fails in the
  full parallel suite but **passes standalone** — unrelated to UI/chat. If it's the
  only failure, it's the flake; push with `--no-verify` after confirming your own
  files are clean (CI is the real gate).
- **Generated churn:** running tests dirties `deno.lock` and
  `src/server/handlers/dev/framework-candidates.generated.ts` — `git checkout --`
  them before committing.
- **Deno-specific lint:** no `import * as React` if unused (JSX uses react-jsx
  runtime); use `globalThis` not `window`; prefix unused params with `_`.
- The jsdom render harness for component tests is in
  `src/react/components/ui/color-mode.test.tsx` / the `adapter/*.conformance.test.tsx`
  files (jsdom + `createRoot` + `flushSync` + a `waitFor` helper). Overlay surfaces
  portal on a LATER render (after the anchor ref attaches), so open via a trigger
  click, not `defaultOpen`, in tests.

## Recommended order of attack

1. **Rebase `feat/ui-chat-to-spec` onto `main`** and reconcile the adapter layer
   with #3176/#3056 (get #3185 green). Consider rescoping #3185 to the adapter core
   and splitting goals 3–8 into follow-up PRs.
2. Finish **Base UI adapter to 5/5** primitives (menu, tooltip, select).
3. Then iterate goals 1–9: stories → docs (`/docs-writer`) → tests, primitive by
   primitive; expand the primitive set (goal 4); add Radix/React Aria/Ariakit
   adapter templates (goal 3); wire the interop test bed (goal 6).
