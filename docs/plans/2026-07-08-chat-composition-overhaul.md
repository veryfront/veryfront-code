# Plan — `veryfront/chat` composition & API overhaul

Source of truth: the handoff brief — [`./2026-07-08-chat-composition-handoff.md`](./2026-07-08-chat-composition-handoff.md) (§A–§K).
Assumes **PR #2798 (`veryfront/ui`) has landed** as the base layer.
This document is the execution plan: **epics → tasks → quality gates → tests → acceptance criteria**, plus the strategy that sequences them. It is intentionally *not* code.

> The handoff is **input, not gospel.** Where its solution is right, we adopt it; where the code shows a deeper problem or a better fix, we diverge (see §0.8 "Where we improve on the handoff" and the "Additional findings" appendix — smells found by auditing the shipped code, not just reading the doc).

---

## 0. Strategic framing (read first)

### 0.1 The one non-negotiable = the acid test
"Change any leaf X on any node Y, in place, without re-implementing its parent Z." Everything below is in service of that. **A principle that isn't enforced by a gate will rot** — so each epic ships an *enforcement mechanism*, not just an implementation.

### 0.2 Definition of Done
**Every exported component (UI primitives + chat) — "composable, no black box":**
1. Presentation is a dumb consumer of `{state, actions, meta}` context or props (no fetching/effects/persistence inside it).
2. Every visual leaf is an addressable sub-component with **one** root `className`.
3. A runtime composability-contract test asserts each leaf is individually overridable without losing sibling behaviour.
4. Public types pass `tsc --noEmit`.
5. No boolean feature toggles, no `*ClassName`/`*Props`/`icons={{}}` bags.

**Chat components — additionally (three-tier + acid-test stories, §J):**
6. Three Storybook tiers (black-box / props / compound) **off one implementation**, plus one explicit "one-leaf-override" acid-test story.

> **Scope (Q4, locked).** `veryfront/ui` primitives must be composable/no-black-box (1–5) but are **not** required to ship the three-tier story set. Chat components carry **both** (1–6). Keeps the ~180-story explosion off the UI kit while still guaranteeing every primitive is reachable.

### 0.3 Breaking-change strategy (the most important strategic call)
The work is ~70% **additive/non-breaking** (§F✅, §G, §I-internal, §A, §C, §D, §K, §J) and ~30% **breaking removals** (§B toggles, §E passthrough props, §H flat API).

**Recommendation: ratchet, then batch.**
- Land *all* additive work first — introduce the compositional replacements so both old (deprecated) and new APIs coexist.
- Add **deprecation lints/ratchets** the moment a replacement exists (freeze the old surface; forbid new usages).
- **Batch every removal (§B/§E/§H) into a single breaking release** with a codemod + migration guide — do **not** dribble breaking changes across many PRs (that's N migrations for consumers instead of one).

### 0.4 Enforcement philosophy — gates as ratchets, not one-time cleanups
Each anti-pattern gets a lint seeded with a **baseline allowlist of today's violations**; the lint fails on any *new* violation and the allowlist only shrinks. This lets us stop the bleeding immediately and burn down incrementally. (Same shape as the repo's existing `check-sanitizer-baseline` / `check-skipped-tests-baseline`.)

### 0.5 Reframes vs. the handoff's phasing
- **§J (Storybook) is infrastructure, not a final phase.** Build the harness + CI gate *first* (E0), then fold the per-component stories into each component epic's DoD.
- **§G splits**: G1 (children types + `tsc` gate — tiny, do first) vs G2 (React-19 `forwardRef` codemod — large, mechanical, parallelizable, independent).
- **§I splits**: I(i) the `{state,actions,meta}` *contract* (spine, foundational) vs I(ii) the per-component dumb-down (folds into §C/§K per component).
- **§K is a house rule**: codify the 4-tier collection pattern once (K0), then application is mechanical per list.

### 0.6 Dependency graph
```
E0 (enablement/gates) ──┬─> E1 (context spine, I-i) ──> E3 (state glue, A) ──> E4/E6 (depth: C/D/K + I-ii)
                        ├─> E2 (React19 codemod, G2)  [parallel, independent]
                        └─> J-harness ─────────────────────────────────────> (folds into every epic's DoD)
E4/E6 ──> E8/E9/E10 (BREAKING batch: B/E/H) ──> major release + codemod + migration guide
```

