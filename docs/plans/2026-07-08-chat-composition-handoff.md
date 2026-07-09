# Handoff: `veryfront/chat` — composition & API changes for a "perfect" demo

**Audience:** veryfront-code maintainers.
**Author:** produced while building the customer-operations-agent chat examples.
**Goal:** ship two demos off **one** set of primitives:

1. **Batteries-included** — `<Chat>` + `<ConversationsProvider>` + a layout, using
   built-in components as-is. Great defaults, zero config.
2. **Fully composed** — the *same* hooks, providers, and UI leaves arranged by
   hand for total control.

The non-negotiable: **#1 must be nothing more than a default arrangement of the
public parts from #2.** No private internals, no logic that only exists inside
`<Chat>`. If `<Chat>` can do it, userland composition must be able to do it too,
with no `useEffect`/`useRef`/glue code.

Everything below is verified against the shipped package
(`node_modules/veryfront@0.1.998`) — file/line evidence in the Appendix.

---

## The acid test

> **"Can I change the X on Y?"** — the first thing every developer asks. Today,
> when `Y` is nested inside some `<ZComponent>`, the answer is often "no, not
> without replacing all of Z," and the demo falls over. Customers hate that.

**Every node must pass this test:** any leaf `X` — an icon, a label, a class, a
handler — must be changeable *in place*, without re-implementing its parent `Z`.
That is the single measure of success for this work. If changing the send-button
icon, a sidebar row's menu, or a message avatar requires forking a whole region,
the API has failed.

The API must feel like **idiomatic React**: developers already know how to
customize with **props, `children`, and compound components** (Radix / Headless
UI / Chakra mental model). Don't invent new patterns — meet that expectation.

## North-star principles

1. **Change-X-on-Y passes everywhere.** Every leaf is reachable and overridable
   in place (props/children/compound) without touching its ancestors.
2. **Presentation and business logic are split.** Logic lives in **headless
   hooks/providers**; components are **presentational** — they take props +
   `children` and render, holding no wiring. This split is *what makes* the acid
   test pass: dumb components are trivially customizable; a component that owns
   logic can't be reshaped. (Headless-UI / TanStack model.)
3. **No userland glue.** Hooks + providers do the wiring. A composed app contains
   zero `useEffect`/`useRef`. If integration needs an effect, it belongs *inside*
   a library hook/provider — never in app code.
4. **Children first; render props only for data-passing.** Static structure
   composes via `children`/compound sub-components. A `renderX` prop is justified
   *only* where the parent must inject per-item data (lists) — and there, offer
   both a function-child and `renderItem`. Don't bolt `renderX` onto static
   leaves (`renderHeader`, `renderCard`, `renderTrigger` are smells — those want
   composition). *(composition-patterns §3.2)*
5. **Down to ALL child nodes.** Every visual leaf is an addressable, composable
   sub-component — not just the top-level regions. Nothing is a black box you
   can't reach into.
6. **No boolean feature toggles.** Presence is composition. `showSources` →
   render `<Message.Sources/>` or don't. No `show*`/`enable*`/`hide*`.
7. **One root `className` per component.** No `contentClassName`,
   `cardClassName`, `subComponentClassName`, or `xxxProps={{}}` passthrough
   objects. Want to style a child? Compose the child and give *it* a className.
8. **Documented, non-magic props.** Every prop's effect is obvious from its name
   and doc. No resolved-by-presence behaviour, no deprecated shadow-API.
9. **Three usage tiers, one implementation.** Every component works as (a) a
   **black box** with sensible defaults, (b) **props-customized**, and (c)
   **fully compound-composed** — and all three are the *same* implementation, not
   parallel code paths. Storybook proves all three (§J).

---

## The two target demos (end state)

### Demo 1 — batteries-included

```tsx
// app/page.tsx
<ConversationsProvider store={localConversationStore('ops')}>
  <ChatLayout>                     {/* AppShell preset: sidebar + main */}
    <ChatSidebar />                {/* reads provider from context */}
    <Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
  </ChatLayout>
</ConversationsProvider>
```

