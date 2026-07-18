# Chat

The L1 preset — a batteries-included chat surface built entirely from the public L2 components, with sensible defaults. Render it whole, or compose inside it with the `Chat.*` compound parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { Chat } from 'veryfront/chat'
```

## Anatomy

`<Chat>` with no children renders the full default composition below. Pass `children` to recompose using the compound parts (kept from today: `.Root .MessageList .Input .Empty .Skeleton .If .Message .ErrorBanner`):

```tsx
<Chat agentId="support-agent" api="/api/ag-ui">
  <Chat.Root>                       {/* session context — zero nodes (RFC) */}
    <Chat.If test={(s) => s.isEmpty}>
      <Chat.Empty />                {/* idle hero: avatar · heading · suggestion chips */}
    </Chat.If>
    <Chat.MessageList>              {/* scroll container */}
      <Chat.Message />              {/* one row per turn (default map) */}
    </Chat.MessageList>
    <Chat.ErrorBanner />            {/* null while there is no session error */}
    <Chat.Input />                  {/* the composer: one <form> */}
  </Chat.Root>
</Chat>
```

> Whether `children` *replaces* the default composition (as sketched here) or is *appended* inside it (today's behavior — children render after the composer) is **TBD in implementation**.

## Default DOM (childless render)

The actual HTML `<Chat agentId api />` renders today (thread with messages), annotated with part names and layout mechanics. Classes abbreviated to layout-relevant ones. The RFC-reshaped tree keeps this structure but moves the token scope to `ChatThemeScope` and turns message rows into `<article>`:

```html
<style>…generated token CSS (CSP-nonce aware)…</style>       <!-- injected by Chat.Root today; moves to ChatThemeScope (RFC) -->
<div data-vf-ui data-vf-chat data-chat-container             <!-- Chat.Root container today (RFC: deleted — zero nodes) -->
     class="flex flex-col h-full overflow-hidden relative"    style="max-height:100%">
                                                             <!-- vertical flex column; clips its own overflow -->

  <!-- transcript slot: exactly ONE of skeleton / empty hero / message list renders -->
  <div class="relative flex-1 min-h-0 flex flex-col">        <!-- Chat.MessageList wrapper: fills leftover height; -->
                                                             <!-- `relative` = the anchor for the scroll button -->
    <div role="log" aria-live="polite" data-message-list
         class="flex-1 min-h-0 overflow-y-auto">             <!-- the ONLY scrolling element; top-edge fade via -->
                                                             <!-- mask-image once scrollTop > 8px -->
      <div class="max-w-[850px] mx-auto px-9 py-6 space-y-6"><!-- .Content: centered fixed-width column -->
        <div class="group/msg flex w-full flex-col gap-1.5">…</div>
                                                             <!-- Chat.Message ×N: in-flow column; actions are -->
                                                             <!-- opacity-0 group-hover/msg:opacity-100 (hover-reveal) -->
      </div>
    </div>
    <button aria-label="Scroll to bottom"
            class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full p-2">↓</button>
                                                             <!-- ScrollButton: absolutely positioned over the -->
                                                             <!-- NON-scrolling wrapper (not the scroll content), -->
                                                             <!-- bottom-center; unmounts entirely at bottom (today) -->
  </div>

  <div class="max-w-2xl mx-auto px-4 pb-3">                  <!-- Chat.ErrorBanner: in-flow between list and composer; -->
    <div role="alert">…message… <button>Retry</button></div> <!-- only present while session error is non-null -->
  </div>

  <div class="flex-shrink-0 pb-6">                           <!-- Chat.Input outer: pinned by flex order, never shrinks -->
    <div class="mx-auto w-full max-w-[850px] px-4">          <!-- centered column, same width as transcript -->
      <div class="flex flex-wrap items-center gap-2 pb-4">…</div>
                                                             <!-- pending AttachmentPill row: only when files pending -->
      <form>                                                 <!-- the submit form -->
        <div class="relative overflow-hidden rounded-lg bg-[var(--secondary)] px-3 py-2">
                                                             <!-- the composer card; `relative` anchors the drag -->
                                                             <!-- overlay; card is the drop target -->
          <!-- DropZoneOverlay: absolute inset overlay, only while dragging files -->
          <textarea class="min-h-9 w-full min-w-0">…</textarea>  <!-- .Field: full-width top of card -->
          <div class="mt-2.5 flex min-h-[44px] items-center justify-between">
                                                             <!-- footer toolbar: space-between row -->
            <div class="flex min-w-0 items-center gap-1.5">＋</div>      <!-- left: Attach (+ menu) -->
            <div class="flex shrink-0 items-center gap-1.5">model ↑</div><!-- right: Model · Stop|Voice|Send -->
                                                             <!-- (each self-gates to null by state) -->
          </div>
        </div>
      </form>
    </div>
  </div>
