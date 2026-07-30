/**
 * `veryfront/chat` COVERAGE MANIFEST — the deterministic "to spec" gate.
 *
 * RED until the chat surface is complete. Each component must be exported, have a
 * Storybook story (`storybook/stories/chat/<Name>.stories.tsx`), and be documented
 * (named in `docs/guides/chat-ui.md`). Each hook must be exported and documented
 * (named in `docs/guides/chat-hooks.md` or `chat-ui.md`).
 *
 * Composability / one-node / ref / asChild are enforced per-compound in
 * `chat/composability.contract.test.tsx` and each component's `*.test.tsx`; this
 * file is the cross-cutting inventory gate. Update the lists as the surface grows.
 */
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as chat from "veryfront/chat";

const STORIES_DIR = new URL("../../../../storybook/stories/chat/", import.meta.url).pathname;
const CHAT_UI_DOC = new URL("../../../../docs/guides/chat-ui.md", import.meta.url).pathname;
const CHAT_HOOKS_DOC = new URL("../../../../docs/guides/chat-hooks.md", import.meta.url).pathname;

/** The 25 spec components (RFC #2980). */
const CHAT_COMPONENTS = [
  "Chat",
  "ChatRoot",
  "ChatInput",
  "ChatMessageList",
  "ChatEmptyState",
  "ChatSidebar",
  "ChatActions",
  "ChatAgentPicker",
  "ChatThemeScope",
  "ChatErrorBoundary",
  "Message",
  "ToolCall",
  "Reasoning",
  "Sources",
  "StepIndicator",
  "InlineCitation",
  "BranchPicker",
  "MessageActionBar",
  "AttachmentPill",
  "AttachmentsPanel",
  "AgentCard",
  "AgentPicker",
  "ModelSelector",
  "Markdown",
  "AppShell",
];

/** The spec hooks (RFC #2980). */
const CHAT_HOOKS = [
  "useChat",
  "useChatInput",
  "useChatInputContext",
  "useChatScroll",
  "useMessageBranches",
  "useConversations",
  "useConversation",
  "useConversationChat",
  "useAttachments",
  "useUpload",
  "useVoiceInput",
  "useCompletion",
  "useStreaming",
  "useToolCall",
  "useReasoning",
  "useSources",
  "useStepIndicator",
  "useModelSelector",
  "useAgentPicker",
  "useAgentCard",
  "useChatActions",
  "useMessageContext",
  "useMessageParts",
  "useChatContext",
  "useClipboard",
  "useAgents",
  "useAgent",
  "useAgentMetadata",
  "useChatSidebarItem",
  "useAttachmentPill",
  "useAttachmentsPanel",
];

let storyFiles: string[] = [];
try {
  storyFiles = [...Deno.readDirSync(STORIES_DIR)].map((e) => e.name);
} catch { /* dir missing → all story checks fail */ }
const uiDoc = safeRead(CHAT_UI_DOC);
const hooksDoc = safeRead(CHAT_HOOKS_DOC);
function safeRead(p: string): string {
  try {
    return Deno.readTextFileSync(p);
  } catch {
    return "";
  }
}

describe("veryfront/chat coverage — components", () => {
  for (const name of CHAT_COMPONENTS) {
    it(`${name}: exported from veryfront/chat`, () => {
      assert(
        name in chat && (chat as Record<string, unknown>)[name] != null,
        `${name} is not exported from veryfront/chat`,
      );
    });
    it(`${name}: has a Storybook story`, () => {
      assert(
        storyFiles.includes(`${name}.stories.tsx`),
        `missing storybook/stories/chat/${name}.stories.tsx`,
      );
    });
    it(`${name}: is documented`, () => {
      assert(uiDoc.includes(name), `${name} is not documented in docs/guides/chat-ui.md`);
    });
  }
});

describe("veryfront/chat coverage — hooks", () => {
  for (const name of CHAT_HOOKS) {
    it(`${name}: exported from veryfront/chat`, () => {
      assert(
        name in chat && typeof (chat as Record<string, unknown>)[name] === "function",
        `${name} is not exported from veryfront/chat`,
      );
    });
    it(`${name}: is documented`, () => {
      assert(
        hooksDoc.includes(name) || uiDoc.includes(name),
        `${name} is not documented in docs/guides/chat-hooks.md or chat-ui.md`,
      );
    });
  }
});
