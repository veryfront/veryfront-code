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

describe("Storybook UI workbench", () => {
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
        title: "Veryfront UI/Chat/Preset",
        imports: ['from "veryfront/chat"'],
        names: ["Chat", "modelOptions"],
      },
      {
        path: "storybook/stories/chat/ChatComposition.stories.tsx",
        title: "Veryfront UI/Chat/Composition",
        imports: ['from "veryfront/chat"'],
        names: ["ChatRoot", "ChatMessageList", "ChatComposer", "Message"],
      },
      {
        path: "storybook/stories/chat/ChatSubcomponents.stories.tsx",
        title: "Veryfront UI/Chat/Subcomponents",
        imports: ['from "veryfront/chat"'],
        names: ["ToolCallCard", "Sources", "ReasoningCard", "MessageActions"],
      },
      {
        path: "storybook/stories/chat/ChatWithSidebar.stories.tsx",
        title: "Veryfront UI/Chat/With Sidebar",
        imports: ['from "veryfront/chat"'],
        names: ["ChatWithSidebar"],
      },
      {
        path: "storybook/stories/primitives/ReactPrimitives.stories.tsx",
        title: "Veryfront UI/React Primitives",
        imports: ['from "../../../src/react/primitives/index.ts"'],
        names: ["ChatContainer", "MessageList", "InputBox", "SubmitButton"],
      },
      {
        path: "storybook/stories/components/FrameworkComponents.stories.tsx",
        title: "Veryfront UI/Framework Components",
        imports: [
          'from "../../../src/react/components/Head.tsx"',
          'from "../../../src/react/components/MDXProvider.tsx"',
          'from "../../../src/react/components/optimized-image/index.ts"',
        ],
        names: ["OptimizedImage", "MDXProvider", "Head"],
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

  it("gives reviewable chat components dedicated Storybook stories", async () => {
    const dedicatedStories = [
      {
        path: "storybook/stories/chat/AttachmentPill.stories.tsx",
        title: "Veryfront UI/Chat/AttachmentPill",
        imports: ['from "veryfront/chat"'],
        names: ["AttachmentPill"],
      },
      {
        path: "storybook/stories/chat/ChatComposer.stories.tsx",
        title: "Veryfront UI/Chat/ChatComposer",
        imports: ['from "veryfront/chat"'],
        names: ["ChatComposer", "ModelSelector", "AttachmentPill"],
      },
      {
        path: "storybook/stories/chat/ChatSidebar.stories.tsx",
        title: "Veryfront UI/Chat/ChatSidebar",
        imports: ['from "veryfront/chat"'],
        names: ["ChatSidebar"],
      },
      {
        path: "storybook/stories/chat/Message.stories.tsx",
        title: "Veryfront UI/Chat/Message",
        imports: ['from "veryfront/chat"'],
        names: ["StandaloneMessage", "StreamingMessage", "Message"],
      },
      {
        path: "storybook/stories/chat/ModelSelector.stories.tsx",
        title: "Veryfront UI/Chat/ModelSelector",
        imports: ['from "veryfront/chat"'],
        names: ["ModelSelector"],
      },
      {
        path: "storybook/stories/chat/ReasoningCard.stories.tsx",
        title: "Veryfront UI/Chat/ReasoningCard",
        imports: ['from "veryfront/chat"'],
        names: ["ReasoningCard"],
      },
      {
        path: "storybook/stories/chat/Sources.stories.tsx",
        title: "Veryfront UI/Chat/Sources",
        imports: ['from "veryfront/chat"'],
        names: ["Sources", "InlineCitation"],
      },
      {
        path: "storybook/stories/chat/ToolCallCard.stories.tsx",
        title: "Veryfront UI/Chat/ToolCallCard",
        imports: ['from "veryfront/chat"'],
        names: [
          "ToolCallCard",
          "ToolStatusBadge",
          "SkillBadge",
          "InferenceBadge",
        ],
      },
      {
        path: "storybook/stories/chat/UploadsPanel.stories.tsx",
        title: "Veryfront UI/Chat/UploadsPanel",
        imports: ['from "veryfront/chat"'],
        names: ["UploadsPanel"],
      },
      {
        path: "storybook/stories/chat/AgentCard.stories.tsx",
        title: "Veryfront UI/Chat/AgentCard",
        imports: ['from "veryfront/chat"'],
        names: ["AgentCard"],
      },
      {
        path: "storybook/stories/chat/Markdown.stories.tsx",
        title: "Veryfront UI/Chat/Markdown",
        imports: ['from "veryfront/react/components/chat"'],
        names: ["Markdown", "RichCodeBlock"],
      },
      {
        path: "storybook/stories/chat/ActionComponents.stories.tsx",
        title: "Veryfront UI/Chat/Action Components",
        imports: ['from "veryfront/chat"'],
        names: [
          "MessageActions",
          "MessageFeedback",
          "QuickActions",
          "Suggestions",
          "TabSwitcher",
        ],
      },
    ];

    for (const story of dedicatedStories) {
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
      "storybook/stories/chat/ToolCallCard.stories.tsx",
      "storybook/stories/chat/ChatComposer.stories.tsx",
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