### 0.7 Risk register
- **R1 (high):** E1+E3 rewire the `<Chat>` core. Mitigation: freeze behaviour with the *existing* runtime tests + an expanded contract test **before** refactoring; refactor under green.
- **R2 (med):** "acid test" is subjective → it must become concrete per-component contract tests, or the gate is theatre.
- **R3 (med):** §K × 11 collections risks drift → the house-rule doc + a shared list primitive + a lint template.
- **R4 (low/annoying):** breaking batch timing vs. the repo's rolling `0.1.x` versioning — needs a release/signalling decision (see Open Decisions Q1).

---

## Cross-cutting quality gates (built in E0, enforced forever after)

| Gate | What it enforces | Mechanism |
| --- | --- | --- |
| `tsc --noEmit` (public + stories) | Documented composition typechecks under React 19 (deno check misses this) | new CI job over `tsconfig.json` + a stories tsconfig |
| Storybook three-tier | Every exported component has black-box / props / compound + 1 acid-test story | extend `scripts/storybook/storybook-workbench.test.ts` |
| Composability contract (runtime) | Every compound's leaves are individually overridable, siblings keep behaviour | extend `composability.contract.test.tsx` |
| Composability contract (static) | Every compound re-exports its leaves; no black-box regions | extend `scripts/lint/audit-chat-composability.ts` |
| No-new-boolean-toggle lint | Bans new `show*/enable*/hide*` props; baseline = current list | new `scripts/lint/ban-feature-toggles.ts` (+ baseline) |
| No-passthrough lint | Bans new `*ClassName`, `*Props`, `icons={{}}` bags; baseline seeded | new `scripts/lint/ban-passthrough-props.ts` (+ baseline) |
| No-`forwardRef` lint | Bans new `forwardRef` (post-E2); baseline shrinks to 0 | new lint (+ baseline) |
| Composed-demo purity | The composed example app has **zero** `useEffect`/`useRef` | lint over the example app dir |

---

## Epics

> Legend — **Breaking?** additive unless marked. **DoD** = §0.2 applies on top of the epic-specific acceptance.

### E0 — Enablement & gates (do first; unblocks everything)
**Goal.** Stand up the enforcement infra so later epics land under gates, and fix the tiny type bugs blocking documented composition.
**Breaking?** No.
**Tasks.**
- G1: re-declare `children: React.ReactNode` on every compound props interface that `extends HTMLAttributes` (confirmed offenders: `AppShellProps`, `AppShell.Sidebar/Header`, `ChatEmptyState*`; sweep for the rest).
- Add `tsc --noEmit` CI job (public entry types) + a **stories** tsconfig so `deno task` gates story typechecking.
- J-harness: a Storybook helper + `storybook-workbench.test.ts` extension asserting the three-tier + acid-test story set per exported component (seed with an allowlist of components not yet covered).
- Extend `audit-chat-composability.ts` + `composability.contract.test.tsx` into the general "acid-test" contract (leaf-override probe).
- Seed the three ratchet lints (feature-toggle, passthrough, forwardRef) with today's violations as baselines.
- K0: write the "Collections" house-rule doc (the 4 access points) — spec only, no application yet.
**Tests.** The gates test themselves (a passing + a deliberately-failing fixture per lint/contract). `tsc` job green on current tree.
**Quality gates added.** All of the cross-cutting table above.
**Acceptance.**
- `deno task <new gates>` all green on the current tree.
- Each ratchet lint fails on an injected new violation and passes on baseline.
- Documented composition examples from the handoff typecheck under `tsc --noEmit`.

### E1 — Headless context spine (§I-i)
**Goal.** Restructure `ChatContextValue` / `ComposerContextValue` / message context to the generic `{ state, actions, meta }` contract; remove `showSources: boolean` from the contract.
**Breaking?** Internal-only if these contexts aren't publicly exported; if any hook (`useChatContext` etc.) is public, ship a back-compat shim (flat getters delegating to structured) for one release, then remove in the breaking batch.
**Depends.** E0.
**Tasks.** Define the interfaces; migrate providers (`ChatRoot`) to inject a state owner instead of ~25 flat props; move `showSources`-style meta out of context (presence-driven); update all internal consumers to `const { state, actions, meta } = useX()`.
**Tests.** Contract test: the same UI subtree renders identically under **≥2 provider implementations** satisfying `ChatContextValue` (e.g. an ephemeral vs a persisted provider stub). Existing chat runtime tests stay green.
**Quality gates.** Composability contract; no-boolean-in-context assertion.
**Acceptance.** Every presentational chat node reads only `{state,actions,meta}`; a hand-written component reading the same context loses no behaviour; ≥2 providers drive the same UI.

