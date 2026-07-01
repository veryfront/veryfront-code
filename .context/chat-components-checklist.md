# Chat components — porting checklist

Living tracker for rebuilding the chat components **1:1 with Veryfront Studio**,
on the private `chat/ui` primitives. Open-source, composable (compound parts, no
prop soup), static/configurable in Storybook.

- **Studio repo:** `/Users/mattboon/conductor/workspaces/veryfront-studio/milan`
- **Storybook:** `deno task storybook` → http://localhost:6006
- **Verify loop:** `deno check` → `deno task storybook:check` → `npm run build-storybook`
- **fmt:** local deno must be **2.7.7** (matches CI). `deno task fmt`.

Legend: ✅ done (Studio 1:1, green) · 🟡 v1 story exists, needs Studio-1:1 upgrade
· 🔴 not built yet · ⬜ story slot

---

## Primitives (Chat/UI)

| # | Primitive | Status | Notes |
|---|---|---|---|
| — | Avatar (was UserAvatar) | ✅ | renamed; generic user/agent/entity avatar |
| — | Status (was StatusBadge) | ✅ | renamed |
| — | FileType (was FileTypeBadge) | ✅ | renamed; +FileTypeThumb, getFileTypeLabel |
| — | Tabs | ✅ | Studio 1:1, motion forked out, static pill. Chat/Uploads toggle |
| — | CodeBlock (was RichCodeBlock) | 🟡 | syntax-highlighted code. **Reused by Markdown (fenced) + ToolCall (params/result JSON)** — build as a shared primitive |

### CodeBlock (shared primitive) — the "ace" Studio one

Our current `RichCodeBlock` is a plain `<pre>` + copy button with **no syntax
highlighting** — that's why it looks bad. Studio's `ChatCodeBlock` is the structural
reference (shiki + copy + lang label + collapsible), but we do **not** copy Studio's
theme.

- **Themes: shiki built-in `github-light` / `github-dark`** (switch on our
  `color-mode`). Do NOT port Studio's `veryfrontDarkTheme`.
- **Port:** shiki highlighter, copy, lang label, collapsible,
  **Mermaid diagrams** (render `mermaid` fences as SVG).
- **Strip (Studio-panel only):** `openTab`/`openPanel`/`openFilePath`/`executeCommand`,
  file previews, radix `useControllableState`.
- **Dependencies — lazy-load from esm.sh, don't bundle (dependency-light pattern):**
  - **Mermaid: already done.** `markdown.tsx` lazy-loads `mermaid@11.4.1` from
    `https://esm.sh/...` via `importFromUrl` (client-side only). CodeBlock reuses
    this — render `mermaid` fences through a ported `MermaidDiagram` (swap Studio's
    `next-themes` → our `color-mode`, keep our `Skeleton`, drop `printReadiness`).
  - **Shiki: same pattern.** Lazy-load shiki from esm.sh on first code block — no
    bundled dep, keeps the package light while giving the "ace" highlight quality.

**Reference only — Vercel AI Elements / `streamdown` (DO NOT add as a dependency).**
`streamdown` solves **safe streaming markdown**: sanitized/hardened, tolerates
unterminated code fences / partial tokens mid-stream. We **fork the technique**, not
the library — reimplement the defensive-streaming + sanitization logic (and any other
goodies) in our own Markdown renderer. Same rule as Studio: fork the logic, no dep.
AI Elements' `Reasoning` / `Tool` / `Sources` / `PromptInput` are also worth reading
for API shape — reference, not import. Docs: https://ai-sdk.dev/elements

## Components (Chat/Components)

Ordered leaf-first (build up the tree). Each row = one Storybook story.
**Target name** = the public export name (renamed from the current v1 name).