</div>
```

Empty-thread variants of the transcript slot:

```html
<!-- while history/agent metadata loads — Chat.Skeleton -->
<output aria-busy="true" class="flex-1 min-h-0 overflow-hidden">     <!-- fills transcript slot, no scroll -->
  <div class="py-6 w-full max-w-[850px] mx-auto px-9 flex flex-col gap-5">  <!-- same column as the real list -->
    …user bubble skeleton (h-8 w-48 self-end = right-aligned)…
    …assistant row (avatar circle + name bar, then full-width text lines)…
  </div>
  <span class="sr-only">Loading messages...</span>
</output>

<!-- resolved + empty — Chat.Empty (idle hero) -->
<div class="flex flex-1 flex-col items-center justify-center gap-3.5 px-4"> <!-- centered both axes in the slot -->
  …avatar (64px) · <h2> heading · description <p> · suggestions chip row…
</div>
```

## The public default composition

Per the adoption journey, **the L1 default composition is public** — ejecting = paste it and edit. The exact L2 source lands with the implementation; this tree is derived faithfully from today's preset source with RFC names — **illustrative until implementation**:

```tsx
// what <Chat agentId api uploadApi tools labels /> renders — illustrative until implementation
function ChatDefault({ agentId, api, uploadApi, tools, labels, chat: controlled, children }) {
  // App mode: self-driven session — seed + persist via nearest ConversationsProvider.
  // Controlled mode: `chat` prop wins.
  const conversation = useConversationChat({ agentId, api })
  const chat = controlled ?? conversation.chat
  const upload = useUpload({ api: uploadApi })   // no uploadApi → files inline as base64 data: URLs

  return (
    <ChatRoot chat={chat}>                                   {/* context only — zero nodes (#2973) */}
      <ChatThemeScope className="relative flex h-full flex-col overflow-hidden">
        <Chat.If test={(s) => s.isEmpty && !s.ready}>
          <Chat.Skeleton />                                  {/* covers history/agent load — no hero flash */}
        </Chat.If>
        <Chat.If test={(s) => s.isEmpty && s.ready}>
          <Chat.Empty />                                     {/* agent-derived hero + typed suggestions */}
        </Chat.If>
        <Chat.If test={(s) => !s.isEmpty}>
          <ChatMessageList tools={tools}>
            <ChatMessageList.Content />                      {/* default map: one <Message> per turn */}
            <ChatMessageList.ScrollButton />
          </ChatMessageList>
        </Chat.If>
        <Chat.ErrorBanner />                                 {/* null-renders without a session error */}
        <ChatInput upload={upload}>                          {/* session from ChatRoot context */}
          <ChatInput.Field placeholder={labels?.placeholder} />
          <ChatInput.Toolbar>
            <ChatInput.Attach />
            <ChatInput.Model />
            <ChatInput.Submit />                             {/* Send↔Stop off data-status */}
          </ChatInput.Toolbar>
        </ChatInput>
        {children}
      </ChatThemeScope>
    </ChatRoot>
  )
}
```

Today's source notes folded in: the idle hero is **opt-in today** (`emptyState` prop; app mode derives one from agent metadata) — whether the L1 default shows `Chat.Empty` or a blank canvas on an empty thread is carried over from that behavior (agent-derived hero in app mode). Inside a `ConversationsProvider`, switching threads re-seeds the session for the active conversation and holds `Chat.Skeleton` until its messages load.

## Props

Trimmed from today's 28 props to seven:

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `agentId` | `string` | — | App mode: fetches agent name/avatar/suggestions and scopes requests |
| `api` \| `transport` | `string \| { url, headers, credentials, fetch, body }` | `"/api/ag-ui"` | Endpoint or transport object — auth works without a custom client |
| `uploadApi?` | `string` | — | Durable upload endpoint (multipart `file` → `{ url }`); omitted → attachments inline as base64 `data:` URLs (today's behavior, kept) |
| `tools?` | `{ [name: string]: Component }` | — | Tools registry; resolution: inline render fn → registry by name → default renderer |
| `labels?` | object | built-ins | i18n overrides for built-in strings (L1 only — at L2/L3 the consumer owns all text) |
| `chat?` | `UseChatResult` | — | Controlled mode — bring your own `useChat()`; app-mode props are ignored |
| `children?` | `ReactNode` | default composition | Compose inside the preset (replace-vs-append semantics TBD, see Anatomy) |

`asChild` is **not** listed for the preset: `<Chat>` deliberately renders a tree, not one node — the node contract applies to each L2 part it is made of. Whether the preset keeps a `ref` (and to which node) is TBD.

### Removed (today → where it went)

Every today-only prop, with its replacement — this is the ledger a reviewer should judge:

| Today's prop | Replacement |
| --- | --- |
| `initialMessages` · `onError` · `onUpdate` | `useConversationChat` options (L2); presence-resolved persistence lives there |
| `placeholder` | `labels`, or compose `ChatInput.Field placeholder` |
| `className` · `maxHeight` · `theme` | Deleted; string `ChatTheme` retired (ledger) — style the pasted composition / `ChatThemeScope` |
| `renderMessage` | **Deleted** (render-prop-config ban) — `tools` registry or `Message.Parts` composition |
| `suggestions` · `onSuggestionClick` · `onSuggestionSelect` | `ChatEmptyState` composition + `getAgentPromptSuggestionItems(agent)` (#2978) |
| `emptyState` · `initializing` · `skeleton` | `Chat.If` composition with `Chat.Empty` / `Chat.Skeleton` |
| `agent` (`ChatAgentInfo`) | Derived from `agentId` metadata; message identity is **per-message** (multi-agent decision) |
| `onSourceClick` | `Sources` / `InlineCitation` composition |
| `onAttach` · `onSelectAttachment` · `onDrop` · `attachAccept` · `attachments` · `onRemoveAttachment` | `useUpload` + `ChatInput` (`upload` prop); drop target via `getDropTargetProps` |
| `onFeedback` | `MessageFeedback` **cut from v1** (no backend endpoint) |
| `toolbarStart` | Compose children inside `ChatInput.Toolbar` |

## Parts

Every part is one node + `asChild` + `extends HTMLAttributes` + composed `ref` (the whole contract), except where noted. Each part is the same component as its standalone export — never a parallel implementation.

### `Chat.Root`

The scoped session provider (= [`ChatRoot`](./chat-root.md)). **Renders no node by default** (RFC — today it renders the container `<div>`; see that page's ledger). All session state enters here; every other part reads it from context.

**Layout:** none (zero nodes); with `asChild`, your element — today's container is the outer flex column.

| Prop | Type | Description |
| --- | --- | --- |
| `chat` | `UseChatResult` | The one shared session (#2973) |
| `asChild` | `boolean` | Opt into a node by merging onto your element |
| `children` | `ReactNode` | Subtree that reads the context |

**State attributes (proposed):** `data-status="ready|submitted|streaming|error"` — only on a DOM node when `asChild` provides one.

### `Chat.MessageList`

The transcript (= [`ChatMessageList`](./chat-message-list.md)). One scroll container `<div>`; default content = `.Content` (the centered `role="log"` column mapping one [`Chat.Message`](./message.md) per turn) + `.ScrollButton`.

**Layout:** in-flow flex child — `flex-1 min-h-0`, the only scrolling element; anchors the absolutely-positioned scroll button.

| Prop | Type | Description |
| --- | --- | --- |
| `tools?` | registry | Per-tool renderers for the default map |
| `children?` | `ReactNode` | Replace the default `.Content`/`.ScrollButton` anatomy |
| `asChild` + native + `ref` | | Own the scroll container node |

**State attributes (proposed):** `data-at-bottom` · `data-autoscrolling` · `data-scrollable` (imperative — no re-render per scroll tick) · `data-loading` · `data-empty`.

### `Chat.Input`

The composer (= [`ChatInput`](./chat-input.md)). **One `<form>`** + scoped context — the current hidden `max-w-[850px]` centering div is deleted; in the pasted composition that layout div is yours. Default content: `.Field` textarea + toolbar with `.Attach` / `.Model` / `.Submit` (Send↔Stop morph; `.Stop`/`.Send`/`.Voice` self-gate to `null` by state today).

**Layout:** in-flow flex child, `shrink-0` (never collapses under a long transcript); the composer card is `relative` and doubles as the file-drop target.

| Prop | Type | Description |
| --- | --- | --- |
| `chat?` · `upload?` · `voice?` · `value?/onChange?` · `submitMode?` | see [`ChatInput`](./chat-input.md) | Session falls back to `ChatRoot` context |
| `asChild` + native (`FormHTMLAttributes`) + `ref` | | Own the `<form>` |

**State attributes (proposed):** `data-status` · `data-dragging` · `data-compact`.

### `Chat.Empty`

The idle hero (= [`ChatEmptyState`](./chat-empty-state.md) preset). One `<div>`. Default content: agent `Avatar` (64px, image or initial) → `<h2>` heading (agent name; today's fallback string `"What can I help with?"`) → optional description `<p>` → suggestion chip row (typed `{ label, prompt }[]` via `getAgentPromptSuggestionItems`, #2978 — selection hands back the *item*). **Renders only on an empty, resolved thread** (via `Chat.If` in the composition).

**Layout:** fills the transcript slot (`flex-1`), centers its column of children on both axes.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Own the node; children replace the default hero anatomy |

Today's `icon?: ReactNode` prop falls to the **icon-slot ban** — compose `ChatEmptyState.Avatar` / children instead. Today's `title`/`description`/`suggestions`/`onSuggestion*`/`quickActions` props: derived from agent metadata in the default; compose `ChatEmptyState.*` for custom content.

### `Chat.Skeleton`

The loading placeholder. One `<output aria-busy="true">` node. Default content: alternating skeleton rows in the same `max-w-[850px]` column as the real list — right-aligned user bubbles (`self-end`) and assistant rows (avatar circle + name bar + text lines) — plus a visually-hidden "Loading messages..." for assistive tech. Rendered while the thread's history or agent metadata is still loading (so the hero never flashes first).

**Layout:** fills the transcript slot (`flex-1 min-h-0`), overflow hidden — a stand-in with the exact column box of `.Content`.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` | | Own the node; children replace the default rows *(today: `className` only — the convention row is the proposed reshape)* |

