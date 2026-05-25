import "../_helpers/contract-init.ts";
import React from "react";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  agent,
  createAgUiHandler,
  startAgentService,
  veryfrontMcpServer,
} from "../../src/agent/index.ts";
import {
  Chat,
  ChatContextProvider,
  ChatWithSidebar,
  ComposerContextProvider,
  Message,
  MessageContextProvider,
  useAgent,
  useChat,
  useChatContextOptional,
  useCompletion,
} from "../../src/chat/index.ts";
import { defineConfig } from "../../src/config/index.ts";
import {
  type ExtensionFactory,
  ExtensionLoader,
  parsePackageMetadata,
  tryResolve,
  validateExtension,
} from "../../src/extensions/index.ts";
import type { CacheStore } from "../../src/extensions/cache/index.ts";
import { GoogleFonts } from "../../src/react/fonts/index.ts";
import { Head } from "../../src/react/components/Head.tsx";
import { PageContextProvider, usePageContext } from "../../src/react/context/index.tsx";
import { Link, RouterProvider, useRouter } from "../../src/react/router/index.tsx";
import { Sandbox } from "../../src/sandbox/index.ts";
import { isTaskDefinition } from "../../src/task/types.ts";
import {
  getConnector,
  getIcon,
  getRemoteIntegrationToolDefinitions,
  listConnectors,
} from "../../src/integrations/index.ts";
import { buildKnowledgeIngestJobResult } from "../../cli/commands/knowledge/result.ts";
import { getTemplate } from "../../cli/templates/index.ts";

const EXISTING_GUIDE_EXAMPLE_SUITE = [
  "agents.md",
  "api-routes.md",
  "configuration.md",
  "data-fetching.md",
  "jobs.md",
  "mcp-server.md",
  "memory-and-streaming.md",
  "middleware.md",
  "multi-agent.md",
  "oauth.md",
  "providers.md",
  "tools.md",
  "workflows.md",
] as const;

const THIS_GUIDE_EXAMPLE_SUITE = [
  "agent-service-runtime.md",
  "chat-hooks.md",
  "chat-ui.md",
  "cli-knowledge-ingestion.md",
  "coding-agents.md",
  "create-agent.md",
  "deploying.md",
  "extension-authoring.md",
  "extensions.md",
  "head-and-seo.md",
  "installation.md",
  "create-frontend.md",
  "create-project.md",
  "create-api.md",
  "deploy-project.md",
  "integrations.md",
  "pages-and-routing.md",
  "project-structure.md",
  "quickstart.md",
  "sandbox.md",
  "skills.md",
  "tasks.md",
  "workflows-advanced.md",
] as const;

const GUIDE_CODE_EXAMPLE_COVERAGE = new Set<string>([
  ...EXISTING_GUIDE_EXAMPLE_SUITE,
  ...THIS_GUIDE_EXAMPLE_SUITE,
]);

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const GUIDE_DIRS = ["docs/getting-started", "docs/guides"] as const;