### Demo 2 — fully composed (same primitives, arranged by hand)

```tsx
<ConversationsProvider store={localConversationStore('ops')}>
  <AppShell>
    <AppShell.Sidebar>
      <ChatSidebar.Root>
        <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>
        <ChatSidebar.List>
          {(conversation) => (
            <ChatSidebar.Item conversation={conversation}>
              <ChatSidebar.Item.Title />
              <ChatSidebar.Item.Menu>
                <ChatSidebar.Item.Rename />
                <DropdownMenu.Item onSelect={copyTitle}>Copy title</DropdownMenu.Item>
                <ChatSidebar.Item.Delete />
              </ChatSidebar.Item.Menu>
            </ChatSidebar.Item>
          )}
        </ChatSidebar.List>
      </ChatSidebar.Root>
    </AppShell.Sidebar>

    <AppShell.Main>
      <AppShell.Header>
        <AgentPicker /> {/* or fully composed AgentPicker.Trigger/.Content/.Item */}
      </AppShell.Header>

      {/* useConversationChat = useChat bound to the active conversation +
          provider store. No effect in userland. */}
      <ConversationChat.Root>
        <ConversationChat.Transcript>
          {(message) => (
            <Message.Root message={message}>
              <Message.Avatar />
              {/* headless: parts are data, you switch. `Message.Part` renders
                  the default for any type (text, reasoning, sources). */}
              {useMessageParts().map((part, i) =>
                part.type === 'tool'
                  ? <ToolCall.Root key={i} tool={part}>…</ToolCall.Root>
                  : <Message.Part key={i} part={part} />
              )}
              <Message.Sources />
              <Message.Actions>
                <Message.CopyAction />
                <Message.RegenerateAction />
              </Message.Actions>
            </Message.Root>
          )}
        </ConversationChat.Transcript>

        <ChatInput.Root>
          <ChatInput.Field placeholder="Ask the support agent…" />
          <ChatInput.Attach />
          <ChatInput.Model />
          <ChatInput.Voice />
          <ChatInput.Send icon={<MailIcon />} />
        </ChatInput.Root>
      </ConversationChat.Root>
    </AppShell.Main>
  </AppShell>
</ConversationsProvider>
```

Every node above is a public export. There is no `useChat` + `useEffect`
persistence dance, no `showSources`, no `renderItem` escape hatch that
reimplements a built-in worse than the original.

---

## Required changes in `veryfront/chat`

### A. Kill userland state glue (highest priority)

