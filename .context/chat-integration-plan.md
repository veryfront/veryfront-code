# Chat integration plan — a batteries-included `<Chat>` (Studio parity)

Integrate the new `veryfront/chat` components into a real, working chat that **closely
resembles Veryfront Studio both visually and behaviorally**, driven from a consuming app
(the `:3000` demo) with **minimal code — ideally just `<Chat {...} />`**.

## Definition of done
A fully working chat where the consumer writes ~one component, and it matches Studio for:
skeleton loading, idle/empty state (agent avatar + name + suggestions), suggestion→send,
message formatting (agent header, right-aligned user turns, spacing, hover toolbar), tool
calls + skills, reasoning, streaming + retry + stop, scroll-to-bottom, `+` attach → OS
dialog, dropzone upload flow, sticky input, page layout/width, and SSR (no height jump).

## The core architectural move
Today `<Chat>` is **controlled** (caller passes `messages`, `input`, `onChange`,
`onSubmit`, `stop`, `reload`… and wires `useChat` themselves — see
`src/react/components/chat/chat/index.tsx:202`). `ChatWithSidebar`
(`chat-with-sidebar.tsx`) is already close to batteries-included but still takes a
`chat={useChat(...)}` controller.

**Add an uncontrolled "app" mode** so the consumer passes only config, and `<Chat>`
wires `useChat` + `useAgentMetadata` internally:

```tsx
// The whole consumer:
<Chat agentId="inbox-helper" api="/api/ag-ui" />
```

- New props (all optional): `agentId`, `api`, `initialMessages`, `models`, `uploadApi`,
  `sidebar`, `onError`. When `messages`/`input` are NOT passed, `<Chat>` self-drives via
  `useChat({ api, agentId, initialMessages })` and `useAgentMetadata(agentId)`.
- Keep the existing controlled surface for power users (back-compat).
- The demo app keeps only: the API route(s) (`/api/ag-ui`, `/api/uploads`) + `<Chat …/>`.

## Current state (from repo exploration)
- ✅ `<Chat>` preset renders empty state, message list, composer, dropzone overlay, error
  banner, model selector, voice, export; compound API (`Chat.Root/MessageList/Composer/…`).
- ✅ `useChat` returns `messages,input,isLoading,error,model,activeModel,inferenceMode,
  sendMessage,editMessage,getBranches,switchBranch,reload,stop,setMessages,addToolOutput,
  handleInputChange,handleSubmit` (`src/agent/react/use-chat/use-chat.ts:463`).
- ✅ `useAgentMetadata(id)` → `{ agent: { id,name,description,avatarUrl,suggestions } }`
  from `/api/agents/:id` (`src/agent/react/use-agent-metadata.ts:40`).
- ✅ Tool calls (`ToolCall`), skills (`SkillTool`), reasoning (`Reasoning`), sources,
  markdown, feedback all render in the message list.
- ✅ Dropzone overlay + attach `+` menu + attachment pills with upload states exist.
- ⚠️/❌ Gaps: no streaming **skeleton**; scroll-to-bottom button exists but **not wired**
  (no stick-to-bottom hook); agent metadata **not consumed** by the preset (avatar/name/
  suggestions must be passed manually); no built-in **upload client**; SSR textarea height
  set in a plain effect → **post-hydration jump**; `AgentPicker` not wired into composer.

## Progress (this round)
- ✅ **#4 Message formatting** — Message Studio-parity rebuild landed (Header, right-aligned user `max-w-[80%]`, regenerate, Tokens popover; `StandaloneMessage` now composes the compound parts). See chat-review.
- ✅ **#2/#3/#5 Uncontrolled `<Chat>` app mode** — `<Chat agentId api />` self-drives `useChat` + `useAgentMetadata` when `messages`/`input` are omitted (`ControlledChat`/`UncontrolledChat` split, conditional render not conditional hooks). Empty state fed from agent metadata (avatar icon + name + description), suggestions from `agent.suggestions`, default `onSuggestionClick → sendMessage`, retry via `reload`. Controlled surface kept for back-compat. Driver green, controlled preset unchanged (screenshot).

