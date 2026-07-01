# Chat components — live review tracker

Single source of truth for the review. ✅ done (type + driver green, last `build-storybook` passed) ·
🔧 pending · ⏳ needs a build/refresh to confirm. I have no headless browser, so visual
confirmation is on you (HMR); I verify types + driver + build.

---

## ✅ Done (verified compiling)

- **Duplicates** — retired v1 stories; one entry per component.
- **ChatInput** — Studio `PromptForm` two-row layout; `+` circular grey bg; submit fixed (ArrowUp/Stop, centered, `icon-primary` size-9); agent-pill slot; top padding trimmed; removed download button, "Model only" story, and the duplicate attachments render (row-gap + missing-×).
- **ChatActions** — `+` trigger has bg + no tooltip.
- **AgentPicker** — dropped invented descriptions + With-Manage/Sections/Manage examples.
- **Reasoning** — chevron direction (collapsed → right, open → down); toggle text visible.
- **Sources + InlineCitation** — hover cards use standard popover surface (no border).
- **Avatar** — initial scales to fit via container-query (fills empty-state avatar).
- **Attachment** — shadcn lifecycle states (selected / uploading+% / processing / uploaded / error+retry) on the component.
- **Alert** — new `Chat/UI/Alert` primitive; 14px text; icons via `AlertIcon`.
- **ToolCall** — error uses `Alert` (error + icon); "Error" title removed; added Running story; removed Badges grab-bag.
- **ModelSelector** — rebuilt on Popover + Command (portals via Floating → no clip; grouped by provider; real models.dev logos; `variant` icon/pill; 16px command items).
- **Dropdown / command items** — reverted to 16px (Alert stays 14px).
- **Alert icons** — added `InfoIcon` + `AlertTriangleIcon` to the barrel; default → info, warning → triangle (were empty circles).
- **Sources snippet** — white bg, tooltip metrics (text-xs, `px-2.5 py-1`, `rounded-md`, no shadow/border).
- **Markdown** — block fences now render through the extracted **CodeBlock** (shiki) instead of `RichCodeBlock`.

---

## 🔧 Pending — small / medium