**Problem.** To compose the transcript/composer from sub-components you must
hand-drive `useChat`, and then persistence is on you. The bridge that syncs a
live `useChat` into the conversation store **exists only inside `<Chat>`**
(`UncontrolledChat`'s `React.useEffect(… sink(conversation) …, [chat.messages,
boundId])`, with a `persistRef` + first-render-skip). Composed apps must
re-implement that effect (`usePersistMessages` in our demo). That violates
principles 1 and "#1 = arrangement of #2's parts."

**What the ecosystem does** (for reference):
- **Vercel AI SDK v5**: persistence is **server-side**, in the route's
  `toUIMessageStreamResponse({ onFinish: ({ messages }) => saveChat(...) })`.
  The client `useChat({ id, messages })` only carries identity + seed. No client
  persistence callback.
- **TanStack AI**: stateless today; the planned answer is a pluggable
  **`ChatPersistenceAdapter`** (`getItem`/`setItem`/`removeItem`) bound to the
  client — i.e. a store adapter, which veryfront *already has* as
  `ConversationStore`.

**Asks (do both):**

1. **Server-side finish hook on `createAgUiHandler`.** It already has
   `beforeStream`; add the symmetric `onFinish`/`afterStream({ messages })` so
   durable persistence can live at the route boundary (the AI SDK model). This is
   the "right" default and needs no client state at all.

2. **Bind the client chat to the store — as a hook/provider, not an effect.**
   Expose `useConversationChat({ conversationId, store, agentId })` (and/or a
   `<ConversationChat.Root>` provider) that internally does `useChat` + seeding +
   the persist bridge and returns the session. This is exactly what `<Chat>` does
   privately today — promote it to a public headless primitive so composition
   reaches parity. Then **`<Chat>` is refactored to consume it**, guaranteeing #1
   and #2 share one code path.

   Net userland result: `const chat = useConversationChat()` — no `useEffect`,
   no `useRef`, no first-render guard.

> Acceptance: a fully-composed multi-conversation chat with persistence contains
> **zero** `useEffect`/`useRef` in app code.

---

### B. Remove boolean feature toggles → composition

**Problem.** Behaviour is toggled by booleans instead of presence. Several are
already `@deprecated` with the note "renders automatically" — meaning the flag
is vestigial. Full list found in the shipped types:

| Toggle | Replace with (composition) |
| --- | --- |
| `showSources` *(already @deprecated)* | render `<Message.Sources/>` or omit |
| `showSteps` *(already @deprecated)* | render `<Message.Steps/>` / `<StepIndicator/>` or omit |
| `showScrollButton` | render `<ConversationScrollButton/>` or omit |
| `showMessageActions` | render `<Message.Actions/>` or omit |
| `showExport` | render an export action or omit |
| `showTabs` / `hideTabSwitcher` | compose `<TabSwitcher/>` or omit |
| `enableAttachments` | render `<ChatInput.Attach/>` or omit |
| `enableVoice` | render `<ChatInput.Voice/>` or omit |
| `showSearch` (AgentPicker) | render `<AgentPicker.Search/>` or omit |
| `enableMermaid` | opt-in via a markdown plugin, not a boolean |
| `showLabel`, `showRemove` (pills) | compose the pill's parts |

**Ask.** Delete the toggles from the composition layer. Presence of a
sub-component *is* the switch. For the **preset `<Chat>`** (batteries mode) it's
fine to keep a small, documented set of *convenience* booleans **if** they map
1:1 to "include this default sub-component" — but the composed layer must never
require them, and none should gate behaviour magically.

> These are "exemplars to discuss" per your note — flagging all of them; we can
> decide per-item whether the preset keeps a convenience alias.

---

### C. Composition down to ALL child nodes

**Problem.** Compounds exist for the big regions, but several leaves are still
opaque, forcing `renderX`-reimplementation-from-scratch (which loses the
built-in behaviour — e.g. our sidebar `renderItem` had to re-do inline rename as
a native `prompt()` and hand-roll a menu).

**Ask.** Every visual leaf is a named sub-component with a single root
`className`, reachable via composition, and each list also takes a `renderX`.
Concretely, complete these compounds down to the leaves:

- **`Message`** — expose `Message.Header.Name`, `Message.Header.Timestamp`,
  `Message.Avatar` (already), and make `Message.Content` accept **per-part
  render slots** (see D) so tool/reasoning/source/text each compose.
- **`ChatSidebar.Item`** — expose `.Title`, `.Menu`, `.Rename`, `.Delete` so you
  can **add** a menu entry *without* replacing the row (today `renderItem` is the
  only hook and it discards the built-in inline-rename + menu).
- **`ChatInput`** — already good (`.Field/.Attach/.Model/.Voice/.Send/.Stop`);
  expose the toolbar container as `.Toolbar` so layout is composable too.
- **`ChatEmptyState`** — already compound; fix its types (see F).
- **`AgentPicker`** — expose `.Search` (replaces `showSearch`).

> Acceptance: for every built-in region, I can replace any single leaf while
> keeping its siblings' built-in behaviour — no full-region re-implementation.

---

### D. Composition first; render props only for data-passing

`composition-patterns` §3.2 is explicit: **`children` for static structure;
`renderX` only when the parent must pass per-item data back** (lists). Today the
library over-uses render props as an *alternative* to composition — `renderTool`,
`renderMessage`, `renderItem`, `renderRow`, `renderPill`, `renderCodeBlock`,
`renderScrollButton`, `renderTrigger`, `renderSkill`, `renderHeader`,
`renderCard` — and inconsistently (`renderItem` vs `renderRow` vs `renderPill`).

**Asks:**

1. **Demote static render props to composition.** `renderHeader`, `renderCard`,
   `renderTrigger`, `renderSkill` render *static structure* → they should be
   compound children (`<X.Header>…</X.Header>`), not callbacks.
2. **Keep render props only for data lists, and offer both forms.** Where the
   parent supplies each item's data, support a function-child *and* `renderItem`:
   `<X.List>{(item) => <X.Item …/>}</X.List>` (function-child is the norm, like
   `Message.Content`'s). Standardize the name to `render<Child>` matching the
   sub-component (`renderItem` ↔ `<X.Item>`).
3. **Message parts are headless data — expose them, don't slot-map them.** This
   is how AI SDK (`message.parts.map(part => switch(part.type))`) and assistant-ui
   (`<MessagePrimitive.Parts>{({ part }) => …}`) both do it. Provide four access
   points off **one** implementation, message-scoped:
   - **Data / headless:** `message.parts` (already data) + `useMessageParts()`
     from message context — map with a `switch`.
   - **Leaf renderers exposed:** `Message.Part` (default render for any one part)
     plus `Message.Text`, `Message.Reasoning`, `Message.Source`, `ToolCall.*` —
     so a `switch` returns composed *defaults*, not reinventions.
   - **`Message.Parts` primitive:** iterates + function-child `({ part }) => …`,
     defaults when you return nothing (the assistant-ui shape).
   - **`Message.Content` batteries:** `= <Message.Parts>` with the default
     switch. Zero-config.
   Drop the `renderTool` bag and the slot-map idea entirely — parts render via
   the switch/primitive, not per-type render props.

---

### E. One root `className`; delete passthrough props

**Problem (found in shipped types):**
- `contentClassName` (ChatMessageList), `cardClassName` (a card component) —
  second class-names for nested nodes.
- `dragProps` — an object-passthrough prop.
- `icons?: XxxIcons` slot objects on **7** components (`ChatInputIcons`,
  `ChatSidebarIcons`, `AgentPickerIcons`, `MessageActionBarIcons`,
  `MessageFeedbackIcons`, `BranchPickerIcons`, `AttachmentPillIcons`) — this is
  the `subComponentProps={{}}` smell: you configure a child through a bag on the
  parent instead of composing the child.

**Asks:**
- Remove `*ClassName` (keep only the single root `className`). Styling a nested
  node = composing that node and styling it directly.
- Remove `*Props`/`dragProps` passthrough objects.
- Replace `icons={{…}}` bags with per-sub-component `icon` props (which already
  exist, e.g. `<ChatInput.Send icon={…}>`). Keep one narrow exception only if a
  component has no composable form.

---

### F. Export the UI-kit primitives — ✅ in flight (PR #2798)

**Problem.** `DropdownMenu`, `Button`, `IconButton`, `Dialog`, etc. were used
*internally* (e.g. `ChatSidebar.Item`'s "…" menu is a `DropdownMenu`) but were
**not on any public export** — no `./ui`, `./components/chat`, or `./*`. So the
moment you compose a custom row with a menu, you couldn't reuse vf's own menu;
you hand-rolled one (our demo did). That directly blocked principle 2/3.

**Status.** **PR #2798 does exactly this** — moves the 39 primitives to
`src/react/components/ui/` and exposes a new **`veryfront/ui`** namespace
(`veryfront/ui`, `veryfront/components/ui`, `veryfront/react/components/ui`),
with `chat` depending on `ui` (never the reverse) and no break to existing
consumers. This is the base-layer split the rest of the handoff assumes.

**Remaining under this heading:** once merged, (a) `DropdownMenu` et al. import
from `veryfront/ui` — wire `<ChatSidebar.Item.Menu>` + `<DropdownMenu.Item>` so
adding a row-menu entry (§C) uses the real primitive, not a hand-roll; (b) ensure
every primitive is a **compound** with a single root `className` (feeds §C/§E);
(c) point the composed example at `veryfront/ui`.

---

### G. Fix composition-blocking type bugs

**Problem.** Components whose props are `extends React.HTMLAttributes<T>` without
re-declaring `children` fail to typecheck under React 19 types — `Property
'children' does not exist on type 'IntrinsicAttributes & AppShellProps'`. Hit on
`AppShell`, `AppShell.Sidebar`, `AppShell.Header`, and all `ChatEmptyState.*`.
This makes the *documented* composition examples not typecheck (they build,
because `veryfront build` skips `tsc`, but a consuming app that runs `tsc`
errors).

**Ask.** Explicitly declare `children: React.ReactNode` on every compound
component's props (don't rely on inherited `HTMLAttributes.children`). Add a
`tsc --noEmit` gate to CI so composition examples stay type-clean.

**React 19 modernization (`composition-patterns` §4.1).** The chat components use
`forwardRef` ~140× (e.g. `message.tsx` 6×, `chat-root.tsx` 1×) while
`ui/button.tsx` already dropped it — inconsistent and obsolete. Under React 19,
`ref` is a regular prop (no `forwardRef` wrapper) and `use(Context)` replaces
`useContext` (and can be called conditionally). Migrate wholesale so the codebase
models the current idiom consumers will expect to mirror.

---

### H. Collapse the deprecated flat controlled API

**Problem.** `ChatProps` carries a large `@deprecated` flat surface
(`messages`, `input`, `onChange`, `onSubmit`, `sendMessage`, `stop`, `reload`,
`setInput`, `model`, `activeModel`, `onModelChange`, `inferenceMode`,
`renderTool`, `quickActions`, `onQuickAction`, `showSources`, `showSteps`,
`showExport`, `editMessage`, `getBranches`, `switchBranch`, …) alongside the new
`chat={useChat()}`. Two ways to do everything = magic + confusion.

**Ask.** Remove the deprecated flat props. One controlled path:
`chat={useChat()}` (or `<Chat.Root>` context). Document the migration.

---

### I. Split presentation from business logic (headless)

**Problem.** Several components fuse logic with rendering, which is the root cause
the acid test fails: if `<ChatSidebar.Item>` owns select/rename/delete *and* the
row markup, you can't change the row without inheriting or discarding its logic
(exactly why our `renderItem` had to reimplement rename as `prompt()`).

**Ask.** Enforce the headless split across the surface:
- **Logic → hooks/providers/context.** `useConversations`, `useConversationChat`,
  `useAgentPicker`, composer context, message context — these own state,
  handlers, and side effects.
- **Presentation → components.** Every component is a thin, dumb consumer of that
  context (or of props): it reads `select`/`rename`/`isActive` from context and
  renders. No fetching, no effects, no persistence inside a presentational node.
- **Result:** because the row is dumb and pulls behaviour from context, a custom
  row (or a swapped leaf) keeps *all* the behaviour for free — the acid test
  passes by construction. This is the Radix/Headless-UI/TanStack separation and
  it's what React developers expect.

**Current state (not there yet).** `ChatContextValue` and `ComposerContextValue`
are **flat bags** — state (`messages`, `input`, `isLoading`), actions
(`setInput`, `onSubmit`, `editMessage`), and meta (`theme`, `scrollToBottom`,
`isAtBottom`) all mixed in one interface, and `showSources: boolean` is baked
*into the context* (a toggle in the shared contract). And the "provider"
(`ChatRoot`) is fed ~25 flat props rather than injecting a state owner.

**Sub-ask — adopt the generic `{ state, actions, meta }` context interface**
(`composition-patterns` §2.2/§2.3). Restructure each context as a contract any
provider can implement:

```ts
interface ChatContextValue {
  state:   { messages; input; isLoading; error; model; attachments }
  actions: { setInput; submit; stop; reload; setModel; attach; edit }
  meta:    { agent; theme; scrollToBottom; isAtBottom }
}
```

Then **different providers implement the same interface** and the *same* UI
composes over all of them — which is precisely how batteries `<Chat>` and the
hand-composed demo share one implementation (principle 9): e.g. a
`ConversationChatProvider` (persisted), an `EphemeralChatProvider` (local), a
`ServerChatProvider` (route-persisted, §A) all satisfy `ChatContextValue`.

This also **kills the persistence effect the right way.** `composition-patterns`
§2.3 shows the exact anti-pattern — *"Incorrect: useEffect to sync state up"* →
*"Correct: lift state into a provider."* Our `usePersistMessages` effect is that
"sync up" smell; lifting chat+persistence into the provider (§A) removes it, and
lets components *outside* the transcript (a header token counter, a preview)
read chat state from context without prop-drilling or refs.

**Hooks vs components — don't hookify presentation.** The scoping discipline
applies to *data*, not every node:
- **Data/state → scope-prefixed hooks:** `useMessage()`, `useConversation()`,
  `useComposer()`, `useAgents()`. The prefix names *where the data lives*. One
  context hook per scope — not one per pixel.
- **Collections → list hooks** returning arrays (`useMessageParts`,
  `useConversationMessages`, `useConversationAttachments`) — data you map (§K).
- **Display → compound components reading context:** `Message.Avatar`,
  `Message.Header`, `ChatInput.Send`. Scope comes from the *namespace*
  (`Message.*`), not a hook. So a message avatar is `Message.Avatar` (reads
  `useMessage()`), **not** a `useConversationAvatar`; there is no hook per visual
  node. Rule: hook when it's data/state you read or mutate; component (reading
  context) when it's a presentational node.
- **One hook per scope, structured — not one per slice.** Access is
  `const { state, actions, meta } = useMessage()`. `useMessageActions` /
  `useMessageMeta` are just `.actions` / `.meta` — a destructure away; don't ship
  them as separate hooks (surface for nothing). Split `state` and `actions` into
  separate *contexts* only as a *measured* render-isolation optimization (actions
  are stable; action-only consumers shouldn't re-render on state change) — an
  internal optimization, never the default surface.

> Acceptance: every presentational component can be replaced by a hand-written
> equivalent that reads the same `{state, actions, meta}` context and loses
> **no** behaviour; the same composed UI renders under ≥2 different providers.

### J. Storybook is the completeness contract (started, unfinished)

**Problem.** The composition story was *begun* in Storybook (there are
`Composed` stories for `Chat`, `ChatInput`, `ChatSidebar`, `ToolCall`, …) but not
finished to satisfaction — coverage is partial and inconsistent, so the acid test
isn't provable per-component. Concretely, `storybook:check` **already fails on
`main`**: the Overview `COMPOSITION` array and `storybook/stories/chat/
ChatComposition.stories.tsx` don't exist (noted in PR #2798). The composition
narrative was scaffolded and abandoned — this section is about finishing it.

**Note:** PR #2798 already splits the Storybook sidebar into a top-level **UI**
section and a **Chat** section — the right structure to build the three-tier
stories onto.

**Ask.** Make Storybook the enforced contract. **Every** component ships **three
stories, all backed by the same implementation:**

1. **Black box** — defaults only (`<Chat/>`, `<ChatSidebar/>`), proving great
   out-of-the-box behaviour.
2. **Props** — customized via props (icons, labels, class, handlers), proving the
   common "change X" cases idiomatically.
3. **Compound** — fully composed from sub-components down to the leaves, proving
   "change X on Y buried in Z" for that component.

Additionally:
- A story per component demonstrating the **acid test** explicitly: "change this
  one leaf" (e.g. swap the send icon, add a sidebar-menu item, restyle the tool
  output) — each a few lines, no region re-implementation.
- The docs "Composition" tab must render the full sub-component tree (many
  already do — finish the ones that don't).
- Gate CI on Storybook build + a `tsc --noEmit` over the stories so the
  documented composition always typechecks (see §G).

> Acceptance: for every exported component, all three tiers render in Storybook,
> and there is a one-leaf-override story that compiles and works.

### K. Codify the "collection pattern" and apply it to every list

The Message-parts resolution (§D.3) isn't a special case — it's the shape **every
collection** in the chat domain should share. **It is the data/display split
(principle 2, §I) applied to lists:** the hook is the *data*, the leaf/primitive/
batteries are *display*. Define it once, apply it uniformly, so the whole API is
learnable from any one list ("if you know parts, you know attachments").

**And it's always achievable** — the data already exists as hooks
(`chat.messages`, `useUpload().attachments`, `useAgents().agents`,
`useConversations().conversations`). The display components exist too. The only
work is *decoupling* them: stop having the display component own the iteration +
data plumbing, and expose the data hook + a leaf so the consumer can map. Nothing
here requires new capability — just separating what's already there.

The four access points, all off one implementation:

1. **`useX()` → data** (headless; e.g. `useMessageParts`, `useUpload().attachments`).
2. **`<X.Item>` / leaf** — the composable default for one element
   (`Message.Part`, `AttachmentPill`, `SourcePill`, `ChatSidebar.Item`).
3. **`<X.List>` primitive** — iterates + function-child `({ item }) => …`,
   renders defaults when you return nothing (assistant-ui shape).
4. **`<X>` batteries** — `<X.List>` with the default renderer. Zero-config.

Apply to (components/hooks that exist today but aren't unified on this shape):

| Collection | Data | Leaf | Batteries | Heterogeneous |
| --- | --- | --- | --- | --- |
| Message parts (incl. file attachments) | `useMessageParts()` | `Message.Part` | `Message.Content` | ✅ |
| Composer attachments (pending draft) | `useComposerAttachments()` *(today `useUpload().attachments`)* | `AttachmentPill` | composer strip | ✅ mediaType |
| Conversation files (durable) | `useConversationAttachments()` *(today `useUploadsRegistry`)* | `AttachmentPill` | `AttachmentsPanel` | ✅ mediaType |
| Transcript | `useConversationMessages()` *(today `chat.messages`)* | `Message.Root` | `ChatMessageList` | ~ role |
| Conversations | `useConversations().conversations` | `ChatSidebar.Item` | `ChatSidebar.List` | ~ recency |
| Sources | `extractSourcesFromParts()` | `SourcePill` | `Sources` | — |
| Agents | `useAgents().agents` | `AgentPicker.Item` | `AgentPicker` | — |
| Suggestions | `agent.suggestions` | `Suggestion` | `Suggestions` | — |
| Steps | `useMessageParts()` | `StepIndicator` step | `StepIndicator` | — |
| Branches | `chat.getBranches()` | — | `BranchPicker` | — |
| Models | prop | `ModelOption` | `ModelSelector` | — |

**Priority within §K:** **attachments** (heterogeneous `switch` on file type — the
exact twin of parts) and **transcript** (the message list) are the highest-value
unifications; the homogeneous lists are mechanical once the shape is a documented
house rule.

> Acceptance: a single "Collections" doc page + Storybook section shows the
> identical four-tier pattern for parts, attachments, and the transcript; the
> rest follow by convention.

## Changes in THIS example repo once the above land

The composed demo (`app/custom/page.tsx`) currently carries the workarounds the
above changes eliminate. When they land, delete:

- `usePersistMessages` + its `useRef`/`useEffect` → replaced by
  `useConversationChat` / `<ConversationChat.Root>` (§A).
- The hand-rolled `ConversationRow` popover + native `prompt()` → `ChatSidebar.Item`
  sub-parts + `DropdownMenu` from **`veryfront/ui`** (§C, §F/PR #2798).
- The `MailIcon` stays (legit), but via `<ChatInput.Send icon>` (already fine).
- Any remaining boolean props (none should survive §B).
- The `AppShell`/`ChatEmptyState` `tsc` suppressions (§G).

Result: `app/custom/page.tsx` becomes pure composition of public parts with no
custom logic — the reference for Demo 2. `app/page.tsx` stays the 1-line Demo 1.

---

## Suggested phasing

1. **§F (export ui)** — ✅ in flight as **PR #2798** (`veryfront/ui`). Land it
   first; it's the base-layer split everything else composes on. Pair with
   **§G (types)** — small, unblocks composition immediately.
2. **§I (headless split)** — foundational; it's what makes the acid test pass.
   Land the presentation/logic separation before the depth work builds on it.
3. **§A (state glue)** — the headline; `useConversationChat` + route `onFinish`,
   refactor `<Chat>` onto it (consumes §I).
4. **§C/§D (leaf composition + render-prop parity)** — the depth work: reach
   every child node, unify render props.
5. **§B/§E/§H (toggle/className/deprecation cleanup)** — API-surface polish;
   coordinate as breaking changes / a major.
6. **§J (Storybook contract)** — runs *alongside* every phase: each component
   isn't "done" until its three-tier + acid-test stories exist and typecheck.

The through-line: **§I + §J are the definition of done.** Every component lands
its headless split and its three Storybook tiers, or it isn't finished.

---

## Appendix — evidence (shipped `veryfront@0.1.998`)

- **Persistence bridge is `<Chat>`-private:** `react/components/chat/chat/index.tsx`
  `UncontrolledChat` — `useEffect(… sink(conversation) …, [chat.messages, boundId])`
  with `persistRef`/`lastEmittedRef`.
- **`showSources` deprecated:** `ChatProps` — "Sources render automatically when a
  message carries them"; `MessageContentProps` — "Prefer composition — render
  `Message.Sources` or omit."
- **Boolean toggles (count):** `showSources`, `showSteps` (×5 each),
  `showScrollButton`, `showMessageActions`, `showExport`, `showTabs`,
  `hideTabSwitcher`, `enableAttachments`, `enableVoice`, `enableMermaid`,
  `showSearch`, `showLabel`, `showRemove`.
- **Second class-names / passthrough:** `contentClassName`, `cardClassName`,
  `dragProps`.
- **`icons={{}}` slot objects (7):** `ChatInputIcons`, `ChatSidebarIcons`,
  `AgentPickerIcons`, `MessageActionBarIcons`, `MessageFeedbackIcons`,
  `BranchPickerIcons`, `AttachmentPillIcons`.
- **Render props present (unstandardized):** `renderTool`, `renderMessage`,
  `renderItem`, `renderRow`, `renderPill`, `renderCodeBlock`,
  `renderScrollButton`, `renderTrigger`, `renderSkill`, `renderHeader`,
  `renderCard`.
- **UI kit not exported** (being fixed by **PR #2798**): shipped
  `package.json#exports` has no `./ui` / `./components/chat` / `./*`;
  `DropdownMenu` lives at `react/components/chat/ui/dropdown-menu` (used by
  `ChatSidebar.Item`) but is unreachable publicly. #2798 promotes these to
  `veryfront/ui`.
- **Flat contexts + boolean-in-contract:** `ChatContextValue` /
  `ComposerContextValue` mix state/actions/meta flatly and include
  `showSources: boolean` (context files under `chat/chat/contexts/`).
- **`forwardRef` ~140× across chat components** (message.tsx 6×, chat-root 1×),
  while `ui/button.tsx` already dropped it — React-19 migration pending.
- **Storybook composition incomplete:** `storybook:check` fails on `main` — the
  Overview `COMPOSITION` array and `stories/chat/ChatComposition.stories.tsx`
  don't exist (per PR #2798).
- **Type bug:** `tsc --noEmit` errors `children does not exist on AppShellProps`
  / `ChatEmptyStateRootProps` (props extend `HTMLAttributes` without re-declaring
  `children`).
- **External references:** AI SDK v5 server-side `onFinish` persistence
  (ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence); TanStack AI planned
  `ChatPersistenceAdapter` (github.com/TanStack/ai/discussions/201).
```
