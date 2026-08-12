# ChatInput

The chat composer - a single `<form>` with composable leaves for the field, attachments, model selection, voice, and submit.

> **Status: RFC 29 - partly landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `ChatInput`, `ChatInput.Attach`, `ChatInput.Export`, `ChatInput.Field`, `ChatInput.Model`, `ChatInput.Root`, `ChatInput.Send`, `ChatInput.Stop`, `ChatInput.Submit`, `ChatInput.Toolbar`, `ChatInput.Voice`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatInput } from "veryfront/chat";
// every sub-part is also a flat named export (same function), with its props type:
import { ChatInput, ChatInputField, type ChatInputFieldProps } from "veryfront/chat";
```

### `ChatInput` flat sub-part exports - `new` - `shipped` (src/chat/index.ts:250)

The flat sub-part exports above are **not** a proposal: `ChatInputRoot`, `ChatInputField`, `ChatInputToolbar`, `ChatInputAttach`, `ChatInputModel`, `ChatInputVoice`, `ChatInputSubmit`, `ChatInputSend`, `ChatInputStop`, and `ChatInputExport` (with their `Props` types) all ship from `veryfront/chat` today, alongside the `ChatInput.*` namespace aliases. What each leaf _does_ is still the proposal - see the per-delta badges below.

This is the one page where "every sub-part is also a flat named export" has actually landed; on every other component page it is still proposed.

## Parts index

- [`.Root`](#chatinputroot---changed) - `changed`: two hidden wrapper divs deleted - one `<form>`; ~19 state props collapse into `chat`/`upload`/`voice`
- [`.Field`](#chatinputfield---changed---partly-shipped-srcreactcomponentschatchatcompositionchat-composertypests18) - `changed`, **`partly shipped`**: the IME guard and the full native surface landed; `submitMode` and paste-to-attach have not
- [`.Submit`](#chatinputsubmit---changed) - `changed`: single always-rendered node (no Send-delegation null-render); `icon`/`stopIcon` removed
- [`.Send`](#chatinputsend---changed) - `changed`: `icon` + `WrapClick` `onClick` removed
- [`.Stop`](#chatinputstop---changed) - `changed`: `icon` + `WrapClick` `onClick` removed
- [`.Voice`](#chatinputvoice---changed) - `changed`: baked listening styles → `data-listening`; `icon`/`WrapClick` removed
- [`.Model`](#chatinputmodel---changed) - `changed`: `models` config moves here from the Root; `data-open` added
- [`.Attach`](#chatinputattach---changed) - `changed`: multi-node (wrapper + hidden input + menu) → one `<button>`; `icon`/`WrapClick` removed
- [`.Export`](#chatinputexport---changed) - `changed`: `icon` removed; `messages` defaults to the Root's resolved chat; tooltip wrapper collapses to one `<button>`
- [`.Toolbar`](#chatinputtoolbar---kept) - `kept`

## Anatomy

`ChatInput.Root` renders **one `<form>`** and provides scoped context to its
children. It adds **zero** wrapper divs - today's Root renders two hidden
wrappers (`flex-shrink-0 pb-6 pt-2` and `mx-auto w-full max-w-[850px] px-4`)
around your children and no `<form>` at all; the proposal deletes both wrappers
and makes the form the single node. Every layout element between the form, the
textarea, and the buttons is markup you wrote. `<ChatInput>` is shorthand for
`<ChatInput.Root>`.

```tsx
<ChatInput.Root>
  {/* ONE <form> · data-status · data-dragging · data-compact */}
  <ChatInput.Field /> {/* <textarea> · IME-guarded Enter · paste-to-attach */}
  <ChatInput.Toolbar>
    {/* <div role="toolbar"> · pure layout, optional */}
    <ChatInput.Attach /> {/* <button> · opens the file picker · null without upload */}
    <ChatInput.Model models={MODELS} /> {/* <button> trigger · data-open · null without models */}
    <ChatInput.Voice /> {/* <button> · data-listening · null when field has text */}
    <ChatInput.Submit /> {/* <button> · morphs Send↔Stop via data-status */}
    {/* or the split pair instead of .Submit: */}
    <ChatInput.Send /> {/* <button> · null while streaming */}
    <ChatInput.Stop /> {/* <button> · null unless streaming */}
    <ChatInput.Export /> {/* <button> · null when transcript is empty */}
  </ChatInput.Toolbar>
