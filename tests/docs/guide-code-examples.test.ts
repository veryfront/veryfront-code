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
  veryfrontApiMcpServer,
  veryfrontStudioMcpServer,
} from "../../src/agent/index.ts";
import {
  AttachmentsPanel,
  Chat,
  ChatContextProvider,
  ChatThemeScope,
  ComposerContextProvider,
  Message,
  MessageContextProvider,
  useAgent,
  useChat,
  useChatContextOptional,
  useCompletion,
  useUploadsRegistry,
} from "../../src/chat/index.ts";
import { createUploadHandler, ragStore } from "../../src/embedding/index.ts";
import { defineConfig } from "../../src/config/index.ts";
import { datasets, evalAgent, metrics, runEval } from "../../src/eval/index.ts";
import { metrics as projectMetrics } from "../../src/metrics/index.ts";
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
import { parseDeployArgs } from "../../cli/commands/deploy/command.ts";
import { buildKnowledgeIngestRunResult } from "../../cli/commands/knowledge/result.ts";
import { parsePullArgs } from "../../cli/commands/pull/command.ts";
import { parsePushArgs } from "../../cli/commands/push/command.ts";
import { parseCliArgs } from "../../cli/shared/args.ts";
import { getTemplate } from "../../cli/templates/index.ts";

const EXISTING_GUIDE_EXAMPLE_SUITE = [
  "agents.md",
  "api-routes.md",
  "configuration.md",
  "data-fetching.md",
  "runs.md",
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
  "build-a-rag-app.md",
  "chat-hooks.md",
  "chat-ui.md",
  "cli-knowledge-ingestion.md",
  "coding-agents.md",
  "create-agent.md",
  "deploy-from-ci.md",
  "deploying.md",
  "evals.md",
  "extension-authoring.md",
  "extensions.md",
  "head-and-seo.md",
  "index.md",
  "installation.md",
  "create-frontend.md",
  "create-project.md",
  "create-api.md",
  "deploy-project.md",
  "integrations.md",
  "move-studio-changes-to-git.md",
  "pages-and-routing.md",
  "project-structure.md",
  "project-metrics.md",
  "quickstart.md",
  "sandbox.md",
  "skills.md",
  "storybook-ui-workbench.md",
  "tasks.md",
  "workflows-advanced.md",
  "eval.md",
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

const GUIDE_DIRS = ["docs/getting-started", "docs/guides", "docs/concepts"] as const;

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
        entry.isFile && entry.name.endsWith(".md") &&
        entry.name !== "README.md"
      ) {
        const content = await readGuide(entry.name);
        if (content.includes("```")) names.push(entry.name);
      } else if (entry.isDirectory) {
        for await (const child of Deno.readDir(`${dir}/${entry.name}`)) {
          if (
            child.isFile && child.name.endsWith(".md") &&
            child.name !== "README.md"
          ) {
            const rel = `${entry.name}/${child.name}`;
            const content = await readGuide(rel);
            if (content.includes("```")) names.push(rel);
          }
        }
      }
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
    assertEquals(veryfrontApiMcpServer(), { kind: "veryfront-api" });
    assertEquals(veryfrontStudioMcpServer(), { kind: "veryfront-studio" });

    const handler = createAgUiHandler("assistant");
    assertEquals(typeof handler, "function");
  });
});