| # | Target name | Current v1 name | Screenshot | Studio baseline | Primitives | Status |
|---|---|---|---|---|---|---|
| 1 | **ChatEmptyState** | ChatEmptyState | zC2Xi2 | `ChatIdleView` | Avatar, Button | ✅ |
| 2 | **Attachment** | AttachmentPill | R4QgHv | `AttachmentPill` | Pill, FileTypeThumb, IconButton | 🟡 fixes done, rename pending |
| 3 | **Markdown** | Markdown | CxOUEf | `ChatMessageText` | prose, code blocks, citations | 🟡 |
| 4 | **Sources** | Sources | — | `CitationSources` / `SourceDocuments` | Pill, Tooltip, links | 🟡 |
| 5 | **Reasoning** | ReasoningCard | CxOUEf | `Reasoning` | Collapsible, Shimmer, ChevronRight | 🟡 |
| 6 | **SkillTool** (skill loaded) | SkillBadge | (studio) | `LoadSkillTool` → `ChatTool` | tool-call row (icon + label), Check icon | 🟡 rebuild as tool row, not pill |
| 7 | **ToolCall** | ToolCallCard | ukDtyd | `ChatToolCard`+`ChatTool`+`ChatToolInvocation` | Collapsible, Status, code, table | 🟡 |
| 8 | **Message** | Message | CxOUEf | `Message`+`ChatMessageHeader`+`ChatMessageText`+`ChatTokenUsage` | Avatar, Markdown, Reasoning, IconButton | 🟡 |
| 9 | **AgentCard** | AgentCard | — | agent card | Card, Avatar, Badge | 🟡 |
| 10 | **UploadsPanel** | UploadsPanel | — | `ChatMessageUpload` | ProgressBar, FileType | 🟡 |
| 11 | **ChatSidebar** | ChatSidebar | — | `ChatConversationsPanel` | row+DropdownMenu, Input, ScrollFade | 🟡 |
| 12 | **ModelSelector** | ModelSelector | fHyJXe | `ChatModelPickerDesktop` | Popover + Command, Check, provider logos | 🟡 |
| 13 | **AgentPicker** | — (new) | LTTnmY | `AgentPicker` | Popover/Command, Avatar rows, Manage | 🔴 |
| 14 | **ChatActions** | — (new; retire old story) | sfkasT | `PromptMenuContent` | DropdownMenu (Attach Files/Photos, Attach Figma, Settings submenu) | 🔴 |
| 15 | **ChatInput** | ChatComposer | R4QgHv, TIMrln | `PromptInput`+`PromptForm` | Textarea + all below, dropzone. Just the box (not the message list) | 🟡 rename + upgrade |

**ChatActions** = the composer's `+` menu ("Attach Files or Photos", "Attach Figma
File", Settings). Build fresh — **retire** the old catch-all "Action Components"
story rather than repurposing it.

**Collapsed into ChatComposer** (not standalone — compositions of existing
primitives, demonstrated inside the composer story):
- Action button (AiE9OH) = `IconButton` + `Tooltip` (mic / submit / stop states).
- The old "Action Components" grab-bag (message controls / tabs) — covered by
  Message.Actions and the `Tabs` primitive.

### Message anatomy (row 8) — compound parts, NOT separate sidebar rows

The whole assistant message (CxOUEf) is one `Message` compound. Its story must
demonstrate every part; the parts are composed via children:

| Part | Studio baseline | Notes |
|---|---|---|
| `Message.Root` | `Message` | context: role, feedback, branch state |
| `Message.Header` | `ChatMessageHeader` | Avatar + name + timestamp (right-aligned) |
| reasoning toggle | `Reasoning` (row 5) | "Thought for 1s ›" — reuse the Reasoning component |
| `Message.Content` | `ChatMessageText` | the `Markdown` body (row 3) |
| `Message.Actions` | `MessageActions` | copy / regenerate icon buttons |
| meta / tokens | `ChatTokenUsage` | "79.8k" token count (popover) |

**Dropped from Studio:** `RunLink` / "View run" (Studio panel-system deep-link,
not relevant to open-source chat). Footer = Copy · Regenerate · token count only.

**`ChatTokenUsage` popover (9Gr8Xg) — tighten the styling, not 1:1.** Studio's is
loose: oversized title, big row gaps, weak hierarchy. Improve: smaller title,
tighter rows, clear label/value hierarchy. Rows: Model, Input, Output, Total
(bold). Drop "Credits used" (not relevant to open-source, like View run).

So `Reasoning` and `Markdown` are their own rows AND reused inside `Message`.
Building `Message` depends on rows 3 (Markdown) and 5 (Reasoning) landing first.

### Naming decisions
- **Drop shape/type suffixes:** `UserAvatar`→`Avatar`, `StatusBadge`→`Status`,
  `FileTypeBadge`→`FileType`, `AttachmentPill`→`Attachment`, `ReasoningCard`→`Reasoning`,
  `ToolCallCard`→`ToolCall`, `SkillBadge`→`Skill`.
- **Keep `Chat*` prefix** where the bare word is too generic / would collide:
  `ChatEmptyState`, `ChatSidebar`, and `ChatInput` (was `ChatComposer` — "Composer"
  read as more than the box; `ChatInput` = just the input box).