### `Chat.If`

The selector conditional — **renders no node**; renders `children` when the selector passes, else `fallback`.

**Layout:** none (no node) — children participate in the parent's flex flow directly.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `test` *(required)* | `(s: ChatContextValue) => boolean` | — | Selector over the shared session context (today's prop is `condition: boolean \| fn` — the rename and the drop of the raw-boolean form follow the no-boolean-variants rule) |
| `fallback?` | `ReactNode` | `null` | Rendered when the selector fails (kept from today) |

Outside a `Chat.Root`, the selector cannot run — today the part renders `fallback` (`null`) in that case.

### `Chat.Message`

One message row (= [`Message`](./message.md)). One **`<article>`** (today: a `<div>`) + scoped `MessageContext`. Default content: avatar/header, then parts in order (text as `Markdown`, reasoning, tool calls, sources), then hover-revealed actions. Session callbacks (`editMessage`, `reload`) come from `ChatRoot` context — never re-threaded per message.

**Layout:** in-flow column (`flex flex-col gap-1.5 w-full`) inside the transcript column; row actions are hidden-but-animatable (`opacity-0 group-hover:opacity-100` today → `data-floating`, never unmount-to-hide).

| Prop | Type | Description |
| --- | --- | --- |
| `message` *(required)* | `ChatMessage<TMetadata, TDataParts, TTools>` | The turn to render |
| `asChild` + native + `ref` | | Own the `<article>` |