### E2 — React 19 modernization (§G-2) — *parallel, independent*
**Goal.** Drop `forwardRef` (29 sites/17 files in chat) → `ref` as a regular prop; `useContext` → `use()` where it clarifies.
**Breaking?** No (internal idiom).
**Depends.** E0 (the forwardRef baseline lint).
**Tasks.** Codemod pass, component by component; delete the baseline entries as they burn down to 0.
**Tests.** Existing render/ref tests green; add a ref-forwarding assertion where missing.
**Acceptance.** `forwardRef` baseline = 0 in chat; ref still attaches on every leaf (test-proven).

### E3 — Kill userland state glue (§A) — the headline
**Goal.** Persistence + chat binding become library primitives, not app effects.
**Breaking?** Additive (new exports), then internal refactor of `<Chat>`.
**Depends.** E1.
**Tasks.**
- Add `afterStream`/`onFinish({ messages })` to `createAgUiHandler` (symmetric with `beforeStream`) — server-side persistence at the route boundary.
- Add `useConversationChat({ conversationId, store, agentId })` and/or `<ConversationChat.Root>` provider: does `useChat` + seeding + the persist bridge internally (the logic currently private to `UncontrolledChat`'s effect).
- **Refactor `<Chat>` to consume it** — one code path for batteries + composed.
**Tests.** Provider-level test: multi-conversation persistence with **zero** `useEffect`/`useRef` in the test's "userland" harness; switching conversations seeds+persists correctly; `<Chat>` batteries behaviour unchanged (existing tests green).
**Quality gates.** Composed-demo purity lint (zero effects/refs).
**Acceptance.** A fully-composed multi-conversation persisted chat contains zero `useEffect`/`useRef` in app code; `<Chat>` and the composed demo share the same hook/provider.

### E4 — Leaf composition depth (§C) + headless dumb-down (§I-ii)
**Goal.** Complete compounds to the leaves; each leaf a dumb context consumer.
**Breaking?** Additive (adds sub-components; keeps existing).
**Depends.** E1, E3.
**Tasks.** `Message.Header.Name/.Timestamp`; `ChatSidebar.Item.Title/.Menu/.Rename/.Delete` (menu built on `veryfront/ui` `DropdownMenu`); `ChatInput.Toolbar`; `AgentPicker.Search`; each reads behaviour from context so a swapped leaf keeps rename/delete/select for free.
**Tests.** Per-leaf acid-test: replace one leaf, assert siblings' behaviour intact; sidebar row-menu **addition** (not replacement) works.
**Quality gates.** Composability contract per completed compound; its three Storybook tiers.
**Acceptance.** For every region, any single leaf is replaceable with built-in sibling behaviour retained; "add a sidebar menu entry" needs no region re-implementation.

### E5 — Render-prop discipline + headless message parts (§D)
**Goal.** `children` for static structure; `renderItem` only for data lists; message parts exposed as headless data.
**Breaking?** Additive now; the *removal* of `renderHeader/renderCard/renderTrigger/renderSkill` etc. joins the breaking batch (E8–E10).
**Depends.** E4.
**Tasks.** Convert static render props → compound children (keep old as deprecated). Standardize list render props to `render<Child>` + function-child. Ship `useMessageParts()`, `Message.Part`, `Message.Text/.Reasoning/.Source`, `Message.Parts` (function-child), `Message.Content = <Message.Parts>` default switch. Delete the `renderTool` *concept* (superseded; actual prop removed in batch).
**Tests.** Parts render via `switch` returning composed defaults; `Message.Parts` defaults-on-empty-return; `Message.Content` zero-config equals the manual switch.
**Acceptance.** Four documented access points to parts off one implementation; no slot-map; render props exist only on data lists.

### E6 — Collection pattern applied everywhere (§K)
**Goal.** Every chat collection shares the 4-tier shape from K0.
**Breaking?** Additive.
**Depends.** E5 (parts is the exemplar), K0.
**Tasks.** Apply to: composer attachments, conversation files, transcript, conversations, sources, agents, suggestions, steps, branches, models. **Priority: attachments (heterogeneous, twin of parts) + transcript.** Each: expose `useX()` data hook, `<X.Item>` leaf, `<X.List>` function-child primitive, `<X>` batteries.
**Tests.** For parts + attachments + transcript: all four tiers render; homogeneous lists get a lighter conformance test.
**Quality gates.** A "collection conformance" contract test template per list.
**Acceptance.** One "Collections" doc + Storybook section shows the identical four-tier pattern for parts/attachments/transcript; the rest follow by convention.

### E7 — Storybook three-tier + acid-test coverage (§J) — *tracking epic, folds into E1–E6*
**Goal.** Every exported component ships its three tiers + one-leaf-override story, all typechecked.
**Breaking?** No.
**Depends.** E0 (harness).
**Tasks.** Per component (tracked as a checklist), author the tiers; finish the abandoned `Composition` narrative; the storybook gate flips each component from allowlisted → enforced.
**Acceptance.** The storybook three-tier gate has an **empty allowlist** (every exported component enforced); `tsc` over stories green.

### E8 — BREAKING: remove boolean toggles (§B)
**Depends.** E4–E6 (replacements exist). **Breaking? Yes.**
**Tasks.** Remove `showSources/showSteps/showScrollButton/showMessageActions/showExport/showTabs/hideTabSwitcher/enableAttachments/enableVoice/showSearch/enableMermaid/showLabel/showRemove` from the **composition** layer. Decide per-item whether the **preset `<Chat>`** keeps a convenience alias (Open Decision Q2).
**Tests.** Presence-driven behaviour proven; preset aliases (if kept) map 1:1 to including a default sub-component.
**Acceptance.** Composed layer requires no booleans; feature-toggle baseline = 0.

### E9 — BREAKING: remove passthrough props (§E)
**Depends.** E4. **Breaking? Yes.**
**Tasks.** Remove `contentClassName`/`cardClassName` (keep single root `className`), `dragProps`, and the 7 `icons={{}}` bags → per-sub-component `icon` props.
**Acceptance.** Passthrough baseline = 0; styling/icon customization is composition-only.

### E10 — BREAKING: collapse deprecated flat controlled API (§H)
**Depends.** E1, E3. **Breaking? Yes.**
**Tasks.** Remove the `@deprecated` flat `ChatProps` surface (`messages/input/onChange/onSubmit/sendMessage/stop/reload/setInput/model/activeModel/onModelChange/inferenceMode/renderTool/quickActions/…`). One controlled path: `chat={useChat()}` / `<Chat.Root>`.
**Acceptance.** One documented controlled path; migration guide covers every removed prop.

### E11 — BREAKING release cut (batches E8+E9+E10)
**Goal.** Ship all removals as one major with a codemod + migration guide + changelog.
**Depends.** E8, E9, E10, and each replacement gate at baseline 0.
**Acceptance.** Codemod migrates the removed props to composition; migration guide complete; npm-smoke + downstream example build green on the new surface.

---

## Recommended PR sequence
1. **PR-1 = E0** (types + `tsc` gate + storybook harness + contract extension + ratchet baselines + K0 doc). Small-ish, unblocks all.
2. **PR-2 = E2** (React 19 codemod) — parallelizable, land anytime after E0.
3. **PR-3 = E1** (context spine).
4. **PR-4 = E3** (state glue) — the headline.
5. **PR-5…N = E4/E5/E6** per region/collection, each self-contained with its stories + contract test (attachments + transcript first).
6. **PR-final = E8+E9+E10 → E11** one breaking release.

Each PR's merge bar = the cross-cutting gates + that component's DoD.

---

## Open decisions — need your call before building
- **Q1 (release/versioning).** How do we signal the breaking batch (E11) in a repo that uses a rolling `0.1.x` patch counter? Options: (a) reserve a version + CHANGELOG + codemod and treat it as "the breaking one"; (b) actually move to `0.2.0`/`1.0.0` to use semver's minor/major properly. Recommendation: (b) — a real minor/major bump is the honest signal for consumers.
- **Q2 (preset booleans).** Does the batteries `<Chat>` keep *any* convenience booleans (mapping 1:1 to "include default sub-component"), or go strictly zero-boolean everywhere? Affects E8 + the 1-line Demo-1 ergonomics.
- **Q3 (persistence priority).** §A asks for **both** server-side `onFinish` and client `useConversationChat`. The demos are client-composed — do we ship the client hook first (unblocks both demos) and the route `onFinish` second, or together?
- **Q4 (Storybook scope).** "Every component, three tiers" — does that include the 39 `veryfront/ui` primitives (~60 components × 3 ≈ 180 stories), or scope the three-tier contract to **chat** components and keep UI primitives at single-story? (Big effort delta.)
- **Q5 (first-PR scope).** Confirm PR-1 = E0 as scoped above. Anything you want pulled forward (e.g. start E1 in the same PR) or dropped?
- **Q6 (issues).** Want me to turn this into GitHub issues (one epic → tracking issue + task issues), or keep it as this doc + drive PRs directly?

---

## 0.8 Where we improve on the handoff (critical divergences)

The handoff is a strong *symptom* list but under-plays three things the code audit makes obvious:

1. **The real spine is decomposing one god file, not "context shape."** `chat/chat/index.tsx` is **1,153 LOC, 26 `@deprecated` markers, ~117 prop/field lines** — it fuses `<Chat>`, `UncontrolledChat` (the persistence effect §A), the entire deprecated flat API (§H), and the mega-prop surface. §I/§A/§H all converge here. Treat **shrinking this file** as the master burn-down metric; the context restructure (§I) is a *means* to that end, not the end.

2. **We are missing a safety net, not just stories.** **36 chat components have no co-located test.** §J's three-tier stories are aspirational polish; the *prerequisite* for safely rewiring the core (E1/E3) is **characterization tests** locking current behaviour. This is a new epic (E0.5) the handoff omits — refactoring a 1,153-LOC untested god file blind is the single biggest risk.

3. **Progress must be measured, or "done" is subjective.** The acid test is qualitative. Convert the whole effort into **metric ratchets** (below) wired into CI, so every PR provably moves the numbers down and can never regress. This makes §J's "definition of done" objective.

## 0.9 Metric ratchets (wired into CI in E0; each PR must not regress)

| Metric | Today | Target | Gate |
| --- | --- | --- | --- |
| `chat/index.tsx` LOC | 1,153 | < ~300 | file-size ratchet |
| `@deprecated` in chat | 32 (26 in index.tsx) | 0 (after E10) | grep ratchet |
| Feature-toggle booleans | ~13 | 0 in composition layer | `ban-feature-toggles` |
| Passthrough props (`*ClassName`/`*Props`/`icons={{}}`) | ~10 | 0 | `ban-passthrough-props` |
| `forwardRef` in chat | 29 (17 files) | 0 | `ban-forwardRef` |
| Public barrel compat aliases | ≥5 (`Attachment`, `StandaloneMessage`, `StreamingMessage`, …) | 0 (after E10) | barrel-surface test |
| Chat components w/o test | 36 | 0 | coverage-per-component gate |
| Storybook three-tier coverage | partial | 100% (empty allowlist) | `storybook-workbench` |
| Unmemoized context `value={{…}}` | ≥1 (agent-picker) | 0 | lint/contract |

## Additional findings appendix (audited in the shipped tree, beyond §A–§K)

- **F-1 God components.** `index.tsx` 1153 · `message.tsx` 970 (92 props) · `chat-composer.tsx` 644 · `sidebar.tsx` 630 (70 props) · `agent-picker.tsx` 520 · `chat-actions.tsx` 515. Presentation+logic fused → the structural reason the acid test fails. Decomposition is implicit in §I but the **size** is the concrete, measurable smell. *(Feeds E1/E4; add a per-file LOC ratchet.)*
- **F-2 Prop-count explosion.** `ChatProps` ~117 members, `MessageProps` ~92, `ChatSidebarProps` ~70 — the quantified form of "boolean/flat-prop proliferation." *(composition-patterns §1: replace with children/compound.)*
- **F-3 Unmemoized context value** (`agent-picker.tsx` `.Provider value={{…}}` inline) → new object every render → all consumers re-render. §I must mandate memoized, ideally state/actions-split contexts. *(Add to E1 acceptance + a lint.)*
- **F-4 Public-barrel deprecation debt.** `src/chat/index.ts` ships compat aliases from the earlier rename (`AttachmentPill as Attachment`, `Message as StandaloneMessage`/`StreamingMessage`, `MessageProps as Standalone/StreamingMessageProps`). Two names per concept = the "two ways to do everything" smell in the *public* surface. *(Fold into E10 breaking batch + migration guide.)*
- **F-5 Two class-join helpers.** `theme.ts` exports `cn`; `ui/cva.ts` exports `cx` — both are `clsx`. `ui` standardized on `cx`; chat still uses `cn`. One concept, two names. *(Low priority: standardize on one, re-export the other as a deprecated alias.)*
- **F-6 Index-as-key (×8).** `key={i}`/`key={index}` on lists that reorder (messages/parts/attachments/conversations) risks React reconciliation bugs on insert/delete/reorder — precisely the §K/§D collections. *(Fold stable-key fixes into E5/E6; add a lint over the chat lists.)*
- **F-7 Timer cluster (10 prod `setTimeout`/`setInterval`).** Scroll/focus/debounce logic implemented with raw timers inside components. Audit for effects that should be derived state or extracted into a named hook (§I "logic → hooks"). Not all wrong, but a review target.
- **Corrected non-findings (audit hygiene).** Batch-1's high counts for direct-DOM (`querySelector`/`getElementById` ×31), `as unknown as` (×6), and `: any` (×5) were **test-file noise** — production chat code is **0/0/0** on these. No production type-escape or imperative-DOM smell. Reported so priorities aren't skewed by false positives.

## New/updated epics from the audit

### E0.5 — Characterization safety net (NEW; do before E1/E3)
**Goal.** Lock current behaviour of the god file + the 36 untested components before any rewire.
**Breaking?** No. **Depends.** E0.
**Tasks.** Characterization tests (render + key interactions: send, edit, persist, switch conversation, rename/delete, attach) for `<Chat>`/`UncontrolledChat`, `message`, `sidebar`, `chat-composer`, `agent-picker`. Prioritize the files E1/E3 touch.
**Tests/Acceptance.** Named behaviours pass on the current tree; the suite stays green through E1/E3 (the definition of "no regression"); untested-component count strictly decreases toward 0.

### E1 addendum — god-file decomposition + memoized structured context
Add to E1 tasks: extract `UncontrolledChat`/persistence out of `index.tsx` (→ E3's provider), extract the deprecated flat API into a clearly-marked `chat-compat.tsx` slated for E10 deletion, and require every context `value` be memoized (F-3). Acceptance gains: `index.tsx` < ~300 LOC; no inline context object.

---

## Canonical alignment — `composition-patterns` v1.0 (the cited reference)

Mapping each rule → epic → the concrete acceptance criterion it dictates, and where the shipped code violates it.

| Rule (priority) | Epic | Code violates it via | Acceptance criterion (verbatim to the rule) |
| --- | --- | --- | --- |
| **§1.1 Avoid boolean prop proliferation** (CRITICAL) | E8 (§B) | ~13 `show*/enable*/hide*` toggles; `ChatProps` ~117 fields | No behaviour-customizing booleans on the composition layer; each mode is composition or an explicit variant (see below) |
| **§1.2 Use compound components** (HIGH) | E4 (§C) | opaque leaves; `renderItem` as the only hook on `ChatSidebar.Item` | Every region is a `Provider`+parts compound; each part reads `use(Context)`, exported as a compound object |
| **§2.1 Decouple state from UI** (MED) | E1/E3 (§I/§A) | god components fuse state+markup; `UncontrolledChat` owns persistence | UI components know only the context interface; provider is the *only* place state impl lives |
| **§2.2 Generic `{state, actions, meta}` interface** (HIGH) | E1 (§I) | flat context bags; `showSources: boolean` in-contract; unmemoized value | Each context is `{state, actions, meta}`, memoized; ≥2 providers implement it and drive the same UI |
| **§2.3 Lift state into providers** (HIGH) | E3 (§A) | **the persistence `useEffect(…sink…)` IS the doc's "Incorrect: useEffect to sync state up"** | Chat+persistence lifted into a provider; a sibling (header token counter) reads chat state *outside* the transcript with no prop-drill/ref/effect |
| **§3.1 Explicit variants** (MED) | E8 / **Q2** | (would-be) convenience booleans on `<Chat>` | Modes are **explicit variant components** (`<Chat>` default, a distinct preset if needed) — **not** `<Chat compact/thread/edit>` |
| **§3.2 Children over render props** (MED) | E5 (§D) | `renderHeader/renderCard/renderTrigger/renderSkill` (static) + inconsistent `renderItem/renderRow/renderPill` | `children` for static structure; `renderItem` **only** where the parent passes data, shaped `({ item, index }) => …` |
| **§4.1 React 19 (`ref` prop, `use()`)** (MED) | E2 (§G2) | 29 `forwardRef` in chat; `useContext` throughout | 0 `forwardRef`; `use(Context)` (conditional-capable) replaces `useContext` |

### Decision resolved by the reference — Q2 (preset booleans)
`composition-patterns` §1.1+§3.1 are explicit: the answer to "modes" is **explicit variant components**, never booleans. So the batteries `<Chat>` should be *the default explicit variant* (a fixed arrangement of the public parts), and any alternative mode ships as its **own named component** (e.g. a hypothetical `<CompactChat>`), not a `<Chat compact>` flag. **Recommendation: zero behaviour-booleans anywhere; presets are variant components.** This tightens E8 and removes the "convenience alias" carve-out the handoff left open — unless you explicitly want ergonomic aliases despite the rule (your call, but the cited guide says no).

### The strongest single lever
§2.3's "Incorrect: useEffect to sync state up" is a **line-for-line description of the shipped persistence bridge** (`UncontrolledChat`'s `useEffect(…sink(conversation)…, [chat.messages, boundId])`). The reference doesn't just say "this is bad" — it prescribes the exact fix (lift into a provider). That makes **E3 the highest-conviction, best-supported change in the whole plan**: it's not opinion, it's the cited anti-pattern with the cited remedy.

---

## Decisions locked (2026-07-08)

- **Q1 — Versioning: no version bump in any of these PRs.** The version/release call is made **after merge** as a separate step (matches the repo's rolling `0.1.x` cadence — bumps are their own dedicated PRs). E11 therefore does **not** touch `deno.json`; it ships the breaking *code* + codemod + migration guide, and the version/release decision follows independently.
- **Q3 — Persistence: ship both together.** E3 delivers server-side `afterStream/onFinish({messages})` on `createAgUiHandler` **and** the client `useConversationChat` / `<ConversationChat.Root>` in the same epic (they're the two halves of "kill the persistence effect").
- **Q4 — Storybook scope: split by layer.** UI primitives = composable/no-black-box only (DoD 1–5); chat components = both (DoD 1–6, incl. three-tier + acid-test stories). The three-tier storybook gate's enforced allowlist covers **chat** components; UI primitives are held to the composability contract, not the story-tier count.
- **Q5 — Docs first.** PR-1 is **spec/docs to work through the design before code**: the collections house-rule doc (K0), the `{state,actions,meta}` context contract spec, and the per-component DoD checklist — landed as `.context`/`docs` markdown. The gate *infrastructure* (E0) + characterization safety net (E0.5) follow once the specs are agreed. **Do not start component code until the specs are reviewed.**
- **Q6 — Tracking in markdown, no GitHub issues.** This plan file is the tracker. Each epic gets a checklist here; progress + burn-down metrics are updated in-file per PR. (Companion per-epic md files may be split out under `.context/plans/` if any single epic's checklist grows large.)

### Revised PR sequence (post-decisions)
1. **PR-1 — Docs/specs (Q5):** K0 collections house-rule, context contract spec, DoD checklist, metric-ratchet definitions. **Review gate before any code.**
2. **PR-2 — E0 gates + G1 types:** the enforcement infra + `tsc` gate + ratchet baselines (built to the PR-1 specs).
3. **PR-3 — E0.5 characterization tests:** safety net over the god file + the 36 untested components.
4. **PR-4 — E2** React 19 codemod (parallelizable).
5. **PR-5 — E1** context spine → **PR-6 — E3** state glue (both halves, Q3).
6. **PR-7…N — E4/E5/E6** depth (attachments + transcript first), each with its chat three-tier stories.
7. **PR-final — E8+E9+E10 → E11** breaking batch + codemod + migration guide (**no version bump**, Q1).