- **Keep as-is:** `Markdown`, `Sources`, `Message`, `AgentCard`, `ModelSelector`,
  `AgentPicker`, `UploadsPanel`.

---

## Hard rules (from handoff)

1. **Read the Studio source before styling** — never eyeball. (`studio/…/<Name>.tsx` + `.stories.tsx`.)
2. `cn`/`cva` do **not** tailwind-merge → weight/size lives in one place; override base utils with the `!` suffix (`h-9!`, `size-16!`).
3. Deterministic token remap: `bg-primary`→`bg-[var(--primary)]`, `vf-type-base`→`text-base`, `vf-weight-medium`→`font-medium`.
4. **Icons render a half-step smaller** than Studio: `size-4`→`size-3.5`, `size-5`→`size-4.5`.
5. Studio removed grey text hierarchy — secondary text is `text-[var(--foreground)]`, hierarchy = weight+size.
6. Prominent titles use `font-semibold` (Inter reads lighter than Söhne).
7. Overlays must portal via `Floating` (or they clip in the iframe).
8. **No Studio-only deps** (radix / cva / `@/` / motion) — boundary test enforces. Fork the logic.
9. **Composable, no prop soup** — compound parts composed via children, small focused prop surfaces.
10. Every new story needs its **Overview** nav link (`storybook/stories/Overview.stories.tsx`) or `storybook:check` fails.

## Rulebook — working agreement (added 2026-07-01, after a sloppy review round)

These are binding. They exist because a round shipped green-but-wrong: the driver
passed while components were un-ported, invented, doubled, or visually broken.

1. **Visual parity is the definition of done — NOT the driver test.** `deno task
   storybook:check` only proves a component is *exported* and *has a story*. It says
   nothing about whether it matches Studio. Before claiming any component done, OPEN
   its story in Storybook (`deno task storybook` → the `Chat/…/<Name>` page) or
   screenshot it, and diff it against the Studio story side-by-side. Never let the
   green tick stand in for "looks right".
