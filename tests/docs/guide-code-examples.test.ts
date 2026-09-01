import "../_helpers/contract-init.ts";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import {
  agent,
  createAgUiHandler,
  startNodeVeryfrontCloudAgentService,
  veryfrontApiMcpServer,
  veryfrontStudioMcpServer,
} from "../../src/agent/index.ts";
import {
  AttachmentsPanel,
  Chat,
  ChatContextProvider,
  ChatInputContextProvider,
  ChatThemeScope,
  Message,
  MessageContextProvider,
  useAgent,
  useAttachments,
  useChat,
  useChatContextOptional,
  useCompletion,
} from "../../src/chat/index.ts";
import { createUploadHandler, ragStore } from "../../src/embedding/index.ts";
import { defineConfig } from "../../src/config/index.ts";
import {
  applyCORSHeaders,
  type CORSConfig,
  handleCORSPreflight,
} from "../../src/security/index.ts";
import { buildCSP } from "../../src/security/http/response/security-handler.ts";
import { datasets, evalAgent, evalDataset, metrics, runEval } from "../../src/eval/index.ts";
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
import {
  createSearchKnowledgeTool,
  normalizeKnowledgeQuery,
  projectKnowledge,
} from "../../src/knowledge/index.ts";
import { Sandbox } from "../../src/sandbox/index.ts";
import { schedule } from "../../src/schedule/index.ts";
import { webhook } from "../../src/webhook/index.ts";
import { isTaskDefinition } from "../../src/task/types.ts";
import {
  createLocalIntegrationToolSource,
  getConnector,
  getIcon,
  getRemoteIntegrationToolDefinitions,
  listConnectors,
} from "../../src/integrations/index.ts";
import { HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV } from "../../src/integrations/local-credential-host-policy.ts";
import { loadRemoteToolsFromSource } from "#veryfront/tool";
import { parseDeployArgs } from "../../cli/commands/deploy/command.ts";
import { buildKnowledgeIngestRunResult } from "../../cli/commands/knowledge/result.ts";
import { parsePullArgs } from "../../cli/commands/pull/command.ts";
import { parsePushArgs } from "../../cli/commands/push/command.ts";
import { parseCliArgs } from "../../cli/shared/args.ts";
import { AUTH_PRESETS } from "../../cli/scaffold/engine.ts";
import { getTemplate } from "../../templates/index.ts";

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
  "application-auth.md",
  "build-a-rag-app.md",
  "chat-hooks.md",
  "chat-ui.md",
  "cli-knowledge-ingestion.md",
  "coding-agents.md",
  "cloud-environment-access.md",
  "cloud-quickstart.md",
  "create-agent.md",
  "deploy-from-ci.md",
  "deploying.md",
  "evals.md",
  "extension-authoring.md",
  "extensions.md",
  "head-and-seo.md",
  "installation.md",
  "create-frontend.md",
  "create-project.md",
  "add-to-existing-project.md",
  "create-api.md",
  "deploy-project.md",
  "integrations.md",
  "integrations/salesforce.md",
  "move-studio-changes-to-git.md",
  "pages-and-routing.md",
  "project-knowledge.md",
  "project-structure.md",
  "project-metrics.md",
  "quickstart.md",
  "sandbox.md",
  "schedule.md",
  "webhook.md",
  "security-headers.md",
  "self-hosting.md",
  "skills.md",
  "storybook-ui-workbench.md",
  "tasks.md",
  "ui-components.md",
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

describe("Guide: middleware.md", () => {
  it("uses one route-specific CORS policy for preflight and the actual response", async () => {
    const corsConfig: CORSConfig = {
      origin: "https://example.com",
      methods: ["GET", "OPTIONS"],
      allowedHeaders: ["Authorization"],
      maxAge: 86400,
    };
    const preflight = await handleCORSPreflight({
      request: new Request("http://localhost/api/report", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "GET",
          "access-control-request-headers": "Authorization",
        },
      }),
      config: corsConfig,
    });
    assertEquals(preflight.headers.get("access-control-allow-origin"), "https://example.com");

    const request = new Request("http://localhost/api/report", {
      headers: { origin: "https://example.com" },
    });
    const response = Response.json({ report: "ready" });
    const actual = await applyCORSHeaders({ request, response, config: corsConfig }) ?? response;
    assertEquals(actual.headers.get("access-control-allow-origin"), "https://example.com");
  });
});

