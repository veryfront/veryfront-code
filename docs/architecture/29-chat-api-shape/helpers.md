# Helpers

Pure functions — no DOM, no hooks. The primitives several hooks and components are built on, exported for L3 use.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../29-chat-api-shape.md).

Every helper is a plain function you can call anywhere — in your own part renderers, export buttons, or server code. Where a hook is "thin over" a helper, the helper is the exported primitive so L3 consumers never re-implement it.

## Reference

| Helper | Signature → purpose |
| --- | --- |
| `getTextContent(msg)` | Flat text of a message. |
| `groupPartsInOrder(parts)` | `PartGroup[]` — groups adjacent parts; the primitive under [`useMessageParts`](./hooks/use-message-parts.md). |
| `isToolPart(part)` | Part type guard for tool parts. |
| `isReasoningPart(part)` | Part type guard for reasoning parts. |
| `isSkillToolPart(part)` | Part type guard for skill-tool parts. |
| `extractSourcesFromParts(parts)` | Citation list — the primitive under [`useSources`](./hooks/use-sources.md). |
| `getAgentPromptSuggestions(agent)` | `string[]` — lossy; kept for compat. |
| `getAgentPromptSuggestionItems(agent)` | `{ label, prompt }[]` — public (#2978); selection hands the *item* back, no `.find` massaging. |
| `normalizeAgentMetadata(value)` | API response normalizer for agent metadata. |
| `normalizeAgentsListResponse(value)` | API response normalizer for the agents list. |
| `exportAsMarkdown(messages)` | Transcript export to markdown. |
| `downloadMarkdown(messages, filename?)` | Transcript export + download. |
| `extractChatMessageMetadata(value)` | Typed metadata off a message. |
| `agentsToPickerOptions(agents)` | Maps agents to picker options — used by [`ChatAgentPicker`](./components/chat-agent-picker.md). |
| `mergeProps(...propsObjects)` | **New, public** — the normative merge used internally by every prop getter and `asChild` (React Aria model). |

## Notes

- **`mergeProps` is the normative merge.** It is the exact merge the library uses internally, exported for L3 consumers composing several hooks onto one element: event handlers compose (consumer first, `preventDefault` cancels internal), `className` merges Tailwind-aware (consumer wins), `style` shallow-merges consumer-wins, refs compose. See the *Merge semantics* section of the RFC.
- **Part guards at L3.** `isToolPart` / `isReasoningPart` / `isSkillToolPart` are the switch you write inside a [`Message.Parts`](./components/message.md) render function or your own `useMessageParts` loop.
- **Transcript export composes.** [`ChatActions`](./components/chat-actions.md) thread-level export/clear and [`ChatInput.Export`](./components/chat-input.md) are built from `exportAsMarkdown` / `downloadMarkdown` — the same functions you call yourself.