- ✅ **#6/#12 Layout + scroll + sticky** — `useStickToBottom` hook (auto-scroll only while pinned, pauses on width reflow, `ResizeObserver`); `ConversationScrollButton` now hidden at bottom + wired to `scrollToBottom`; message column + composer both `max-w-[850px]`; composer sticky via the flex column. Scroll button gained an aria-label.
- ✅ **#1 Skeleton** — `ChatMessagesSkeleton` (Studio 1:1, alternating user/assistant rows, `aria-busy`), rendered when a thread is loading with no messages yet.
- ✅ **#7/#8 Attach + upload** — composer `+` menu already portalled (chat-review); added `useUpload({api})` — multipart POST → `{id,url}`, per-file lifecycle (`uploading`%/`uploaded`/`error`) driving the `Attachment` pill states; `url` added to `AttachmentInfo`. Public `veryfront/chat` export.
- ✅ **#9/#10 Stop/Mic + SSR height** — composer footer: streaming→Stop, empty→**Mic** (via `onVoice`), value→Send. Textarea auto-resize moved to `useLayoutEffect` + `suppressHydrationWarning` + fixed `min-h` → no post-hydration jump.

- ✅ **#11 Tool/skill coverage** — audited `groupPartsInOrder`: text/tool/`dynamic-tool`/reasoning/step/tool-result all handled; `isToolPart` covers `dynamic-tool` + `tool-*`. **Fixed a gap:** both render paths (`Message.Content` + preset `AssistantMessage`) were still rendering skills through the OLD `SkillBadge` pill — now routed to the rebuilt **`SkillTool`** row via `getSkillToolProps(part)`. Tools → `ToolCall`, skills → `SkillTool`, everywhere.

## Per-requirement plan

