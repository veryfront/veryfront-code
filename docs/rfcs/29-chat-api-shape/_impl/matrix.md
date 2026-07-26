# RFC 29 — `veryfront/chat`: master tracking matrix

Every component + every hook, tracked across the 6 gate columns. Reproduced verbatim from the
approved plan's "Full matrix — every component + every hook" section. A row is **done** only
when every gate box is checked.

Gate boxes, in order: **Spec · Built · Story · Test · Styled · Verified** (`☐` = todo).

**Recon tag:** `M` = behavior matches · `C` = API-change · `N` = diff-name / consolidate ·
`X` = missing · `b` = barrel-export gap · `cut` / `reloc`. Every non-`cut` row still owes the
one-node / `forwardRef` / no-bags rewrite.

**Batch** = execution order (A→G; see `tickets/README.md`).

## Components (25)

| Component | Recon | Batch | Spec·Built·Story·Test·Styled·Verified |
|---|---|---|---|
| AgentPicker | M·b | A | ☐☐☐☐☐☐ |
| ModelSelector | C·b | A | ☐☐☐☐☐☐ |
| ChatActions | C·b | A | ☐☐☐☐☐☐ |
| ChatInput | C | B | ☐☐☐☐☐☐ |
| AttachmentPill | M | B | ☐☐☐☐☐☐ |
| Message | C | C | ☐☐☐☐☐☐ |
| ToolCall | C | C | ☐☐☐☐☐☐ |
| Reasoning | C | C | ☐☐☐☐☐☐ |
| StepIndicator | C | C | ☐☐☐☐☐☐ |
| Sources | C | C | ☐☐☐☐☐☐ |
| InlineCitation | M | C | ☐☐☐☐☐☐ |
| BranchPicker | M | C | ☐☐☐☐☐☐ |
| MessageActionBar | C(trim) | C | ☐☐☐☐☐☐ |
| Markdown | M(wording) | C | ☐☐☐☐☐☐ |
| ChatMessageList | C | D | ☐☐☐☐☐☐ |
| ChatEmptyState | C | D | ☐☐☐☐☐☐ |
| ChatSidebar | C·b | E | ☐☐☐☐☐☐ |
| ChatRoot | M | E | ☐☐☐☐☐☐ |
| AgentCard | M(adapter) | F | ☐☐☐☐☐☐ |
| ChatAgentPicker | M·b(adapter) | F | ☐☐☐☐☐☐ |
| AttachmentsPanel | C(reloc) | F | ☐☐☐☐☐☐ |
| ChatErrorBoundary | M(reloc→ui) | F | ☐☐☐☐☐☐ |
| Chat (L1) | C(prop trim) | G | ☐☐☐☐☐☐ |
| ChatThemeScope | M·b(name) | G | ☐☐☐☐☐☐ |
| AppShell | M(in ui) | ref | ☐☐☐☐☐☐ |

## Hooks (33)

Hooks have no Story / Styled of their own — they're covered by their component's stories and
default-render parity (`n/a` below). The two `cut` hooks don't enter the barrel.
`consumed-from-ui` is a doc page, not a hook.

