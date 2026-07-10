# Migration guide — `veryfront/chat` composition overhaul (breaking batch E8–E11)

The additive replacement layer (E0–E6) landed first: every removal below has a
composition replacement that already ships. This is the batched breaking change
— one migration for consumers, not many. Each removal burns a ratchet in
`scripts/lint/ban-chat-antipatterns.ts` toward 0.

Status key: **[done]** landed & validated · **[planned]** replacement exists, removal pending.

---

## E9 — passthrough props → per-sub-component slots

Styling and icons are set on the piece you mean, not smuggled through the parent.

| Removed | Replacement | Status |
| --- | --- | --- |
| `<ChatSidebar icons={{ more, rename, delete, newConversation }}>` + `ChatSidebarIcons` | `<ChatSidebar.Item.Menu icon>`, `<ChatSidebar.Item.Rename icon>`, `<ChatSidebar.Item.Delete icon>`, `<ChatSidebar.NewButton icon>` | **[done]** |
| `AgentPickerIcons` / `ChatInputIcons` / `AttachmentPillIcons` bags | per-leaf `icon` on `AgentPicker.Trigger`/`.Item`, `ChatInput.Send`/`.Stop`/`.Voice`/`.Attach`, `AttachmentPill.Retry`/`.Remove` | **[done]** |
| `MessageActionBarIcons` / `BranchPickerIcons` / `MessageFeedbackIcons` bags | **removed** — these flat multi-button leaves render fixed default glyphs (no icon override; compose a variant if you need custom icons) | **[done]** |
| `AttachmentPill` `showRemove` (internal context flag) | presence-driven: the `.Remove` leaf renders when `onRemove` is set and not uploading | **[done]** |
| `<Message.Content contentClassName>` / `InlineCitation cardClassName` | needs the nested element exposed as a sub-component first (compound-ify), then a single root `className` per part | **[planned]** |

```diff
- <ChatSidebar icons={{ rename: <MyPencil/>, delete: <MyTrash/> }} … />
+ <ChatSidebar.Root …>
+   <ChatSidebar.List>
+     {items.map((c) => (
+       <ChatSidebar.Item key={c.id} conversation={c}>
+         <ChatSidebar.Item.Menu>
+           <ChatSidebar.Item.Rename icon={<MyPencil/>} />
+           <ChatSidebar.Item.Delete icon={<MyTrash/>} />
+         </ChatSidebar.Item.Menu>
+       </ChatSidebar.Item>
+     ))}
+   </ChatSidebar.List>
+ </ChatSidebar.Root>
```

---

## E8 — feature-toggle booleans → presence-driven composition

`show*/enable*/hide*` flags become "include the sub-component, or don't"
(composition-patterns §1.1/§3.1: modes are composition or explicit variants,
never behaviour booleans). The batteries `<Chat>` stays the default variant.

| Removed flag | Replacement | Status |
| --- | --- | --- |
| `showSources` (Message/Chat) | render `<Message.Sources />` (or omit it) | **[planned]** |
| `showSteps` | include the steps region (`StepIndicator` / `Message.Part`) or omit | **[planned]** |
| `showScrollButton` | include `<ConversationScrollButton />` or omit | **[planned]** |
| `showMessageActions` | include `<Message.Actions />` or omit | **[planned]** |
| `showExport` | include the export action (`exportAsMarkdown`) or omit | **[planned]** |
| `showTabs` / `hideTabSwitcher` | include `<TabSwitcher />` or omit | **[planned]** |
| `showSearch` (AgentPicker) | include `<AgentPicker.Search />` or omit | **[planned]** |
| `enableAttachments` | include `<ChatInput.Attach />` / `<AttachmentsPanel />` or omit | **[planned]** |
| `enableVoice` | include `<ChatInput.Voice />` or omit | **[planned]** |
| `enableMermaid` | pass a Mermaid-capable `codeBlock` to `Message.Content` or omit | **[planned]** |
| `showRemove` (AttachmentPill) | include `<AttachmentPill.Remove />` or omit | **[planned]** |

```diff
- <Message message={m} showSources showMessageActions />
+ <Message.Root message={m}>
+   <Message.Content />
+   <Message.Sources />
+   <Message.Actions />
+ </Message.Root>
```

> The preset `<Chat>` keeps rendering the default arrangement (sources, actions,
> scroll button, …) with zero config — you only compose when you want to *change*
> the arrangement. Removing the flags means there's exactly one way to turn a
> region off: don't include it.

---

## E10 — one controlled path (remove the deprecated flat `ChatProps`)

The flat `messages`/`input`/`onChange`/`onSubmit`/`sendMessage`/`stop`/`reload`/
`setInput`/`model`/`activeModel`/`onModelChange`/`inferenceMode`/`renderTool`/… props on
`<Chat>` (24 `@deprecated` members in `chat/chat-props.ts`) collapse to a single
whole-session object.

| Removed | Replacement | Status |
| --- | --- | --- |
| `<Chat messages={…} input={…} onChange={…} onSubmit={…} … />` | `<Chat chat={useChat()} />` | **[planned]** |
| `renderTool` prop | compose `Message.Content`'s function child (special-case `part.type === "tool"`) | **[planned]** |

```diff
- <Chat messages={messages} input={input} onChange={onChange} onSubmit={onSubmit} … />
+ const chat = useChat();
+ <Chat chat={chat} />
```

---

## Codemod (E11)

A jscodeshift/ts-morph codemod ships alongside, mapping each removed prop to its
composition form:
- `icons={{…}}` bag → the compound's `<X.*  icon>` leaves.
- `show*/enable*/hide*` flags → include/exclude the corresponding sub-component.
- flat `<Chat messages input …>` → `<Chat chat={useChat()} />`.

Where a mechanical rewrite isn't safe (custom `renderTool`), the codemod inserts
a `// TODO(veryfront-migration):` marker with a link to this guide.

## Verifying your migration

Run your typecheck against the new types — the removed props are gone from the
public `.d.ts`, so `tsc` flags every call site. The library's own
`deno task typecheck:consumer` proves the documented composition compiles; the
`lint:chat-ratchets` gate proves the anti-patterns reached 0.
