/**
 * `veryfront/chat` COVERAGE MANIFEST — the deterministic "to spec" gate.
 *
 * RED until the chat surface is complete. Each component must be exported, have a
 * Storybook story (`storybook/stories/chat/<Name>.stories.tsx`), be documented
 * (named in `docs/guides/chat-ui.md`), and have a test (name referenced by some
 * `*.test.tsx` under `chat/`). Each hook must be exported, documented (named in
 * `docs/guides/chat-hooks.md` or `chat-ui.md`), and have a behaviour test.
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

// All `*.test.tsx` source under the chat tree EXCEPT this manifest (which lists
// every component/hook name as a string literal — including it would make the
// "has a test" check pass trivially). A piece "has a test" when its name is
// referenced by some OTHER test file (its own `*.test.tsx` or a shared
// contract/characterization suite).
function collectTestSources(dir: string): string {
  let out = "";
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory) {
      out += collectTestSources(`${p}/`);
    } else if (e.isFile && e.name.endsWith(".test.tsx") && e.name !== "coverage.test.tsx") {
      try {
        out += "\n" + Deno.readTextFileSync(p);
      } catch { /* unreadable → skip */ }
    }
  }
  return out;
}
const CHAT_TEST_SRC = collectTestSources(new URL(".", import.meta.url).pathname);

// All non-test source under the chat tree (for cva-variant discovery), and all
// chat Storybook story source (for the "demonstrated in a story" check).
function collectSource(dir: string, suffix: RegExp, exclude: RegExp): string {
  let out = "";
  for (const e of Deno.readDirSync(dir)) {
    const p = `${dir}${e.name}`;
    if (e.isDirectory) {
      out += collectSource(`${p}/`, suffix, exclude);
    } else if (e.isFile && suffix.test(e.name) && !exclude.test(e.name)) {
      try {
        out += "\n" + Deno.readTextFileSync(p);
      } catch { /* skip */ }
    }
  }
  return out;
}
const CHAT_SRC = collectSource(new URL(".", import.meta.url).pathname, /\.tsx?$/, /\.test\.tsx?$/);
let CHAT_STORY_SRC = "";
try {
  CHAT_STORY_SRC = collectSource(STORIES_DIR, /\.stories\.tsx$/, /(?!)/);
} catch { /* no chat stories dir */ }

/** Pull `{group,value}` pairs from every `cva({ variants: {...} })` block in `src`. */
function extractAllVariants(src: string): Array<{ group: string; value: string }> {
  const out: Array<{ group: string; value: string }> = [];
  const re = /(?<![A-Za-z])variants\s*:\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const lines = src.slice(m.index + m[0].length).split("\n");
    let depth = 1, group: string | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      const stripped = line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
      if (depth === 1) {
        const g = /^([A-Za-z_][\w-]*)\s*:\s*\{/.exec(stripped);
        if (g && g[1]) group = g[1];
      } else if (depth === 2 && group) {
        const v = /^(?:"([\w-]+)"|'([\w-]+)'|([A-Za-z_][\w-]*))\s*:/.exec(line);
        const value = v && (v[1] ?? v[2] ?? v[3]);
        if (value) out.push({ group, value });
      }
      depth += (stripped.match(/\{/g)?.length ?? 0) - (stripped.match(/\}/g)?.length ?? 0);
      if (depth <= 0) break;
    }
  }
  return out;
}

// Every cva variant across the chat surface must be exercised in a story, in the
// docs, AND in a test — "covered somehow". Compounds span files, so this is a
// module-level gate (dedup by group=value) rather than per-component. RED until
// each variant is demonstrated everywhere.
describe("veryfront/chat: every cva variant is covered (story · docs · test)", () => {
  const seen = new Set<string>();
  const variants = extractAllVariants(CHAT_SRC).filter((v) => {
    const k = `${v.group}=${v.value}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  it(`covers all ${variants.length} chat cva variants in story · docs · test`, () => {
    const docs = uiDoc + "\n" + hooksDoc;
    const misses: string[] = [];
    for (const { group, value } of variants) {
      const re2 = new RegExp(`\\b${value}\\b`);
      const where: string[] = [];
      if (!re2.test(CHAT_STORY_SRC)) where.push("story");
      if (!re2.test(docs)) where.push("docs");
      if (!re2.test(CHAT_TEST_SRC)) where.push("test");
      if (where.length) misses.push(`${group}="${value}" (missing: ${where.join(", ")})`);
    }
    assert(misses.length === 0, `chat variants not fully covered:\n  ${misses.join("\n  ")}`);
  });
});

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
    it(`${name}: has a test`, () => {
      assert(
        new RegExp(`\\b${name}\\b`).test(CHAT_TEST_SRC),
        `${name} is not referenced by any chat *.test.tsx — needs its own component ` +
          `test (or coverage in a shared contract/characterization suite)`,
      );
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
    it(`${name}: has a test`, () => {
      assert(
        new RegExp(`\\b${name}\\b`).test(CHAT_TEST_SRC),
        `${name} is not referenced by any chat *.test.tsx — needs a behaviour test`,
      );
    });
  }
});