2. **Read the Studio source first, EVERY time, and QUOTE it.** In the report, cite the
   exact Studio file + the classes/structure you matched (e.g. "`ChatFormInput` =
   `rounded-2xl bg-white …`"). "I forked the logic" is not evidence and is not
   accepted. (Reinforces Hard rule 1.)
3. **No invention.** Match Studio's prop surface and states exactly. Do NOT add props,
   descriptions, labels, sections, or example stories that Studio does not have. A
   minimal story = the default + only the states Studio itself demonstrates. If you
   think something is missing from Studio, ASK — don't add it.
4. **Renames are MOVES, not additions — one entry per component in the sidebar.** When
   you add the target-named story, retire the v1 story (and its Overview link) in the
   same pass. Keep only the export-*name* alias, and only if a Composition story still
   imports it. Never leave `Foo` AND `FooCard` both visible in the sidebar.
5. **Build fidelity-critical components yourself; delegate only mechanical work.** Any
   delegated agent gets rules 2–3 verbatim in its brief (quote-Studio, no invention,
   minimal story) AND is told the human will eyeball the result.
6. **One review pass per component** against these rules before reporting back.
7. **Scope transparency.** State exactly which checklist rows you touched and which you
   did NOT, so "did X change?" is never a surprise. Renamed-but-not-upgraded ≠ done for
   any row marked "rename + upgrade".

## Outstanding fidelity fixes (from the 2026-07-01 review — all must pass rule 1)

> **⚠️ This section is now superseded by the live trackers — use those, not this:**
> - **`.context/chat-review.md`** — the current review tracker (every outstanding
>   item + status, kept up to date).
> - **`.context/chat-integration-plan.md`** — the plan to integrate the components
>   into a batteries-included `<Chat>` (the 12 requirements).
> The list below is the earlier snapshot, kept for history.

> **Status (addressed in the follow-up round, pending Matt's visual confirmation):**
> P0 duplicates retired · P1 ChatInput rebuilt to Studio `PromptForm` two-row
> layout (editor top; footer `+`·agent·model·mic) · ChatActions `+` = `icon-tertiary`
> bg, no tooltip · AgentPicker descriptions + With-Manage/Sections/Manage examples
> removed · Reasoning chevron flipped · Sources card → standard popover surface
> (`rounded-lg bg-popover shadow-sm`, no bespoke border) · CodeBlock now shows plain
> code immediately (shiki = progressive enhancement) · Message thumbs removed from the
> docs anatomy. Full-render eyeball still owed (no headless browser locally).

- **P0 — kill duplicates.** Retire v1 Component stories (AttachmentPill, ReasoningCard,
  ToolCallCard, ChatComposer, Action Components) + their Overview links; repoint the two
  hardcoded guardrail paths in `scripts/storybook/storybook-workbench.test.ts`
  (`ToolCallCard.stories.tsx`→`ToolCall`, `ChatComposer.stories.tsx`→`ChatInput`). Keep
  export-name aliases (Composition stories use them).
- **P1 — ChatInput MUST reflect Studio `PromptInput`/`PromptForm`/`ChatFormInput`.** A
  rename alone is NOT the upgrade. Target (Studio screenshot): white rounded card,
  "Type a prompt or a question…" placeholder, bottom bar = `+` (circular bg) · Agent
  pill (avatar + name + chevron) · then model logo + mic/submit on the right. Composes
  ChatActions + AgentPicker, so those must be correct first.
- **P2 — composed pieces:**
  - **ChatActions**: `+` trigger has NO tooltip and DOES have the circular button
    background (match Studio's `+`).
  - **AgentPicker**: remove the invented per-row descriptions; delete the "With Manage",
    "Sections / Connected Agents", and "Manage Agents" example stories; strip to Studio's
    real shape (avatar + name + check).
  - **Reasoning**: chevron collapsed → points RIGHT, expanded → points DOWN (currently
    backwards — `ChevronDownIcon` with `isOpen && "rotate-90"` points left when open).
  - **Sources**: the hover card must use the standard Popover primitive (so it gets the
    border), not a bespoke borderless card.
  - **CodeBlock**: "no code block" — shiki lazy-load renders nothing; make it actually
    highlight AND fall back to plain code, verified in the built Storybook (compiling ≠
    rendering).
- **P3 — Message (separate 🟡 row, was out of the red scope):** remove thumbs up/down
  from `Message.Actions`. Full Message Studio-parity is its own row.

## For the sub-agent pass (start here after a context clear)

**Driver test (the source of truth for "done"):**
```
deno task storybook:check
```
3 red steps encode the target: (1) Chat/Components sidebar stories, (2) `veryfront/chat`
public exports, (3) the Chat/UI `CodeBlock` primitive. Each red item = one task.

**Red tasks (7 + CodeBlock):** Attachment · Reasoning · ToolCall · ChatInput
(renames) · SkillTool (pill→tool-row) · AgentPicker · ChatActions (new builds) ·
CodeBlock (Chat/UI primitive, shiki github-light/dark + mermaid, lazy esm.sh).

**Per-task definition of done:**
1. Component built/renamed to Studio 1:1 (read the Studio source first).
2. Story at `storybook/stories/chat/<Name>.stories.tsx`, title `Chat/Components/<Name>`
   (CodeBlock → `storybook/stories/ui/CodeBlock.stories.tsx`, `Chat/UI/CodeBlock`).
3. Exported under the target name from `veryfront/chat` (`src/chat/index.ts`).
4. Overview nav link added (`storybook/stories/Overview.stories.tsx`).
5. `deno task storybook:check` step goes green; `deno fmt` clean (**deno 2.7.7**).

**Rename mechanics (Attachment/Reasoning/ToolCall/ChatInput):**
`git mv` source + story files → `replace_all` the identifier (e.g. `AttachmentPill`→
`Attachment`, which also fixes `…Props`) → update the export chain:
`chat/components|composition/*` → `chat/index.tsx` → `chat.tsx` → `index.ts` →
`src/chat/index.ts` (+ `src/react/public.ts` + `src/chat/index.test.ts` for public
names) → Overview link → the driver test's `target`/`targetExports` rows →
`deno run -A scripts/build/generate-dev-ui-manifest.ts` (regen safelist).

**⚠️ Collision warning — do NOT run these fully in parallel.** Every task edits the
same shared files (the export barrels, `Overview.stories.tsx`, the driver test,
the generated safelist). Have each agent do only its **own component files + its
story** in isolation; do the shared-barrel/Overview/test wiring **centrally/serially**
after, or agents will clobber each other.

**Invariants:** read Studio source first · deterministic token remap · `!` suffix to
override base utils (`cn` doesn't tw-merge) · icons a half-step smaller · no Studio
deps (radix/cva/@//motion) — fork the logic · lazy-load shiki/mermaid from esm.sh,
don't bundle · fork streamdown's defensive-streaming ideas, don't import it.

## Done this session
- Tabs, ChatEmptyState built (Studio 1:1). Avatar/Status/FileType renamed. Committed + pushed on `ui-storybook-workbench-v1`.
