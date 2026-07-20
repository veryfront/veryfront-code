# RFC: `veryfront/chat` API shape — a reset

> **Per-piece documentation:** every proposed component and hook has a user-facing docs page under [`29-chat-api-shape/`](./29-chat-api-shape/README.md) — 25 components, 34 hooks, helpers, providers.

**Status:** draft for discussion. **North star: `veryfront/ui`.** Chat should be a
**regular component library built exactly like `veryfront/ui`** — each component a
single, fully-controllable node. `veryfront/ui` already nails this (it's a Radix-API
fork + `cva`, `asChild`, `extends HTMLAttributes`); `veryfront/chat` should follow
the same convention and **build on those primitives**. No installer, no copied
source, no headless-only detour — just clean components you fully control from the
import. **Goal:** every node and every attribute is the consumer's.

## The `veryfront/ui` convention chat must adopt

This is *already how `ui/button.tsx` and `ui/dropdown-menu.tsx` are written* — apply
it to every chat component:

1. **`extends React.HTMLAttributes<T>`** (the right element type) and **`{...props}`
   onto the single node.** That one line is what makes *every* native attribute the
   consumer's: `className`, `style`, `data-*`, `aria-*`, `onClick`, `id`, `ref`.
2. **`asChild`** (the `ui` `Slot`) on every component — swap `div`→`p`, merge onto
   your own element.
3. **`cva` variants + `className` merge** (`cx`) for styling — same tokens as `ui`.
4. **`ref` as a prop** (React 19), like `ui`.
5. **Compound + single node** — `DropdownMenu` is the template: `Root/Trigger/
   Content/Item`, each one node, `Trigger` `asChild`.

```tsx
// a chat leaf, written like a ui component:
export interface ChatInputSubmitProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
}
export function ChatInputSubmit({ asChild, className, ...props }: ChatInputSubmitProps) {
  const chatInput = useChatInputContext()        // behaviour from the hook
  const Comp = asChild ? Slot : Button
  // consumer props go INTO the getter — handlers compose, className merges (rule 9)
  return <Comp {...chatInput.getSubmitProps({ className: cx('…', className), ...props })} />
}
```

Now the consumer gets everything for free: `<ChatInput.Submit data-x aria-label="Send"
className="…" onClick={…} asChild>` — or swaps the element entirely.

---

## The one principle

> **The library owns behaviour and state (hooks). The consumer owns markup (every
> div, every class).**

Everything follows from this. React Aria proves you can do it **from a plain
package import**: hooks return **prop getters** (props you spread onto elements you
render) and primitives take **`asChild`** (merge behaviour onto your element). No
copying source, no CLI — **every node and every attribute is already in the
consumer's hands** through the API. The thing we keep tripping on — a component
that renders DOM you can't reach — simply never exists.

**Why a per-node `className` prop is not the fix.** Customizing a node means owning
the *element*, not decorating it — the consumer may want to **change the tag**
(`div` → `p`, `button` → `a`), **add `data-*` / `aria-*` attributes**, wrap it, or
change its children. A `className` prop hands you none of that; it just lets you
paint a box the library still owns. The only real answer is to **own the element**
— via `asChild` or prop getters. So the requirement isn't "expose more class
hooks"; it's "never render an element the consumer can't supply themselves."

## Hard rules (what "clean" means here)

1. **No `xxxClassName` / `xxxProps` bags. Ever.** One `className` targets one node.
2. **No hidden DOM.** A primitive renders **one** element (or merges onto yours via
   `asChild`). Structure = you compose primitives + your own divs. There is never
   an "inner div you can't class" — because you rendered it.
3. **`asChild` everywhere** (Radix Slot). Any primitive can merge its behaviour +
   a11y onto *your* element, so you pick the tag and own all classes.
4. **Prop getters for full headless.** Hooks return `getXProps()` you spread — you
   render the elements. (React Aria model.)
5. **Config lives on the component that uses it.** `models` goes on the model
   selector, not the root. Root context is opt-in (Layer 2), never required.
6. **Scoped context, not app-wide magic.** A `<ChatInput>` shares state with *its*
   children only; it is not a global store the whole tree reads implicitly.
7. **Style state via `data-*`, not props.** `data-streaming`, `data-active`,
   `data-loading` — style with CSS/Tailwind variants, no boolean props. (React
   Aria model.)
8. **Backward compatible / additive.** The current styled components stay and get
   re-implemented *on top of* the new layers; nothing is ripped out.
9. **Merging is exact, or the contract is a lie.** Handlers compose (consumer
   first, `preventDefault` cancels internal), classes merge Tailwind-aware
   (consumer wins), refs compose, getters take overrides. See *Merge semantics* —
   normative, conformance-tested.