| # | Requirement | Current | Studio reference | Work |
|---|---|---|---|---|
| 1 | **Skeleton while loading** | `isLoading` flag only, no skeleton rows | `ChatMessagesSkeleton.tsx` (alternating user/assistant skeleton rows, `aria-busy`) | Build `ChatMessagesSkeleton` (Chat/UI or chat); render it in the message list when the thread is loading (before first message). |
| 2 | **ChatEmptyState from agent config** | `ChatEmptyState` exists but fed manual props | `ChatIdleView` fed by `useSelectedProjectAgent()` (avatar/name/description) + `selectedAgent.suggestions` | In uncontrolled mode, feed `ChatEmptyState` from `useAgentMetadata` (avatar, name, description, suggestions). |
| 3 | **Suggestions trigger a chat** | `onSuggestionClick` prop | `handleIdleSuggestionClick` → `addMessageToChat({text})` | Default `onSuggestionClick` → `sendMessage({text: suggestion})`. |
| 4 | **Message formatting = Studio** | Message parts render; alignment/toolbar need parity pass | `Message.tsx` (`from==='user'` → `ml-auto justify-end`, `max-w-[80%]`), `ChatMessageHeader` (avatar `size-8` + name + right timestamp), hover `MessageActions` | **Message Studio-parity rebuild** (see chat-review "big rebuilds"): header avatar+name+timestamp, right-aligned user bubbles + max-width, spacing tokens (`--chat-prose/leading/meta`), hover toolbar (copy/regenerate). |
| 5 | **Retry + streaming mechanism** | `useChat.reload()` + `stop()` + `isLoading` | `chat.regenerate()` / `resumeStream()`; memoize non-streaming messages (`ChatMessageContainer` React.memo, only re-render `isLastMessage && isStreaming`) | Wire `reload` to the message toolbar's Regenerate; memoize completed message rows so streaming only re-renders the last row. Surface `error` → retry affordance. |
| 6 | **Scroll-to-bottom button** | `ConversationScrollButton` exists, unwired | `useStickToBottom()` + button hidden when `isAtBottom`; ResizeObserver pauses on width change; scroll on load | Add a `useStickToBottom` hook (or fork the technique); wire the button in the message list (hidden at bottom); auto-scroll on new message + on load; pause on layout width change. |
| 7 | **ChatInput `+` → OS dialog** | Bespoke attach menu (Upload/Select document) — clips + no portal | `PlusMenu` = `DropdownMenu` + `useDropzone({noClick:true, open})`; item "Attach Files or Photos" calls `open()` | Replace the composer's bespoke menu with **ChatActions** (portalled DropdownMenu); "Attach Files or Photos" triggers the hidden file input / dropzone `open()`. (Also fixes the clip bug in chat-review.) |
| 8 | **Dropzone + upload API** | Dropzone overlay + `onAttach/onDrop`; no upload client | `useInlineFileUpload` + `uploadChatDataFiles` (blob preview → presigned URL → GCS → proxy URL); accepts typed files | Ship a `useUpload({api})` hook (fork the technique; simpler: POST FormData → `/api/uploads` → `{id,url}`), wired to the attachment pill states (uploading %/uploaded/error). **Keep the existing template upload API** (`cli/templates/.../api/uploads`) as the reference/default. |
| 9 | **Stop button behavior** | Submit swaps to stop (done in composer) | `PromptFormActions`: streaming → Stop (`Square`); empty → Mic; else Send (`ArrowUp`) | Verify parity: streaming shows Stop → `stop()`; empty shows Mic (needs a Mic icon); value shows Send. (Composer already does Send/Stop; add Mic-idle state.) |
| 10 | **SSR input height (no jump)** | Textarea auto-resize in a plain `useEffect` → jump | TipTap `immediatelyRender:false` + fixed `min-h/max-h` classes so SSR + client match | Give the textarea a fixed `min-h` (e.g. `min-h-[52px] md:min-h-[60px]`) matching SSR; run resize in `useLayoutEffect`; `suppressHydrationWarning`. No post-hydration jump. |
| 11 | **All tool calls + skills** | `ToolCall` + `SkillTool` render in the list | `ChatToolCard`/`ChatTool`/`LoadSkillTool` | Confirm every tool/skill part routes to `ToolCall`/`SkillTool` in the message list (audit `message-parts.ts` grouping). Mostly done — verify coverage. |
| 12 | **Page layout / width + sticky input** | Composer is in-flow; width via `max-w-3xl` | Messages `max-w-[850px] mx-auto`; input sticky at bottom of the column | Match container width (`max-w-[850px]`), make the ChatInput **sticky to the bottom** of the chat column, messages scroll above it. |

## Suggested build order
1. **Message Studio-parity rebuild** (#4) — foundation; also unblocks AgentCard (chat-review).
2. **Uncontrolled `<Chat>` mode** (#2, #3, #5) — internally wire `useChat` + `useAgentMetadata`; empty state + suggestions + retry.
3. **Layout + sticky input + scroll-to-bottom** (#6, #12) — `useStickToBottom`, sticky composer, width.
4. **Skeleton** (#1).
5. **Attach + dropzone + upload hook** (#7, #8) — ChatActions `+` menu + `useUpload`.
6. **Stop/Mic + SSR height** (#9, #10) — composer polish.
7. **Tool/skill coverage audit** (#11).
8. Ship the minimal `:3000` example: API route(s) + `<Chat agentId=… api=… />`.

## Notes
- Keep the consumer minimal — all wiring lives in `veryfront/chat`. The `:3000` repo = API route(s) + `<Chat …/>`.
- Fork Studio's *techniques* (stick-to-bottom, streaming memoization, upload orchestration) — do **not** import Studio deps (radix/cva/`@/`), per the rulebook in `chat-components-checklist.md`.
- Depends on the outstanding component fixes in `chat-review.md` (Message rebuild, ChatInput `+` menu, Tooltip portal) — do those first where they overlap.