async function readGuide(filename: string): Promise<string> {
  for (const dir of GUIDE_DIRS) {
    try {
      return await Deno.readTextFile(`${dir}/${filename}`);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  throw new Error(`Guide not found: ${filename}`);
}

async function guideFilesWithCodeFences(): Promise<string[]> {
  const names: string[] = [];
  for (const dir of GUIDE_DIRS) {
    for await (const entry of Deno.readDir(dir)) {
      if (
        !entry.isFile || !entry.name.endsWith(".md") ||
        entry.name === "README.md"
      ) continue;
      const content = await readGuide(entry.name);
      if (content.includes("```")) names.push(entry.name);
    }
  }
  return names.sort();
}

describe("Guide code example coverage", () => {
  it("has code-example tests for every published guide with fenced examples", async () => {
    const guideFiles = await guideFilesWithCodeFences();
    const uncovered = guideFiles.filter((name) => !GUIDE_CODE_EXAMPLE_COVERAGE.has(name));
    assertEquals(uncovered, []);
  });

  it("does not keep stale guide code-example coverage entries", async () => {
    const guideFiles = new Set(await guideFilesWithCodeFences());
    const stale = [...GUIDE_CODE_EXAMPLE_COVERAGE].filter((name) => !guideFiles.has(name));
    assertEquals(stale, []);
  });
});

describe("Guide: agent-service-runtime.md", () => {
  it("uses public agent service helpers that exist and produce documented MCP configs", () => {
    assertEquals(typeof startAgentService, "function");
    assertEquals(typeof createAgUiHandler, "function");
    assertEquals(veryfrontMcpServer(), { kind: "veryfront-api" });
    assertEquals(veryfrontMcpServer("studio"), { kind: "veryfront-studio" });

    const handler = createAgUiHandler("assistant");
    assertEquals(typeof handler, "function");
  });
});

describe("Guide: chat-ui.md", () => {
  it("uses the preset Chat component with the documented hook and route helper", () => {
    assertEquals(typeof useChat, "function");
    assertEquals(typeof createAgUiHandler, "function");
    assertExists(Chat);
    assertEquals(typeof (Chat as Record<string, unknown>).render, "function");
    assertExists((Chat as Record<string, unknown>).Root);
    assertExists((Chat as Record<string, unknown>).MessageList);
    assertExists((Chat as Record<string, unknown>).Composer);
    assertExists((Message as Record<string, unknown>).Root);
    assertExists(ChatWithSidebar);
    assertExists(ChatContextProvider);
    assertExists(ComposerContextProvider);
    assertExists(MessageContextProvider);
    assertEquals(typeof useChatContextOptional, "function");

    const element = React.createElement(
      (Chat as Record<string, React.ComponentType<Record<string, unknown>>>)
        .Root,
      { messages: [], input: "" },
      React.createElement(
        (Chat as Record<string, React.ComponentType<Record<string, unknown>>>)
          .Empty,
        { title: "Ask me anything" },
      ),
    );
    assertEquals(element.type, (Chat as Record<string, unknown>).Root);
  });
});

describe("Guide: chat-hooks.md", () => {
  it("uses exported headless chat hooks", () => {
    assertEquals(typeof useChat, "function");
    assertEquals(typeof useAgent, "function");
    assertEquals(typeof useCompletion, "function");
  });
});

describe("Guide: coding-agents.md", () => {
  it("documents both MCP transports, per-client config, and the vf_* tool surface", async () => {
    const guide = await readGuide("coding-agents.md");

    for (
      const snippet of [
        "veryfront dev",
        "veryfront mcp",
        "http://localhost:3002/mcp",
        "~/.claude.json",
        "mcpServers",
        "vf_get_errors",
        "vf_scaffold",
        "vf_get_schema",
        "veryfront schema --json",
        "tools/list",
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }

    assertEquals(guide.includes("http://localhost:9999/mcp"), false);
    assertEquals(guide.includes("veryfront start`, it listens"), false);
    assertEquals(
      guide.includes("HTTP MCP only listens while `veryfront dev` or `veryfront start`"),
      false,
    );
  });
});

describe("Guide: cli-knowledge-ingestion.md", () => {
  it("uses the current knowledge ingest job result shape", () => {
    const result = buildKnowledgeIngestJobResult({
      requestedCount: 1,
      sourceMode: "explicit_sources",
      knowledgePath: "knowledge/",
      ingested: [{
        source: "docs/example.md",
        localSourcePath: "docs/example.md",
        outputPath: "knowledge/example.md",
        remotePath: "knowledge/example.md",
        slug: "example",
        sourceType: "markdown",
        summary: "Example summary",
        stats: {},
        warnings: [],
      }],
    });

    assertEquals(result.kind, "knowledge_ingest");
    assertEquals(result.ingested.length, 1);
    assertEquals(result.summary.ingested_count, 1);
  });
});

describe("Guide: deploying.md", () => {
  it("uses a valid build config snippet", () => {
    const config = defineConfig({
      build: {
        outDir: "dist",
        trailingSlash: false,
      },
    });

    assertEquals(config.build?.outDir, "dist");
    assertEquals(config.build?.trailingSlash, false);
  });

  it("keeps the production path command sequence aligned with the CLI guides", async () => {
    const guide = await readGuide("deploying.md");

    for (
      const command of [
        "veryfront dev",
        "veryfront build",
        "veryfront start",
        "veryfront deploy",
        "veryfront open",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
  });
});

describe("Guide: extension-authoring.md", () => {
  const loader = new ExtensionLoader(noopLogger);

  afterEach(async () => {
    await loader.teardownAll();
  });

  it("uses a valid extension factory and custom provided contract", async () => {
    interface CurrentUserProvider {
      getUser(): Promise<{ id: string } | null>;
    }

    const currentUserProvider: CurrentUserProvider = {
      async getUser() {
        return null;
      },
    };

    const authExtension: ExtensionFactory = () => ({
      name: "auth-extension",
      version: "1.0.0",
      capabilities: [],
      provides: {
        CurrentUserProvider: currentUserProvider,
      },
    });

    const extension = authExtension();
    assertEquals(validateExtension(extension), []);
    assertEquals(await currentUserProvider.getUser(), null);
  });

  it("loads providers before consumers and tears down loaded extensions", async () => {
    const events: string[] = [];
    const cache = { id: "cache" };
    const provider = {
      name: "cache-extension",
      version: "1.0.0",
      capabilities: [],
      provides: { CacheStore: cache },
      teardown: () => events.push("provider:teardown"),
    };
    const consumer = {
      name: "cache-consumer",
      version: "1.0.0",
      capabilities: [],
      contracts: { requires: ["CacheStore"] },
      setup: (ctx: { get<T>(contract: string): T | undefined }) => {
        events.push(
          ctx.get("CacheStore") === cache ? "consumer:setup" : "missing",
        );
      },
      teardown: () => events.push("consumer:teardown"),
    };

    await loader.setupAll(
      [
        { extension: consumer, source: "config", origin: "test" },
        { extension: provider, source: "config", origin: "test" },
      ],
      {},
    );
    await loader.teardownAll();

    assertEquals(events, [
      "consumer:setup",
      "consumer:teardown",
      "provider:teardown",
    ]);
  });

  it("verifies a factory and resolves a CacheStore through the loader", async () => {
    const values = new Map<string, unknown>();
    const cache: CacheStore = {
      get: (key) => Promise.resolve(values.get(key)),
      set: (key, value) => {
        values.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        values.delete(key);
        return Promise.resolve();
      },
      has: (key) => Promise.resolve(values.has(key)),
      clear: () => {
        values.clear();
        return Promise.resolve();
      },
    };
    const factory: ExtensionFactory = () => ({
      name: "my-cache",
      version: "1.0.0",
      capabilities: [],
      provides: { CacheStore: cache },
    });

    const extension = factory({ maxSize: 100 });
    assertEquals(extension.name, "my-cache");
    assertEquals(validateExtension(extension), []);

    await loader.setupAll(
      [{ extension, source: "config", origin: "test" }],
      {},
    );

    const resolved = tryResolve<CacheStore>("CacheStore");
    assertExists(resolved);
    await resolved.set("key", "value", 60);
    assertEquals(await resolved.get("key"), "value");
  });

  it("uses package metadata that Veryfront discovery recognizes", () => {
    const metadata = parsePackageMetadata({
      name: "@myorg/ext-custom-cache",
      veryfront: {
        extension: true,
        capabilities: [{ type: "network", hosts: ["redis.example.com"] }],
        contracts: { provides: ["CacheStore"] },
      },
    });

    assertExists(metadata);
    assertEquals(metadata.isExtension, true);
    assertEquals(metadata.contracts?.provides, ["CacheStore"]);
  });
});

describe("Guide: extensions.md", () => {
  it("uses extension factories accepted by defineConfig", () => {
    const memoryCache: ExtensionFactory = () => ({
      name: "memory-cache",
      version: "1.0.0",
      capabilities: [],
      provides: { CacheStore: {} },
    });

    const config = defineConfig({
      extensions: [
        memoryCache({ maxSize: 500 }),
      ],
    });

    assertEquals(config.extensions?.length, 1);
    assertEquals(validateExtension(config.extensions?.[0]), []);
  });
});

describe("Guide: head-and-seo.md", () => {
  it("uses exported Head and GoogleFonts components", () => {
    const head = React.createElement(
      Head,
      null,
      React.createElement("title", null, "About Us"),
      React.createElement("meta", {
        name: "description",
        content: "Learn about the team and mission.",
      }),
    );
    const fonts = React.createElement(GoogleFonts, {
      fonts: [
        { name: "Inter", weights: [400, 500, 700] },
        { name: "Fira Code", weights: [400] },
      ],
    });

    assertEquals(head.type, Head);
    assertEquals(fonts.type, GoogleFonts);
  });
});

describe("Guide: integrations.md", () => {
  it("uses built-in connector catalog helpers", () => {
    const connectors = listConnectors();
    const github = getConnector("github");
    const githubIcon = getIcon("github");

    assert(connectors.length > 0);
    assertExists(github);
    assertExists(githubIcon);
    assertEquals(typeof getRemoteIntegrationToolDefinitions, "function");
  });
});

describe("Guide: pages-and-routing.md", () => {
  it("uses public routing and page context exports", () => {
    assertEquals(typeof useRouter, "function");
    assertEquals(typeof usePageContext, "function");

    const link = React.createElement(Link, { href: "/about" }, "About");
    const router = React.createElement(
      RouterProvider,
      null,
      React.createElement(PageContextProvider, null, link),
    );

    assertEquals(link.type, Link);
    assertEquals(router.type, RouterProvider);
  });
});

describe("Guide: project-structure.md", () => {
  it("uses an auto-discovered agent file shape that creates an agent", () => {
    const hello = agent({ id: "hello", system: "Say hi." });

    assertEquals(hello.id, "hello");
    assertEquals(hello.config.system, "Say hi.");
  });
});

describe("Guide: create-agent.md", () => {
  it("defines the first assistant agent", async () => {
    const guide = await readGuide("create-agent.md");

    for (
      const snippet of [
        'import { agent } from "veryfront/agent"',
        "export default agent({",
        'id: "assistant"',
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }

    for (
      const snippet of [
        'import { getAgent } from "veryfront/agent"',
        'const assistant = getAgent("assistant")',
        "await assistant.generate({ input: question })",
      ]
    ) {
      assertEquals(guide.includes(snippet), false);
    }
  });

  it("compiles the inline agent definition against the public agent factory", () => {
    const assistant = agent({
      id: "assistant",
      system: "You are a concise assistant. Answer in one short paragraph.",
    });

    assertEquals(assistant.id, "assistant");
  });
});

describe("Guide: installation.md", () => {
  it("documents every supported install method with the expected one-liner", async () => {
    const guide = await readGuide("installation.md");

    const expectedOneLiners = [
      "curl -fsSL https://veryfront.com/install.sh | sh",
      "irm https://veryfront.com/install.ps1 | iex",
      "brew install veryfront/tap/veryfront",
      "npm install veryfront",
      "deno add npm:veryfront",
      "npx veryfront",
    ];

    for (const command of expectedOneLiners) {
      assertStringIncludes(guide, command);
    }
  });

  it("documents requirements, install choices, and verification", async () => {
    const guide = await readGuide("installation.md");

    for (
      const heading of [
        "## Requirements",
        "## Blank or existing project",
        "## New scaffolded project",
        "## Install the CLI",
        "### macOS and Linux",
        "### Windows",
        "### npx (one-shot)",
        "## Verify the CLI",
      ]
    ) {
      assertStringIncludes(guide, heading);
    }
  });
});

describe("Guide: create-project.md", () => {
  it("documents the tutorial templates that exist in the CLI registry", async () => {
    const guide = await readGuide("create-project.md");
    const templateIds = ["minimal", "ai-agent"] as const;

    for (const templateId of templateIds) {
      assertStringIncludes(guide, `\`${templateId}\``);
      assertExists(await getTemplate(templateId));
    }
  });
});

describe("Guide: create-api.md", () => {
  it("documents the AG-UI route for the first agent", async () => {
    const guide = await readGuide("create-api.md");

    for (
      const snippet of [
        "// app/api/ag-ui/route.ts",
        'import { createAgUiHandler } from "veryfront/agent"',
        'export const POST = createAgUiHandler("assistant")',
        "curl -N -X POST",
        "data:` lines as the answer streams",
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }
  });
});

describe("Guide: create-frontend.md", () => {
  it("documents adding a chat page for the agent route", async () => {
    const guide = await readGuide("create-frontend.md");

    for (
      const snippet of [
        "// app/page.tsx",
        '"use client";',
        'import { Chat, useChat } from "veryfront/chat"',
        "useChat()",
        '<Chat {...chat} placeholder="Ask me anything..." />',
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }
  });
});

describe("Guide: deploy-project.md", () => {
  it("documents the build, start, deploy, and open sequence", async () => {
    const guide = await readGuide("deploy-project.md");

    for (
      const command of [
        "veryfront build",
        "veryfront start",
        "veryfront deploy",
        "veryfront open",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
  });
});

describe("Guide: sandbox.md", () => {
  it("uses the public Sandbox attach and lazy creation APIs without network access", () => {
    const sandbox = Sandbox.attach({
      id: "session_123",
      endpoint: "https://sandbox.example.com",
      apiUrl: "https://api.example.com",
      authToken: "<TOKEN>",
    });
    const lazySandbox = Sandbox.createLazy({
      getProjectId: () => "proj_123",
      apiUrl: "https://api.example.com",
      authToken: "<TOKEN>",
    });

    assertEquals(sandbox.id, "session_123");
    assertEquals(sandbox.url, "https://sandbox.example.com");
    assertExists(lazySandbox);
  });
});

describe("Guide: skills.md", () => {
  it("documents a SKILL.md example with required frontmatter and allowed tools", async () => {
    const guide = await readGuide("skills.md");

    assertStringIncludes(guide, "name: code-review");
    assertStringIncludes(guide, "description: Review code changes");
    assertStringIncludes(
      guide,
      "allowed_tools: load-skill load-skill-reference execute-skill-script",
    );
    assertStringIncludes(guide, "veryfront skills validate skills/my-skill");
  });
});

describe("Guide: workflows-advanced.md", () => {
  it("documents loop helpers, blob storage, and React hook surface", async () => {
    const guide = await readGuide("workflows-advanced.md");

    for (
      const snippet of [
        'import { delay, doWhile, loop, map, times } from "veryfront/workflow"',
        'loop("refine"',
        'doWhile("poll"',
        'times("generate"',
        'map("process"',
        "blobStorage",
        'import { useWorkflow, useWorkflowStart } from "veryfront/workflow"',
        "useWorkflowStart({",
        "useWorkflow({ runId })",
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }
  });
});

describe("Guide: tasks.md", () => {
  it("uses a TaskDefinition-compatible default export shape", async () => {
    const syncData = {
      name: "Sync external data",
      description: "Pull latest records from the external API",
      schedulable: true,
      async run(
        ctx: { env: Record<string, string>; config: Record<string, unknown> },
      ) {
        return {
          synced: Object.keys(ctx.env).length + Object.keys(ctx.config).length,
        };
      },
    };

    assert(isTaskDefinition(syncData));
    assertEquals(
      await syncData.run({ env: { A: "1" }, config: { batchSize: 100 } }),
      {
        synced: 2,
      },
    );
  });
});
