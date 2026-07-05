import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import { BROWSER_SAFE_EXPORTS } from "../build/browser-safe-exports.mjs";

type DenoConfig = {
  exclude?: string[];
  exports: Record<string, string>;
  imports: Record<string, string>;
  tasks?: Record<string, string>;
};

type PackageJson = {
  private?: boolean;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await Deno.readTextFile(path)) as T;
}

async function readText(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

/** Slugify a story `title` to the id prefix Storybook derives from it. */
function toStorybookId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Recursively yield every `*.stories.tsx` file under `dir`. */
async function* storyFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* storyFiles(full);
    else if (entry.name.endsWith(".stories.tsx")) yield full;
  }
}

describe("Storybook UI workbench", () => {
  it("Overview links every UI/Component/Composition story exactly once, in the right section", async () => {
    const overview = await readText("storybook/stories/Overview.stories.tsx");

    // All nav ids in order, plus a duplicate check (one link per story).
    const navIds = [...overview.matchAll(/id:\s*"([a-z0-9-]+--docs)"/g)].map(
      (m) => m[1],
    );
    assert(navIds.length > 0, "expected NavGrid ids in the Overview");
    const dupes = [...new Set(navIds.filter((id, i) => navIds.indexOf(id) !== i))];
    assertEquals(dupes, [], `duplicate Overview links: ${dupes.join(", ")}`);

    // Every linkable docs page: an autodocs story titled under one of the three
    // linked sections. (`Chat/Overview` and any non-autodocs story are excluded.)
    const expected = new Set<string>();
    for await (const path of storyFiles("storybook/stories")) {
      const src = await readText(path);
      const title = src.match(
        /title:\s*"(Chat\/(?:UI|Components|Composition)\/[^"]+)"/,
      )?.[1];
      if (title && /tags:\s*\[[^\]]*"autodocs"/.test(src)) {
        expected.add(`${toStorybookId(title)}--docs`);
      }
    }

    const navSet = new Set(navIds);
    const missing = [...expected].filter((id) => !navSet.has(id)).sort();
    const extra = [...navSet].filter((id) => !expected.has(id)).sort();
    assertEquals(missing, [], `components with no Overview link: ${missing.join(", ")}`);
    assertEquals(
      extra,
      [],
      `Overview links a non-existent / non-linkable story: ${extra.join(", ")}`,
    );

    // Section correctness: each section array only holds ids with its prefix.
    for (
      const [name, prefix] of [
        ["COMPONENTS", "chat-components-"],
        ["COMPOSITION", "chat-composition-"],
        ["UI", "chat-ui-"],
      ] as const
    ) {
      const block = overview.match(
        new RegExp(`const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`),
      )?.[1] ?? "";
      const ids = [...block.matchAll(/id:\s*"([a-z0-9-]+--docs)"/g)].map((m) =>
        m[1]
      );
      assert(ids.length > 0, `Overview ${name} section not found`);
      const wrong = ids.filter((id) => !id.startsWith(prefix));
      assertEquals(
        wrong,
        [],
        `Overview ${name} section has ids not under ${prefix}: ${
          wrong.join(", ")
        }`,
      );
    }
  });

  it("keeps Storybook isolated from framework exports and browser-safe runtime patches", async () => {
    const denoConfig = await readJson<DenoConfig>("deno.json");
    const exportsJson = JSON.stringify(denoConfig.exports);
    const importsJson = JSON.stringify(denoConfig.imports);

    assertEquals(denoConfig.exports["./chat"], "./src/chat/index.ts");
    assertEquals(denoConfig.imports["veryfront/chat"], "./src/chat/index.ts");
    assertEquals(denoConfig.exports["./react"], undefined);
    assertEquals(exportsJson.includes("storybook"), false);
    assertEquals(importsJson.includes("@storybook"), false);
    assertEquals(BROWSER_SAFE_EXPORTS.includes("./react"), false);

    for (const exportPath of BROWSER_SAFE_EXPORTS) {
      assertEquals(
        typeof denoConfig.exports[exportPath],
        "string",
        `${exportPath} must remain a public export before npm build patching`,
      );
    }

    assertEquals(denoConfig.exclude?.includes("storybook/"), true);
    assertEquals(
      denoConfig.tasks?.storybook,
      "npm --prefix storybook run storybook",
    );
    assertEquals(
      denoConfig.tasks?.["build:storybook"],
      "npm --prefix storybook run build-storybook",
    );
    assertEquals(
      denoConfig.tasks?.["storybook:check"],
      "deno test --no-lock --config=scripts/test.deno.json --no-check --allow-read scripts/storybook/storybook-workbench.test.ts",
    );
  });

  it("defines a private dev-only Storybook package", async () => {
    const pkg = await readJson<PackageJson>("storybook/package.json");

    assertEquals(pkg.private, true);
    assertEquals(
      pkg.scripts?.storybook,
      "storybook dev -p 6006 --host 0.0.0.0",
    );
    assertEquals(pkg.scripts?.["build-storybook"], "storybook build -o dist");

    for (
      const dependencyName of [
        "@storybook/react-vite",
        "@tailwindcss/vite",
        "@vitejs/plugin-react",
        "storybook",
        "tailwindcss",
        "typescript",
        "vite",
        "react",
        "react-dom",
      ]
    ) {
      assert(
        pkg.devDependencies?.[dependencyName],
        `${dependencyName} must stay scoped to storybook/package.json`,
      );
    }
  });

  it("documents that shipped UI source stays under src/react", async () => {
    const guide = await readText("docs/guides/storybook-ui-workbench.md");

    assertStringIncludes(guide, "Keep shipped UI source under `src/react`.");
    assertStringIncludes(guide, "`deno task storybook`");
    assertStringIncludes(guide, "`deno task build:storybook`");
    assertStringIncludes(
      guide,
      "Storybook must not become a public `deno.json` export.",
    );
  });

  it("covers the shipped UI families with Storybook stories that import real components", async () => {
    const requiredStories = [
      {
        path: "storybook/stories/chat/Chat.stories.tsx",
        title: "Chat/Components/Chat",
        imports: ['from "veryfront/chat"'],
        names: ["Chat", "modelOptions"],
      },
      {
        path: "storybook/stories/chat/ChatComposition.stories.tsx",
        title: "Chat/Composition/Anatomy",
        imports: ['from "veryfront/chat"'],
        names: ["ChatRoot", "ChatMessageList", "ChatInput", "Message"],
      },
      {
        path: "storybook/stories/chat/ChatSubcomponents.stories.tsx",
        title: "Chat/Composition/Subcomponents",
        imports: ['from "veryfront/chat"'],
        names: ["ToolCall", "Sources", "Reasoning", "MessageActionBar"],
      },
      {
        path: "storybook/stories/chat/ChatSidebar.stories.tsx",
        title: "Chat/Components/ChatSidebar",
        imports: ['from "veryfront/chat"'],
        names: ["ChatSidebar"],
      },
      {
        path: "storybook/stories/primitives/ReactPrimitives.stories.tsx",
        title: "Chat/Composition/React Primitives",
        imports: ['from "../../../src/react/primitives/index.ts"'],
        names: ["ChatContainer", "MessageList", "InputBox", "SubmitButton"],
      },
    ];

    for (const story of requiredStories) {
      const source = await readText(story.path);

      assertStringIncludes(
        source,
        story.title,
        `${story.path} must use the expected title`,
      );
      for (const importSpec of story.imports) {
        assertStringIncludes(
          source,
          importSpec,
          `${story.path} must import ${importSpec}`,
        );
      }
      for (const componentName of story.names) {
        assertStringIncludes(
          source,
          componentName,
          `${story.path} must cover ${componentName}`,
        );
      }
    }
  });

  it("has every target Chat/Components story in the sidebar", async () => {
    // The TARGET sidebar under Chat/Components — the final, renamed component set
    // (see .context/chat-components-checklist.md). This is the driver: it fails
    // until every component has a story at its target path/title exporting its
    // target name. Sub-agents take one row each and turn it green.
    const target = [
      { file: "Chat", title: "Chat", names: ["Chat"] },
      { file: "Attachment", title: "Attachment", names: ["Attachment"] },
      { file: "Markdown", title: "Markdown", names: ["Markdown"] },
      { file: "Sources", title: "Sources", names: ["Sources"] },
      { file: "Reasoning", title: "Reasoning", names: ["Reasoning"] },
      { file: "ToolCall", title: "ToolCall", names: ["ToolCall"] },
      { file: "Message", title: "Message", names: ["Message"] },
      { file: "AgentCard", title: "AgentCard", names: ["AgentCard"] },
      { file: "AttachmentsPanel", title: "AttachmentsPanel", names: ["AttachmentsPanel"] },
      { file: "ChatSidebar", title: "ChatSidebar", names: ["ChatSidebar"] },
      { file: "ModelSelector", title: "ModelSelector", names: ["ModelSelector"] },
      { file: "AgentPicker", title: "AgentPicker", names: ["AgentPicker"] },
      { file: "ChatActions", title: "ChatActions", names: ["ChatActions"] },
      { file: "ChatInput", title: "ChatInput", names: ["ChatInput"] },
      { file: "ChatEmptyState", title: "ChatEmptyState", names: ["ChatEmptyState"] },
    ];

    const problems: string[] = [];
    for (const c of target) {
      const path = `storybook/stories/chat/${c.file}.stories.tsx`;
      let source: string;
      try {
        source = await readText(path);
      } catch {
        problems.push(`${c.title}: missing story ${path}`);
        continue;
      }
      const expectedTitle = `Chat/Components/${c.title}`;
      if (!source.includes(expectedTitle)) {
        problems.push(`${c.title}: story must use title "${expectedTitle}"`);
      }
      for (const name of c.names) {
        if (!source.includes(name)) {
          problems.push(`${c.title}: story must cover export ${name}`);
        }
      }
    }

    assertEquals(
      problems,
      [],
      `Chat/Components sidebar incomplete:\n  - ${problems.join("\n  - ")}`,
    );
  });

  it("exports every target chat component from veryfront/chat (driver)", async () => {
    // The public API target. Fails until every component is exported under its
    // final name (renames landed + new components built). `\b` boundaries mean
    // "Attachment" does NOT match "Attachment", "CodeBlock" not "RichCodeBlock".
    const publicBarrel = await readText("src/chat/index.ts");
    const targetExports = [
      "Attachment",
      "Markdown",
      "Sources",
      "Reasoning",
      "SkillTool",
      "ToolCall",
      "Message",
      "AgentCard",
      "AttachmentsPanel",
      "ChatSidebar",
      "ModelSelector",
      "AgentPicker",
      "ChatActions",
      "ChatInput",
      "ChatEmptyState",
      "CodeBlock",
    ];
    const missing = targetExports.filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(publicBarrel),
    );
    assertEquals(
      missing,
      [],
      `veryfront/chat is missing target exports: ${missing.join(", ")}`,
    );
  });

  it("has a CodeBlock primitive under Chat/UI (driver)", async () => {
    // CodeBlock is the shared syntax-highlight primitive (Markdown + ToolCall).
    // Renamed from RichCodeBlock, moved to the ui barrel, shiki github-light/dark
    // + mermaid, lazy-loaded from esm.sh (no bundled dep).
    const problems: string[] = [];

    const uiBarrel = await readText("src/react/components/chat/ui/index.ts");
    if (!/\bCodeBlock\b/.test(uiBarrel)) {
      problems.push("src/react/components/chat/ui/index.ts must export CodeBlock");
    }

    const storyPath = "storybook/stories/ui/CodeBlock.stories.tsx";
    try {
      const story = await readText(storyPath);
      if (!story.includes("Chat/UI/CodeBlock")) {
        problems.push(`${storyPath} must use title "Chat/UI/CodeBlock"`);
      }
    } catch {
      problems.push(`missing story ${storyPath}`);
    }

    assertEquals(
      problems,
      [],
      `CodeBlock primitive incomplete:\n  - ${problems.join("\n  - ")}`,
    );
  });

  it("ports Studio styling without importing Studio-only UI dependencies", async () => {
    const sourceFiles = [
      "src/react/components/chat/theme.ts",
      "src/react/components/chat/chat-tokens.ts",
      "src/react/components/chat/chat/components/tool-ui.tsx",
      "src/react/components/chat/chat/composition/chat-composer.tsx",
      "src/react/components/chat/model-selector.tsx",
      "src/react/components/chat/agent-card.tsx",
      "src/server/handlers/dev/projects/html-shell.ts",
      "src/studio/bridge/bridge-styles.ts",
      "storybook/.storybook/preview.css",
      "storybook/stories/chat/ToolCall.stories.tsx",
      "storybook/stories/chat/ChatInput.stories.tsx",
    ];
    const licensedFontNames = [
      ["Gell", "ix"].join(""),
      ["S", "öhne"].join(""),
      ["Soh", "ne"].join(""),
    ];

    for (const path of sourceFiles) {
      const source = await readText(path);
      assertEquals(
        source.includes("@radix-ui/"),
        false,
        `${path} must not import Radix`,
      );
      assertEquals(
        source.includes("class-variance-authority"),
        false,
        `${path} must not import CVA`,
      );
      assertEquals(
        source.includes("@/"),
        false,
        `${path} must not import Studio aliases`,
      );
      for (const fontName of licensedFontNames) {
        assertEquals(
          source.includes(fontName),
          false,
          `${path} must not reference licensed Studio fonts`,
        );
      }
    }

    const themeSource = await readText("src/react/components/chat/theme.ts");
    const previewSource = await readText("storybook/.storybook/preview.css");
    const bridgeSource = await readText("src/studio/bridge/bridge-styles.ts");
    assertStringIncludes(themeSource, "font-family:Inter");
    assertStringIncludes(previewSource, "Inter, ui-sans-serif");
    assertStringIncludes(bridgeSource, "font-family: Inter, ui-sans-serif");
  });

  it("uses explicit Vite aliases for Veryfront source imports instead of package exports", async () => {
    const main = await readText("storybook/.storybook/main.ts");
    const aliases = await readText("storybook/.storybook/veryfront-aliases.ts");

    assertStringIncludes(main, "createVeryfrontAliases");
    assertStringIncludes(aliases, "veryfront\\/chat");
    assertStringIncludes(aliases, "#veryfront");
    assertStringIncludes(
      aliases,
      "storybook/.storybook/shims/veryfront-utils.ts",
    );
    assertStringIncludes(aliases, "src/chat/index.ts");
    assertStringIncludes(aliases, "src/react/components/chat/index.ts");
  });
});
