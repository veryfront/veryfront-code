import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

interface GuideContract {
  references: string[];
  snippets: string[];
}

const GUIDE_CONTRACTS: Record<string, GuideContract> = {
  "agent-service-runtime.md": {
    references: ["../reference/veryfront/agent.md", "../reference/veryfront/channels.md"],
    snippets: ["startAgentService", "VERYFRONT_AGENT_SERVICE_URL", "/api/runs"],
  },
  "agents.md": {
    references: ["../reference/veryfront/agent.md"],
    snippets: ["createAgUiHandler", "load-skill-reference", "RunFinished"],
  },
  "api-routes.md": {
    references: ["../reference/veryfront/agent.md", "../reference/veryfront/middleware.md"],
    snippets: ["app/api/hello/route.ts", "pages/api/hello.ts", "ReadableStream"],
  },
  "chat-composition.md": {
    references: ["../reference/veryfront/chat.md"],
    snippets: ["Chat.MessageList", "Message.Root", "ChatWithSidebar"],
  },
  "chat-hooks.md": {
    references: ["../reference/veryfront/chat.md"],
    snippets: ["useChat", "useAgent", "useCompletion"],
  },
  "chat-theming.md": {
    references: ["../reference/veryfront/chat.md"],
    snippets: ["theme", "attachments", "Context providers"],
  },
  "chat-ui.md": {
    references: [
      "../reference/veryfront/chat.md",
      "../reference/veryfront/agent.md",
      "../reference/veryfront/markdown.md",
    ],
    snippets: ["Chat", "useChat", "createAgUiHandler"],
  },
  "cli-knowledge-ingestion.md": {
    references: ["../reference/veryfront/cli.md"],
    snippets: ["knowledge_ingest", "jq '.ingested'", "veryfront knowledge ingest"],
  },
  "choose-a-primitive.md": {
    references: [
      "../reference/veryfront/agent.md",
      "../reference/veryfront/tool.md",
      "../reference/veryfront/workflow.md",
      "../reference/veryfront/jobs.md",
      "../reference/veryfront/integrations.md",
      "../reference/veryfront/mcp.md",
      "../reference/veryfront/sandbox.md",
      "../reference/veryfront/extensions.md",
    ],
    snippets: ["Agent", "Tool", "Workflow", "Task", "Job", "Integration", "MCP", "Sandbox"],
  },
  "production-path.md": {
    references: [
      "./quickstart.md",
      "./choose-a-primitive.md",
      "./pages-and-routing.md",
      "./api-routes.md",
      "./deploying.md",
      "../reference/veryfront/index.md",
    ],
    snippets: [
      "veryfront init",
      "veryfront dev",
      "veryfront build",
      "veryfront start",
      "veryfront deploy",
      "veryfront open",
      "production path",
    ],
  },
  "configuration.md": {
    references: ["../reference/veryfront/index.md"],
    snippets: ["defineConfig", "VERYFRONT_API_TOKEN", "getEnv"],
  },
  "data-fetching.md": {
    references: ["../reference/veryfront/index.md"],
    snippets: ["getServerData", "getStaticData", "redirect"],
  },
  "deploying.md": {
    references: [
      "../reference/veryfront/index.md",
      "../reference/veryfront/server.md",
      "../reference/veryfront/observability.md",
      "../reference/veryfront/utils.md",
    ],
    snippets: ["veryfront build", "veryfront start", "veryfront deploy", "veryfront open"],
  },
  "extension-authoring.md": {
    references: ["../reference/veryfront/extensions.md"],
    snippets: ["veryfront extension init", "ExtensionFactory", "capabilities"],
  },
  "extension-lifecycle.md": {
    references: ["../reference/veryfront/extensions.md"],
    snippets: ["setup", "teardown", "veryfront.config.ts"],
  },
  "extension-publishing.md": {
    references: ["../reference/veryfront/extensions.md"],
    snippets: ["veryfront.extension", "deno add", "semver"],
  },
  "extension-testing.md": {
    references: ["../reference/veryfront/testing.md"],
    snippets: ["ExtensionLoader", "tryResolve", "deno test"],
  },
  "extensions.md": {
    references: ["../reference/veryfront/extensions.md"],
    snippets: ["defineConfig", "extRedis", "First-party extension areas"],
  },
  "head-and-seo.md": {
    references: [
      "../reference/veryfront/head.md",
      "../reference/veryfront/fonts.md",
      "../reference/veryfront/context.md",
    ],
    snippets: ["Head", "GoogleFonts", "JSON-LD"],
  },
  "index.md": {
    references: [],
    snippets: [
      "Quickstart",
      "Choose a primitive",
      "Production path",
      "Build pages and APIs",
      "Ship to production",
    ],
  },
  "integrations.md": {
    references: ["../reference/veryfront/integrations.md"],
    snippets: ["integrations", "perUser", "Available integrations"],
  },
  "jobs.md": {
    references: ["../reference/veryfront/jobs.md"],
    snippets: ["createJobsClient", "task:knowledge-ingest", "jobs.targets.list"],
  },
  "mcp-server.md": {
    references: [
      "../reference/veryfront/mcp.md",
      "../reference/veryfront/tool.md",
      "../reference/veryfront/prompt.md",
      "../reference/veryfront/resource.md",
    ],
    snippets: ["createMCPServer", "MCP-Session-Id", "tools/list"],
  },
  "memory-and-streaming.md": {
    references: ["../reference/veryfront/agent.md", "../reference/veryfront/chat.md"],
    snippets: ["memory", "createAgUiHandler", "useChat"],
  },
  "middleware.md": {
    references: ["../reference/veryfront/middleware.md"],
    snippets: ["MiddlewarePipeline", "Authorization", "401"],
  },
  "multi-agent.md": {
    references: ["../reference/veryfront/agent.md", "../reference/veryfront/workflow.md"],
    snippets: ["agentAsTool", "getAgentsAsTools", "workflow"],
  },
  "oauth.md": {
    references: ["../reference/veryfront/oauth.md"],
    snippets: ["createOAuthInitHandler", "getTokens", "OAuthService"],
  },
  "pages-and-routing.md": {
    references: [
      "../reference/veryfront/router.md",
      "../reference/veryfront/context.md",
      "../reference/veryfront/mdx.md",
    ],
    snippets: ["app router", "useRouter", "Link"],
  },
  "project-structure.md": {
    references: ["../reference/veryfront/index.md"],
    snippets: ["app/", "agents/", "tools/"],
  },
  "installation.md": {
    references: [],
    snippets: [
      "npm create veryfront",
      "brew install veryfront/tap/veryfront",
      "veryfront.com/install.sh",
      "veryfront.com/install.ps1",
    ],
  },
  "create-an-agent.md": {
    references: ["./agents.md", "./tools.md", "./chat-ui.md", "./installation.md", "./quickstart.md", "./providers.md", "./memory-and-streaming.md"],
    snippets: [
      "agents/assistant.ts",
      "import { agent } from \"veryfront/agent\"",
      "getAgent(\"assistant\")",
      "assistant.generate({ input: question })",
      "veryfront dev",
    ],
  },
  "providers.md": {
    references: ["../reference/veryfront/provider.md", "../reference/veryfront/embedding.md"],
    snippets: ["provider/model", "OPENAI_API_KEY", "registerModelProvider"],
  },
  "quickstart.md": {
    references: [],
    snippets: ["veryfront init", "veryfront dev", "veryfront build"],
  },
  "sandbox.md": {
    references: ["../reference/veryfront/sandbox.md", "../reference/veryfront/fs.md"],
    snippets: ["Sandbox.create", "executeCommand", "sandbox.close"],
  },
  "skills.md": {
    references: ["../reference/veryfront/agent.md"],
    snippets: ["SKILL.md", "allowed_tools", "veryfront skills validate"],
  },
  "tasks.md": {
    references: ["../reference/veryfront/jobs.md"],
    snippets: ["veryfront task sync-data", "schedulable", "VeryfrontJobsClient"],
  },
  "tools.md": {
    references: ["../reference/veryfront/tool.md"],
    snippets: ["tool", "inputSchema", "toolRegistry"],
  },
  "workflows.md": {
    references: ["../reference/veryfront/workflow.md"],
    snippets: ["workflow", "parallel", "waitForApproval"],
  },
};

describe("published guide contracts", () => {
  it("has one contract for every published guide", async () => {
    const guideFiles: string[] = [];
    for await (const entry of Deno.readDir("docs/guides")) {
      if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
        guideFiles.push(entry.name);
      }
    }
    guideFiles.sort();

    assertEquals(Object.keys(GUIDE_CONTRACTS).sort(), guideFiles);
  });

  for (const [filename, contract] of Object.entries(GUIDE_CONTRACTS)) {
    it(`${filename} keeps its guide contract`, async () => {
      const guide = await Deno.readTextFile(`docs/guides/${filename}`);

      for (const reference of contract.references) {
        assertStringIncludes(guide, reference);
      }
      for (const snippet of contract.snippets) {
        assertStringIncludes(guide, snippet);
      }

      if (filename !== "index.md") {
        assertStringIncludes(guide, "## Verify it worked");
      }
    });
  }
});
