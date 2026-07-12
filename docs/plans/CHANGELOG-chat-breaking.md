# Chat composition breaking-change summary

This change completes the E8-E11 `veryfront/chat` composition batch. The
package version remains unchanged in this pull request. Versioning and release
publication remain separate release operations.

## Added

- `ChatInput.Export`
- `ChatMessageList.Content`
- `InlineCitation.Trigger` and `InlineCitation.Card`
- `AgentPicker.Search`, `AgentPicker.Create`, and `AgentPicker.Manage`
- `BranchPicker.Previous`, `BranchPicker.Count`, and `BranchPicker.Next`
- `MessageActionBar.Copy`, `MessageActionBar.Copied`,
  `MessageActionBar.Regenerate`, and `MessageActionBar.Edit`
- `MessageFeedback.Positive` and `MessageFeedback.Negative`
- `ModelSelector.Search`
- a Babel AST migration codemod exposed as `deno task codemod:chat`
- focused compound, consumer type, and migration tests

## Changed

- `<Chat>` accepts `chat={useChat()}` as its only controlled preset path.
- The Chat preset always includes attachments, message sources, multi-step
  rendering, message actions, and the scroll-to-bottom control.
- Search, export, tabs, voice, source, action, and step customization is driven
  by compound-part presence.
- `Sources`, `ModelSelector`, and `Message.Tokens` use the canonical
  `renderItem={({ item, index }) => ...}` collection callback.
- `useDropZone` returns named drag handlers.

## Removed

- all `show*`, `enable*`, and `hide*` behavior flags from the chat source
- all icon bags, nested class-name passthrough props, and `dragProps`
- the flat controlled `ChatProps` session API
- spread-oriented `UseChatResult` aliases
- static and redundant render callbacks superseded by compound children
- compatibility component and prop type aliases

## Migration

Use [the migration guide](./MIGRATION-chat-breaking.md) and run:

```bash
deno task codemod:chat -- ./app
```

The codemod performs safe mechanical rewrites and inserts
`TODO(veryfront-migration)` markers when application intent is required.
