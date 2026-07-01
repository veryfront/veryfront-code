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

- **Markdown code blocks BROKEN** (1uaxQz) — fenced code renders as `[object Object], run = ,…`. Cause: `markdown.tsx:269` does `String(codeChildren)` but rehype-highlight has already wrapped the code in span element nodes, so it stringifies to `[object Object]`. Fix: extract text recursively (flatten children to text) + drop the now-redundant `rehypeHighlight` (CodeBlock does its own shiki). **High priority.**
- **Markdown prose styling → Studio parity** — the text formatting must match Studio: **lists** (ul/ol markers, spacing), **inline code**, **hr**, **headings** (sizes/weights), blockquote, links, paragraph spacing. Audit `MARKDOWN_CONTAINER_CLASS` (the big `prose-*` string) against Studio's `ChatMessageText`/markdown styles and align.
- **RichCodeBlock** — mark **deprecated** (Markdown now uses the extracted `CodeBlock`); add `@deprecated` JSDoc, keep the export for back-compat, retire later.
- **ChatActions Settings submenu** (uCs0o7) — can't move the mouse into the submenu; the parent dropdown closes before you reach it (missing hover-bridge / safe-triangle + the submenu isn't kept open on pointer transit). Fix the submenu hover handling in `chat-actions.tsx` / `dropdown-menu.tsx`.
- **CodeBlock** — copy button should be icon-only (drop the "Copy" text); add a file-type icon next to the language label (see Studio's ChatCodeBlock).
- **Buttons everywhere use primitives** — audit the chat components/stories and replace raw `<button>` with the `Button` / `IconButton` primitives (consistent sizing, focus, hover, icon scale). E.g. Reasoning toggle, Sources pills, composer `+`/export, CodeBlock copy, ModelSelector icon trigger, attachment remove.
- **Tooltip** — clipped in the iframe; the primitive has no portal / collision handling. Needs to portal via `Floating` + flip on collision (fixes every tooltip).
- **ChatInput `+` attach menu** — the bespoke "Upload document / Select document" menu clips (cut off), items look small, and has no icons. Should use a portalled menu (ChatActions / DropdownMenu primitive) with icons.
- **Attachment States story** — component supports the states; the "States" story section isn't wired (you were unsure — confirm keep all / some / none).

## 🔧 Pending — bigger per-component rebuilds (Studio parity)

- **AgentCard** — currently a bespoke card (Thinking / Tool Calls / Messages boxes). Rebuild so it's a **`Card`** wrapper with **`Message` components inside**, composing the real parts (use the **primitives** throughout — no raw `<button>`/`<div>` where a primitive exists):
  - **`Card`** container (Card primitive) holding the message anatomy.
  - **Header row**: agent **Avatar** + **name** on the left, **`<Status>`** on the right, e.g. `[avatar]  Whatever Agent            ● Running`.
  - agent **Avatar + name** (copied from Studio).
  - thinking block → **Reasoning** component.
  - tool calls → **ToolCall** card.
  - message text → **Markdown**.
  - Mirror Studio's agent/message anatomy; it should read like a `Message` inside a card.
- **Message** (chat-components-message) — looks unchanged; needs the Studio-parity pass: header (Avatar + name + timestamp), Status top-right, Reasoning toggle, Markdown content, actions (copy / regenerate), token usage. (Was a 🟡 row, out of the original red scope.)
- **ChatSidebar** — "looks totally broken"; make it resemble Studio's chat sidebar (M2PPf6): **slimmer list items**, a per-row **context menu** (rename/delete via DropdownMenu), tighter spacing. Reference Studio `ConversationsPanel`.

---

## Notes / process
- Rulebook (how we work) is in `chat-components-checklist.md` → "Rulebook — working agreement": visual parity is the gate; read + quote Studio; no invention; renames are moves.
- The recurring root cause of clipping (tooltip, `+` menu, old model dropdown) = bespoke overlays without portal. Fix = use the portalled primitives (Popover/DropdownMenu/Tooltip via Floating).