- ✅ **Markdown code blocks BROKEN** (1uaxQz) — FIXED. Added recursive `extractText()` (flattens children to text) + dropped `rehypeHighlight` (CodeBlock does its own shiki). Verified in Storybook: fenced `ts` block now highlights correctly (no `[object Object]`).
- ✅ **Markdown prose styling → Studio parity** — DONE. Root cause: the `prose-*` utilities were inert (no `@tailwindcss/typography` plugin in Storybook/consumers). Rebuilt `MARKDOWN_CONTAINER_CLASS` as self-contained arbitrary-variant descendant selectors mirroring Studio's `variantStyles.default` (`[&_h1]:text-lg`, `[&_ul]:list-disc [&_ul]:pl-6`, `[&_li]:my-1.5`, `[&_hr]:border-t`, spacing). Verified in Storybook: h3 heading + bulleted list now render with hierarchy + markers. Dependency-light (no plugin required by consumers).
- ✅ **RichCodeBlock** — DONE. Added `@deprecated` JSDoc pointing to the shared `CodeBlock` primitive; export kept for back-compat.
- ✅ **ChatActions Settings submenu** (uCs0o7) — DONE. Added a close-delay "safe transit" (leaving the row schedules a 160ms close; entering the submenu/row cancels it) + an invisible hover-bridge over the gap, so the submenu is reachable. `onPointerDownCapture` stopPropagation on the submenu keeps the parent menu open when toggling a switch (the submenu is portalled = "outside"). Also fixed a `Floating` `defaultOpen` positioning bug (rAF re-measure) so default-open menus render positioned. Verified via Playwright: submenu opens on hover, survives transit, toggle keeps parent open (screenshots).
- ✅ **CodeBlock** — DONE. Copy button is now an icon-only `IconButton` (`icon-ghost`/`icon-sm`, tooltip "Copy code", no text) matching Studio's ChatCodeBlock; added `CodeBracketsIcon` next to the language label (flat + collapsible headers). Verified in Storybook (screenshot).
- ✅ **Buttons everywhere use primitives** — DONE (parity-safe pass). Converted the icon buttons where the primitive sizing matches 1:1: composer `+` (icon-tertiary, task #7), composer **export** (IconButton icon-lg + "Export as Markdown" tooltip), **CodeBlock copy** (task #4), **attachment remove + retry** (Button `icon-xs`). Added a new `icon-xs` (size-5) Button size so the tiny pill buttons keep their exact footprint while gaining focus-ring/hover consistency. **Intentionally left as-is (converting would regress parity, rule 1):** Reasoning toggle (bare full-width text+chevron row, no primitive size fits), Sources pills (bespoke `rounded-full` pill shape), ModelSelector icon trigger (Popover anchor with its own logo sizing). Message-area buttons (message-actions / feedback / branch-picker) are covered by the Message rebuild (below).
- ✅ **Tooltip** — DONE. Rewrote `TooltipContent` to portal into `document.body` (escapes iframe/overflow clip) with collision-aware `side` flipping + cross-axis clamp + arrow. Verified via CodeBlock "Copy code" tooltip (screenshot): renders un-clipped, flips to bottom near the top edge.
- ✅ **ChatInput `+` attach menu** — DONE. Replaced the bespoke absolute `div[role=menu]` with the portalled `DropdownMenu` primitive (escapes composer overflow, flips on collision) — items now carry icons (PaperclipIcon → Upload document, FileTextIcon → Select document) at proper size. Single-action case still opens the OS dialog directly. `+` trigger is now the `icon-tertiary` Button primitive. Verified: menu portals to body, no clip (screenshot).
- ✅ **Attachment States story** — DONE. Wired a "Upload states" story showing all five lifecycle states the component already supports (selected/uploading+%/processing/uploaded/error+retry) + documented the `state`/`progress`/`onRetry` props. Verified in Storybook (screenshot): all states render, error shows the retry button.

## 🔧 Pending — bigger per-component rebuilds (Studio parity)

- ✅ **AgentCard** — DONE. Rebuilt as a **`Card`** (new `chat/ui/card.tsx` primitive, ported from Studio's `Card`) wrapping the Message anatomy: header row = **Avatar + name** (left) · **`<Status>`** dot+label (right) — e.g. `[RA] Release Agent  ● Thinking`; thinking → **Reasoning**; tool calls → **ToolCall** card (adapted `ToolCall`→`ChatToolPart`); message text → **Markdown**. Added `name`/`avatarUrl` props, mapped `AgentStatus`→Status color/label/pulse. All primitives, no bespoke boxes/h3 labels. Verified in Storybook (screenshot).
- ✅ **Message** (chat-components-message) — DONE (Studio-parity rebuild). Reworked `Message.Root` to Studio's vertical-column anatomy (`ChatMessageView`/`Message`): assistant header on top, user turns right-aligned + `max-w-[80%]` (no more old dark bubble). Added **`Message.Header`** (agent Avatar `size-8` + name + right timestamp, ported from `ChatMessageHeader`), wired **regenerate** into `Message.Actions` (from `onReload`), and added **`Message.Tokens`** — a token-usage popover (Model/Input/Output/**Total**, dropped "Credits used", tightened per checklist). Rebuilt **`StandaloneMessage`** as a thin wrapper composing the compound parts (was the old monolithic renderer showing raw `[output-available]`/role labels). Re-pointed the export chain (composition/api → chat/index → chat.tsx → both public barrels) + updated `index.test.ts`. Verified in Storybook (header, right-aligned user, reasoning, markdown, tool card, token popover — screenshots).
- **ChatSidebar** — "looks totally broken"; make it resemble Studio's chat sidebar (M2PPf6): **slimmer list items**, a per-row **context menu** (rename/delete via DropdownMenu), tighter spacing. Reference Studio `ConversationsPanel`.

---

## Notes / process
- Rulebook (how we work) is in `chat-components-checklist.md` → "Rulebook — working agreement": visual parity is the gate; read + quote Studio; no invention; renames are moves.
- The recurring root cause of clipping (tooltip, `+` menu, old model dropdown) = bespoke overlays without portal. Fix = use the portalled primitives (Popover/DropdownMenu/Tooltip via Floating).