| Hook | Recon | Batch | Spec·Built·Story*·Test·Styled*·Verified |
|---|---|---|---|
| useAgentPicker | M·b | A | ☐☐n/a☐n/a☐ |
| useModelSelector | M·b | A | ☐☐n/a☐n/a☐ |
| useChatActions | M·b | A | ☐☐n/a☐n/a☐ |
| useChatInput | **N** (⇐useComposerValue) | B | ☐☐n/a☐n/a☐ |
| useChatInputContext | **N** (⇐useComposerContext) | B | ☐☐n/a☐n/a☐ |
| useUpload | M | B | ☐☐n/a☐n/a☐ |
| useVoiceInput | M | B | ☐☐n/a☐n/a☐ |
| useAttachmentPill | M | B | ☐☐n/a☐n/a☐ |
| useMessageContext | M | C | ☐☐n/a☐n/a☐ |
| useMessageParts | M | C | ☐☐n/a☐n/a☐ |
| useToolCall | C | C | ☐☐n/a☐n/a☐ |
| useReasoning | C | C | ☐☐n/a☐n/a☐ |
| useStepIndicator | C·b | C | ☐☐n/a☐n/a☐ |
| useSources | M·b | C | ☐☐n/a☐n/a☐ |
| useMessageBranches | **X (missing)** | C | ☐☐n/a☐n/a☐ |
| useClipboard | M | C | ☐☐n/a☐n/a☐ |
| useChatScroll | **N** (⇐useStickToBottom, superset) | D | ☐☐n/a☐n/a☐ |
| useConversations | M·b (+selectAgent) | E | ☐☐n/a☐n/a☐ |
| useConversation-Chat | C(+ready) | E | ☐☐n/a☐n/a☐ |
| useConversationsContext | M | E | ☐☐n/a☐n/a☐ |
| useChatSidebarItem | M·b | E | ☐☐n/a☐n/a☐ |
| useChatContext | M | E | ☐☐n/a☐n/a☐ |
| useChat | C (−input state) | B/F | ☐☐n/a☐n/a☐ |
| useAgents | M(adapter) | F | ☐☐n/a☐n/a☐ |
| useAgent | M(adapter) | F | ☐☐n/a☐n/a☐ |
| useAgentMetadata | M(adapter) | F | ☐☐n/a☐n/a☐ |
| useAgentCard | M·b | F | ☐☐n/a☐n/a☐ |
| useAttachments | M(reloc) | F | ☐☐n/a☐n/a☐ |
| useAttachmentsPanel | M(reloc) | F | ☐☐n/a☐n/a☐ |
| useChatErrorHandler | M(reloc→ui) | F | ☐☐n/a☐n/a☐ |
| useStreaming | M | F | ☐☐n/a☐n/a☐ |
| useCompletion | **cut** | — | n/a |
| useConversation | **cut** | — | n/a |

*Hooks have no Story / Styled of their own — they're covered by their component's stories and
default-render parity. The two `cut` hooks don't enter the barrel. `consumed-from-ui` is a doc
page, not a hook.

## Recon summary (from the reconciliation headline)

| | behavior MATCHES | API-CHANGE | DIFF-NAME | logic MISSING | barrel-only gap |
|---|---|---|---|---|---|
| Components (25) | 8 | 14 | 0 | **0** | 6 |
| Hooks (33) | ~22 | 6 | 3 | **1** | ~10 |

- **Only truly missing:** `useMessageBranches` (extract from
  `useChat().getBranches / switchBranch`; powers `BranchPicker`).
- **DIFF-NAME (RFC name wins; keep deprecated alias one release):** `useChatInput` ⇐ consolidate
  `useComposerValue` + submit fold / guard / clear + voice (and remove `input` /
  `handleInputChange` from `useChat`); `useChatInputContext` ⇐ `useComposerContext`;
  `useChatScroll` ⇐ superset of `useStickToBottom`; `ChatInput.Field` (not `.Input`);
  `useAttachments` ⇐ `useUploadsRegistry`; `ChatThemeScope` ⇐ reconcile barrel vs
  `ChatStyleProvider`.
- **6 barrel gaps** (exist, unexported): `AgentPicker`, `ChatActions`, `ChatAgentPicker`, + their
  hooks — pure `chat/index.ts` re-export work.
- **Cuts (nothing ships ahead of its backend):** `Message.Feedback`, `useCompletion`,
  `useConversation`. **Relocations:** `AttachmentsPanel` + attachment hooks →
  `veryfront/chat/attachments`; `ChatErrorBoundary` / `useChatErrorHandler` → `veryfront/ui`. All
  removals / relocations ship in the **one batched breaking release** (RFC rule 8 ledger).