describe("Guide: index.md", () => {
  it("documents the CLI and coding-agent workflow from the overview", async () => {
    const guide = await readGuide("index.md");

    for (
      const snippet of [
        "npm create veryfront",
        "cd <PROJECT_NAME>",
        "veryfront dev",
        "veryfront generate <type> <name>",
        "veryfront schema --json",
        "AGENTS.md",
        "vf_bootstrap",
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }
  });
});

describe("Guide: project-metrics.md", () => {
  it("uses the public project metrics SDK hook", async () => {
    const guide = await readGuide("project-metrics.md");

    assertEquals(typeof projectMetrics.counter, "function");
    assertEquals(typeof projectMetrics.histogram, "function");
    assertEquals(typeof projectMetrics.gauge, "function");
    assertStringIncludes(guide, 'import { metrics } from "veryfront/metrics"');
  });
});

describe("Guide: storybook-ui-workbench.md", () => {
  it("documents deno tasks that exist in deno.json", async () => {
    const guide = await readGuide("storybook-ui-workbench.md");
    const denoJson = JSON.parse(await Deno.readTextFile("deno.json")) as {
      tasks?: Record<string, string>;
    };

    for (const task of ["storybook", "build:storybook", "storybook:check"]) {
      assertStringIncludes(guide, `deno task ${task}`);
      assertExists(denoJson.tasks?.[task], `deno.json task "${task}" should exist`);
    }
  });
});

describe("Guide: chat-ui.md", () => {
  it("uses the preset Chat component with the documented hook and route helper", () => {
    assertEquals(typeof useChat, "function");
    assertEquals(typeof createAgUiHandler, "function");
    assertEquals(typeof Chat, "function");
    const chatRecord = Chat as unknown as Record<string, unknown>;
    const messageRecord = Message as unknown as Record<string, unknown>;
    assertExists(chatRecord.Root);
    assertExists(chatRecord.MessageList);
    assertExists(chatRecord.Input);
    assertExists(messageRecord.Root);
    assertExists(ChatContextProvider);
    assertExists(ComposerContextProvider);
    assertExists(MessageContextProvider);
    assertEquals(typeof useChatContextOptional, "function");

    const chatComponents = Chat as unknown as Record<
      string,
      React.ComponentType<Record<string, unknown>>
    >;
    const ChatRoot = chatComponents.Root;
    const ChatEmpty = chatComponents.Empty;
    assertExists(ChatRoot);
    assertExists(ChatEmpty);

    const element = React.createElement(
      ChatRoot,
      { messages: [], input: "" },
      React.createElement(
        ChatEmpty,
        { title: "Ask me anything" },
      ),
    );
    assertEquals(element.type, ChatRoot);
  });
});

describe("Guide: memory-and-streaming.md", () => {
  it("uses the canonical useChat event handlers", async () => {
    const guide = await readGuide("memory-and-streaming.md");

    assertStringIncludes(guide, "handleInputChange");
    assertStringIncludes(guide, "handleSubmit");
    assertEquals(guide.includes("const { messages, input, onChange, onSubmit"), false);
  });
});

describe("Guide: chat-hooks.md", () => {
  it("uses exported headless chat hooks", () => {
    assertEquals(typeof useChat, "function");
    assertEquals(typeof useAgent, "function");
    assertEquals(typeof useCompletion, "function");
  });
});

describe("Guide: build-a-rag-app.md", () => {
  it("uses the public RAG, chat, upload, and AG-UI helpers", async () => {
    const guide = await readGuide("build-a-rag-app.md");
    const template = await getTemplate("docs-agent");

    assertEquals(typeof ragStore, "function");
    assertEquals(typeof createUploadHandler, "function");
    assertEquals(typeof useUploadsRegistry, "function");
    assertExists(AttachmentsPanel.Root);
    assertEquals(typeof useChat, "function");
    assertEquals(typeof ChatThemeScope, "function");
    assertEquals(typeof createAgUiHandler, "function");
    assertExists(template);
    const templatePage = template.find((file) => file.path === "app/page.tsx")?.content ?? "";
    const templateLayout = template.find((file) => file.path === "app/layout.tsx")?.content ?? "";
    assertStringIncludes(templateLayout, "ChatThemeScope");
    assertStringIncludes(templateLayout, "AppShell");
    assertStringIncludes(templatePage, 'agentId="rag"');
    assert(
      template.some((file) => file.path === "store.ts"),
      "docs-agent template includes store.ts",
    );
    assert(
      template.some((file) => file.path === "app/api/ag-ui/route.ts"),
      "docs-agent template includes the AG-UI route",
    );
    assert(
      template.some((file) => file.path === "app/api/ingest/route.ts"),
      "docs-agent template includes the ingestion route",
    );
    assert(
      template.some((file) => file.path === "app/api/uploads/route.ts"),
      "docs-agent template includes the upload route",
    );
    assert(
      template.some((file) => file.path === "app/uploads/page.tsx"),
      "docs-agent template includes the uploads page",
    );
    assertStringIncludes(guide, 'useUploadsRegistry({ url: "/api/uploads" })');
    assertStringIncludes(guide, "AttachmentsPanel");
    assertStringIncludes(guide, 'import { store } from "../../../store.ts";');
    assertStringIncludes(guide, "await store.indexContentDir();");
    assertStringIncludes(guide, "const results = await store.search(query, { topK: 5 });");
    assertStringIncludes(guide, ".veryfront/rag/uploads/");
    assertStringIncludes(guide, "DocumentExtractor");
    assertStringIncludes(guide, "XLS, XLSX");
    assertStringIncludes(guide, "OCR is not a separate step.");
    assertStringIncludes(guide, "chunkOptions");
    assertStringIncludes(guide, "maxChars: 2000");
    assertStringIncludes(guide, "VERYFRONT_API_TOKEN");
    assertStringIncludes(guide, "AI Gateway");
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
    assertEquals(guide.includes("Unknown command: mcp"), false);
    assertEquals(guide.includes("deno run -A cli/main.ts mcp"), false);
    assertEquals(
      guide.includes("HTTP MCP only listens while `veryfront dev` or `veryfront start`"),
      false,
    );
  });
});

describe("Guide: cli-knowledge-ingestion.md", () => {
  it("uses the current knowledge ingest run result shape", () => {
    const result = buildKnowledgeIngestRunResult({
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
        "veryfront serve",
        "veryfront push --branch main --yes",
        "veryfront deploy --branch main --env production --yes",
        "veryfront open",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
    assertEquals(guide.includes("veryfront start"), false);
  });
});

describe("Guide: deploy-from-ci.md", () => {
  it("uses supported Push and Deploy arguments in the required order", async () => {
    const guide = await readGuide("deploy-from-ci.md");
    const pushCommand = "veryfront push --branch main --yes";
    const deployCommand = "veryfront deploy --branch main --env production --yes";

    const pushArgs = parseCliArgs(["push", "--branch", "main", "--yes"]);
    const parsedPush = parsePushArgs(pushArgs);
    assert(parsedPush.success);
    assertEquals(parsedPush.data.branch, "main");
    assertEquals(pushArgs.yes, true);

    const deployArgs = parseCliArgs([
      "deploy",
      "--branch",
      "main",
      "--env",
      "production",
      "--yes",
    ]);
    const parsedDeploy = parseDeployArgs(deployArgs);
    assert(parsedDeploy.success);
    assertEquals(parsedDeploy.data.branch, "main");
    assertEquals(parsedDeploy.data.env, "production");
    assertEquals(deployArgs.yes, true);

    assert(guide.indexOf(pushCommand) < guide.indexOf(deployCommand));
    assertStringIncludes(guide, "cancel-in-progress: false");
    assertStringIncludes(guide, "RUNNER_TEMP");
  });
});

describe("Guide: move-studio-changes-to-git.md", () => {
  it("uses the immutable release and pruning Pull arguments", async () => {
    const guide = await readGuide("move-studio-changes-to-git.md");
    const pullArgs = parseCliArgs([
      "pull",
      "--release",
      "0.0.42",
      "--prune",
      "--yes",
    ]);
    const parsedPull = parsePullArgs(pullArgs);

    assert(parsedPull.success);
    assertEquals(parsedPull.data.release, "0.0.42");
    assertEquals(parsedPull.data.prune, true);
    assertEquals(pullArgs.yes, true);
    assertStringIncludes(
      guide,
      'veryfront pull --release "$VERYFRONT_RELEASE" --prune --yes',
    );
    assertStringIncludes(guide, "git merge origin/main");
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
      teardown: () => {
        events.push("provider:teardown");
      },
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
      teardown: () => {
        events.push("consumer:teardown");
      },
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
      get: <T = unknown>(key: string) => Promise.resolve(values.get(key) as T | undefined),
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

    const prefetchLink = Link({ href: "/about", children: "About" });
    const noPrefetchLink = Link({ href: "/about", prefetch: false, children: "About" });

    const prefetchProps = prefetchLink.props as Record<string, unknown>;
    const noPrefetchProps = noPrefetchLink.props as Record<string, unknown>;
    assertEquals(prefetchProps["data-prefetch"], "true");
    assertEquals(noPrefetchProps["data-prefetch"], "false");
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
      "npm install veryfront",
      "pnpm add veryfront",
      "yarn add veryfront",
      "bun add veryfront",
      "deno add npm:veryfront",
      "npm create veryfront",
      "pnpm create veryfront",
      "yarn create veryfront",
      "bun create veryfront",
      "npm install -g veryfront",
      "pnpm add -g veryfront",
      "yarn global add veryfront",
      "bun add -g veryfront",
      "npx veryfront",
      "veryfront install agents",
      "veryfront --version",
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
        "### npm",
        "### pnpm",
        "### yarn",
        "### bun",
        "## One-shot CLI usage",
        "## Coding-agent setup",
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
        '<Chat chat={chat} placeholder="Ask me anything..." />',
      ]
    ) {
      assertStringIncludes(guide, snippet);
    }
  });
});

describe("Guide: deploy-project.md", () => {
  it("documents the build, serve, deploy, and open sequence", async () => {
    const guide = await readGuide("deploy-project.md");

    for (
      const command of [
        "veryfront build",
        "veryfront serve",
        "veryfront push --branch main --yes",
        "veryfront deploy --branch main --env production --yes",
        "veryfront open",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
    assertEquals(guide.includes("veryfront start"), false);
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
      "allowed_tools: load_skill load_skill_reference execute_skill_script",
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

  it("does not document a task list flag the CLI does not support", async () => {
    const guide = await readGuide("tasks.md");

    assertStringIncludes(guide, "veryfront task sync-data");
    assertEquals(guide.includes("veryfront task --list"), false);
  });
});

describe("Guide: evals.md", () => {
  it("defines and runs a portable eval without a provider call", async () => {
    const deepResearchEval = evalAgent({
      name: "Deep research answer quality",
      target: "agent:researcher",
      dataset: datasets.inline([
        {
          id: "capital-france",
          input: { question: "What is the capital of France?" },
          reference: "Paris",
          metadata: { split: "smoke" },
        },
      ]),
      metrics: [
        metrics.answer.contains({ text: "Paris" }).gate(),
        metrics.agent.noFailedTools().gate(),
        metrics.ops.tokens({ maxTotal: 4_000 }).budget(),
      ],
    });

    const report = await runEval(deepResearchEval, {
      adapters: {
        agent: async ({ example }) => ({
          text: String(example.reference),
          finishReason: "stop",
          usage: { totalTokens: 64 },
          toolCalls: [],
        }),
      },
    });

    assertEquals(deepResearchEval.kind, "eval");
    assertEquals(deepResearchEval.target, "agent:researcher");
    assertEquals(report.summary.failed, 0);
    assertEquals(report.summary.records, 1);
  });
});
