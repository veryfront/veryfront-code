# Migrate the `veryfront/chat` composition breaking batch

This guide covers the E8-E11 breaking batch. The replacement composition APIs
land in the same release as the removals, so you can migrate once. See the
[breaking-change summary](./CHANGELOG-chat-breaking.md) for the release-facing
list of changes.

## Run the codemod

Run the codemod against one or more files or directories:

```bash
deno task codemod:chat -- ./app
```

Use check mode in CI to find files that still need migration:

```bash
deno task codemod:chat -- --check ./app
```

The codemod parses TypeScript and JSX with Babel. It automatically:

- rewrites removed compatibility imports to canonical imports
- replaces a local `useChat()` result spread into `<Chat>` and matching
  `chat.messages` style props with `<Chat chat={chat} />`
- rewrites removed `useChat()` aliases to `handleInputChange`, `handleSubmit`,
  and `setModel`
- removes feature flags when their value matches the fixed preset behavior
- converts `Sources.renderPill` to the canonical `renderItem` callback shape

When a rewrite depends on application intent, the codemod keeps the old prop so
your typecheck still identifies it and inserts a `TODO(veryfront-migration)`
comment beside the JSX element. Resolve every marker before merging the
consumer migration.

## E8: Replace behavior flags with composition

The `<Chat>` preset now has one fixed arrangement. It includes attachments,
message sources, multi-step rendering, message actions, and the scroll-to-bottom
control. It does not include tabs, export, or voice controls. Compose the lower
level parts when you need a different arrangement.

| Removed flag                  | Replacement                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `showSources`                 | Include or omit `<Message.Sources />`.                                                              |
| `showSteps`                   | Render step groups with `<Message.Part />`, or filter them in the `Message.Content` function child. |
| `showScrollButton`            | Pass a `renderScrollButton` to `ChatMessageList`, or compose your own scroll control.               |
| `showMessageActions`          | Include or omit `<Message.Actions />`.                                                              |
| `showExport`                  | Include or omit `<ChatInput.Export messages={messages} />`.                                         |
| `showTabs`, `hideTabSwitcher` | Include or omit `<TabSwitcher />` in a composed layout.                                             |
| `enableAttachments`           | Include or omit `<ChatInput.Attach />` and attachment handling.                                     |
| `enableVoice`                 | Include or omit `<ChatInput.Voice />`.                                                              |
| `showSearch`                  | Include or omit `<AgentPicker.Search />` or `<ModelSelector.Search />`.                             |
| `enableMermaid`               | Pass a Mermaid-capable `renderCodeBlock` to `Markdown` or `codeBlock` to `Message.Content`.         |

The tab-only preset props `activeTab`, `onTabChange`, `uploads`, and
`onRemoveUpload`, plus the preset `onVoice` callback, are also removed. Pass
the tab and upload values directly to composed `TabSwitcher` and
`AttachmentsPanel` parts. Pass the voice handler to `ChatInput.Root` or
`ChatInput`, then include `<ChatInput.Voice />` in the composed toolbar.

```diff
- <Message message={message} showSources showSteps />
+ <Message.Root message={message}>
+   <Message.Header />
+   <Message.Content />
+   <Message.Sources />
+   <Message.Actions />
+ </Message.Root>
```

## E9: Move customization to compound leaves

| Removed API                                    | Replacement                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `ChatSidebar icons={{...}}` and icon bag types | Set `icon` on `ChatSidebar.Item.Menu`, `.Rename`, `.Delete`, and `.NewButton`.      |
| `AgentPicker icons={{...}}`                    | Set `icon` on `AgentPicker.Trigger`, `.Item`, `.Create`, and `.Manage`.             |
| `ChatInput icons={{...}}`                      | Set `icon` on `ChatInput.Attach`, `.Send`, `.Stop`, `.Voice`, and `.Export`.        |
| `AttachmentPill icons={{...}}`                 | Set `icon` on `AttachmentPill.Retry` and `.Remove`.                                 |
| `MessageActionBar icons={{...}}`               | Set `icon` on `MessageActionBar.Copy`, `.Copied`, `.Regenerate`, and `.Edit`.       |
| `BranchPicker icons={{...}}`                   | Set `icon` on `BranchPicker.Previous` and `.Next`.                                  |
| `MessageFeedback icons={{...}}`                | Set `icon` on `MessageFeedback.Positive` and `.Negative`.                           |
| `ChatInput messages`                           | Set `messages` on `<ChatInput.Export>`.                                             |
| `ChatInput onExportClick`                      | Set `onClick` on `<ChatInput.Export>`.                                              |
| `AgentPicker.Content searchPlaceholder`        | Set `placeholder` on `<AgentPicker.Search>`.                                        |
| `ModelSelector.Content searchPlaceholder`      | Set `placeholder` on `<ModelSelector.Search>`.                                      |
| `Message.Content contentClassName`             | Set `className` on `<ChatMessageList.Content>` or the specific `Message` leaf.      |
| `InlineCitation cardClassName`                 | Set `className` on `<InlineCitation.Card>`.                                         |
| `useDropZone().dragProps`                      | Use the returned `onDragEnter`, `onDragLeave`, `onDragOver`, and `onDrop` handlers. |

