/**
 * `veryfront/chat` COVERAGE MANIFEST — the deterministic "to spec" gate.
 *
 * RED until the chat surface is complete. Mirrors the ui gate's docs-in-component
 * model: each component must be exported, have a Storybook story with a `DocsPage`
 * (its docs live there, NOT the root guide), have every `*Props` field documented
 * with JSDoc, and be assigned to a test suite. Each hook must be exported, carry a
 * JSDoc doc-comment on its declaration (its docs live on the hook), and be assigned
 * to a test suite. This manifest checks inventory only; the referenced suites own
 * behavioral assertions. Every cva variant must appear as a literal selection in a
 * story and test source; a guardrail keeps the root guides from becoming per-variant
 * catalogs.
 *
 * Composability / one-node / ref / asChild are enforced per-compound in
 * `chat/composability.contract.test.tsx` and each component's `*.test.tsx`; this
 * file is the cross-cutting inventory gate. Update the lists as the surface grows.
 */
import { assert } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { fromFileUrl, join } from "#veryfront/compat/path";
import * as chat from "veryfront/chat";

const STORIES_DIR = fromFileUrl(new URL("../../../../storybook/stories/chat/", import.meta.url));
const CHAT_UI_DOC = fromFileUrl(new URL("../../../../docs/guides/chat-ui.md", import.meta.url));
const CHAT_HOOKS_DOC = fromFileUrl(
  new URL("../../../../docs/guides/chat-hooks.md", import.meta.url),
);

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

/** Flat exports for every ChatInput compound leaf, paired with its namespace alias. */
const CHAT_INPUT_PARTS = {
  ChatInputRoot: "Root",
  ChatInputField: "Field",
  ChatInputSend: "Send",
  ChatInputStop: "Stop",
  ChatInputSubmit: "Submit",
  ChatInputVoice: "Voice",
  ChatInputModel: "Model",
  ChatInputAttach: "Attach",
  ChatInputExport: "Export",
  ChatInputToolbar: "Toolbar",
} as const;

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
function collectTestSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) {
      out.push(...collectTestSources(p));
    } else if (
      e.isFile && (e.name.endsWith(".test.ts") || e.name.endsWith(".test.tsx")) &&
      e.name !== "coverage.test.tsx"
    ) {
      try {
        out.push(Deno.readTextFileSync(p));
      } catch { /* unreadable → skip */ }
    }
  }
  return out;
}
const CHAT_TEST_SOURCES = collectTestSources(fromFileUrl(new URL(".", import.meta.url)));
const CHAT_TEST_SRC = CHAT_TEST_SOURCES.join("\n");

// All non-test source under the chat tree (for cva-variant discovery), and all
// chat Storybook story source (for the "demonstrated in a story" check).
function collectSources(dir: string, suffix: RegExp, exclude: RegExp): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) {
      out.push(...collectSources(p, suffix, exclude));
    } else if (e.isFile && suffix.test(e.name) && !exclude.test(e.name)) {
      try {
        out.push(Deno.readTextFileSync(p));
      } catch { /* skip */ }
    }
  }
  return out;
}
const CHAT_SRC = collectSources(
  fromFileUrl(new URL(".", import.meta.url)),
  /\.tsx?$/,
  /\.test\.tsx?$/,
).join("\n");
// Some public `veryfront/chat` hooks (useChat, useAgent(s), useCompletion,
// useStreaming, useVoiceInput, …) are re-exported from the agent module, so their
// declarations live outside the chat tree. Scan that source too for the hook-doc
// check (NOT for the chat variant gate, which stays scoped to CHAT_SRC).
let AGENT_HOOK_SRC = "";
try {
  AGENT_HOOK_SRC = collectSources(
    fromFileUrl(new URL("../../../agent/react/", import.meta.url)),
    /\.tsx?$/,
    /\.test\.tsx?$/,
  ).join("\n");
} catch { /* agent react source missing → those hooks stay red */ }
let CHAT_STORY_SOURCES: string[] = [];
try {
  CHAT_STORY_SOURCES = collectSources(STORIES_DIR, /\.stories\.tsx$/, /(?!)/);
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

type VariantSelectionToken =
  | { type: "identifier" | "string"; value: string }
  | { type: "colon" | "other" };

/**
 * Collect literal object-property selections such as `{ size: "default" }`.
 * Strings and comments are tokenized rather than regex-matched so prose like
 * `type: 'size: "default"'` cannot accidentally satisfy the coverage gate.
 */
function extractLiteralVariantSelections(source: string): Set<string> {
  const tokens: VariantSelectionToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (char === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index++;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        index++;
      }
      index = Math.min(index + 2, source.length);
      continue;
    }
    if (char === ":") {
      tokens.push({ type: "colon" });
      index++;
      continue;
    }
    if (char === "`") {
      index++;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index++;
          break;
        }
        index++;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = "";
      index++;
      while (index < source.length) {
        const stringChar = source[index] ?? "";
        if (stringChar === "\\") {
          const escaped = source[index + 1];
          if (escaped !== undefined) value += escaped;
          index += 2;
          continue;
        }
        if (stringChar === quote) {
          index++;
          break;
        }
        value += stringChar;
        index++;
      }
      tokens.push({ type: "string", value });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index++;
      while (index < source.length && /[\w$]/.test(source[index] ?? "")) index++;
      tokens.push({ type: "identifier", value: source.slice(start, index) });
      continue;
    }
    if (!/\s/.test(char)) tokens.push({ type: "other" });
    index++;
  }

  const selections = new Set<string>();
  for (let tokenIndex = 0; tokenIndex <= tokens.length - 3; tokenIndex++) {
    const group = tokens[tokenIndex];
    const colon = tokens[tokenIndex + 1];
    const value = tokens[tokenIndex + 2];
    if (
      (group?.type === "identifier" || group?.type === "string") &&
      colon?.type === "colon" && value?.type === "string"
    ) {
      selections.add(`${group.value}=${value.value}`);
    }
  }
  return selections;
}

