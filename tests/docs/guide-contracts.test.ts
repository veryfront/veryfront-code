import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

interface GuideContract {
  references: string[];
  snippets: string[];
}

const GUIDE_DIRS = ["docs/getting-started", "docs/guides"] as const;

async function listPublishedGuideFiles(): Promise<string[]> {
  const guideFiles: string[] = [];
  for (const dir of GUIDE_DIRS) {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md") {
        guideFiles.push(entry.name);
      }
    }
  }
  return guideFiles.sort();
}

async function readPublishedGuide(filename: string): Promise<string> {
  for (const dir of GUIDE_DIRS) {
    try {
      return await Deno.readTextFile(`${dir}/${filename}`);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  throw new Error(`Guide not found: ${filename}`);
}

const GUIDE_CONTRACTS: Record<string, GuideContract> = {
  "agent-service-runtime.md": {
    references: ["../api-reference/veryfront/agent.md", "../api-reference/veryfront/channels.md"],
    snippets: ["startAgentService", "VERYFRONT_AGENT_SERVICE_URL", "/api/runs"],
  },
  "agents.md": {
    references: ["../api-reference/veryfront/agent.md"],
    snippets: ["createAgUiHandler", "load-skill-reference", "RunFinished"],
  },
  "api-routes.md": {
    references: ["../api-reference/veryfront/agent.md", "../api-reference/veryfront/middleware.md"],
    snippets: ["app/api/hello/route.ts", "pages/api/hello.ts", "ReadableStream"],
  },
  "chat-composition.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["Chat.MessageList", "Message.Root", "ChatWithSidebar"],
  },
  "chat-hooks.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["useChat", "useAgent", "useCompletion"],
  },
  "chat-theming.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["theme", "attachments", "Context providers"],
  },
  "chat-ui.md": {
    references: [
      "../api-reference/veryfront/chat.md",
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/markdown.md",
    ],
    snippets: ["Chat", "useChat", "createAgUiHandler"],
  },
  "cli-knowledge-ingestion.md": {
    references: ["../api-reference/veryfront/cli.md"],
    snippets: ["knowledge_ingest", "jq '.ingested'", "veryfront knowledge ingest"],
  },
  "coding-agents.md": {
    references: [
      "../api-reference/veryfront/mcp.md",
      "../api-reference/veryfront/cli.md",
    ],
    snippets: [
      "veryfront mcp",
      "veryfront dev",
      "mcpServers",
      "~/.claude.json",
      "vf_get_errors",
      "vf_scaffold",
      "tools/list",
    ],
  },
  "choose-a-primitive.md": {
    references: [
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/tool.md",
      "../api-reference/veryfront/workflow.md",
      "../api-reference/veryfront/jobs.md",
      "../api-reference/veryfront/integrations.md",
      "../api-reference/veryfront/mcp.md",
      "../api-reference/veryfront/sandbox.md",
      "../api-reference/veryfront/extensions.md",
    ],
    snippets: ["Agent", "Tool", "Workflow", "Task", "Job", "Integration", "MCP", "Sandbox"],
  },
  "production-path.md": {
    references: [
      "../getting-started/create-a-project.md",
      "./choose-a-primitive.md",
      "./pages-and-routing.md",
      "./api-routes.md",
      "./deploying.md",
      "../api-reference/veryfront/index.md",
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
  "quickstart.md": {
    references: [
      "./installation.md",
      "../guides/providers.md",
      "../guides/agents.md",
      "../guides/tools.md",
      "../guides/chat-ui.md",
      "./deploy-a-project.md",
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/tool.md",
      "../api-reference/veryfront/chat.md",
    ],
    snippets: [
      "veryfront init support-agent --template ai-agent",
      "tools/get-weather.ts",
      "tools: { getWeather: true }",
      "maxSteps: 5",
      'createAgUiHandler("assistant")',
      'useChat({ api: "/api/ag-ui" })',
      "veryfront build",
      "veryfront deploy",
    ],
  },
  "configuration.md": {
    references: ["../api-reference/veryfront/index.md"],
    snippets: ["defineConfig", "VERYFRONT_API_TOKEN", "getEnv"],
  },
  "data-fetching.md": {
    references: ["../api-reference/veryfront/index.md"],
    snippets: ["getServerData", "getStaticData", "redirect"],
  },
  "deploying.md": {
    references: [
      "../api-reference/veryfront/index.md",
      "../api-reference/veryfront/server.md",
      "../api-reference/veryfront/observability.md",
      "../api-reference/veryfront/utils.md",
    ],
    snippets: ["veryfront build", "veryfront start", "veryfront deploy", "veryfront open"],
  },
  "extension-authoring.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["veryfront extension init", "ExtensionFactory", "capabilities"],
  },
  "extension-lifecycle.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["setup", "teardown", "veryfront.config.ts"],
  },
  "extension-publishing.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["veryfront.extension", "deno add", "semver"],
  },
  "extension-testing.md": {
    references: ["../api-reference/veryfront/testing.md"],
    snippets: ["ExtensionLoader", "tryResolve", "deno test"],
  },
  "extensions.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["defineConfig", "extRedis", "First-party extension areas"],
  },
  "head-and-seo.md": {
    references: [
      "../api-reference/veryfront/head.md",
      "../api-reference/veryfront/fonts.md",
      "../api-reference/veryfront/context.md",
    ],
    snippets: ["Head", "GoogleFonts", "JSON-LD"],
  },
  "index.md": {
    references: [],
    snippets: [
      "Veryfront Code",
      "Prerequisite knowledge",
      "How to use these guides",
      "Installation",
      "TypeScript",
      "React",
    ],
  },
  "veryfront-code.md": {
    references: [],
    snippets: [
      "Why Veryfront Code",
      "Agents",
      "Tools",
      "Workflows",
      "Pages & Routing",
      "Getting Started",
      "Foundations",
      "AI primitives",
      "Chat UI",
      "Orchestration",
      "External systems",
      "Extensions",
      "Ship to production",
    ],
  },
  "integrations.md": {
    references: ["../api-reference/veryfront/integrations.md"],
    snippets: ["integrations", "perUser", "Available integrations"],
  },
  "jobs.md": {
    references: ["../api-reference/veryfront/jobs.md"],
    snippets: ["createJobsClient", "task:knowledge-ingest", "jobs.targets.list"],
  },
  "mcp-server.md": {
    references: [
      "../api-reference/veryfront/mcp.md",
      "../api-reference/veryfront/tool.md",
      "../api-reference/veryfront/prompt.md",
      "../api-reference/veryfront/resource.md",
    ],
    snippets: ["createMCPServer", "MCP-Session-Id", "tools/list"],
  },
  "memory-and-streaming.md": {
    references: ["../api-reference/veryfront/agent.md", "../api-reference/veryfront/chat.md"],
    snippets: ["memory", "createAgUiHandler", "useChat"],
  },
  "middleware.md": {
    references: ["../api-reference/veryfront/middleware.md"],
    snippets: ["MiddlewarePipeline", "Authorization", "401"],
  },
  "multi-agent.md": {
    references: ["../api-reference/veryfront/agent.md", "../api-reference/veryfront/workflow.md"],
    snippets: ["agentAsTool", "getAgentsAsTools", "workflow"],
  },
  "oauth.md": {
    references: ["../api-reference/veryfront/oauth.md"],
    snippets: ["createOAuthInitHandler", "getTokens", "OAuthService"],
  },
  "pages-and-routing.md": {
    references: [
      "../api-reference/veryfront/router.md",
      "../api-reference/veryfront/context.md",
      "../api-reference/veryfront/mdx.md",
    ],
    snippets: ["app router", "useRouter", "Link"],
  },
  "project-structure.md": {
    references: ["../api-reference/veryfront/index.md"],
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
    references: [
      "../guides/agents.md",
      "../guides/api-routes.md",
      "../guides/tools.md",
      "../guides/chat-ui.md",
      "./installation.md",
      "./create-a-project.md",
      "../guides/providers.md",
      "../guides/memory-and-streaming.md",
    ],
    snippets: [
      "agents/assistant.ts",
      'import { agent } from "veryfront/agent"',
      'createAgUiHandler("assistant")',
      'getAgent("assistant")',
      "assistant.generate({ input: question })",
      "curl -N -X POST",
      "/api/ag-ui",
      "message-start",
      "message-finish",
      "veryfront dev",
    ],
  },
  "providers.md": {
    references: [
      "../api-reference/veryfront/provider.md",
      "../api-reference/veryfront/embedding.md",
    ],
    snippets: ["provider/model", "OPENAI_API_KEY", "registerModelProvider"],
  },
  "create-a-project.md": {
    references: ["./installation.md", "./create-an-agent.md"],
    snippets: ["veryfront init test-app", "veryfront dev", "ai-agent", "minimal"],
  },
  "create-an-api.md": {
    references: ["./create-a-project.md", "./create-a-frontend.md", "../guides/api-routes.md"],
    snippets: [
      "app/api/hello/route.ts",
      "Response.json",
      "export function GET()",
      "curl http://localhost:3000/api/hello",
    ],
  },
  "create-a-frontend.md": {
    references: [
      "./create-a-project.md",
      "./deploy-a-project.md",
      "../guides/pages-and-routing.md",
    ],
    snippets: [
      "app/about/page.tsx",
      "export default function About",
      'import { Link } from "veryfront/router"',
      '<Link href="/about">',
    ],
  },
  "deploy-a-project.md": {
    references: [
      "./create-a-project.md",
      "../guides/configuration.md",
      "../api-reference/veryfront/index.md",
    ],
    snippets: ["veryfront build", "veryfront start", "veryfront deploy", "veryfront open"],
  },
  "sandbox.md": {
    references: ["../api-reference/veryfront/sandbox.md", "../api-reference/veryfront/fs.md"],
    snippets: ["Sandbox.create", "executeCommand", "sandbox.close"],
  },
  "skills.md": {
    references: ["../api-reference/veryfront/agent.md"],
    snippets: ["SKILL.md", "allowed_tools", "veryfront skills validate"],
  },
  "tasks.md": {
    references: ["../api-reference/veryfront/jobs.md"],
    snippets: ["veryfront task sync-data", "schedulable", "VeryfrontJobsClient"],
  },
  "tools.md": {
    references: ["../api-reference/veryfront/tool.md"],
    snippets: ["tool", "inputSchema", "toolRegistry"],
  },
  "workflows.md": {
    references: ["../api-reference/veryfront/workflow.md"],
    snippets: ["workflow", "parallel", "waitForApproval"],
  },
  "workflows-advanced.md": {
    references: ["../api-reference/veryfront/workflow.md"],
    snippets: ["loop", "doWhile", "blobStorage", "useWorkflow", "useWorkflowStart"],
  },
};

describe("published guide contracts", () => {
  it("has one contract for every published guide", async () => {
    const guideFiles = await listPublishedGuideFiles();
    assertEquals(Object.keys(GUIDE_CONTRACTS).sort(), guideFiles);
  });

  for (const [filename, contract] of Object.entries(GUIDE_CONTRACTS)) {
    it(`${filename} keeps its guide contract`, async () => {
      const guide = await readPublishedGuide(filename);

      for (const reference of contract.references) {
        assertStringIncludes(guide, reference);
      }
      for (const snippet of contract.snippets) {
        assertStringIncludes(guide, snippet);
      }

      if (filename !== "index.md" && filename !== "veryfront-code.md") {
        assertStringIncludes(guide, "## Verify it worked");
      }
    });
  }
});