</ChatInput.Root>;
```

**Childless/default contract:** a childless `<ChatInput.Root>` renders the public
default composition shown below. Passing `children` replaces that default
composition inside the form. `<ChatInput>` and `<ChatInput.Root>` are the same
render-or-compose surface; there is no provider-only Root variant in the proposed
API.

## Default DOM (childless render)

What the batteries `<ChatInput …/>` actually renders today, annotated with the part each line becomes and its layout mechanics. The two outer wrappers are the ones the proposal deletes.

```html
<div class="flex-shrink-0 pb-6">
  <!-- outer wrapper - REMOVED in proposal -->
  <div class="mx-auto w-full max-w-[850px] px-4">
    <!-- width clamp - REMOVED in proposal (layout is yours) -->

    <!-- children slot - ONLY when children were passed; wraps, does not scroll -->
    <div class="flex flex-wrap items-center gap-1.5 pb-3">…</div>

    <!-- pending-attachment row - ONLY when attachments.length > 0; wrapping flex row -->
    <div class="flex flex-wrap items-center gap-2 pb-4">
      <AttachmentPill class="w-[200px]" /> <!-- fixed-width chips; width is the container's call -->
    </div>

    <form>
      <!-- ← the proposal's .Root: the ONLY node it keeps -->
      <!-- the "card": relative = positioning context for the drop overlay; drag handlers live HERE, not on the form -->
      <div
        class="
          relative overflow-hidden rounded-[var(--radius-lg)] border border-transparent
          bg-[var(--secondary)] px-3 py-2 shadow-sm transition-all md:px-4 md:py-3
        "
      >
        <!-- + border-dashed border-[var(--edge-medium)] while dragging -->

        <!-- drop overlay - ONLY while dragging; absolute inset-0 z-10 relative to the CARD, fills it,
             pointer-events-none, column-centered glyph + "Drop files" label, backdrop-blur -->
        <div
          class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 …"
        >
          …
        </div>

        <!-- .Field - in-flow at the top of the card; w-full min-w-0, grows with content (multiline) -->
        <textarea class="min-h-9 w-full min-w-0 py-1.5 text-base leading-6 …" />

        <!-- footer toolbar - one row below the field: justify-between splits it into two clusters -->
        <div class="mt-2.5 flex min-h-[44px] items-center justify-between gap-1.5 md:gap-2">
          <!-- left cluster: min-w-0 so it shrinks/truncates first -->
          <div class="flex min-w-0 items-center gap-1.5 md:gap-2">
            <!-- .Attach - wrapper div is the positioning context for its visually-hidden file input
                 (absolute, 1px, clipped); the menu itself is PORTALLED, not in this tree -->
            <div class="relative flex shrink-0 items-center">
              <input type="file" style="position: absolute; width: 1px; height: 1px; clip: …" />
              <button class="shrink-0" aria-label="Add document">+</button>
            </div>
            <!-- toolbarStart slot (removed in proposal - pass your own children) -->
          </div>

          <!-- right cluster: shrink-0 - never collapses; buttons are siblings in DOM order -->
          <div class="flex shrink-0 items-center gap-1.5 md:gap-2">
            <!-- .Model - ONLY when models configured -->
            <!-- .Stop  - ONLY while streaming        (each button shrink-0, size icon-lg) -->
            <!-- .Voice - ONLY when idle + empty field + voice configured -->
            <!-- .Send  - ONLY when not streaming; hidden when empty + voice takes the slot -->
            <button class="shrink-0" aria-label="Send">↑</button>
          </div>
        </div>
      </div>
    </form>
  </div>
