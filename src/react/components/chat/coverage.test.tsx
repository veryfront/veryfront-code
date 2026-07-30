/**
 * `veryfront/chat` COVERAGE MANIFEST — the deterministic "to spec" gate.
 *
 * RED until the chat surface is complete. Mirrors the ui gate's docs-in-component
 * model: each component must be exported, have a Storybook story with a `DocsPage`
 * (its docs live there, NOT the root guide), have every `*Props` field documented
 * with JSDoc, and have a test. Each hook must be exported, carry a JSDoc doc-comment
 * on its declaration (its docs live on the hook), and have a behaviour test. Every
 * cva variant is demonstrated in a story + a test; a guardrail keeps the root guides
 * from becoming per-variant catalogs.
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

/**
 * The canonical standalone chat components (RFC #2980's v1 scope + the Storybook
 * "final, renamed component set"). Each earns its own story + DocsPage.
 *
 * NOT listed here — per RFC #2980's own "scope cuts & relocations" these are
 * sub-parts / relocations, still exported + tested but documented where they live,
 * not as separate stories (so the manifest matches the Storybook target sidebar):
 *   - `ChatRoot`, `ChatMessageList` — parts of the `Chat` compound (documented in Chat)
 *   - `MessageActionBar` — thin alias of `Message.Actions` (canonical home: Message)
 *   - `BranchPicker`, `InlineCitation` — parts of `Message` / `Sources`
 *   - `ChatErrorBoundary` — RFC: "no chat-specific logic → move to veryfront/ui"
 *   - `ChatAgentPicker` — RFC: veryfront-adapter piece (backend-coupled)
 *   - `ChatThemeScope` — a theming wrapper (documented under theming)
 *   - `AppShell` — the `veryfront/ui` primitive, re-exported (covered by the ui suite)
 */
const CHAT_COMPONENTS = [
  "Chat",
  "ChatInput",
  "ChatEmptyState",
  "ChatSidebar",
  "ChatActions",
  "Message",
  "ToolCall",
  "Reasoning",
  "Sources",
  "StepIndicator",
  "AttachmentPill",
  "AttachmentsPanel",
  "AgentCard",
  "AgentPicker",
  "ModelSelector",
  "Markdown",
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
// Some public `veryfront/chat` hooks (useChat, useAgent(s), useCompletion,
// useStreaming, useVoiceInput, …) are re-exported from the agent module, so their
// declarations live outside the chat tree. Scan that source too for the hook-doc
// check (NOT for the chat variant gate, which stays scoped to CHAT_SRC).
let AGENT_HOOK_SRC = "";
try {
  AGENT_HOOK_SRC = collectSource(
    new URL("../../../agent/react/", import.meta.url).pathname,
    /\.tsx?$/,
    /\.test\.tsx?$/,
  );
} catch { /* agent react source missing → those hooks stay red */ }
let CHAT_STORY_SRC = "";
try {
  CHAT_STORY_SRC = collectSource(STORIES_DIR, /\.stories\.tsx$/, /(?!)/);
} catch { /* no chat stories dir */ }

/**
 * Fields of the named `<Name>Props` interface missing JSDoc, or `null` if that
 * interface isn't declared anywhere in `src` (props typed inline → not gated).
 * `ref`/`className` are exempt (universal boilerplate). Mirrors the ui gate.
 */
function propsMissingJsdoc(src: string, interfaceName: string): string[] | null {
  const m = new RegExp(`(?:export\\s+)?interface\\s+${interfaceName}\\b[^{]*\\{`).exec(src);
  if (!m) return null;
  const lines = src.slice(m.index + m[0].length).split("\n");
  const offenders: string[] = [];
  let depth = 1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (
      depth === 1 &&
      /^(?:readonly\s+)?["']?[A-Za-z_$][\w$-]*["']?\s*\??\s*:/.test(trimmed) &&
      !trimmed.startsWith("//") && !trimmed.startsWith("*")
    ) {
      const field = trimmed.match(/^(?:readonly\s+)?["']?([A-Za-z_$][\w$-]*)["']?/)?.[1] ?? "";
      if (field && field !== "ref" && field !== "className") {
        const prev = (lines[i - 1] ?? "").trim();
        if (!(prev.endsWith("*/") || prev.startsWith("/**"))) offenders.push(field);
      }
    }
    depth += (raw.match(/\{/g)?.length ?? 0) - (raw.match(/\}/g)?.length ?? 0);
    if (depth <= 0) break;
  }
  return offenders;
}

/** Does `src` declare `name` (fn or const) with a JSDoc comment immediately above? */
function hasJsdocDecl(src: string, name: string): boolean {
  const lines = src.split("\n");
  const decl = new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?(?:function|const)\\s+${name}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (decl.test(lines[i] ?? "")) {
      const prev = (lines[i - 1] ?? "").trim();
      if (prev.endsWith("*/") || prev.startsWith("/**")) return true;
    }
  }
  return false;
}

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
  it(`covers all ${variants.length} chat cva variants in story · test`, () => {
    const misses: string[] = [];
    for (const { group, value } of variants) {
      const re2 = new RegExp(`\\b${value}\\b`);
      const where: string[] = [];
      // Docs live in the component's story (not the root guide), so a variant is
      // documented by being demonstrated there; also require a test reference.
      if (!re2.test(CHAT_STORY_SRC)) where.push("story");
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
    it(`${name}: is documented in its story (colocated DocsPage)`, () => {
      let story = "";
      try {
        story = Deno.readTextFileSync(`${STORIES_DIR}${name}.stories.tsx`);
      } catch { /* no story → fails below, the point */ }
      assert(
        /DocsHero|DocsPropsTable|DocsPage/.test(story),
        `${name} has no colocated docs — its Storybook story must carry a DocsPage ` +
          `(DocsHero + DocsPropsTable). Component docs live in the story, not the root guide.`,
      );
    });
    it(`${name}: props documented with JSDoc`, () => {
      const missing = propsMissingJsdoc(CHAT_SRC, `${name}Props`);
      assert(
        missing === null || missing.length === 0,
        `${name}Props has undocumented props: ${(missing ?? []).join(", ")} — ` +
          `every public prop needs a /** … */ (feeds DocsPropsTable + IDE hovers)`,
      );
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
    it(`${name}: is documented (JSDoc in source)`, () => {
      assert(
        hasJsdocDecl(CHAT_SRC, name) || hasJsdocDecl(AGENT_HOOK_SRC, name),
        `${name} has no JSDoc doc-comment above its declaration — hook docs live on the ` +
          `hook (a /** … */ with an @example), not the root guide`,
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

// GUARDRAIL — the root guides stay thin. Component/hook + variant docs live in the
// component's story (DocsPage) and source JSDoc; the guides must not become a
// per-variant catalog. Fails if a guide lists an internal (hyphenated) cva token.
describe("veryfront/chat: the root guides stay thin (docs live in components)", () => {
  it("name no internal cva variant tokens — variant docs belong in the story", () => {
    const guides = uiDoc + "\n" + hooksDoc;
    const tokens = new Set<string>();
    for (const { value } of extractAllVariants(CHAT_SRC)) {
      if (value.includes("-")) tokens.add(value);
    }
    const offenders = [...tokens].filter((t) => new RegExp(`\\b${t}\\b`).test(guides));
    assert(
      offenders.length === 0,
      `docs/guides/chat-*.md list cva variant tokens (${offenders.join(", ")}). ` +
        `Variant docs belong in each component's Storybook story, not the root guides.`,
    );
  });
});