function collectLiteralVariantSelections(sources: readonly string[]): Set<string> {
  const selections = new Set<string>();
  for (const source of sources) {
    for (const selection of extractLiteralVariantSelections(source)) selections.add(selection);
  }
  return selections;
}

describe("veryfront/chat variant coverage matching", () => {
  it("matches literal values within their variant group", () => {
    const selections = extractLiteralVariantSelections(`
      const props = { variant: "default", 'size': 'sm' };
      const docs = { type: 'size: "default"' };
      const template = \`role: "assistant"\`;
      // size: "icon-sm"
      /* role: "assistant" */
      interface Props { size?: "icon-lg" }
    `);
    assert(selections.has("variant=default"));
    assert(selections.has("size=sm"));
    assert(!selections.has("size=default"));
    assert(!selections.has("size=icon-sm"));
    assert(!selections.has("size=icon-lg"));
    assert(!selections.has("role=assistant"));
  });
});

// Every cva variant across the chat surface must be represented by a literal
// selection in a story and a test source. This is an inventory check, not proof
// that an assertion exercises the variant. Compounds span files, so the gate is
// module-level (dedup by group=value) rather than per-component.
describe("veryfront/chat: cva variant inventory", () => {
  const seen = new Set<string>();
  const variants = extractAllVariants(CHAT_SRC).filter((v) => {
    const k = `${v.group}=${v.value}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const storySelections = collectLiteralVariantSelections(CHAT_STORY_SOURCES);
  const testSelections = collectLiteralVariantSelections(CHAT_TEST_SOURCES);
  it(`represents all ${variants.length} chat cva variants in story and test source`, () => {
    const misses: string[] = [];
    for (const { group, value } of variants) {
      const where: string[] = [];
      // Docs live in the component's story (not the root guide), so a variant is
      // documented by being demonstrated there; also require a test reference.
      const selection = `${group}=${value}`;
      if (!storySelections.has(selection)) where.push("story");
      if (!testSelections.has(selection)) where.push("test");
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
        story = Deno.readTextFileSync(join(STORIES_DIR, `${name}.stories.tsx`));
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
    it(`${name}: is assigned to a test suite`, () => {
      assert(
        new RegExp(`\\b${name}\\b`).test(CHAT_TEST_SRC),
        `${name} is not referenced by any chat *.test.tsx — needs its own component ` +
          `test (or assignment in a shared contract/characterization suite)`,
      );
    });
  }
});

describe("veryfront/chat coverage — ChatInput flat compound exports", () => {
  for (const [flatName, partName] of Object.entries(CHAT_INPUT_PARTS)) {
    it(`${flatName}: exported and identical to ChatInput.${partName}`, () => {
      const flatPart = (chat as Record<string, unknown>)[flatName];
      const namespacePart = (chat.ChatInput as unknown as Record<string, unknown>)[partName];
      assert(flatPart != null, `${flatName} is not exported from veryfront/chat`);
      assert(flatPart === namespacePart, `${flatName} must be the ChatInput.${partName} function`);
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
    it(`${name}: is assigned to a test suite`, () => {
      assert(
        new RegExp(`\\b${name}\\b`).test(CHAT_TEST_SRC),
        `${name} is not referenced by any chat *.test.tsx — assign it to a behavior suite`,
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
