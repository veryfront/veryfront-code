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
> was exactly that — it still advertised a `veryfront/react` module that has
> never existed in `deno.json`'s `exports`, an `AgentCard` `theme` prop that was
> removed, and a message-part `switch` that silently dropped every real tool
> call. Keep this file to orientation: where things are, and which check keeps
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

Three module specifiers reach this code, and they must expose the _same function
objects_, not merely the same names:

- `veryfront/chat` → [`src/chat/index.ts`](../../../chat/index.ts) — the only
  one in `deno.json`'s `exports`, so the only one a consumer project can import.
- `veryfront/react/components/chat` and `veryfront/components/chat` →
  [`index.ts`](./index.ts) — internal import-map aliases, re-exporting
  [`chat.tsx`](./chat.tsx), which aggregates the subdirectories above.

A new export has to be threaded through all of them.
[`src/chat/index.test.ts`](../../../chat/index.test.ts) asserts identity across
the barrels and that each `ChatInput` leaf is the same function as its compound
sub-part; `deno task lint:chat-ratchets` type-checks
[`src/react/chat-barrels.check.ts`](../../chat-barrels.check.ts) alongside it.

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
- [`docs/rfcs/29-chat-api-shape.md`](../../../../docs/rfcs/29-chat-api-shape.md) — why the composition surface is shaped this way