</div>
```

Key mechanics: everything is **in-flow flex, in DOM order** - the Send button sits right because its cluster is the second child of a `justify-between` row, not because of floats or absolute positioning. The only absolute elements are the drop overlay (`inset-0` over the _card_) and the hidden file input (clipped inside `.Attach`'s own `relative` wrapper - never over the card).

## Parts

Every part renders exactly one node, `extends` that node's native attributes, spreads `{...props}` onto it, and takes `asChild`. Icon-bearing leaves render their default icon when childless; pass children to replace it - the current `icon`/`stopIcon` props are **removed**, and the current wrap-signature `onClick(event, next)` (`WrapClick`) is **removed** in favor of standard composed handlers (yours first; `preventDefault` cancels the internal handler).

### `ChatInput.Root` - `changed`

_Changed: today's two hidden wrapper divs are deleted and the `<form>` becomes the single node; ~19 `ComposerStateProps` collapse into the `chat`/`upload`/`voice` hook results._

One `<form>` + the compound's scoped context (`ChatInputContextProvider`). Native form submit runs the composer-owned pipeline: **fold pending attachments into `file` parts → guard while uploads are in flight → trim, send → clear input + attachments**. (This pipeline exists today in `useComposerValue` when `sendMessage` is supplied; the proposal makes it the only path, owned by `useChatInput`.)

**Layout:** the `<form>` imposes nothing - no flex, no width clamp (today's `mx-auto max-w-[850px] px-4` wrapper is deleted); every row/cluster between it and the leaves is your markup.

`extends React.FormHTMLAttributes<HTMLFormElement>` - every native attribute (`className`, `style`, `data-*`, `aria-*`, handlers, `ref`) passes through to the form. Handlers compose (yours first), `className` merges Tailwind-aware.

| Prop                              | Type                                 | Default                    | Description                                                                                                                     |
| --------------------------------- | ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `asChild`                         | `boolean`                            | `false`                    | Merge form behavior onto your own element instead of rendering a `<form>`.                                                      |
| `chat` _(proposed)_               | `UseChatResult`                      | nearest `ChatRoot` context | The chat session to submit into. Explicit prop > nearest context > default.                                                     |
| `upload` _(proposed)_             | `UseUploadResult`                    | -                          | Attachment state from `useUpload`; enables `.Attach`, paste-to-attach, drag-drop (`data-dragging`), and the submit fold/guard.  |
| `voice` _(proposed)_              | `UseVoiceInputResult`                | -                          | Voice state from `useVoiceInput`; the transcript folds into the input value - no userland transcript weaving. Enables `.Voice`. |
| `value` / `onChange` _(proposed)_ | `string` / `(value: string) => void` | -                          | Controlled mode. Omit both for uncontrolled. Input state has one owner: `useChatInput` (`useChat` does not expose `input`).     |
| `submitMode` _(proposed)_         | `'enter' \| 'ctrlEnter' \| 'none'`   | `'enter'`                  | What key submits from the field.                                                                                                |

**Removed** - today's `ChatInput.Root` threads ~19 state props (`ComposerStateProps`); the proposal collapses them into the three hook results above:

| Current prop(s)                                                                                                        | Where it goes                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `input` / `onChange(event)` / `setInput`                                                                               | `value`/`onChange` (controlled) or internal uncontrolled state        |
| `onSubmit` / `sendMessage` / `onClearAttachments`                                                                      | composer-owned submit via `chat` (no submit glue in userland)         |
| `isLoading` / `stop`                                                                                                   | derived from `chat` (`status`, `stop`)                                |
| `onVoice` / `isListening` / `transcript`                                                                               | `voice`                                                               |
| `models` / `model` / `onModelChange`                                                                                   | `models={…}` on the `.Model` leaf                                     |
| `onAttach` / `onDrop` / `onSelectAttachment` / `attachAccept` / `attachments` / `onRemoveAttachment` / `onAttachClick` | `upload` (accept/limits configured on `useUpload`)                    |
| `theme` / `toolbarStart` / `placeholder` (batteries `<ChatInput>`)                                                     | `className` on leaves / your own children / `placeholder` on `.Field` |

**State attributes (proposed):** `data-status="ready|submitted|streaming|error"`
(mirrors `useChat().status`; today streaming is a `isLoading` boolean prop),
`data-dragging` (file dragged over the form - today an internal `isDragActive`
boolean toggling border classes), `data-compact` (present when the form's inline
size is below 560px or the field has a single visual line).

### `ChatInput.Field` - `changed` - `partly shipped` (src/react/components/chat/chat/composition/chat-composer.types.ts:18)

_Changed: `submitMode`-driven, IME-guarded Enter and paste-to-attach are added, and the full native textarea surface + `asChild` open up (today only `placeholder`/`className`/`aria-label`)._

**Landed** in [#3277](https://github.com/veryfront/veryfront-code/pull/3277), in **two files** - this delta has two halves, so the badge above and the [roll-up row](../README.md#what-has-landed---shipped-srcreactcomponentschatchathooksuse-chat-inputts85) each cite one of them:

- **Native surface** (`src/react/components/chat/chat/composition/chat-composer.types.ts:18`, the badge's anchor): `ChatInputFieldProps` now extends `React.TextareaHTMLAttributes<HTMLTextAreaElement>` (minus the controlled trio), so the full native surface and `ref` are already the consumer's.
- **IME guard** (`src/react/primitives/input-box.tsx:37`, the roll-up's anchor): `handleInputBoxKeyDown` checks native `isComposing`, synthetic `isComposing`, and the `keyCode === 229` fallback before Enter submits. `.Field` and `useChatInput().getFieldProps()` both route through it, so a custom textarea cannot diverge from the primitive.

**Still proposed:** `submitMode`, paste-to-attach, and `asChild` on this leaf.

One `<textarea>` (today: the `InputBox` primitive in multiline mode).

**Layout:** in-flow block, `w-full min-w-0` (fills its container, shrinks below intrinsic width), `min-h-9`, grows vertically with content - no positioning of its own.

Default content: the input value - while dictating, the live transcript replaces it (`transcript || value`). Enter submits per `submitMode`, with an IME-composition guard so CJK input never double-submits. **Paste-to-attach (proposed):** pasting files into the field adds them to the pending attachments (requires `upload` on the Root). **Always renders.** Disabled while streaming or listening (today via the `disabled` attribute; the proposal also surfaces `data-disabled`).

| Prop                       | Type                                                        | Default                    | Description                                                                                                    |
| -------------------------- | ----------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `placeholder`              | `string`                                                    | `"Type a message..."`      | Placeholder text.                                                                                              |
| `aria-label`               | `string`                                                    | `placeholder ?? "Message"` | Accessible name.                                                                                               |
| native + `ref` (`shipped`) | `React.TextareaHTMLAttributes<HTMLTextAreaElement>` · `ref` | -                          | Already open: `ChatInputFieldProps` extends the native textarea surface (minus `value`/`onChange`/`onSubmit`). |
| `asChild` _(proposed)_     | `boolean`                                                   | `false`                    | Not landed - `.Field` still renders the `InputBox` primitive rather than merging onto your element.            |

### `ChatInput.Submit` - `changed`

_Changed: becomes a single always-rendered node (today it delegates to `.Send`/`.Stop` and inherits their null-render); `icon`/`stopIcon` are removed._

The canonical submit control: **one `<button>`** that morphs Send↔Stop as `data-status` changes.

**Layout:** `shrink-0` in-flow flex child - sits wherever you place it in DOM order; never absolutely positioned.

Default content: up-arrow glyph when ready, stop glyph while streaming; pass children to compose your own (style the swap off `[data-status="streaming"]`). Disabled (and `data-disabled`) when the message can't be sent (empty input and no resolved attachment).

Today `.Submit` delegates to `.Send`/`.Stop` (two components, `icon` +
`stopIcon` props, both removed) and therefore inherits `.Send`'s null-render,
disappearing when the field is empty and voice is configured. Proposed:
`.Submit` is a single always-rendered node. It never yields its slot to `.Voice`;
the default composition may render `.Voice` next to it and disable `.Submit`
until there is text or a resolved attachment.

| Prop                            | Type                                                    | Default | Description                                    |
| ------------------------------- | ------------------------------------------------------- | ------- | ---------------------------------------------- |
| `asChild` + native              | `React.ButtonHTMLAttributes<HTMLButtonElement>` · `ref` | -       | One node; children replace the default glyphs. |
| `icon` / `stopIcon` _(removed)_ | `React.ReactNode`                                       | ↑ / ■   | Replaced by children + `data-status` styling.  |

**State attributes:** `data-status="ready|submitted|streaming|error"` · `data-disabled`.

### `ChatInput.Send` - `changed`

_Changed: `icon` and the `WrapClick` `onClick` signature are removed - children replace the glyph, handlers compose natively._

Send-only half of the split pair - one `<button>`, `aria-label="Send"`, default content: up-arrow icon.

**Layout:** `shrink-0` in-flow flex child, `size-icon-lg`; position comes purely from DOM order in your toolbar row.

**Renders `null` while streaming**, and **`null` when the field is empty and voice is configured** (it yields the slot to `.Voice` - today's `!canSubmit && onVoice` guard). Otherwise renders, disabled until there is trimmed text or a resolved attachment.

| Prop                                                  | Type | Default | Description                                  |
| ----------------------------------------------------- | ---- | ------- | -------------------------------------------- |
| `asChild` + native + `ref`                            |      | -       | Children replace the default icon.           |
| `icon` _(removed)_ / `onClick: WrapClick` _(removed)_ |      | -       | Children compose; handlers compose natively. |

### `ChatInput.Stop` - `changed`

_Changed: `icon` and the `WrapClick` `onClick` signature are removed - children replace the glyph, handlers compose natively._

Stop-only half - one `<button>`, `aria-label="Stop"`, default content: stop-square icon.

**Layout:** `shrink-0` in-flow flex child; because `.Send`/`.Stop` null-render on opposite states, placing them adjacent yields one occupied slot at a time.

Clicking calls the session's `stop()`. **Renders `null` unless streaming** - safe to include unconditionally alongside `.Send`.

| Prop                                                  | Type | Default | Description                                  |
| ----------------------------------------------------- | ---- | ------- | -------------------------------------------- |
| `asChild` + native + `ref`                            |      | -       | Children replace the default icon.           |
| `icon` _(removed)_ / `onClick: WrapClick` _(removed)_ |      | -       | Children compose; handlers compose natively. |

### `ChatInput.Voice` - `changed`

_Changed: the baked-in listening styles become a `data-listening` attribute you style yourself; `icon` and `WrapClick` `onClick` are removed._

One `<button>`, `aria-label="Voice input"`, `aria-pressed` while listening. Default content: microphone glyph.

**Layout:** `shrink-0` in-flow flex child; in the default toolbar it occupies the same right-cluster slot `.Send` uses (the two never render together). **Renders `null`** while streaming, when the field has submittable text (send takes the slot), or when no `voice` is configured on the Root. Toggles dictation; the transcript folds into the field value via the hook.

| Prop                                                  | Type | Default | Description                                  |
| ----------------------------------------------------- | ---- | ------- | -------------------------------------------- |
| `asChild` + native + `ref`                            |      | -       | Children replace the default mic glyph.      |
| `icon` _(removed)_ / `onClick: WrapClick` _(removed)_ |      | -       | Children compose; handlers compose natively. |

**State attributes (proposed):** `data-listening` - today the listening state is baked-in classes (`bg-[var(--primary)] text-[var(--secondary)]`); the proposal removes the baked styling and surfaces the attribute so you style `[data-listening]` yourself.

### `ChatInput.Model` - `changed`

_Changed: `models` config moves here from the Root; `asChild` + native attrs open up (today `className` only) and `data-open` is added._

The model-selector **trigger** - one `<button>` (today it renders the `ModelSelector` component in `variant="icon"`; the popover anchors via the trigger ref once the `ui` prerequisite lands - settled). Default content: the selected model's icon/label. **Renders `null` when no models are configured** - today the null-render also requires `onModelChange` (`chat-composer.tsx:223` guards `!models || models.length === 0 || !onModelChange`); the proposal drops that requirement, since selection routes through the chat session's `setModel` from context. Disabled while streaming.

**Layout:** in-flow flex child (the trigger); the open list is a popper/portal, not part of the toolbar's flow.

| Prop                                    | Type            | Default | Description                                                                                                                            |
| --------------------------------------- | --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `models` _(proposed)_                   | `ModelOption[]` | -       | Config lives on this leaf, not the root (today `models`/`model`/`onModelChange` are Root props read from context - **removed** there). |
| `asChild` _(proposed)_ + native + `ref` |                 | -       | Today `.Model` accepts only `className`.                                                                                               |

**State attributes (proposed):** `data-open` - popper expanded. Selection uses
`onModelChange` when supplied on `.Model`; otherwise it routes through the chat
session's `setModel`.

### `ChatInput.Attach` - `changed`

_Changed: today's wrapper div + hidden file input + portalled menu collapse to one `<button>` (input owned by `useUpload`); `icon`, `WrapClick`, and the `attachAccept` Root prop are removed._

One `<button>` that opens the file picker, `aria-label="Attach files"` (today
`"Add document"`). Default content: plus icon. **Renders `null` when no `upload`
is configured on the Root** (today: when neither `onAttach` nor
`onSelectAttachment` is set).

**Layout:** today a `relative flex shrink-0 items-center` wrapper - the `relative` exists solely as the positioning context for the visually-hidden `<input type="file">` (absolute, 1px, clipped) so it never overlays anything else; the dropdown menu is portalled. Proposed: one in-flow `shrink-0` button, hidden input owned by the hook.

Today `.Attach` is not one node: it renders a wrapper `<div>`, a visually-hidden
`<input type="file">`, and a portalled dropdown menu ("Attach files to chat" /
"Select document" when `onSelectAttachment` is set). Proposed: one `<button>`
wired via `getAttachProps`, with the hidden file input owned by
`useUpload().getAttachInputProps()`. The two-item plus menu is not part of the
default `.Attach` contract; compose it with `ChatActions` or your own menu when
you need both file upload and document selection.

| Prop                                                  | Type | Default | Description                                                             |
| ----------------------------------------------------- | ---- | ------- | ----------------------------------------------------------------------- |
| `asChild` _(proposed)_ + native + `ref`               |      | -       | Children replace the default plus icon.                                 |
| `icon` _(removed)_ / `onClick: WrapClick` _(removed)_ |      | -       | Children compose; handlers compose natively (replaces `onAttachClick`). |

Accept filter and file limits move to `useUpload({ accept, maxSize, maxFiles })` - the current `attachAccept` Root prop is **removed**.

### `ChatInput.Export` - `changed`

_Changed: `icon` is removed; `messages` is required today but defaults to the Root's resolved chat (`useChatContextOptional()`); today's tooltip `<span>` wrapper + portalled tooltip collapse to one `<button>`._

One `<button>`, `aria-label="Export conversation"` (today with a "Export as Markdown" tooltip). Default content: down-arrow icon.

**Layout:** `shrink-0` in-flow flex child; not part of the default toolbar today - place it yourself. Downloads the transcript as Markdown (`exportAsMarkdown`/`downloadMarkdown` under the hood). **Renders `null` when the transcript is empty.**

| Prop                                                  | Type            | Default                                    | Description                                                                                                                               |
| ----------------------------------------------------- | --------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `messages`                                            | `ChatMessage[]` | transcript from `useChatContextOptional()` | The messages to export. _(Required today.)_ Defaults to the Root's resolved chat - the nearest chat context - so the leaf needs no props. |
| `asChild` _(proposed)_ + native + `ref`               |                 | -                                          | Children replace the default icon.                                                                                                        |
| `icon` _(removed)_ / `onClick: WrapClick` _(removed)_ |                 | -                                          | Children compose; handlers compose natively.                                                                                              |

### `ChatInput.Toolbar` - `kept`

One `<div role="toolbar">`.

**Layout:** a single horizontal flex row - `flex items-center gap-1.5 md:gap-2` - children in DOM order; it does not split left/right (the default composition's `justify-between` split is a separate, published layout div).

Pure layout convenience - its children read their own context, so it carries **no** behavior. **Optional**: use your own div freely; nothing breaks. **Always renders.**

| Prop                                    | Type | Default | Description                                           |
| --------------------------------------- | ---- | ------- | ----------------------------------------------------- |
| `asChild` _(proposed)_ + native + `ref` |      | -       | Today `.Toolbar` accepts only `className`/`children`. |

## State attributes

Style state with CSS/Tailwind variants - there are no boolean styling props.

| Attribute                                          | On                   | Meaning                                                                |
| -------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `data-status="ready\|submitted\|streaming\|error"` | `.Root` `.Submit`    | Session status (mirrors `useChat().status`).                           |
| `data-dragging`                                    | `.Root`              | A file is dragged over the drop target.                                |
| `data-compact`                                     | `.Root`              | Present below 560px inline size or when the field has one visual line. |
| `data-open`                                        | `.Model`             | Model popper expanded.                                                 |
| `data-listening`                                   | `.Voice`             | Dictation active.                                                      |
| `data-disabled`                                    | any interactive leaf | Disabled.                                                              |

## Context (what the parts read)

`useChatInputContext()` - throws outside `ChatInput.Root` (`useChatInputContextOptional` returns `null` instead). Proposed shape, from `useChatInput`:

```ts
{
  // state
  value: string
  canSubmit: boolean            // trimmed text, or a resolved attachment
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  isStreaming: boolean          // sugar: status === 'streaming'
  attachments: AttachmentInfo[]
  isListening: boolean
  // actions
  submit(): void                // fold → guard → send → clear
  stop(): void
  clear(): void
  attach(files: FileList | File[]): void
  // prop getters (all take optional overrides - handlers chain, classes merge)
  getFormProps · getFieldProps · getSubmitProps ·
  getAttachProps · getVoiceProps · getDropTargetProps
}
```

This replaces today's `ComposerContext` (`input`, `onChange`, `onSubmit`, `isLoading`, `canSubmit`, `onStop`, `onVoice`, `isListening`, `transcript`, `model`, `models`, `onModelChange`, `onAttach`, `onSelectAttachment`, `onRemoveAttachment`, `attachAccept`, `attachments`). Notable renames: `input` → `value`, `isLoading` → `status`/`isStreaming`, `onStop` → `stop`; the model trio moves to the `.Model` leaf.

## Examples

### Default (inside `<Chat/>`)

The L1 preset renders `ChatInput` for you. Its default composition is public - everything `<Chat>` renders is reachable, documented L2.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />;
```