describe("Guide: concepts/schedule.md", () => {
  it("addresses the documented scheduled agent conversation", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      agentMessage: { prompt: "Triage every open case created since the last run." },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "case-triage",
      conversationMode: "create_new",
    });
    assertEquals(definition.agentMessage, {
      prompt: "Triage every open case created since the last run.",
    });
  });

  it("accepts the documented dual declaration that spans a platform upgrade", () => {
    const definition = schedule({
      id: "triage-new-cases",
      schedule: "*/10 * * * *",
      target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      agentMessage: { prompt: "Triage every open case created since the last run." },
      input: {
        _schedule_target: { conversationMode: "create_new" },
        prompt: "Triage every open case created since the last run.",
      },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "case-triage",
      conversationMode: "create_new",
    });
    assertEquals(definition.input, {
      _schedule_target: { conversationMode: "create_new" },
      prompt: "Triage every open case created since the last run.",
    });
  });

  it("defines the documented stale-run health budget", () => {
    const definition = schedule({
      id: "daily-support-triage",
      schedule: "0 9 * * 1-5",
      target: { kind: "workflow", id: "escalate-ticket" },
      health: { maxStalenessSeconds: 1_800 },
    });

    assertEquals(definition.health, { maxStalenessSeconds: 1_800 });
  });
});

describe("Guide: concepts/webhook.md", () => {
  it("normalizes the documented event filter example", () => {
    const definition = webhook({
      id: "pull-request-review",
      target: { kind: "workflow", id: "review-pull-request" },
      eventFilter: {
        mode: "all",
        conditions: [
          { path: "action", operator: "in", value: ["opened", "reopened"] },
          { path: "pull_request.draft", operator: "equals", value: false },
          { path: "pull_request.labels", operator: "contains", value: "backend" },
        ],
      },
    });

    assertEquals(definition.eventFilter?.mode, "all");
    assertEquals(definition.eventFilter?.conditions.map((c) => c.operator), [
      "in",
      "equals",
      "contains",
    ]);
  });

  it("normalizes the documented agent prompt mapping example", () => {
    const definition = webhook({
      id: "support-escalation",
      target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
      agentMessage: {
        promptTemplate: "Triage {{payload.summary}} for account {{payload.account.id}}.",
      },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "support-agent",
      conversationMode: "create_new",
    });
    assertEquals(
      definition.agentMessage?.promptTemplate,
      "Triage {{payload.summary}} for account {{payload.account.id}}.",
    );
  });

  it("accepts the documented dual declaration that spans a platform upgrade", () => {
    const definition = webhook({
      id: "support-escalation",
      target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
      agentMessage: {
        promptTemplate: "Triage {{payload.summary}} for account {{payload.account.id}}.",
        conversationMode: "create_new",
      },
    });

    assertEquals(definition.target, {
      kind: "agent",
      id: "support-agent",
      conversationMode: "create_new",
    });
    assertEquals(definition.agentMessage?.conversationMode, "create_new");
  });
});

describe("Guide: agent-service-runtime.md", () => {
  it("uses public agent service helpers that exist and produce documented MCP configs", () => {
    assertEquals(typeof startNodeVeryfrontCloudAgentService, "function");
    assertEquals(typeof createAgUiHandler, "function");
    assertEquals(veryfrontApiMcpServer(), { kind: "veryfront-api" });
    assertEquals(veryfrontStudioMcpServer(), { kind: "veryfront-studio" });

    const handler = createAgUiHandler("assistant");
    assertEquals(typeof handler, "function");
  });
});