10. **Default-render parity: the styling is already right — keep it.** The
   reshape moves *ownership* of nodes; it does not redesign them. For every
   component, the childless/L1 default render must produce the **identical DOM
   tree and classes as today** — zero layout regressions. Wrappers deleted from
   a primitive (e.g. `ChatInput`'s internal centering div, `ChatRoot`'s
   container) reappear as explicit markup in the printed default composition,
   so pixels never change. The only DOM deltas permitted are the ones
   explicitly badged `changed` in the docs with a stated reason (currently:
   `ChatMessageList`'s two-node root collapse, `StepIndicator`'s `<ol>/<li>`
   restructure, `Message.Tokens`' popover trim) — each is a review item, not a
   side effect. The conformance harness pins this with default-render DOM
   snapshots.

---

## Cross-cutting contracts

These apply to every piece; reference blocks cite them instead of restating them.

### Merge semantics (normative)

1. **Event handlers compose, never clobber.** Consumer handler runs first; if it
   calls `event.preventDefault()`, the internal handler is skipped (Radix
   `composeEventHandlers` semantics). A naive `{...getXProps()} {...props}` spread
   is **not** the pattern: L2 components compose internally; L3 consumers pass
   their props *into* the getter.
2. **`getXProps(overrides?)`** — every prop getter accepts the consumer's props
   and returns the merged result: handlers chained per rule 1, `className` merged
   per rule 3, `style` shallow-merged consumer-wins, `id`/`aria-*` consumer-wins.
3. **`className` merges Tailwind-aware** (`cx` = clsx + tailwind-merge): consumer
   classes beat variant defaults (`p-4` overrides a default `p-2`).
4. **Refs compose.** The `ref` prop and internal refs are merged; none dropped.
5. **`asChild` applies the same single merged result** onto the child element per
   rules 1–4; getters are never double-applied.
6. **`mergeProps` is public API** — the exact merge used internally, exported for
   L3 consumers composing several hooks onto one element (React Aria model).

### `data-*` state contract

State is exposed as data attributes (CSS variants + test selectors), never boolean
styling props. Global vocabulary (each block lists which apply):

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-status="ready\|submitted\|streaming\|error"` | `ChatRoot` · `ChatInput.Root` · `.Submit` | session status (mirrors `useChat().status`) |
| `data-streaming` | `Message.Root` · `.Text` · `Reasoning.Root` | this content is streaming now |
| `data-role="user\|assistant\|system"` | `Message.Root` | author |
| `data-agent-id="<id>"` | `Message.Root` | producing agent (per-message — multi-agent ready) |
| `data-state="input-streaming\|input-available\|output-available\|output-error\|approval-requested\|approval-responded\|output-denied"` | `ToolCall.Root` | tool lifecycle incl. human-in-the-loop approval |
| `data-open` | disclosure + popper roots/triggers (`ToolCall`, `Reasoning`, `Sources`, `ChatInput.Model`, `AgentPicker.Trigger`, `ChatActions.Trigger`, `InlineCitation`) | expanded |
| `data-state="pending\|active\|complete"` | `StepIndicator` steps | step lifecycle |
| `data-active` | `ChatSidebar.Item` · picker items · `AttachmentsPanel.Item` · `BranchPicker` | selected |
| `data-loading` | async containers (`ChatMessageList`, `AttachmentsPanel.Root`, `ChatSidebar.Root`) | fetch in flight |
| `data-invalid` | `AgentPicker` inputs | validation failed (kept from today) |
| `data-error` | `Message.Root` · attachment rows | errored |
| `data-upload-state="idle\|uploading\|processing\|error\|done"` | `AttachmentPill.Root` · `AttachmentsPanel.Item` | upload lifecycle |
| `data-empty` | list containers | zero items |
| `data-editing` | `Message.Root` | edit composer active |
| `data-copied` | copy buttons | transient copied feedback |
| `data-dragging` | `ChatInput.Root` (drop target) | file drag-over |
| `data-compact` | `ChatInput.Root` | single-line/narrow layout |
| `data-at-bottom` · `data-autoscrolling` · `data-scrollable` | `ChatMessageList` | scroll state — updated imperatively (no React re-render per scroll tick) |
| `data-floating` | `Message.Actions` | hidden-but-animatable (never unmount-to-hide) |
| `data-listening` | `ChatInput.Voice` | dictation active |
| `data-disabled` | any interactive leaf | disabled |

### Prop getters — resolved

L2 primitives are the 95% path. **Every stateful hook still exposes getters for
its interactive nodes, because the L2 components are implemented with them** — so
the two can never drift. Display-only leaves (`Message.Avatar`, `Sources.Pill`
label) need no getter: hook state + your element suffices. Each hook's reference
block lists its exact getters.

### TypeScript generics (locked before v1 — retrofit would be breaking)

- **Messages:** `ChatMessage<TMetadata, TDataParts, TTools>` (AI SDK v5
  `UIMessage` shape). `useChat<TMessage>` preserves the type through
  `useMessageParts`, `Message.Parts`' render prop, and helpers.
- **Tools:** `useToolCall<TTools>` narrows per tool name (`part.type ===
  'tool-…'`). The tools registry (below) is typed against `TTools` — a wrong
  renderer signature is a compile error.
- **Data parts** flow typed through the same path; custom part renderers receive
  the narrowed part type.

### Part rendering & the tools registry (per-piece ejection at every layer)

The most common customization — "render *this* tool/part my way" — must never
force ejecting the tree:

- **L1:** `<Chat tools={{ web_search: MyToolCard }} />`
- **L2:** `<ChatMessageList tools={…}>`, or per-message `<Message.Parts>{(part) => …}</Message.Parts>`
- **L3:** `useMessageParts()` + your own switch.

Resolution order (assistant-ui model): inline render fn → registry by name →
default renderer. Registry values are components receiving the typed part.

### The markdown exception (the only sanctioned multi-node primitive)

`Markdown` (and therefore `Message.Text`) necessarily renders a node tree — the
one documented exception to the node contract, tamed by:

- **`components={{ code, a, img, table, … }}` override map** (react-markdown
  convention): every emitted element type is replaceable — still no unreachable
  node. `RichCodeBlock` is the default `code` renderer; swap it via the map.
- **Streaming is owned here** (streamdown model): incremental block parsing (only
  the tail block re-renders per token), unterminated fence/emphasis repair, and
  hardening via `allowedLinkPrefixes` / `allowedImagePrefixes`.
- **Inline citations** are an override slot (`components.citation`) rendering
  footnote markers from source parts; default = numbered pills.

### Scroll contract (`useChatScroll`, subsumes `useStickToBottom`)

Transcript scrolling is a subsystem, not a boolean (per shadcn MessageScroller /
assistant-ui viewport):

- **State:** `isAtBottom`, `isAutoScrolling`, `currentAnchorId`,
  `visibleMessageIds` (opt-in subscription).
- **Actions:** `scrollToBottom()`, `scrollToMessage(id)`, `scrollToStart/End()`.
- **Behavior:** escape-on-scroll-up + resume threshold; `turnAnchor:
  "bottom" | "top"` (ChatGPT-style user-turn-to-top); position restore on thread
  switch; `preserveScrollOnPrepend` for paged history.
- **Leaves:** `ChatMessageList.ScrollButton` (inert + unfocusable at bottom).

### Streaming a11y contract

- `ChatMessageList.Content`: `role="log"`, `aria-relevant="additions"`,
  `aria-busy` while streaming (no token-level SR spam); completion announced once
  via a visually-hidden `role="status"` region.
- Errors render with `role="alert"`; decorative icons/shimmer are `aria-hidden`.
- `getFieldProps` guards IME composition (no CJK double-submit); `submitMode:
  "enter" | "ctrlEnter" | "none"` on `useChatInput`.

### State ownership (resolves the races)

- **Input state has one owner: `useChatInput`** — controlled (`value`/`onChange`)
  or uncontrolled; `useChat` does **not** expose `input`/`handleInputChange`.
  Voice folds in via `useChatInput({ voice })` — no userland transcript weaving.
- **Streams are provider-scoped, not mount-scoped:** keyed by conversation id in
  the conversations/chat context; switching threads neither aborts nor orphans an
  in-flight stream, and it persists to the correct thread. `useConversationChat`
  exposes `ready` — consumers never write their own thread-ready guard.
- **Editing reuses the composer:** `ChatInput` inside a `Message` *is* the edit
  form (context-sensitive, assistant-ui model); `Message.Root` gets
  `data-editing`; nearest provider wins — the explicit nested-context rule.
- **Context precedence everywhere:** explicit prop > nearest context > default.
- **Readiness flows into chat context:** `ChatContextValue` includes `ready:
  boolean` — `ChatRoot` reads `activeReady` from the nearest
  `ConversationsProvider` (standalone: `true`). `Chat.If` selectors and the
  default composition gate skeletons on it; consumers never re-derive it.
- **The edit mechanism, concretely:** `useChatInput` reads
  `useMessageContextOptional()`. Inside a message with `isEditing`, it seeds
  `value` from `textContent`, routes submit to `editMessage(message.id, value)`
  instead of `sendMessage`, and maps Escape to `cancelEdit`. No extra props —
  nesting *is* the wiring.
- **Scroll attachment + button anchoring:** `useChatScroll` returns
  `viewportRef` (and `getViewportProps(overrides?)`) — attach either to your
  scroller. `ChatMessageList.ScrollButton` anchors via `position: sticky` at
  the viewport's bottom edge (no wrapper node, no portal) — proposed
  resolution, review welcome.
- **`useReasoning` gets an explicit-input form** — `useReasoning({ text,
  isStreaming }?)` — so the L3 eject works without a `Reasoning.Root`
  (mirrors `useToolCall(part?)` / `useSources(message?)`).
- **`StepIndicator` model:** per-boundary context reader — `useStepIndicator()`
  → `{ stepIndex, state: 'pending' | 'active' | 'complete' }`, steps derived
  from `step-start` parts; `active` = the latest boundary while the message
  streams. One shape, both docs pages.
- **Audit-settled details:** `AttachmentPill.Root` takes `upload?:
  UseUploadResult`, defaulting to the nearest `ChatInput` context's upload —
  that's how `.Retry`/`.Remove` route without handler props. `ChatSidebar`
  gains `.Item.Menu.Trigger` (the icon-slot replacement). `Sources.Root` drops
  `data-open` (it has no disclosure). Childless `<Message.Parts/>` renders the
  default per-type mapping (registry-aware) — the public default for
  `.Content`. One conversation type: `Conversation` (no `ConversationSummary`).
  Optional context hooks return `null` (never `undefined`), library-wide.
  `Message.Tokens` popover trim is settled: it becomes a display-only `<span>`
  (breakdown popover falls to the popper open question). `formatSize` joins the
  public helpers. The canonical DOM-delta ledger is the docs pages' `changed`/
  `new` badges — rule 10's inline list is illustrative, not exhaustive.

---

## Three layers, one source of truth

Each layer is built from the one below. Pick your altitude.

```
L1  Preset (black box)    <Chat agentId api />
L2  Components (ui-style)  <ChatInput><ChatInput.Field/><ChatInput.Submit/></ChatInput>
L3  Headless hooks        const c = useChatInput(); <textarea {...c.getFieldProps()} />
```

### L3 — Headless hooks (React Aria style)

State + actions + **prop getters**. You render every node. Total control, zero DOM
opinion. This is the foundation the other layers compose.

```tsx
const chat = useChat({ api })                  // messages, status, streamingMessageId, sendMessage…
const chatInput = useChatInput({ chat, upload }) // input state + submit (folds attachments, guards uploads)
const parts = useMessageParts(message)         // typed part list
const tool = useToolCall(part)                 // expanded state, input/output/error
const sources = useSources(message)            // citation list
const attachments = useAttachments({ url })    // durable files
const picker = useAgentPicker()                // context reader: open, query, options, select
const list = useConversations()                // conversations, active, select/create/rename/remove

// You render the DOM:
<textarea {...chatInput.getFieldProps()} className="my-input" />
<button {...chatInput.getSubmitProps()} className="my-btn">
  {chatInput.isStreaming ? <Stop/> : <Send/>}
</button>
```

`useChatInput` owns the submit fold/guard/clear (kills the userland glue). Prop
getters carry the a11y + handlers; **you** own the tag and classes.

### L2 — Primitives (Radix / React-Aria-Components style)

Thin components over L3. **Single node each**, `asChild`, scoped context, `data-*`
state. You still add the layout divs. No config threaded through a root.

**Node contract (the guarantee).** Every primitive renders **exactly one** DOM node
— never a private stack of wrappers:
- **Leaf** primitives *are* one element: `ChatInput.Field` → one `<textarea>`,
  `ChatInput.Submit` → one `<button>`, `ChatInput.Model` → one trigger.
- **Container** primitives render **one** semantic node and provide context to
  their children: **`ChatInput` → a single `<form>`**, `Message` → a single
  `<article>`, `MessageList` → a single scroll container. They add **zero** wrapper
  divs — *you* supply every layout div in between.
- Every one of these is `asChild`, so the single node is *yours* to swap
  (`div`→`p`), attribute (`data-*`), and class.

So `<ChatInput>` is **one `<form>` + context** — not an input chrome. This is the whole "no div you can't reach": between the form and
the textarea and the button, there is nothing but the markup *you* wrote.

```tsx
<ChatInput chat={chat} upload={upload}>       {/* scoped context for ITS children */}
  <div className="my-card">                    {/* YOUR layout div, YOUR class */}
    <ChatInput.Field className="my-input" placeholder="Ask…" />
    <div className="my-toolbar">              {/* YOUR div */}
      <ChatInput.Attach className="my-attach" />
      <ChatInput.Model models={MODELS} className="my-model" />   {/* config on the leaf */}
      <ChatInput.Submit className="my-submit" />  {/* one node; style via [data-status="streaming"] */}
    </div>
  </div>
</ChatInput>
```

`asChild` when you want your own element to *be* the control:
```tsx
<ChatInput.Submit asChild>
  <MyFancyButton>Send</MyFancyButton>
</ChatInput.Submit>
```

Same for messages — every part-type is a reachable node, no opaque `Message.Part`:
```tsx
<Message message={m}>
  <Message.Parts>
    {(part) =>
      isToolPart(part)      ? <ToolCall part={part} className="my-tool"/> :
      isReasoningPart(part) ? <Message.Reasoning part={part} className="my-reason"/> :
                              <Message.Text part={part} className="my-text"/>}
  </Message.Parts>
</Message>
```

### L1 — Preset (black box)

The batteries default, built from L2 with sensible defaults.
```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

---

## The adoption journey — pit of success

The three layers are not three products; they are **one graduation path**. A
consumer must be able to *choose their journey* and evolve without ever hitting a
rewrite cliff:

1. **Start black-box (L1).** `<Chat agentId api/>` — running in five minutes,
   zero decisions.
2. **Customize a piece (L1 → L2).** The L1 preset's **default composition is
   public**: the RFC (and later the docs) print the exact L2 source that `<Chat>`
   renders. Ejecting = paste that composition and edit the one piece you care
   about. Everything else keeps working because it *is* the same code path.
3. **Rebuild entirely (L2 → L3).** Any L2 leaf can be replaced, one at a time, by
   your own element driven by the same hook (`asChild` or prop getters). Full
   custom DOM, same behaviour, no forked logic.

**Requirements this places on the API (checked per piece in the reference):**
- Every L1 default is expressible as documented public L2 — no private components,
  no internal-only props.
- Every L2 component is a thin shell over a public L3 hook — the hook is exported
  and sufficient to rebuild the component verbatim.
- Steps are *per-piece*, not all-or-nothing: swapping one message part or one
  toolbar button never forces ejecting the rest of the tree.
- Each component-reference block includes its **eject path**: L1 appearance → L2
  composition → L3 hook, so the journey is visible in the docs for every piece.

---

## How this dissolves the problems we hit

| Pain (from the composed example) | Resolution |
| --- | --- |
| "how do I class/attribute/retag the node inside X?" | Every node `extends HTMLAttributes` + `asChild` — it's yours (className, `data-*`, tag). No hidden div. |
| `models` on the root felt wrong | Config on the leaf (`ChatInput.Model models=`); root context is opt-in only. |
| `usePersistMessages` effect | `useConversationChat` / `useChatInput` own it (L3). |
| `isStreaming` index math | `data-streaming` from context; or `chatInput.isStreaming`. |
| re-threading ~30 props | L2 scoped `<ChatInput chat={chat}>`; or L3 prop getters. No app-wide root magic. |
| `AttachmentsPanel.Item` opaque | It's a primitive over `useAttachments`; compose the row or use the hook. |
| suggestion massaging / `.find` | `useAgent`/helper returns `{ label, prompt }[]`; callback returns the item. |

The six issues already filed (#2973–#2978) become **the first concrete steps** of
L2/L3 rather than one-off patches.

---

## Full API inventory

The complete surface, reshaped onto the convention above. **Every component
`extends` the native attributes of its node, spreads `{...props}` onto that one
node, and takes `asChild`.** Every stateful domain has a **hook** (L3) that its
components (L2) consume. Node in `<angle>`.

### Session & thread
| Piece | Kind | Notes |
| --- | --- | --- |
| `useChat` | hook | base session: `messages`, `status`, `error`, `streamingMessageId`, `sendMessage`, `stop`, `reload(messageId?)`, `setModel`, `editMessage`, `setMessages`; per-message `status`/`error` on the message object; transport option. Input state lives in `useChatInput` (see State ownership) |
| `useConversationChat` | hook | `useChat` bound to a `ConversationsProvider`'s active thread (seed + persist) → `{ chat, bound, resolvedAgentId, ready }` |
| `useCompletion` | hook | one-shot text (non-chat) |
| `useStreaming` | hook | low-level stream state |
| `useChatActions` | hook | context reader for the `ChatActions` compound only — thread-level export/clear *compose from* `exportAsMarkdown`/`downloadMarkdown` + `setMessages` |
| `useChatContext` / `…Optional` | hook | read `ChatRoot` context |
| `Chat` | **L1 preset** | `<Chat agentId api/>` |
| `ChatRoot` | provider | scoped chat context; renders **no node by default** (`asChild` for a node) |
| `ChatMessageList` | `<div>` scroll container | `.Content` (role="log") · `.ScrollButton`; contract = `useChatScroll` |
| `ChatThemeScope` | `<div>` | token scope |
| `ChatErrorBoundary` | component | error boundary; `useChatErrorHandler` |

### ChatInput
`useChatInput` · `useChatInputContext` · `useVoiceInput` · `useUpload`
**`ChatInput`** — `Root <form>` · `.Field <textarea>` ·
`.Attach <button>` · `.Model <button/trigger>` · `.Voice <button>` · `.Submit
<button>` (Send↔Stop by state) · `.Send <button>` · `.Stop <button>` · `.Export
<button>` · `.Toolbar <div>`.

### Message
`useMessageContext` · `useMessageParts` · `useClipboard`
**`Message`** — `Root <article>` · `.Avatar <div>` · `.Header <header>` (`.Name
<span>`, `.Timestamp <time>`) · `.Content <div>` · `.Parts` *(render-fn iterator,
no node)* · `.Text` · `.Reasoning` · `.Source` · `.File` · `.Image` · `.Sources
<section>` · `.Actions <div>` · `.CopyAction <button>` · `.RegenerateAction
<button>` · `.EditAction <button>` · `.BranchPicker <div>` · `.Tokens <span>` ·
`.Continuing <span>`.
*(`.Text/.Reasoning/.Source` per #2976; `.File/.Image` new; `.Feedback` cut from v1.)*

### Tool calls
`useToolCall` — **`ToolCall`** — `Root <div>` · `.Trigger <button>` · `.Body
<div>` · `.Input <pre>` · `.Output <div>` · `.Error <div>`.

### Reasoning · Steps · Sources
- `useReasoning` — **`Reasoning`** — `Root <div>` · `.Trigger <button>` · `.Content <div>`.
- `useStepIndicator` — **`StepIndicator`** — `Root <ol>` · `.Rule <li>` · `.Label <span>`.
- `useSources` — **`Sources`** — `Root <div>` · `.List <ul>` · `.Pill <a>`.
- **`InlineCitation`** — `.Trigger <a>` · `.Card <div>` (exists today; doubles as the default `components.citation` renderer in the markdown override map).
- **`ChatActions`** — `Root` · `.Trigger <button>` · `.Content <div>` · `.Item <button>` · `.Preset <button>`.

### Message actions
- **`MessageActionBar`** — re-export of the `Message.Actions` family
  (`.CopyAction` `.RegenerateAction` `.EditAction`; `.Copied` deleted →
  `data-copied`).
- **`BranchPicker`** — `Root <div>` · `.Previous <button>` · `.Count <span>` · `.Next <button>`.
- ~~`MessageFeedback`~~ — cut from v1 (no backend endpoint); returns additively later.

### Attachments
- *ChatInput, pending:* `useAttachmentPill` — **`AttachmentPill`** — `Root <div>` · `.Thumbnail <img>` · `.Icon <span>` · `.Label <span>` · `.Retry <button>` · `.Remove <button>`.
- *Durable files:* `useAttachments` · `useAttachmentsPanel` — **`AttachmentsPanel`** — `Root <div>` · `.Header <header>` · `.List <ul>` · `.Item <li>` (`.Icon` `.Preview` `.Remove` today; `.Name` `.Size` via #2975) · `.Loading <div>` · `.Empty <div>` · `.Action <button>`.

### Conversations
`useConversations` · `useConversation` · `useConversationsContext` ·
`ConversationsProvider`
**`ChatSidebar`** — `Root <nav>` · `.NewButton <button>` · `.List <ul>` · `.Group
<div>` · `.Item <li>` (`.Title <span>` *(#2977)*, `.Menu <DropdownMenu>`, `.Rename`,
`.Delete`) · `.Empty <div>`.

### Agents & models
- `useAgents` · `useAgentMetadata` · `useAgent` · `useAgentCard` · `useAgentPicker` · `useModelSelector`.
- **`AgentPicker`** — `Root` (provider) · `.Trigger <button>` · `.Content <div>` · `.Search <input>` · `.List <ul>` · `.Item <button>` · `.Create <button>` · `.Manage <button>`.
- **`ModelSelector`** — `Root · .Trigger · .Content · .Search · .List · .Item`.
- **`AgentCard`**, **`ChatAgentPicker`** — presets over the above.

### Empty state · Markdown · Shell
- **`ChatEmptyState`** — `Root <div>` · `.Avatar` · `.Heading <h2>` · `.Suggestions <div>` · `.Suggestion <button>`.
- **`Markdown`** / `RichCodeBlock` — rendered content (built on `ui/code-block`).
- **`AppShell`** (from `veryfront/ui`) — `.Sidebar · .SidebarHeader · .SidebarContent · .SidebarFooter · .Main · .Header · .Content · .Trigger`; `useAppShell` · `useChatScroll` · `ColorModeToggle`.

### Helpers (pure functions — no DOM)
`getTextContent` · `groupPartsInOrder` · `isToolPart` · `isReasoningPart` ·
`isSkillToolPart` · `extractSourcesFromParts` · `getAgentPromptSuggestions`
(+ **`getAgentPromptSuggestionItems`** — issue #2978) · `normalizeAgentMetadata` ·
`normalizeAgentsListResponse` · `exportAsMarkdown` · `downloadMarkdown` ·
`extractChatMessageMetadata`.

> **Every row is one node + `asChild` + `extends HTMLAttributes`.** That's the
> whole contract; there is nothing else to learn per component.

---

## Component reference

Per piece: node · props · sub-parts · hook · L1/L2/L3 · eject path. Everything
inherits the *Cross-cutting contracts* (merge semantics, `data-*`, getters,
generics) — blocks only state what's specific to them.

### `ChatInput` — the composer

- **Node:** `.Root` renders **one `<form>`** + scoped context. Zero wrapper divs
  (the current hidden `max-w-[850px]` div is deleted — layout is yours).
- **Props (`.Root`):** `extends React.FormHTMLAttributes<HTMLFormElement>` ·
  `asChild` · `chat?: UseChatResult` (else nearest `ChatRoot` context) ·
  `upload?: UseUploadResult` · `voice?: UseVoiceInputResult` · `value?/onChange?`
  (controlled) · `submitMode?: 'enter' | 'ctrlEnter' | 'none'`.
- **Sub-parts** (each one node, `asChild`, children replace the default icon):

  | Part | Node | `data-*` | Notes |
  | --- | --- | --- | --- |
  | `.Root` | `<form>` | `data-status` `data-dragging` `data-compact` | submit = fold attachments → guard while uploading → send → clear (#2974) |
  | `.Field` | `<textarea>` | — | IME-guarded Enter, `submitMode`, paste-to-attach |
  | `.Attach` | `<button>` | — | opens file picker |
  | `.Model` | `<button>` (trigger) | `data-open` | `models={…}` on the leaf; popper — see open question |
  | `.Voice` | `<button>` | `data-listening` | transcript folds into value via the hook |
  | `.Submit` | `<button>` | `data-status` | canonical morphing Send↔Stop |
  | `.Send` / `.Stop` | `<button>` | — | null-render when off-state |
  | `.Export` | `<button>` | — | `exportAsMarkdown` under the hood |
  | `.Toolbar` | `<div>` | — | pure layout convenience, optional |

- **Hook:** `useChatInput(options)` — options = the `.Root` props minus DOM.
  Returns state `{ value, canSubmit, status, isStreaming, attachments,
  isListening }` (`isStreaming` = `status === 'streaming'`, sugar the examples
  lean on),
  actions `{ submit, stop, clear, attach(files) }`, getters `getFormProps ·
  getFieldProps · getSubmitProps · getAttachProps · getVoiceProps ·
  getDropTargetProps` (all `(overrides?)`). Sole owner of input state; folds
  voice transcript; scoped via `ChatInputContextProvider` /
  `useChatInputContext(Optional)`.
- **L1:** rendered inside `<Chat/>`; every default reachable via the public
  composition. **L2:** `<ChatInput chat={chat}><ChatInput.Field/>…` (see
  Examples). **L3:** `const ci = useChatInput({chat}); <textarea {...ci.getFieldProps({onKeyDown})}/>`.
- **Eject path:** paste the L1 composition → restyle/reorder leaves (they're
  yours) → replace any leaf with your element via `asChild` or its getter.

### `AttachmentPill` — pending upload chip (composer-side)

- **Node:** `.Root` = one `<div>` (row card only when childless — render-or-
  compose, current behavior kept).
- **Sub-parts:** `.Thumbnail <img>` · `.Icon <span>` · `.Label <span>` ·
  `.Retry <button>` · `.Remove <button>` — each one node, `asChild`.
- **`data-*` (`.Root`):** `data-upload-state="idle|uploading|processing|error|done"` · `data-error`.
- **Hook:** `useAttachmentPill()` → `{ attachment, state, retry, remove }`
  (context reader; list comes from `useUpload().attachments`).
- **L2:** `<AttachmentPill attachment={a}><AttachmentPill.Label/>…`; **L3:** map
  `upload.attachments` to your own chips.
- **Eject path:** pill is per-item; replacing it never touches the composer.

### Hooks: `useUpload` · `useVoiceInput`

- **`useUpload({ api | transport, accept?, maxSize?, maxFiles? })`** →
  `{ attachments: AttachmentInfo[], upload(files), remove(id), retry(id),
  clear }` + `getDropTargetProps()` (whole-surface dropzone, sets
  `data-dragging`) + `getAttachInputProps()` (hidden `<input type=file>`).
  Errors surface per-attachment (`data-upload-state="error"` + `.Retry`), not
  as a global throw.
- **`useVoiceInput({ language?, continuous?, interimResults?, onTranscript? })`**
  → `{ isSupported, isListening, transcript, start, stop, toggle, clear,
  error }` (existing signature kept). Consumed via `useChatInput({ voice })` —
  no userland transcript weaving.

### `Message` — one message row

- **Node:** `.Root` = one **`<article>`** + scoped context
  (`MessageContextProvider`). No other node.
- **Props (`.Root`):** `extends React.HTMLAttributes<HTMLElement>` · `asChild` ·
  `message: ChatMessage<TMetadata, TDataParts, TTools>`. Session callbacks
  (`editMessage`, `reload`) come from nearest `ChatRoot` context — never
  re-threaded per message (kills the ~30-prop re-threading).
- **`data-*` (`.Root`):** `data-role` · `data-agent-id` · `data-streaming` ·
  `data-editing` · `data-error`.
- **Sub-parts** (one node each, `asChild`):

  | Part | Node | `data-*` | Notes |
  | --- | --- | --- | --- |
  | `.Avatar` | `<div>` | — | derives from **message** metadata (multi-agent ready) |
  | `.Header` / `.Name` / `.Timestamp` | `<header>` `<span>` `<time>` | — | |
  | `.Content` | `<div>` | — | |
  | `.Parts` | *(no node)* | — | render-fn iterator: `{(part) => …}`, typed, registry-aware |
  | `.Text` `.Reasoning` `.Source` `.File` `.Image` | per type | `data-streaming` on `.Text` | per-part leaves (#2976 + new file/image) |
  | `.Sources` | `<section>` | `data-empty` | |
  | `.Actions` | `<div>` | `data-floating` | hidden-but-animatable, never unmounted |
  | `.CopyAction` `.RegenerateAction` `.EditAction` | `<button>` | `data-copied` on copy | |
  | `.BranchPicker` | `<div>` | `data-active` | see `useMessageBranches` |
  | `.Tokens` | `<span>` | — | renders `ChatMessageMetadataUsage` |
  | `.Continuing` | `<span>` | — | |

- **Hooks:** `useMessageContext(Optional)` →
  `{ message, role, isStreaming, parts, textContent, copy, copied, isEditing,
  startEdit, cancelEdit, regenerate }`. `useMessageParts<TMessage>(message?)` →
  typed `PartGroup[]` (groups adjacent parts; `groupPartsInOrder` is the pure
  primitive under it, exported for L3). `useClipboard(text)` → `{ copied, copy }`.
- **Editing:** render a `ChatInput` *inside* the message when `isEditing` —
  nearest-provider-wins; no separate edit-form family.
- **Eject path:** parts first (`tools` registry / `.Parts` render fn) — restyling
  one part type never ejects the row; the row next; the list never.

### `ToolCall`

- **Nodes:** `.Root <div>` · `.Trigger <button>` · `.Body <div>` · `.Input` ·
  `.Output` · `.Error <div>`. `.Input`/`.Output` are `RichCodeBlock`/`Markdown`-
  backed (markdown exception applies — `components` map reaches them).
  `variant="compact"` is the retired `SkillTool`.
- **`data-*` (`.Root`):** `data-state` (full lifecycle incl.
  `approval-requested | approval-responded | output-denied`) · `data-open`
  (auto-opens on completion).
- **Hook:** `useToolCall<TTools>(part?)` — part explicit at L3, from context at
  L2 → `{ part, state, input (partial while streaming), output, error, isOpen,
  toggle, getTriggerProps, getBodyProps }`.
  Rendering resolution: inline render fn → `tools` registry by name → default.

### `Reasoning` · `StepIndicator` · `Sources` · `InlineCitation`

- **`Reasoning`** — `.Root <div>` (`data-open` `data-streaming`; auto-open while
  streaming, auto-close done) · `.Trigger <button>` · `.Content <div>`.
  `useReasoning()` → `{ open, toggle, isStreaming, duration, getTriggerProps,
  getContentProps }`.
- **`StepIndicator`** — `.Root <ol>` · `.Rule <li>` · `.Label <span>`;
  `useStepIndicator()` → step state (`data-state="pending|active|complete"`).
- **`Sources`** — `.Root <div>` (`data-open` `data-empty`) · `.List <ul>` ·
  `.Pill <a>`; `useSources(message?)` (explicit at L3, context at L2) → `{ sources, isEmpty }` over
  `extractSourcesFromParts`.
- **`InlineCitation`** — `.Trigger <a>` · `.Card <div>` (`data-open`); default
  renderer behind the markdown `components.citation` slot.

### `BranchPicker` · `MessageActionBar` (re-exports)

- **`BranchPicker`** = `Message.BranchPicker` — `.Root <div>` · `.Previous
  <button>` · `.Count <span>` · `.Next <button>`. `useMessageBranches()` →
  `{ index, count, previous, next }` — thin over the existing
  `getBranches`/`switchBranch` on `useChat`.
- **`MessageActionBar`** = `Message.Actions` family, one implementation
  (`.Copied` deleted → `data-copied`).

### `Chat` — the L1 preset

- **Props (trimmed from today's 28):** `agentId` · `api | transport` ·
  `uploadApi?` · `tools?: { [name]: Component }` · `labels?` (i18n) ·
  `chat?: UseChatResult` (controlled) · `children?` (compose inside the preset).
- **Compound (kept from today):** `.Root .MessageList .Input .Empty .Skeleton
  .If .Message .ErrorBanner`. `.If` is the selector conditional:
  `<Chat.If test={(s) => s.isEmpty}>…</Chat.If>` — no boolean-prop variants.
- **The default composition is public** — printed in the docs; ejecting = paste
  it (identical pixels: it carries the theme scope, providers, and default
  classes). Everything `<Chat>` renders is reachable L2.

### `ChatRoot` · `ChatThemeScope` · `ChatErrorBoundary`

- **`ChatRoot`** — the scoped session provider: `chat={useChat()}` is the single
  shared context (#2973); renders **no node by default** (a node only via
  `asChild`); precedence: explicit prop > this context > default.
- **`ChatThemeScope`** — one `<div>` carrying the token scope
  (`[data-vf-ui]`); the legacy string `ChatTheme` system is retired (ledger).
- **`ChatErrorBoundary`** — error boundary; `useChatErrorHandler()` →
  `{ error, handleError, clearError, hasError }` (existing signature). Errors
  render `role="alert"`.

### `ChatMessageList`

- **Node:** `.Root` = one scroll container `<div>`; `.Content` (`role="log"`,
  `aria-relevant="additions"`, `aria-busy` while streaming) · `.ScrollButton`
  (inert + unfocusable at bottom).
- **`data-*`:** `data-at-bottom` · `data-autoscrolling` · `data-scrollable`
  (imperative updates) · `data-loading` · `data-empty`.
- **Hook:** `useChatScroll` — the full scroll contract (see *Cross-cutting
  contracts*). Message iteration is `children` or the default map with the
  `tools` registry — `renderMessage` is deleted (composition, not render-prop
  config).

### Session hooks

- **`useChat<TMessage>(options)`** — see inventory row; adds the transport
  object, per-message `status`/`error`, `reload(messageId?)`; drops
  `input`/`setInput`/`handleInputChange` (ledger). Streams are provider-scoped
  (see State ownership).
- **`useConversationChat({ agentId?, api?, … })`** →
  `{ chat, bound, resolvedAgentId, ready }` — `ready` replaces every userland
  thread-ready guard (#2978).
- **`useChatContext(Optional)`** — reads `ChatRoot`'s context; raw context
  objects stay unexported (today's rule, kept).
- **`useCompletion` / `useStreaming`** — kept as today (one-shot text /
  low-level stream state); documented signatures, no reshape.

### `AttachmentsPanel` — durable files (same depth as messages)

- **Nodes:** `.Root <div>` (`data-loading` `data-empty`) · `.Header <header>` ·
  `.List <ul>` · `.Item <li>` (`data-upload-state` `data-active`) with leaves
  `.Icon <span>` · `.Preview <img>` · `.Name <span>` · `.Size <span>` ·
  `.Remove <button>` (today's `.Icon/.Preview/.Remove` + #2975's `.Name/.Size`)
  · `.Loading <div>` · `.Empty <div>` · `.Action <button>`.
- **Render-or-compose:** `.Item` renders default anatomy when childless; any
  children replace it entirely (no half-hidden row card).
- **Hooks:** `useAttachments({ url | transport, storageKey? })` →
  `{ items: UploadedFile[], isLoading, upload, add, remove, clear, refresh }` +
  per-item error state (no global `uploadError` — ledger). `useUploadsRegistry`
  alias deleted (ledger). `useAttachmentsPanel()` = the compound's context
  reader.
- **Eject path:** per-item — restyle `.Item` children or map `items` yourself;
  the panel chrome never holds the data hostage.

### `ChatSidebar` — conversations

- **Nodes:** `.Root <nav>` (`data-loading` `data-empty`) · `.NewButton <button>`
  · `.List <ul>` · `.Group <div>` · `.Item <li>` (`data-active`) with leaves
  `.Title <span>` (#2977) · `.Menu` (a `ui` `DropdownMenu`) · `.Rename` ·
  `.Delete` · `.Empty <div>`. `renderItem` deleted — compose `.Item` children
  or map `conversations` yourself.
- **Hooks:** `useConversations({ storageKey?, store? })` → `{ conversations,
  activeConversation, activeConversationId, isLoading, activeReady (#2978),
  select, create, rename, remove, update, save, bind,
  selectAgent(agentId, { conversation?: 'new' | 'same' }) }` (deprecated
  aliases `active`/`activeId` dropped — ledger). `useConversation(id)` →
  `{ conversation, isLoading, reload }`. `useConversationsContext(Optional)`
  reads `ConversationsProvider`.

### Agents & models

- **`AgentPicker`** — `.Root` (provider; popper — see open question) · `.Trigger
  <button>` (`data-open`) · `.Content <div>` · `.Search <input>` · `.List <ul>`
  · `.Item <button>` (`data-active`, `data-invalid` kept) · `.Create <button>` ·
  `.Manage <button>`. Boolean props `selected`/`isLoading`/`invalid` →
  `data-*` (ledger); `inputStyle` deleted. `useAgentPicker()` = context reader +
  `{ query, setQuery, options, select }`.
- **`ModelSelector`** — same anatomy minus `.Create/.Manage`;
  `useModelSelector()` reader; `models` config on the leaf/trigger, liftable per
  the escalation rule.
- **`AgentCard`** — `.Root <div>` · `.Header` · `.Reasoning` · `.Tools` ·
  `.Body` (today's parts kept); `useAgentCard()` reader.
- **`ChatAgentPicker`** — preset over `AgentPicker` (+ `agentsToPickerOptions`
  helper, public).
- **Hooks:** `useAgents({ enabled? })` → `{ agents, isLoading, error, refetch }`
  · `useAgentMetadata(agentId)` → `{ agent, isLoading, error }` ·
  `useAgent({ agent, onToolCall?, onToolResult?, onError? })` — existing
  signatures kept.

### `ChatActions`

- **Nodes:** `.Root` (provider) · `.Trigger <button>` (`data-open`) · `.Content
  <div>` · `.Item <button>` · `.Preset <button>`. `trigger?: ReactNode` prop
  deleted — compose `.Trigger` children (ledger). `useChatActions()` = context
  reader; thread-level export/clear compose from `exportAsMarkdown` /
  `downloadMarkdown` + `setMessages`.

### `ChatEmptyState`

- **Nodes:** `.Root <div>` · `.Avatar <div>` · `.Heading <h2>` · `.Suggestions
  <div>` (`data-empty`) · `.Suggestion <button>`. Suggestions come typed:
  `getAgentPromptSuggestionItems(agent)` → `{ label, prompt }[]` (made public,
  #2978) — selection hands the *item* back, no `.find` massaging.

### `Markdown` · `RichCodeBlock`

- **`Markdown`** — the sanctioned multi-node exception (see *Cross-cutting
  contracts*): `components={{ code, a, img, table, citation, … }}` override map;
  owns streaming (incremental parse, fence repair, prefix hardening).
  `renderCodeBlock` deleted — it's `components.code` (ledger).
- **`RichCodeBlock`** — default `components.code`; alias over `ui` `CodeBlock`
  (whose `copyIcon`/`collapseIcon` props fall to the icon-slot ban — ledger).

### `AppShell` (reference — lives in `veryfront/ui`)

`.Sidebar .SidebarHeader .SidebarContent .SidebarFooter .Main .Header .Content
.Trigger` + `useAppShell()`. Already shaped; chat consumes, doesn't own.
`useColorMode` / `ColorModeProvider` / `ColorModeToggle` documented as-is.

### Providers

`ConversationsProvider` · `ChatContextProvider` (via `ChatRoot`) ·
`ChatInputContextProvider` (via `ChatInput`) · `MessageContextProvider` (via
`Message`) · `ColorModeProvider`. Raw context objects stay unexported;
providers render zero nodes; every `use*Context` has an `Optional` variant.

### Helpers (pure, no DOM)

| Helper | Signature → purpose |
| --- | --- |
| `getTextContent(msg)` | flat text of a message |
| `groupPartsInOrder(parts)` | `PartGroup[]` — the primitive under `useMessageParts` |
| `isToolPart` / `isReasoningPart` / `isSkillToolPart` | part type guards |
| `extractSourcesFromParts(parts)` | citation list — primitive under `useSources` |
| `getAgentPromptSuggestions(agent)` | `string[]` (lossy; kept for compat) |
| `getAgentPromptSuggestionItems(agent)` | `{ label, prompt }[]` — public (#2978) |
| `normalizeAgentMetadata` / `normalizeAgentsListResponse` | API response normalizers |
| `exportAsMarkdown(messages)` / `downloadMarkdown(messages, filename?)` | transcript export |
| `extractChatMessageMetadata(value)` | typed metadata off a message |
| `agentsToPickerOptions(agents)` | picker option mapping |
| `mergeProps(...propsObjects)` | **new** — the normative merge, public |

---

## Examples — the three layers

**L1 — black box.** Batteries; runs every hook internally.
```tsx
<ConversationsProvider storageKey="ops">
  <AppShell>
    <AppShell.Sidebar><ChatSidebar /></AppShell.Sidebar>
    <AppShell.Main>
      <Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
    </AppShell.Main>
  </AppShell>
</ConversationsProvider>
```

**L2 — component composition.** `ui`-style components; you own every layout div;
config on the leaf; state via `data-*`. Self-contained — this compiles:
```tsx
function App() {
  return (
    <ConversationsProvider storageKey="ops">
      <Workspace />
    </ConversationsProvider>
  )
}

function Workspace() {
  const { chat, ready } = useConversationChat({ agentId: 'support-agent', api: '/api/ag-ui' })
  return (
  <AppShell>
    <AppShell.Sidebar>
      <ChatSidebar.Root>
        <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>
        <ChatSidebar.List />
      </ChatSidebar.Root>
    </AppShell.Sidebar>

    <AppShell.Main>
      <ChatInput chat={chat}>
        <div className="my-card">                        {/* MY div */}
          <ChatInput.Field className="my-input" placeholder="Ask…" />
          <div className="my-toolbar">                   {/* MY div */}
            <ChatInput.Attach />
            <ChatInput.Model models={MODELS} />           {/* config on the leaf */}
            <ChatInput.Submit className="my-btn" data-analytics="send" />
          </div>
        </div>
      </ChatInput>
    </AppShell.Main>
  </AppShell>
  )
}
```

**L3 — headless hooks.** You render every element; prop getters carry behaviour;
swap tags freely.
```tsx
function MyChatInput() {
  const chat = useConversationChat({ agentId })
  const chatInput = useChatInput({ chat: chat.chat, upload: useUpload() })
  return (
    <form {...chatInput.getFormProps()} className="anything">
      <textarea {...chatInput.getFieldProps()} className="anything" />
      <button {...chatInput.getSubmitProps()} data-x aria-label="Send">
        {chatInput.isStreaming ? <Stop/> : <Send/>}
      </button>
    </form>
  )
}
```

Same components, same hooks, one convention — pick the altitude per surface.

---

## Prior art & deviations (audited from live docs, July 2026)

Benchmarks: **Vercel AI Elements**, **shadcn/ui chat components** (June 2026),
**assistant-ui**, **Base UI**, **React Aria** — all checked against current docs,
not memory.

| Decision | Prior art | Ours | Why |
| --- | --- | --- | --- |
| Distribution | AI Elements: copied source; shadcn: npm headless (`@shadcn/react`) + styled registry; assistant-ui: npm primitives + copied styled layer | **npm package, all three layers** | Full control comes from the API (this RFC's thesis); shadcn's headless package is precedent that this is now mainstream |
| Polymorphism | Radix / shadcn-styled / assistant-ui: `asChild`; Base UI / React Aria: `render` prop | **`asChild`** | Ecosystem familiarity + migration cost; `render`'s real advantages (explicit target, state access) are covered by `data-*` + L3 hooks; Base UI has an open issue proposing a move *to* `asChild` |
| Headless surface | React Aria: props objects + `mergeProps`; Downshift: getters | **`getXProps(overrides?)` + public `mergeProps`** | Getters merge at the call site (kills the clobber trap); `mergeProps` exported for multi-hook composition |
| Streaming markdown | `streamdown` (AI Elements `MessageResponse`) | owned by `Markdown` | Incremental parse, fence repair, link/image-prefix hardening are table stakes — and a security surface |
| Tool UI | assistant-ui toolkit registry (precedence chain, HITL taxonomy); AI Elements `Tool` + `Confirmation` approval states | **tools registry + `data-state` incl. approval** | Most common customization; human-in-the-loop is the 2026 baseline, not an extra |
| Scrolling | shadcn `MessageScroller` state machine; assistant-ui viewport anchoring | **`useChatScroll` contract** | Stick-to-bottom alone is under-spec'd for restore/prepend/anchoring |
| Editing | assistant-ui: composer primitives switch to edit mode by context | same | One component family, no `EditForm` duplicate |

**Consciously out of scope for v1** (recorded so exclusion is a decision, not a
gap): virtualization (but rows stay measurement-friendly: single node,
`content-visibility` compatible), checkpoint/rewind, queued-work display,
token/cost context meter, message reactions & read receipts, selection-quote
toolbar, "open in external chat" hand-off, generated-image part chrome beyond
`Message.Image`. Each can land later additively.

---

## Conformance & testing (per-component AND per-hook)

The RFC specifies the contract; **no test code ships in this PR**. In
implementation the harness is built *first* and gates every enabling issue.

**Per-component — one shared conformance harness, every component registers:**
renders exactly one node (or zero + context) · `className` merges (consumer beats
variant default) · arbitrary `data-*`/`aria-*` spread through · consumer handler
AND internal handler both fire, consumer first, `preventDefault` cancels ·
`asChild` swaps the element and re-merges correctly · `ref` reaches the node ·
declared `data-*` states appear/disappear with state · a11y row (role, name,
keyboard reachable).

```ts
// illustrative harness registration — not shipped code
conformance(ChatInput.Submit, {
  node: 'button',
  states: { 'data-status': ['ready', 'streaming'] },
  context: withChatInput,           // wraps render in required providers
})
```

**Per-hook — behaviour tests:** each hook's state machine and getters
(`useChatInput`: fold/guard/clear, IME guard, controlled mode; attachments:
lifecycle idle→uploading→…; `useChatScroll`: escape/resume, prepend preserve;
`useToolCall`: full `data-state` walk incl. approval).

**Per-domain — a few integration tests:** composer round-trip, abort mid-stream,
thread-switch mid-stream (stream survives, persists to the right thread), upload
end-to-end, edit-and-branch.

---

## Migration (additive, minimal breaking)

1. **Extract L3 hooks** from the existing components (the state is already there —
   `ChatInputContext`, `MessageContext`, `useConversations`). Publish them with prop
   getters. *(Additive.)*
2. **Rephrase current components as L2** over those hooks: single-node, `asChild`,
   `data-*` state, drop `xxxClassName`/`icons={{}}` bags. *(Mostly additive; the
   bag removals are the only breaks — batch them.)*
3. **Keep L1 `<Chat>`** working, re-implemented on L2.

Existing consumers keep working through each step; new consumers get the clean
surface.

---

## Resolved decisions

- **Naming = AI Elements style (flat, descriptive).** The composer is **`ChatInput`**;
  the word "Composer" is banned across the surface, *including hooks and providers*:
  `useChatInput`, `useChatInputContext` / `…Optional`, `ChatInputContextProvider`.
- **The textarea sub-part is `ChatInput.Field`** (not `.Input`); its prop getter is
  `getFieldProps()`. Sub-part names and prop-getter names map 1:1 (`.Field` ↔
  `getFieldProps`, `.Submit` ↔ `getSubmitProps`, `.Root` ↔ `getFormProps`).
- **Testing is per-component AND per-hook** (see Conformance & testing): every
  component registers in a shared conformance harness (node identity, `className`
  merge, spread-through, `asChild`, `ref`, `data-*` states); every hook gets
  behaviour tests. The RFC specifies the contract; no test code ships in the RFC PR.

- **`data-*` contract and prop-getter surface**: resolved — see *Cross-cutting
  contracts*.
- **Every sub-part is a real named export + namespace alias** (generalizes
  #2976): `export function ChatInputField(props: ChatInputFieldProps)` *and*
  `ChatInput.Field = ChatInputField` — same function, two access styles. Every
  `XxxProps` interface is exported. Flat names follow the AI Elements
  convention (`ChatInputField` ~ `PromptInputTextarea`). Why: tree-shaking
  (namespace-only compounds drag all parts into the bundle), typed wrapping in
  consumer design systems, and no more "reachable only via the compound" leaves.
- **One implementation per feature — `Message.*` is canonical.** The standalone
  `MessageActionBar` / `BranchPicker` / `Sources` / `Reasoning` names are the same
  components (namespace re-exports for use outside a `Message`), never parallel
  implementations. `MessageActionBar.Copied` is deleted — copied feedback is
  `data-copied` on `.CopyAction`, per rule 7.
- **`ChatInput.Submit` is the canonical morphing button** (`data-status` drives
  Send↔Stop; children swap via CSS or the `.Send`/`.Stop` leaves, which
  null-render when off-state). No `icon=`/`stopIcon=` props.
- **New part leaves:** `Message.File` and `Message.Image` join
  `.Text/.Reasoning/.Source` — sent and received attachments are renderable parts.
- **Attachments input surface:** `useUpload` exposes `getDropTargetProps()`
  (thread-wide dropzone, `data-dragging`) and `getFieldProps` handles
  paste-to-attach.
- **Transport:** `useChat` accepts `api: string | { url, headers, credentials,
  fetch, body }` — auth works on day one without a custom client.
- **Config escalation rule:** config lives on the leaf; when two leaves need the
  same value (`models`, `uploadApi`), it may be *lifted* to opt-in root context —
  leaf prop always wins.
- **L1 i18n:** `<Chat labels={…}>` overrides built-in strings; at L2/L3 the
  consumer owns all text (children), so no library i18n framework.
- **`icon` slot props are banned** (grounding found ~30 files using
  `icon?: ReactNode`): a leaf renders its default icon when childless; pass
  children to replace it. Same rule kills `renderMessage`/`renderItem`/
  `renderScrollButton`/`renderCodeBlock` config props — composition or the
  registry, not render-prop config.
- **Breaking-changes ledger (batched into the one break):** `useChat` loses
  `input`/`setInput`/`handleInputChange` (input moves to `useChatInput`);
  `MessageActionBar.Copied` deleted (→ `data-copied`); boolean state props
  (`open`, `isStreaming`, `selected`, `loading`, `isActive`…) replaced by
  `data-*`; `icon`/render-prop config removed; legacy string `ChatTheme` retired
  in favor of the token system; `useUploadsRegistry` alias removed
  (`useAttachments` is the name).

- **Nothing ships ahead of its backend** (decided): the surface is trimmed to
  what the platform actually supports today. Applied: **`MessageFeedback` /
  `Message.Feedback` are cut from v1** — `onFeedback` is a consumer callback with
  no backend endpoint behind it; the component returns additively when the
  endpoint exists. **`Message.BranchPicker` stays** — `getBranches`/
  `switchBranch` already exist on `useChat`; documented via a thin
  `useMessageBranches` over them. **`Message.Tokens` stays** — it renders the
  `ChatMessageMetadataUsage` the backend already sends. Any future checklist
  entry gets the same test: no backend, no component.
- **Agent select** (confirmed — matches current studio behavior):
  `selectAgent(agentId, { conversation?: 'new' | 'same' })` on
  `useConversations`. **Default `'new'`** — creates and activates a fresh
  conversation with that agent; `'same'` keeps the current conversation and
  switches its agent. Two plain words, no heuristics.
- **Multi-agent-ready by construction** (decided): conversations may later host
  *multiple* agents, so nothing in the shape may assume one-agent-per-thread:
  a conversation's `agentId` means *active/primary agent*, never sole
  participant; **agent identity is per-message** (message metadata carries the
  producing agent, and `Message.Avatar` / `Message.Header.Name` derive from the
  *message*, not from conversation-level agent config); `Message.Root` exposes
  `data-agent-id` for per-agent styling; a future
  `policy: 'add-to-conversation'` slots into `selectAgent` additively.
- **Virtualization: out of scope v1, committed for later** (decided): v1 rows
  must stay virtualization-ready — single node per row, measurement-friendly,
  `content-visibility` compatible — so it can land additively without reshaping
  the API.

## Open questions

- **Popper anchor wrapper**: even `veryfront/ui`'s `DropdownMenu` root renders a
  wrapper `<span>` anchor — fix in `ui` (Floating UI can anchor to the trigger
  ref) or sanction a narrow "positioning anchor" exception to the node contract
  for popper roots. Touches `ui`, so this one goes to the team on the RFC PR;
  `ChatInput.Model`/`AgentPicker`/`ModelSelector` blocks note the dependency.