### Composed (L2)

You own every layout div; config lives on the leaf; state comes through `data-*`.

```tsx
function MyComposer() {
  const { chat } = useConversationChat({ agentId: "support-agent", api: "/api/ag-ui" });
  return (
    <ChatInput chat={chat}>
      <div className="my-card">
        {/* YOUR div */}
        <ChatInput.Field className="my-input" placeholder="Ask…" />
        <div className="my-toolbar">
          {/* YOUR div */}
          <ChatInput.Attach />
          <ChatInput.Model models={MODELS} /> {/* config on the leaf */}
          <ChatInput.Submit className="my-btn" data-analytics="send" />
        </div>
      </div>
    </ChatInput>
  );
}
```

`asChild` when your own element should _be_ the control:

```tsx
<ChatInput.Submit asChild>
  <MyFancyButton>Send</MyFancyButton>
</ChatInput.Submit>;
```

### Headless (L3)

Render every element yourself; the prop getters carry a11y and behavior. Pass your props _into_ the getter - never `{...getter()} {...props}` - so handlers chain and classes merge correctly.

```tsx
function MyChatInput() {
  const chat = useConversationChat({ agentId });
  const chatInput = useChatInput({ chat: chat.chat, upload: useUpload({ api: "/api/uploads" }) });
  return (
    <form {...chatInput.getFormProps({ className: "anything" })}>
      <textarea {...chatInput.getFieldProps({ onKeyDown: myKeyHandler })} />
      <button {...chatInput.getSubmitProps({ onClick: track, "aria-label": "Send" })}>
        {chatInput.isStreaming ? <Stop /> : <Send />}
      </button>
    </form>
  );
}
```