describe("Guide: application-auth.md", () => {
  it("uses an OIDC config accepted by the public config helper", () => {
    const config = defineConfig({
      security: {
        auth: {
          oidc: {
            issuerEnvVar: "OIDC_ISSUER",
            clientIdEnvVar: "OIDC_CLIENT_ID",
            clientSecretEnvVar: "OIDC_CLIENT_SECRET",
            sessionSecretEnvVar: "VERYFRONT_AUTH_SESSION_SECRET",
            scopes: ["openid", "profile", "email", "groups"],
            trustedEndpointOrigins: ["https://idp-endpoints.example.com"],
          },
        },
      },
    });

    assertEquals(config.security?.auth?.oidc?.scopes, [
      "openid",
      "profile",
      "email",
      "groups",
    ]);
    assertEquals(config.security?.auth?.oidc?.trustedEndpointOrigins, [
      "https://idp-endpoints.example.com",
    ]);
  });

  it("uses a trusted-proxy config accepted by the public config helper", () => {
    const config = defineConfig({
      security: {
        auth: {
          trustedProxy: {
            trustedPeers: ["10.0.0.10"],
            headers: {
              subject: "x-auth-subject",
              email: "x-auth-email",
              groups: "x-auth-groups",
            },
          },
        },
      },
    });

    assertEquals(config.security?.auth?.trustedProxy?.trustedPeers, ["10.0.0.10"]);
    assertEquals(config.security?.auth?.trustedProxy?.headers.subject, "x-auth-subject");
  });

  it("documents real auth presets, reserved routes, and horizontal-scale constraints", async () => {
    const guide = await readGuide("application-auth.md");

    assertEquals(AUTH_PRESETS, ["authelia", "oidc", "microsoft-entra"]);
    for (
      const required of [
        "GET /_veryfront/auth/login",
        "GET /_veryfront/auth/callback",
        "POST /_veryfront/auth/logout",
        "There is no sticky-session requirement",
        "directly to LDAP, NTLM, or Kerberos",
      ]
    ) {
      assertStringIncludes(guide, required);
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

describe("Guide: security-headers.md", () => {
  it("documents the policy the builder actually emits", async () => {
    const guide = await readGuide("security-headers.md");
    // The guide prints the default policy verbatim. Deriving the expectation
    // from the builder means the page cannot drift from what is served.
    for (const directive of buildCSP(false, "<generated>").split("; ")) {
      assertStringIncludes(guide, directive);
    }
  });

  it("documents that Google Fonts needs no config, and it actually does not", async () => {
    const guide = await readGuide("security-headers.md");
    assertStringIncludes(guide, "Google Fonts therefore works with no configuration");

    // The claim the guide now makes: a project that configures nothing can
    // still load what `veryfront/fonts` emits.
    const csp = buildCSP(false, "n", null);
    const directive = (name: string) =>
      csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

    assertStringIncludes(directive("style-src"), "https://fonts.googleapis.com");
    assertStringIncludes(directive("font-src"), "https://fonts.gstatic.com");
    assertStringIncludes(directive("script-src"), "'nonce-n'");
    assert(!csp.includes("style-src-elem"), "no directive shadows the documented style-src");
  });

  it("documents a third-party font service addition that actually admits it", async () => {
    const guide = await readGuide("security-headers.md");
    assertStringIncludes(guide, 'styleSrc: ["https://use.typekit.net"]');
    assertStringIncludes(guide, 'fontSrc: ["https://use.typekit.net"]');

    const csp = buildCSP(false, "n", {
      csp: {
        styleSrc: ["https://use.typekit.net"],
        fontSrc: ["https://use.typekit.net"],
      },
    });
    const directive = (name: string) =>
      csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

    assertStringIncludes(directive("style-src"), "https://use.typekit.net");
    assertStringIncludes(directive("font-src"), "https://use.typekit.net");
    // The guide promises the floor survives an addition.
    assertStringIncludes(directive("style-src"), "https://fonts.googleapis.com");
    assertStringIncludes(directive("script-src"), "'nonce-n'");
  });

  it("documents a null opt-out that keeps the required sources", async () => {
    const guide = await readGuide("security-headers.md");
    assertStringIncludes(guide, "styleSrc: null");

    const csp = buildCSP(false, "n", { csp: { styleSrc: null } });
    assertStringIncludes(csp, "style-src 'self';");
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
    assertExists(ChatInputContextProvider);
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

  it("gates the custom layout's empty state so it cannot outlive an empty thread", async () => {
    const guide = await readGuide("chat-ui.md");

    // `<Chat.Empty>` is prop-driven and never hides itself. A custom layout
    // that drops it straight into `<Chat.Root>` keeps the hero mounted under
    // an active conversation, so the sample must gate it on `ctx.isEmpty`.
    const layout = guide.slice(guide.indexOf("## Compose a custom layout"));
    const gate = layout.indexOf("<Chat.If condition={(ctx) => ctx.isEmpty}>");
    const empty = layout.indexOf("<Chat.Empty");
    assert(gate !== -1, "custom layout sample gates the empty state with <Chat.If>");
    assert(gate < empty, "the <Chat.If> gate wraps <Chat.Empty>");

    const chatComponents = Chat as unknown as Record<
      string,
      React.ComponentType<Record<string, unknown>>
    >;
    const Root = chatComponents.Root;
    const If = chatComponents.If;
    const Empty = chatComponents.Empty;
    const MessageList = chatComponents.MessageList;
    assertExists(Root);
    assertExists(If);
    assertExists(Empty);
    assertExists(MessageList);

    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "128 / 8?" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "128 / 8 = 16" }] },
    ];
    const layoutElement = (msgs: unknown[]) =>
      React.createElement(
        Root,
        { messages: msgs, input: "" },
        React.createElement(
          If,
          { condition: (ctx: { isEmpty: boolean }) => ctx.isEmpty },
          React.createElement(Empty, {
            title: "What can I help with?",
            suggestions: ["Explain React hooks", "Write a regex"],
          }),
        ),
        React.createElement(MessageList, { messages: msgs }),
      );

    const active = renderToString(layoutElement(messages));
    assertEquals(active.includes("What can I help with?"), false);
    assertEquals(active.includes("Explain React hooks"), false);
    assertStringIncludes(active, "128 / 8 = 16");

    const fresh = renderToString(layoutElement([]));
    assertStringIncludes(fresh, "What can I help with?");
    assertStringIncludes(fresh, "Explain React hooks");
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
    assertEquals(typeof useAttachments, "function");
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
    assertStringIncludes(guide, 'useAttachments({ url: "/api/uploads" })');
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
        "npx veryfront@latest deploy",
        "npx veryfront@latest deploy --branch feature-x --env staging",
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
    const pushCommand = "veryfront push --branch main --prune --force --yes";
    const stagingCommand = "veryfront deploy --branch main --env staging --yes";
    const productionCommand = "veryfront deploy --branch main --env production --yes";

    const dryRunArgs = parseCliArgs([
      "push",
      "--branch",
      "main",
      "--prune",
      "--force",
      "--dry-run",
    ]);
    const parsedDryRun = parsePushArgs(dryRunArgs);
    assert(parsedDryRun.success);
    assertEquals(parsedDryRun.data.branch, "main");
    assertEquals(parsedDryRun.data.prune, true);
    assertEquals(parsedDryRun.data.force, true);
    assertEquals(parsedDryRun.data.dryRun, true);

    const pushArgs = parseCliArgs([
      "push",
      "--branch",
      "main",
      "--prune",
      "--force",
      "--yes",
    ]);
    const parsedPush = parsePushArgs(pushArgs);
    assert(parsedPush.success);
    assertEquals(parsedPush.data.branch, "main");
    assertEquals(parsedPush.data.prune, true);
    assertEquals(parsedPush.data.force, true);
    assertEquals(pushArgs.yes, true);

    const deployArgs = parseCliArgs([
      "deploy",
      "--branch",
      "main",
      "--env",
      "staging",
      "--yes",
    ]);
    const parsedDeploy = parseDeployArgs(deployArgs);
    assert(parsedDeploy.success);
    assertEquals(parsedDeploy.data.branch, "main");
    assertEquals(parsedDeploy.data.env, "staging");
    assertEquals(deployArgs.yes, true);

    assert(
      guide.indexOf("veryfront push --branch main --prune --force --dry-run") <
        guide.indexOf(pushCommand),
    );
    assert(guide.indexOf(pushCommand) < guide.indexOf(stagingCommand));
    assert(guide.indexOf(stagingCommand) < guide.indexOf(productionCommand));
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
    assertStringIncludes(guide, "BASE_GIT_SHA");
    assertStringIncludes(guide, "gh pr create");
    assertStringIncludes(guide, "--base main");
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

  it("loads an exact-grant local integration source with named credentials", async () => {
    await withEnv({ [HOST_LOCAL_INTEGRATION_CREDENTIALS_ENV]: "1" }, async () => {
      const credentials = new Map([
        ["SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID", "client-id"],
        ["SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET", "client-secret"],
        [
          "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
          "https://acme.my.salesforce.com",
        ],
      ]);
      const source = createLocalIntegrationToolSource({
        tools: ["salesforce__find_customer"],
        credentialProvider: (name) => credentials.get(name),
      });

      const integrationTools = await loadRemoteToolsFromSource(source);

      assertEquals(Object.keys(integrationTools), ["salesforce__find_customer"]);
    });
  });
});

describe("Guide: integrations/salesforce.md", () => {
  it("uses the public local integration source and remote tool loader", () => {
    assertEquals(typeof createLocalIntegrationToolSource, "function");
    assertEquals(typeof loadRemoteToolsFromSource, "function");
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

describe("Guide: project-knowledge.md", () => {
  it("uses the public manifest and RAG helper contracts", async () => {
    const guide = await readGuide("project-knowledge.md");
    const knowledge = projectKnowledge({ projectDir: "." });
    const searchKnowledge = createSearchKnowledgeTool({
      id: "search_knowledge",
      description: "Search the project's reviewed support knowledge.",
    });

    assertEquals(typeof knowledge.lookup, "function");
    assertEquals(typeof knowledge.index, "function");
    assertEquals(typeof knowledge.retrieve, "function");
    assertEquals(typeof knowledge.search, "function");
    assertEquals(searchKnowledge.id, "search_knowledge");
    assertEquals(normalizeKnowledgeQuery("  SSO   recovery  "), "SSO recovery");
    assertStringIncludes(
      guide,
      'import { projectKnowledge } from "veryfront/knowledge"',
    );
    assertStringIncludes(guide, "page.mode");
    assertStringIncludes(guide, "page_info.next");
    assertStringIncludes(guide, "lookup_target");
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
      "npx veryfront@latest",
      "veryfront install --target agents",
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

  it("warns emitting projects about the inherited noEmit setting", async () => {
    const guide = await readGuide("installation.md");

    assertStringIncludes(guide, '"noEmit": true');
    assertStringIncludes(guide, "stops emitting");
    assertStringIncludes(guide, "./add-to-existing-project.md");
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

describe("Guide: add-to-existing-project.md", () => {
  it("documents the compiler options the scaffold actually sets", async () => {
    const guide = await readGuide("add-to-existing-project.md");

    // The page tells an existing-project reader to set by hand what the
    // scaffolded template already carries. If the template ever drops one of
    // these, the guidance is wrong and this fails.
    const template = await getTemplate("ai-agent");
    assertExists(template);
    const tsconfig = template.find((file) => file.path === "tsconfig.json");
    assertExists(tsconfig, "expected the ai-agent template to ship a tsconfig.json");

    for (const option of ['"jsx": "react-jsx"', '"skipLibCheck": true']) {
      assertStringIncludes(guide, option);
      assertStringIncludes(tsconfig.content, option);
    }
  });

  it("documents a package-exports-aware moduleResolution", async () => {
    const guide = await readGuide("add-to-existing-project.md");

    // Veryfront's entry points are subpath exports (`veryfront/agent`), which
    // the older `node`/`classic` modes cannot resolve. The scaffold sets
    // `bundler`; an adopting project must pick an equivalent mode or the
    // linked next steps fail to typecheck.
    assertStringIncludes(guide, '"moduleResolution": "bundler"');

    const template = await getTemplate("ai-agent");
    assertExists(template);
    const tsconfig = template.find((file) => file.path === "tsconfig.json");
    assertExists(tsconfig);
    assertStringIncludes(tsconfig.content.toLowerCase(), '"moduleresolution": "bundler"');
  });

  it("points at the base config the package actually publishes", async () => {
    const guide = await readGuide("add-to-existing-project.md");
    assertStringIncludes(guide, '"extends": "veryfront/tsconfig.json"');

    // The page's shortest path is extending the shipped config, so the npm
    // build must keep publishing it under that exact export key. Resolved from
    // import.meta.url, not the process cwd: test files share one process under
    // --parallel and a sibling isolate can hold `withCwd` while this runs.
    const dnt = await Deno.readTextFile(
      new URL("../../scripts/build/build-npm-dnt.ts", import.meta.url),
    );
    assertStringIncludes(dnt, './tsconfig.json"] = "./tsconfig.json"');
  });

  it("warns that the published base config disables emit", async () => {
    // The shipped `veryfront/tsconfig.json` sets `noEmit: true`. A host
    // project whose build is `tsc -p ...` keeps exiting 0 after switching to
    // `extends` but silently stops emitting to its outDir — the page must
    // steer emitting projects away from the extends route.
    const dnt = await Deno.readTextFile(
      new URL("../../scripts/build/build-npm-dnt.ts", import.meta.url),
    );
    assertStringIncludes(dnt, "noEmit: true");

    const guide = await readGuide("add-to-existing-project.md");
    assertStringIncludes(guide, '"noEmit": true');
    assertStringIncludes(guide, "stops emitting");
  });

  it("documents the install command and the entry route the server needs", async () => {
    const guide = await readGuide("add-to-existing-project.md");

    for (
      const snippet of [
        "npm install veryfront",
        "// app/page.tsx",
        "npx veryfront dev",
      ]
    ) {
      assertStringIncludes(guide, snippet);
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
  it("documents the focused Push, Deploy, and open sequence", async () => {
    const guide = await readGuide("deploy-project.md");

    for (
      const command of [
        "veryfront login",
        "npx veryfront@latest push",
        "npx veryfront@latest deploy",
        "veryfront open --site",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
    assertEquals(guide.includes("veryfront start"), false);
  });
});

describe("Guide: cloud-quickstart.md", () => {
  it("keeps the gateway tutorial on one runnable command sequence", async () => {
    const guide = await readGuide("cloud-quickstart.md");

    for (
      const command of [
        "npm create veryfront@latest support-agent -- --template ai-agent",
        "npx veryfront@latest login",
        "npx veryfront@latest push",
        "npm run dev",
        "npm run eval -- assistant",
        "npx veryfront@latest deploy --env production",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
  });
});

describe("Guide: self-hosting.md", () => {
  it("documents a complete container path without Cloud commands", async () => {
    const guide = await readGuide("self-hosting.md");

    for (
      const command of [
        "veryfront build",
        "veryfront serve",
        "FROM node:22-slim",
        "COPY package.json package-lock.json ./",
        "RUN npm ci",
        "RUN npm run build",
        'CMD ["npm", "start"]',
        "docker build -t veryfront-app .",
        "docker run --rm -p 3000:3000 --env-file .env veryfront-app",
      ]
    ) {
      assertStringIncludes(guide, command);
    }
    assertEquals(guide.includes("veryfront login"), false);
    assertEquals(guide.includes("FROM denoland/deno"), false);
  });
});

describe("Guide: cloud-environment-access.md", () => {
  it("probes a concrete route and documents both sign-in apexes", async () => {
    const guide = await readGuide("cloud-environment-access.md");

    assertStringIncludes(guide, "<environment-url>/<route>");
    assertStringIncludes(guide, "https://veryfront.com/sign-in");
    assertStringIncludes(guide, "https://veryfront.org/sign-in");
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
        'import { delay, doWhile, loop, map, step, times } from "veryfront/workflow"',
        'loop("refine", {',
        "while:",
        'doWhile("poll", {',
        "until:",
        'times("generate"',
        'map("process", {',
        "processor:",
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

  it("grades a stored dataset value without a target or adapters", async () => {
    const replyQualityEval = evalDataset({
      id: "eval:support-reply-quality",
      dataset: datasets.inline([
        {
          id: "billing-refund-reply",
          input: "Hello, I checked the duplicate charge and started a refund.",
          reference: "pass",
          metadata: { locale: "en" },
        },
      ]),
    });

    const report = await runEval(replyQualityEval, { adapters: {} });

    assertEquals(replyQualityEval.targetKind, "dataset");
    assertEquals(replyQualityEval.target, "eval:support-reply-quality");
    assertEquals(report.summary.records, 1);
    assertEquals(report.summary.failed, 0);
    assertEquals(
      report.records[0]?.output,
      "Hello, I checked the duplicate charge and started a refund.",
    );
  });
});