```diff
- <InlineCitation index={0} source={source} cardClassName="wide" />
+ <InlineCitation index={0} source={source}>
+   <InlineCitation.Trigger />
+   <InlineCitation.Card className="wide" />
+ </InlineCitation>
```

## E10: Use one controlled Chat path

Pass one complete `UseChatResult` to the preset:

```diff
- <Chat
-   messages={chat.messages}
-   input={chat.input}
-   onChange={chat.handleInputChange}
-   onSubmit={chat.handleSubmit}
- />
+ <Chat chat={chat} />
```

The flat session props are removed: `messages`, `input`, `onChange`, `onSubmit`,
`sendMessage`, `stop`, `reload`, `setInput`, `isLoading`, `error`, `models`,
`model`, `activeModel`, `onModelChange`, `inferenceMode`, `editMessage`,
`getBranches`, `switchBranch`, `quickActions`, `onQuickAction`, and
`renderTool`.

The spread-oriented `UseChatResult.onChange`, `.onSubmit`, and `.onModelChange`
aliases are also removed. Use `handleInputChange`, `handleSubmit`, and `setModel`.

For a custom tool row, use a `Message.Content` function child and render
`Message.Part` for the groups you do not replace:

```tsx
<Message.Root message={message}>
  <Message.Content>
    {(part) =>
      part.type === "tool" ? <CustomTool tool={part.tool} /> : <Message.Part part={part} />}
  </Message.Content>
</Message.Root>;
```

The redundant `renderTool` callbacks on `Chat`, `ChatMessageList`,
`Message.Content`, `Message.Part`, and `AgentCard` are removed. Use
`renderMessage` for a whole transcript row or compound children for leaf-level
control.

## Replace compatibility component names

| Removed import                          | Canonical import                        |
| --------------------------------------- | --------------------------------------- |
| `ChatComponents`                        | `Chat`                                  |
| `ChatComposer`, `Chat.Composer`         | `ChatInput`, `Chat.Input`               |
| `Attachment`                            | `AttachmentPill`                        |
| `UploadsPanel`                          | `AttachmentsPanel`                      |
| `StandaloneMessage`, `StreamingMessage` | `Message`                               |
| `MessageActions`                        | `MessageActionBar` or `Message.Actions` |
| `ReasoningCard`                         | `Reasoning`                             |
| `ToolCallCard`                          | `ToolCall`                              |

The corresponding compatibility prop type aliases are removed as well. Import
the prop type that matches the canonical component name.

## Replace deferred render props

| Removed prop                  | Replacement                                                                 |
| ----------------------------- | --------------------------------------------------------------------------- |
| `ModelSelector.renderTrigger` | Compose `<ModelSelector.Trigger>`.                                          |
| `ModelSelector.renderRow`     | Use `renderItem={({ item, index }) => ...}` or compose `.List` and `.Item`. |
| `Sources.renderPill`          | Use `renderItem={({ item, index }) => ...}` or compose `.List` and `.Pill`. |
| `Message.Tokens.renderRow`    | Use `renderItem={({ item, index }) => ...}`.                                |
| `InlineCitation.renderCard`   | Compose `<InlineCitation.Card>` children.                                   |
| `ToolCall.renderSkill`        | Compose a `ToolCall` variant or its compound leaves.                        |

## Verify the migration

Run these checks in the consumer application:

```bash
deno task codemod:chat -- --check ./app
deno check ./app/main.tsx
```

The Veryfront repository verifies the published surface with
`deno task typecheck:consumer`. Its chat ratchet gate requires zero feature
flags and zero passthrough bags.
