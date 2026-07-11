# Implementation progress - chat composition overhaul

Tracker for pull request #2851 on `mattboon/chat-e0-g1-tsc-gate`. The branch is
based on `main`. This file distinguishes the work completed in the pull request
from follow-up items in the broader composition plan.

## E0 - Enablement and gates

- [x] **Consumer `tsc` gate + the real G1 fix.** `deno task typecheck:consumer`
      typechecks documented `veryfront/ui`/`veryfront/chat` composition against
      the built `.d.ts` as an npm consumer compiles it. Root-caused + fixed the
      actual bug (dnt react-shim collapsed every `extends React.HTMLAttributes`
      component's props to `{}` for consumers — `children`/`className`/handlers
      all stripped; invisible to `deno check`). Fix in `build-npm-dnt.ts` maps
      react to the bare npm peer; build-time guard `assertConsumerReactImport`.
      _(supersedes the plan's per-interface "declare children" band-aid.)_
- [x] **Ratchet lints** - `deno task lint:chat-ratchets`
      (`scripts/lint/ban-chat-antipatterns.ts`) locks `forwardRef`, behavior
      flags, passthrough props, and inline context objects at zero. It also
      enforces the reduced file-size ceilings. The task includes the E11
      codemod typecheck and tests and is wired into `verify` and CI.
- [x] **K0 collections house-rule doc** - `docs/plans/K0-collections-house-rule.md`
      (4-tier pattern, grounded in the `Sources` exemplar).
- [x] **Composability contract - acid-test leaf-override probe** added to
      `composability.contract.test.tsx` (Sources exemplar).
- [x] **Storybook target-surface assertion** - `storybook:check` verifies the
      canonical component set and the production Storybook build verifies the
      new composition stories.

## E0.5 - Characterization safety net

- [x] Characterization tests cover the `<Chat>` paths changed by E1/E3 and the
      conversation persistence invariants used by `useConversationChat`.
- [ ] Broader coverage for chat components outside this pull request remains a
      follow-up and does not block the breaking API batch.

## E2 — React 19 forwardRef codemod (safe, mechanical; burns the forwardRef ratchet → 0) — ✅ DONE

- [x] All 29 forwardRef sites / 17 files converted to React-19 `ref` prop.
      forwardRef ratchet locked at 0. Full chat suite (29 files) + consumer gate
      green. Bonus: plain-function form gives consumers stricter prop types than
      forwardRef masked (gate now enforces Chat.Root/Chat.Input controlled props).
      Commit `fe115dadf`.

## E1 - context spine and god-file decomposition - core done

- [x] God file decomposed **1147 to 330 LOC or fewer** (`chat-props.ts`,
      `controlled-chat.tsx`, `app-mode-chat.tsx`). Commit `a0415013d`.
- [x] Per-file LOC ratchet (§0.9 master metric) locking the win. Commit `a041…`.
- [x] F-3: memoized the last inline context value (agent-picker) + a ratchet
      dimension for `.Provider value={{…}}` at 0. Commit `cf9012cfd`.
- [ ] Deferred: the full `{state,actions,meta}` context reshape remains outside
      this pull request. The E8 cleanup removed `showSources` from the context
      contract.

## E3 - kill userland state glue - client half done

- [x] `useConversationChat()` library hook: `useChat` + seeding + the persist
      bridge (§2.3 anti-pattern) live in one reusable, publicly-exported
      primitive; `<Chat>` consumes it. Userland writes no effect. Commit `aed726ad0`.
- [ ] Server half: symmetric `afterStream/onFinish({messages})` on
      `createAgUiHandler` remains a separate agent-runtime follow-up. This pull
      request does not claim full E3 completion.

## E4 - leaf composition depth - done

- [x] ChatSidebar.Item.Menu/.Rename/.Delete compound (acid test).
- [x] Message.Header.Name/.Timestamp, ChatInput.Toolbar, AgentPicker.Search.
      Behaviour-preserving; each leaf takes singular icon/className (sets up E9).

## E6 - collections (K0 4-tier) - done

- [x] Collection-conformance contract (Sources + AttachmentsPanel prove the
      4-tier template). Remaining collections already carry the shape.

## E5 - message parts and render-prop discipline - core done

- [x] `useMessageParts()` headless data hook added (4th access point). Message.Content
      already provides the function-child list tier + Message.Part leaf, so the
      four part access points are complete. Commit `3085dcaa8`.
- [ ] Optional sugar leaves Message.Text/.Reasoning/.Source (deferred).

### E3 groundwork - behavior the persistence lift must preserve

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
   - identity are read via refs so the save→setActive round-trip can't loop.

Acceptance for E3: a fully-composed multi-conversation persisted chat contains
**zero** `useEffect`/`useRef` in app/userland code, and `<Chat>` + the composed
demo share the one hook/provider — with 1–5 above proven unchanged.

## E7 - Storybook API visibility for customization - done

- [x] Rebased onto `origin/main` (base PR #2798 merged as b42ab37d7).
- [x] `ChatSidebar` "Custom row menu" story — surfaces Item.Menu/.Rename/.Delete
      customization (add an entry without re-implementing the row). Commit `a8672fe7e`.
- [x] `Message` "Headless parts (useMessageParts)" story — surfaces the data API.
      Commit `d37dc3bcc`. Storybook build green.
- [x] The target chat component set has canonical stories, including compound
      examples for the replacement leaves introduced by E4 and E8-E10.

## E8 / E9 / E10 / E11 - breaking batch, codemod, and migration - done

- [x] **E8:** removed the public behavior flags. The preset has one fixed
      anatomy and lower-level compounds provide presence-driven customization.
- [x] **E9:** removed icon bags, nested class-name passthroughs, and
      `useDropZone().dragProps`. Added the missing addressable leaves.
- [x] **E10:** removed the flat controlled `<Chat>` API, spread-oriented
      `UseChatResult` aliases, compatibility component aliases, and redundant
      static render callbacks. Controlled callers use `chat={useChat()}`.
- [x] **E11:** added `deno task codemod:chat`, focused codemod tests, the
      migration guide, and the breaking-change summary.
- [x] Ratchets are locked at `0` behavior flags and `0` passthrough props.
