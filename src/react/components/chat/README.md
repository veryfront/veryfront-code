# Chat components — contributor map

Implementation of the chat UI. The public entry point is `veryfront/chat`,
declared in `deno.json` as [`src/chat/index.ts`](../../../chat/index.ts); the
components it re-exports live here.

> **This file is not the chat API documentation, and must not become it.**
>
> Every published name, signature, prop, and usage example is already carried by
> generated or contract-tested files (below). A hand-written fourth copy beside
> the source is the worst of the four: it looks authoritative because it sits
> next to the code, and nothing checks it. The previous version of this README
> was exactly that — every one of its examples imported from a path
> `deno.json`'s `exports` has never published (`veryfront/react`,
> `veryfront/agent/react`), it showed an `AgentCard` `theme` prop that
> `AgentCardProps` does not have, and its headline renderer branched on a
> message-part type that never arrives, silently dropping every real tool call. Keep this file to orientation: where things are, and which check keeps
> which claim honest. If you want to write an example, put it where a test can
> run it.

## Where the chat API is documented — and what keeps each honest

| Document                                                                                   | Covers                                                       | Enforced by                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/api-reference/veryfront/chat.md`](../../../../docs/api-reference/veryfront/chat.md) | Every export of `veryfront/chat`, with source links          | Generated. `deno task docs` regenerates; `deno task docs:api-reference:check` fails CI when it drifts                                                          |
| [`docs/guides/chat-ui.md`](../../../../docs/guides/chat-ui.md)                             | Preset → customization → composition, theming, conversations | `tests/docs/guide-*.test.ts` (via `deno task docs:validate`) compile and assert the examples                                                                   |
| [`docs/guides/chat-hooks.md`](../../../../docs/guides/chat-hooks.md)                       | `useChat`, `useAgent`, persistence, composition hooks        | same guide contract tests                                                                                                                                      |
| Storybook stories under `storybook/stories/chat`                                           | Rendered anatomy per compound                                | [`scripts/lint/audit-chat-composability.ts`](../../../../scripts/lint/audit-chat-composability.ts) rejects `compositionTree` tokens that aren't real sub-parts |
| JSDoc on the exports themselves                                                            | Per-prop meaning                                             | Feeds the generated reference above                                                                                                                            |

Docs changes belong in one of those. Adding an export? Regenerate the reference
with `deno task docs` (CI pins Deno 2.7.7 — put it first on `PATH`).

## Layout

| Path                                                                                                                                                                                                         | Holds                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [`chat/composition/`](./chat/composition)                                                                                                                                                                    | The composition surface — `ChatRoot`, `ChatMessageList`, the composer, `Message`, `ChatEmpty`, `ChatIf`, `ErrorBanner` |
| [`chat/contexts/`](./chat/contexts)                                                                                                                                                                          | The providers those read from: chat, message, composer, conversations                                                  |
| [`chat/components/`](./chat/components)                                                                                                                                                                      | Leaf pieces — reasoning, tool calls, sources, attachments, feedback, skeletons                                         |
| [`chat/hooks/`](./chat/hooks)                                                                                                                                                                                | Headless hooks — composer input, stick-to-bottom, uploads, the `useConversation*` family                               |
| [`chat/persistence/`](./chat/persistence)                                                                                                                                                                    | Conversation store implementations (local, memory) plus their codec and lock                                           |
| [`chat/utils/`](./chat/utils)                                                                                                                                                                                | Part grouping, text extraction, Markdown export                                                                        |
| [`chat/chat-preset.tsx`](./chat/chat-preset.tsx)                                                                                                                                                             | The `<Chat>` preset — app mode and controlled mode assembled from the above                                            |
| [`theme.ts`](./theme.ts), [`chat-tokens.ts`](./chat-tokens.ts), [`chat-theme-scope.tsx`](./chat-theme-scope.tsx)                                                                                             | Theme contracts and the CSS-variable token scope. Dark mode is tokens, not `dark:` variants                            |
| [`agent-card.tsx`](./agent-card.tsx), [`agent-picker.tsx`](./agent-picker.tsx), [`model-selector.tsx`](./model-selector.tsx), [`markdown.tsx`](./markdown.tsx), [`error-boundary.tsx`](./error-boundary.tsx) | Standalone components that ship through the same barrel                                                                |

## Barrels and the parity rule

Three barrels re-export this code, and their export sets are deliberately
_different_. The rule is identity on the shared subset, not one union:

- `veryfront/chat` → [`src/chat/index.ts`](../../../chat/index.ts) — the only
  one of the three in `deno.json`'s `exports`, so the only one a consumer
  project can import. A curated public surface: it takes components from
  [`chat.tsx`](./chat.tsx), adds names that don't live in this directory at all
  (`useChat`, `useAgent`, `useCompletion`, `useStreaming`, `useVoiceInput` from
  `src/agent/react/`; `AppShell`, `Tabs`, `CodeBlock` from [`../ui/`](../ui)),
  and withholds others on purpose — `chatTokens`, `getChatTokensCSS`, and
  `ColorModeProvider` are asserted _absent_ from it.
- `veryfront/react/components/chat` and `veryfront/components/chat` →
  [`index.ts`](./index.ts) — internal import-map aliases over the same
  [`chat.tsx`](./chat.tsx), plus this directory's theme, token, style-provider
  and color-mode exports that the public surface withholds.
- [`../../public.ts`](../../public.ts) — the browser barrel served as
  `veryfront/react` by the generated import map. Also internal: not in
  `deno.json`'s `exports`.

What is actually enforced, and where:

- **Presence in all three**, for one named subset only:
  `CompoundChatRuntimeExport` in
  [`../../chat-barrels.check.ts`](../../chat-barrels.check.ts) lists the 32
  names (the `ChatInput` leaves, `AgentAvatar`, `ChatEmptyState`,
  `ChatMessagesSkeleton`, `mergeProps`, the headless hooks) that must exist in
  every barrel; that file also cross-checks `Reasoning`/`ToolCall`, the
  conversation type family, and `ChatInputRootProps` compatibility.
  `deno task lint:chat-ratchets` type-checks it.
- **Identity** — the same function object, not just the same name — for the ten
  `ChatInput` leaves across `veryfront/chat`, both component aliases and
  `chat.tsx` (and against the matching `ChatInput.<Part>`), for
  `useConversationChat` and the canonical hook/context set across both aliases,
  and for the core re-exports (`Chat`, `useChat`, `useAgent`, `AgentCard`,
  `ChatErrorBoundary`, …) against their defining modules. All in
  [`src/chat/index.test.ts`](../../../chat/index.test.ts).
- **The exact public key list**: the same test asserts `Object.keys` of
  `veryfront/chat` equals a literal array, so adding or removing a public export
  fails until that array is updated.

So a new export does not automatically belong in all three — pick the surface.
Public chat API goes in `src/chat/index.ts` plus its `expectedRuntimeExports`
entry; something only the React components need belongs in the components
barrel alone. Either way re-export it from the module that defines it rather
than re-wrapping — every barrel reading the same source file is what keeps the
shared names identical — and if it is part of a compound, add it to
`CompoundChatRuntimeExport` so all three stay in step.

Sub-parts are attached with `Object.assign` (`Chat.Root`, `Message.Content`,
`ChatInput.Send`, …). The composability lint and
`chat/composability.contract.test.tsx` both key off that shape, so keep new
parts on the same pattern.

## Working on this directory

`deno task lint:chat-ratchets`, `deno task lint:chat-composability`, and
`deno task docs:api-reference:check` are the chat-specific gates;
`deno task docs:check-links` validates the relative links in this file.

## See also

- [`../README.md`](../README.md) — sibling framework components
- [`../../README.md`](../../README.md) — the React module as a whole
- [Chat API shape issue](https://github.com/veryfront/veryfront-issue-inbox/issues/739) — proposal history behind the composition surface