**State attributes (proposed):** `data-role` · `data-agent-id` · `data-streaming` · `data-editing` · `data-error`.

### `Chat.ErrorBanner`

Session error display. Default content today: a centered wrapper (`max-w-2xl mx-auto`) holding a `ui` `Alert` (`variant="error"`, `role="alert"` per the a11y contract) with the error message and, when a retry handler exists, a link-style **Retry** button wired to `reload`. **Renders `null` while the session has no error** — safe to include unconditionally.

**Layout:** in-flow between the transcript and the composer (not an overlay); appears/disappears with the error.

| Prop | Type | Description |
| --- | --- | --- |
| `error?` | `Error` | Explicit error; falls back to the session error from `ChatRoot` context *(today `error` is required and context-blind — the fallback is the reshape)* |
| `asChild` + native + `ref` | | Own the node; children replace the default Alert content |

Today's `icon` prop falls to the **icon-slot ban**; `retryLabel` becomes children / `labels`. Whether the wrapper + `Alert` collapse to literally one node is TBD in implementation (the single-node contract says it must).

## Context (what the parts read)

`useChatContext()` — throws outside `Chat.Root` / `ChatRoot`; `useChatContextOptional()` returns `null` instead. Today's context is a 25-field bag (messages, input, submit/stop, model, attachments, branching, feedback, theme, …); per #2973 it collapses to **the shared session plus derived flags**:

```ts
{
  ...UseChatResult,          // messages, status, error, streamingMessageId, sendMessage, stop, reload, …
  isEmpty: boolean           // derived — the selector field the RFC examples use
  // exact derived-flag set beyond isEmpty: TBD in implementation
}
```

`Chat.If`'s `test` selector receives this same object. The raw context object stays unexported.

## Examples

### Default

Batteries included — runs every hook internally:

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

### Per-piece customization — no ejection

```tsx
<Chat
  agentId="support-agent"
  api="/api/ag-ui"
  tools={{ web_search: MyToolCard }}   {/* one tool renderer swapped; rest untouched */}
  labels={{ placeholder: 'Fragen Sie…' }}
/>
```

### Composed (L2)

Own every layout div; config on the leaf; state via `data-*`:

```tsx
function Workspace() {
  const { chat, ready } = useConversationChat({ agentId: 'support-agent', api: '/api/ag-ui' })
  return (
    <ChatRoot chat={chat}>
      <ChatMessageList className="my-transcript" />
      <ChatInput>
        <div className="my-card">                        {/* YOUR div */}
          <ChatInput.Field className="my-input" placeholder="Ask…" />
          <div className="my-toolbar">                   {/* YOUR div */}
            <ChatInput.Attach />
            <ChatInput.Model models={MODELS} />           {/* config on the leaf */}
            <ChatInput.Submit className="my-btn" data-analytics="send" />
          </div>
        </div>
      </ChatInput>
    </ChatRoot>
  )
}
```

### Headless (L3)

You render every element; consumer props go *into* the getters — never `{...getter()} {...props}`:

```tsx
function MyChatInput() {
  const chat = useConversationChat({ agentId })
  const chatInput = useChatInput({ chat: chat.chat, upload: useUpload() })
  return (
    <form {...chatInput.getFormProps()} className="anything">
      <textarea {...chatInput.getFieldProps()} className="anything" />
      <button {...chatInput.getSubmitProps({ 'aria-label': 'Send' })}>
        {chatInput.isStreaming ? <Stop /> : <Send />}
      </button>
    </form>
  )
}
```

## Customization (eject path)

The three layers are one graduation path — no rewrite cliff:

1. **L1, per-piece:** `tools` registry, `labels`, or `children` recomposition — swapping one tool renderer never forces ejecting the tree.
2. **L2 — eject:** paste the public default composition (identical pixels — it carries the theme scope, providers, and default classes) and edit the one piece you care about. Everything `<Chat>` renders is reachable L2 — no private components, no internal-only props.
3. **L3 — rebuild:** replace any L2 leaf, one at a time, with your own element driven by the same hook (`asChild` or prop getters).

## Related

- [`ChatRoot`](./chat-root.md) · [`ChatMessageList`](./chat-message-list.md) · [`ChatInput`](./chat-input.md) · [`Message`](./message.md) · [`ChatEmptyState`](./chat-empty-state.md) · [`ChatThemeScope`](./chat-theme-scope.md) · [`ChatErrorBoundary`](./chat-error-boundary.md)
- [`useChat`](../hooks/use-chat.md) · [`useConversationChat`](../hooks/use-conversation-chat.md) · [`useChatContext`](../hooks/use-chat-context.md) · [`useUpload`](../hooks/use-upload.md)