### Editing a message

`ChatInput` nested inside a `Message` _is_ the edit form - nearest provider wins, and `Message.Root` gets `data-editing`. There is no separate edit-form component family.

The mechanism is concrete: `useChatInput` reads `useMessageContextOptional()`. When it finds itself inside a message whose context has `isEditing`, it seeds `value` from the message's `textContent`, routes submit to `editMessage(message.id, value)` instead of `sendMessage`, and maps Escape to `cancelEdit`. No extra props - nesting _is_ the wiring.

## Customization

The eject path is per-piece, never all-or-nothing:

1. **L1 → L2:** paste the published default composition that `<Chat>` renders, then restyle or reorder the leaves - they're yours.
2. **L2 → L3:** replace any single leaf with your own element via `asChild`, or drive it with the matching prop getter (`.Field` ↔ `getFieldProps`, `.Submit` ↔ `getSubmitProps`, `.Root` ↔ `getFormProps`). Same hook, same behavior, no forked logic.

## Related

- [`useChatInput`](../hooks/use-chat-input.md) - the hook `ChatInput` is built on
- [`useChatInputContext`](../hooks/use-chat-input-context.md) - read the scoped context
- [`useUpload`](../hooks/use-upload.md) - pending attachments
- [`useVoiceInput`](../hooks/use-voice-input.md) - dictation
- [`AttachmentPill`](./attachment-pill.md) - pending-upload chip rendered alongside the composer
