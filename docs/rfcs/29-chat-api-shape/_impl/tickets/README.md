# RFC 29 — `veryfront/chat`: ticket index

One markdown ticket per piece (per component, per hook), each carrying its own gate checklist
(the 9-point per-component conformance checklist / per-hook behaviour test from `../spec.md`).
Tickets are grouped into **batches A–G** — each batch shares a substrate and defines the
execution order. A piece is "done" only when every gate column in `../matrix.md` is checked.

## Batches

- **A — Tracer: picker cluster.** `AgentPicker` + `ModelSelector` + `ChatActions` + hooks.
  Already match the RFC, sit directly on `ui` Popover / DropdownMenu → completing them exercises
  the whole Phase-2 adapter layer and closes the biggest barrel gap. Highest signal, lowest
  risk.
- **B — Composer + input-state consolidation.** `useChatInput` / `useChatInputContext`, strip
  `useChat` input state, delete `ChatInput` centering wrapper (with parity snapshot),
  `AttachmentPill` + `useUpload` + `useVoiceInput`. Highest coupling → second, on the proven rig.
- **C — Message + parts.** `Message.Parts` / `.File` / `.Image`, −`Feedback`; `ToolCall`
  approval `data-state` + skill-guard decouple; `Reasoning` / `StepIndicator` / `Sources`
  explicit-input hooks; `useMessageBranches` + `BranchPicker`; `MessageActionBar` trim.
- **D — Scroll + list.** `useChatScroll` subsumes `useStickToBottom` → `ChatMessageList`
  `.ScrollButton` + two-node root collapse + streaming a11y `role="log"`; `ChatEmptyState`.
- **E — Conversations + sidebar.** `ChatSidebar.Item.Title` / `Menu.Trigger`;
  `useConversations.selectAgent`; barrel-export the sidebar / conversation hooks.
- **F — Adapter split + relocations / cuts.** Agent `/api/agents` hooks + `AgentCard` SDK view
  behind the veryfront adapter; the relocations / cuts — the breaking-ledger finale.
- **G — L1 preset + barrel + theme.** `Chat` prop trim (~28→7 once its L2 parts are done); final
  `chat/index.ts` export sweep; land RFC docs as canonical.
