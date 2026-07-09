# Implementation progress — chat composition overhaul

Tracker for the execution branch (`mattboon/chat-e0-g1-tsc-gate`, off
`mattboon/veryfront-ui-namespace`). Companion to the plan/START-HERE on the
`mattboon/chat-composition-plan` branch. Tick items as they land; record the
commit.

## E0 — Enablement & gates
- [x] **Consumer `tsc` gate + the real G1 fix.** `deno task typecheck:consumer`
      typechecks documented `veryfront/ui`/`veryfront/chat` composition against
      the built `.d.ts` as an npm consumer compiles it. Root-caused + fixed the
      actual bug (dnt react-shim collapsed every `extends React.HTMLAttributes`
      component's props to `{}` for consumers — `children`/`className`/handlers
      all stripped; invisible to `deno check`). Fix in `build-npm-dnt.ts` maps
      react to the bare npm peer; build-time guard `assertConsumerReactImport`.
      *(supersedes the plan's per-interface "declare children" band-aid.)*
- [x] **Ratchet lints** — `deno task lint:chat-ratchets`
      (`scripts/lint/ban-chat-antipatterns.ts`) seeds baselines: forwardRef 29,
      feature-toggle booleans 29, passthrough props 14. Fails on any new
      violation; only shrinks. Wired into `verify` + CI lint job.
- [x] **K0 collections house-rule doc** — `docs/plans/K0-collections-house-rule.md`
      (4-tier pattern, grounded in the `Sources` exemplar).
- [x] **Composability contract — acid-test leaf-override probe** added to
      `composability.contract.test.tsx` (Sources exemplar).
- [ ] **Storybook three-tier harness assertion** — folds into E7 (tracking).

## E0.5 — Characterization safety net
- [~] Characterization tests over the god file + untested components (must
      precede E1/E3). God-file (`<Chat>`) render/seed behaviours landing;
      full useChat/persistence-effect characterization needs a `useChat` mock
      (tracked for the E3 PR, alongside the invariants below).

## E2 — React 19 forwardRef codemod (safe, mechanical; burns the forwardRef ratchet → 0) — ✅ DONE
- [x] All 29 forwardRef sites / 17 files converted to React-19 `ref` prop.
      forwardRef ratchet locked at 0. Full chat suite (29 files) + consumer gate
      green. Bonus: plain-function form gives consumers stricter prop types than
      forwardRef masked (gate now enforces Chat.Root/Chat.Input controlled props).
      Commit `fe115dadf`.

## E1 — context spine + god-file decomposition — ✅ core done
- [x] God file decomposed **1147 → 376 LOC** (`chat-props.ts`,
      `controlled-chat.tsx`, `app-mode-chat.tsx`). Commit `a0415013d`.
- [x] Per-file LOC ratchet (§0.9 master metric) locking the win. Commit `a041…`.
- [x] F-3: memoized the last inline context value (agent-picker) + a ratchet
      dimension for `.Provider value={{…}}` at 0. Commit `cf9012cfd`.
- [ ] Deferred: full `{state,actions,meta}` context reshape + removing
      `showSources` from the context contract — entangled with message-parts
      rendering; folds into E4/E5. The composability contract already proves the
      contexts are honest.

## E3 — kill userland state glue — ✅ client half done
- [x] `useConversationChat()` library hook: `useChat` + seeding + the persist
      bridge (§2.3 anti-pattern) live in one reusable, publicly-exported
      primitive; `<Chat>` consumes it. Userland writes no effect. Commit `aed726ad0`.
- [ ] Server half (Q3): symmetric `afterStream/onFinish({messages})` on
      `createAgUiHandler` (agent-runtime `src/agent/ag-ui/handler.ts`).

## E4 — leaf composition depth
- [x] Flagship acid test: ChatSidebar.Item decomposed into a composable
      Item.Menu/.Rename/.Delete compound (per-item context `useChatSidebarItem`);
      add a menu entry by composing, keep rename/delete/select. Commit `7e14f2e9d`.
- [ ] Remaining targets: Message.Header.Name/.Timestamp, ChatInput.Toolbar,
      AgentPicker.Search (same pattern).

## E5 — message parts / render-prop discipline
- [~] In progress.

## E6 — collections (K0 4-tier) everywhere
- [ ] Pending (attachments + transcript first).

### E3 groundwork — behaviour the persistence lift MUST preserve
The §2.3 "useEffect to sync state up" anti-pattern lives in
`chat/index.tsx` `UncontrolledChat` (the sink effect, keyed on
`[chat.messages, boundId]`). When E3 lifts it into `useConversationChat` /
`<ConversationChat.Root>`, these observable behaviours must stay identical
(characterize them first):

1. **Seed on open.** Mounting inside a `ConversationsProvider` whose `active.id
   === activeId` seeds `useChat` from `bound.messages`; standalone (no provider)
   seeds from `initialMessages`. `resolvedAgentId = bound?.agentId ?? agentId`.
2. **No re-save on open.** `lastEmittedRef` is seeded with the mount-time
   `chat.messages`, so merely opening a thread never fires the sink (no spurious
   `updatedAt` bump that would reorder the sidebar).
3. **Sink target resolution.** `persist = onUpdate ?? conversations?.save`
   (explicit prop wins, else provider `save`, else ephemeral/no-op).
4. **Whole-conversation emit.** On a real `chat.messages` change the sink gets a
   full `Conversation` (`{...base, messages, title, updatedAt: Date.now()}`);
   title is derived only when the base title is empty/default; identity rides
   `bound` in a provider or a minted synthetic id standalone.
5. **No render loop.** The effect keys on `[chat.messages, boundId]` only; sink
   + identity are read via refs so the save→setActive round-trip can't loop.

Acceptance for E3: a fully-composed multi-conversation persisted chat contains
**zero** `useEffect`/`useRef` in app/userland code, and `<Chat>` + the composed
demo share the one hook/provider — with 1–5 above proven unchanged.

## E7 — Storybook three-tier coverage
- [ ] Pending (folds per component).

## E8 / E9 / E10 / E11 — BREAKING batch + codemod + migration
- [ ] Pending. Additive replacements + deprecations land first; removals batch
      last. Do NOT execute destructive removals until replacement gates hit
      baseline 0 and the safety net is proven.
