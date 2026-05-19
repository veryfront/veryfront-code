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
  "chat-composition.md",
  "chat-hooks.md",
  "chat-theming.md",
  "chat-ui.md",
  "cli-knowledge-ingestion.md",
  "deploying.md",
  "extension-authoring.md",
  "extension-lifecycle.md",
  "extension-publishing.md",
  "extension-testing.md",
  "extensions.md",
  "head-and-seo.md",
  "integrations.md",
  "pages-and-routing.md",
  "project-structure.md",
  "quickstart.md",
  "sandbox.md",
  "skills.md",
  "tasks.md",
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

async function readGuide(filename: string): Promise<string> {
  return await Deno.readTextFile(`docs/guides/${filename}`);
}

async function guideFilesWithCodeFences(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir("docs/guides")) {
    if (!entry.isFile || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const content = await readGuide(entry.name);
    if (content.includes("```")) names.push(entry.name);
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
  });
});

describe("Guide: chat-composition.md", () => {
  it("uses exported compound Chat and Message components", () => {
    assertExists((Chat as Record<string, unknown>).Root);
    assertExists((Chat as Record<string, unknown>).MessageList);
    assertExists((Chat as Record<string, unknown>).Composer);
    assertExists((Message as Record<string, unknown>).Root);

    const element = React.createElement(
      (Chat as Record<string, React.ComponentType<Record<string, unknown>>>).Root,
      { messages: [], input: "" },
      React.createElement(
        (Chat as Record<string, React.ComponentType<Record<string, unknown>>>).Empty,
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

describe("Guide: chat-theming.md", () => {
  it("uses exported chat composition and context APIs", () => {
    assertExists(ChatWithSidebar);
    assertExists(ChatContextProvider);
    assertExists(ComposerContextProvider);
    assertExists(MessageContextProvider);
    assertEquals(typeof useChatContextOptional, "function");
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
});

describe("Guide: extension-authoring.md", () => {
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
});

describe("Guide: extension-lifecycle.md", () => {
  const loader = new ExtensionLoader(noopLogger);

  afterEach(async () => {
    await loader.teardownAll();
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
        events.push(ctx.get("CacheStore") === cache ? "consumer:setup" : "missing");
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

    assertEquals(events, ["consumer:setup", "consumer:teardown", "provider:teardown"]);
  });
});

describe("Guide: extension-testing.md", () => {
  const loader = new ExtensionLoader(noopLogger);

  afterEach(async () => {
    await loader.teardownAll();
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
});

describe("Guide: extension-publishing.md", () => {
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

describe("Guide: quickstart.md", () => {
  it("lists template IDs that exist in the CLI template registry", async () => {
    const guide = await readGuide("quickstart.md");
    const templateIds = [...guide.matchAll(/\| `([^`]+)`\s+\|/g)].map((match) => match[1]);

    assertEquals(templateIds, [
      "minimal",
      "ai-agent",
      "docs-agent",
      "agentic-workflow",
      "multi-agent-system",
      "coding-agent",
      "saas-starter",
    ]);

    for (const templateId of templateIds) {
      assertExists(await getTemplate(templateId as Parameters<typeof getTemplate>[0]));
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

describe("Guide: tasks.md", () => {
  it("uses a TaskDefinition-compatible default export shape", async () => {
    const syncData = {
      name: "Sync external data",
      description: "Pull latest records from the external API",
      schedulable: true,
      async run(ctx: { env: Record<string, string>; config: Record<string, unknown> }) {
        return {
          synced: Object.keys(ctx.env).length + Object.keys(ctx.config).length,
        };
      },
    };

    assert(isTaskDefinition(syncData));
    assertEquals(await syncData.run({ env: { A: "1" }, config: { batchSize: 100 } }), {
      synced: 2,
    });
  });
});
