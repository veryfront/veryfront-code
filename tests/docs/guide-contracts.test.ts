import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

interface GuideContract {
  references: string[];
  snippets: string[];
}

const PUBLIC_DOC_DIRS = ["getting-started", "guides", "concepts"] as const;
const CONCEPT_FILES = new Set<string>([
  "concepts/index.md",
  "concepts/framework-overview.md",
  "concepts/framework-primitives.md",
  "concepts/framework-conventions.md",
  "concepts/agent.md",
  "concepts/tool.md",
  "concepts/workflow.md",
  "concepts/task.md",
  "concepts/job.md",
  "concepts/cron-job.md",
  "concepts/integration.md",
  "concepts/mcp-server.md",
  "concepts/sandbox.md",
  "concepts/framework-extensions.md",
]);

async function listPublishedGuideFiles(): Promise<string[]> {
  const guideFiles: string[] = [];
  for (const dir of PUBLIC_DOC_DIRS) {
    for await (const entry of Deno.readDir(`docs/${dir}`)) {
      if (
        entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md"
      ) {
        guideFiles.push(`${dir}/${entry.name}`);
      }
    }
  }
  return guideFiles.sort();
}

async function readPublishedGuide(path: string): Promise<string> {
  return await Deno.readTextFile(`docs/${path}`);
}

const GUIDE_CONTRACTS: Record<string, GuideContract> = {
  "guides/agent-service-runtime.md": {
    references: [
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/channels.md",
    ],
    snippets: ["startAgentService", "VERYFRONT_AGENT_SERVICE_URL", "/api/runs"],
  },
  "guides/agents.md": {
    references: ["../api-reference/veryfront/agent.md"],
    snippets: ["createAgUiHandler", "load-skill-reference", "RunFinished"],
  },
  "guides/api-routes.md": {
    references: [
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/middleware.md",
    ],
    snippets: [
      "app/api/hello/route.ts",
      "pages/api/hello.ts",
      "ReadableStream",
    ],
  },
  "guides/chat-composition.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["Chat.MessageList", "Message.Root", "ChatWithSidebar"],
  },
  "guides/chat-hooks.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["useChat", "useAgent", "useCompletion"],
  },
  "guides/chat-theming.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["theme", "attachments", "Context providers"],
  },
  "guides/chat-ui.md": {
    references: [
      "../api-reference/veryfront/chat.md",
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/markdown.md",
    ],
    snippets: ["Chat", "useChat", "createAgUiHandler"],
  },
  "guides/cli-knowledge-ingestion.md": {
    references: ["../api-reference/veryfront/cli.md"],
    snippets: [
      "knowledge_ingest",
      "jq '.ingested'",
      "veryfront knowledge ingest",
    ],
  },
  "guides/coding-agents.md": {
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
  "guides/choose-a-primitive.md": {
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
    snippets: [
      "Agent",
      "Tool",
      "Workflow",
      "Task",
      "Job",
      "Integration",
      "MCP",
      "Sandbox",
    ],
  },
  "guides/production-path.md": {
    references: [
      "../getting-started/create-project.md",
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
  "getting-started/quickstart.md": {
    references: [
      "./installation.md",
      "../guides/providers.md",
      "./create-project.md",
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/tool.md",
      "../api-reference/veryfront/chat.md",
    ],
    snippets: [
      "veryfront init support-agent --template ai-agent",
      "calculator.ts",
      "What is 128 divided by 8?",
      "curl -N -X POST",
    ],
  },
  "guides/configuration.md": {
    references: ["../api-reference/veryfront/index.md"],
    snippets: ["defineConfig", "VERYFRONT_API_TOKEN", "getEnv"],
  },
  "guides/data-fetching.md": {
    references: ["../api-reference/veryfront/index.md"],
    snippets: ["getServerData", "getStaticData", "redirect"],
  },
  "guides/deploying.md": {
    references: [
      "../api-reference/veryfront/index.md",
      "../api-reference/veryfront/server.md",
      "../api-reference/veryfront/observability.md",
      "../api-reference/veryfront/utils.md",
    ],
    snippets: [
      "veryfront build",
      "veryfront start",
      "veryfront deploy",
      "veryfront open",
    ],
  },
  "guides/extension-authoring.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["veryfront extension init", "ExtensionFactory", "capabilities"],
  },
  "guides/extension-lifecycle.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["setup", "teardown", "veryfront.config.ts"],
  },
  "guides/extension-publishing.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["veryfront.extension", "deno add", "semver"],
  },
  "guides/extension-testing.md": {
    references: ["../api-reference/veryfront/testing.md"],
    snippets: ["ExtensionLoader", "tryResolve", "deno test"],
  },
  "guides/extensions.md": {
    references: ["../api-reference/veryfront/extensions.md"],
    snippets: ["defineConfig", "extRedis", "First-party extension areas"],
  },
  "guides/head-and-seo.md": {
    references: [
      "../api-reference/veryfront/head.md",
      "../api-reference/veryfront/fonts.md",
      "../api-reference/veryfront/context.md",
    ],
    snippets: ["Head", "GoogleFonts", "JSON-LD"],
  },
  "getting-started/index.md": {
    references: [],
    snippets: [
      "Veryfront app",
      "Getting started",
      "Contents",
      "Before you start",
      "Installation",
      "TypeScript",
      "React",
    ],
  },
  "concepts/framework-overview.md": {
    references: [],
    snippets: [
      "Agents",
      "tools",
      "Workflows",
      "Primitive set",
    ],
  },
  "guides/index.md": {
    references: [],
    snippets: [
      "Guides help you complete specific work",
      "Contents",
      "Configuration",
      "Pages and routing",
      "Workflows",
      "Extensions",
      "Building and deploying",
    ],
  },
  "concepts/index.md": {
    references: [],
    snippets: [
      "How Veryfront framework primitives",
      "Use this section when you need context",
      "Framework primitives",
      "Framework conventions",
      "Framework extensions",
    ],
  },
  "concepts/framework-primitives.md": {
    references: [
      "../guides/choose-a-primitive.md",
      "../api-reference/veryfront/agent.md",
    ],
    snippets: [
      "Agent",
      "Tool",
      "Workflow",
      "Task",
      "Job",
      "Cron job",
      "MCP server",
      "Ownership boundaries",
    ],
  },
  "concepts/framework-conventions.md": {
    references: [
      "../guides/project-structure.md",
      "../api-reference/veryfront/index.md",
    ],
    snippets: [
      "Directory roles",
      "Discovery model",
      "agents/",
      "tools/",
    ],
  },
  "concepts/agent.md": {
    references: [
      "../guides/agents.md",
      "../api-reference/veryfront/agent.md",
    ],
    snippets: ["model reasoning", "tools", "AG-UI"],
  },
  "concepts/tool.md": {
    references: [
      "../guides/tools.md",
      "../api-reference/veryfront/tool.md",
    ],
    snippets: ["callable capability", "input", "output"],
  },
  "concepts/workflow.md": {
    references: [
      "../guides/workflows.md",
      "../api-reference/veryfront/workflow.md",
    ],
    snippets: ["multi-step coordination", "durable state", "steps"],
  },
  "concepts/task.md": {
    references: [
      "../guides/tasks.md",
      "../api-reference/veryfront/jobs.md",
    ],
    snippets: ["background work", "target", "job"],
  },
  "concepts/job.md": {
    references: [
      "../guides/jobs.md",
      "../api-reference/veryfront/jobs.md",
    ],
    snippets: ["durable execution", "status", "events"],
  },
  "concepts/cron-job.md": {
    references: [
      "../guides/jobs.md",
      "../api-reference/veryfront/jobs.md",
    ],
    snippets: ["schedule", "job runs", "trigger"],
  },
  "concepts/integration.md": {
    references: [
      "../guides/integrations.md",
      "../api-reference/veryfront/integrations.md",
    ],
    snippets: ["connector metadata", "auth", "remote tool"],
  },
  "concepts/mcp-server.md": {
    references: [
      "../guides/mcp-server.md",
      "../api-reference/veryfront/mcp.md",
    ],
    snippets: ["assistant-facing", "tools", "prompts"],
  },
  "concepts/sandbox.md": {
    references: [
      "../guides/sandbox.md",
      "../api-reference/veryfront/sandbox.md",
    ],
    snippets: ["isolated command", "file execution", "host process"],
  },
  "concepts/framework-extensions.md": {
    references: [
      "../guides/extensions.md",
      "../guides/extension-authoring.md",
      "../guides/extension-lifecycle.md",
      "../api-reference/veryfront/extensions.md",
    ],
    snippets: ["Core concepts", "Lifecycle", "Contract", "Capability"],
  },
  "guides/integrations.md": {
    references: ["../api-reference/veryfront/integrations.md"],
    snippets: ["integrations", "perUser", "Available integrations"],
  },
  "guides/jobs.md": {
    references: ["../api-reference/veryfront/jobs.md"],
    snippets: [
      "createJobsClient",
      "task:knowledge-ingest",
      "jobs.targets.list",
    ],
  },
  "guides/mcp-server.md": {
    references: [
      "../api-reference/veryfront/mcp.md",
      "../api-reference/veryfront/tool.md",
      "../api-reference/veryfront/prompt.md",
      "../api-reference/veryfront/resource.md",
    ],
    snippets: ["createMCPServer", "MCP-Session-Id", "tools/list"],
  },
  "guides/memory-and-streaming.md": {
    references: [
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/chat.md",
    ],
    snippets: ["memory", "createAgUiHandler", "useChat"],
  },
  "guides/middleware.md": {
    references: ["../api-reference/veryfront/middleware.md"],
    snippets: ["MiddlewarePipeline", "Authorization", "401"],
  },
  "guides/multi-agent.md": {
    references: [
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/workflow.md",
    ],
    snippets: ["agentAsTool", "getAgentsAsTools", "workflow"],
  },
  "guides/oauth.md": {
    references: ["../api-reference/veryfront/oauth.md"],
    snippets: ["createOAuthInitHandler", "getTokens", "OAuthService"],
  },
  "guides/pages-and-routing.md": {
    references: [
      "../api-reference/veryfront/router.md",
      "../api-reference/veryfront/context.md",
      "../api-reference/veryfront/mdx.md",
    ],
    snippets: ["app router", "useRouter", "Link"],
  },
  "guides/project-structure.md": {
    references: ["../api-reference/veryfront/index.md"],
    snippets: ["app/", "agents/", "tools/"],
  },
  "getting-started/installation.md": {
    references: [],
    snippets: [
      "npm install veryfront",
      "deno add npm:veryfront",
      "brew install veryfront/tap/veryfront",
      "veryfront.com/install.sh",
      "veryfront.com/install.ps1",
    ],
  },
  "getting-started/create-agent.md": {
    references: [
      "./installation.md",
      "./create-project.md",
      "./create-api.md",
    ],
    snippets: [
      "agents/assistant.ts",
      'import { agent } from "veryfront/agent"',
      "Define the agent",
    ],
  },
  "guides/providers.md": {
    references: [
      "../api-reference/veryfront/provider.md",
      "../api-reference/veryfront/embedding.md",
    ],
    snippets: ["provider/model", "OPENAI_API_KEY", "registerModelProvider"],
  },
  "getting-started/create-project.md": {
    references: ["./installation.md", "./create-agent.md"],
    snippets: [
      "veryfront init test-app",
      "npm create veryfront",
      "deno init --npm veryfront",
      "veryfront dev",
      "ai-agent",
      "minimal",
    ],
  },
  "getting-started/create-api.md": {
    references: [
      "./create-agent.md",
      "../guides/providers.md",
      "../guides/api-routes.md",
    ],
    snippets: [
      "app/api/ag-ui/route.ts",
      'createAgUiHandler("assistant")',
      "curl -N -X POST",
      "/api/ag-ui",
      "data:` lines",
      "veryfront dev",
    ],
  },
  "getting-started/create-frontend.md": {
    references: [
      "./create-api.md",
      "../guides/chat-ui.md",
    ],
    snippets: [
      "app/page.tsx",
      'import { Chat, useChat } from "veryfront/chat"',
      "useChat()",
      "<Chat",
    ],
  },
  "getting-started/deploy-project.md": {
    references: [
      "./create-project.md",
      "../guides/configuration.md",
      "../api-reference/veryfront/index.md",
    ],
    snippets: [
      "veryfront build",
      "veryfront start",
      "veryfront deploy",
      "veryfront open",
    ],
  },
  "guides/sandbox.md": {
    references: [
      "../api-reference/veryfront/sandbox.md",
      "../api-reference/veryfront/fs.md",
    ],
    snippets: ["Sandbox.create", "executeCommand", "sandbox.close"],
  },
  "guides/skills.md": {
    references: ["../api-reference/veryfront/agent.md"],
    snippets: ["SKILL.md", "allowed_tools", "veryfront skills validate"],
  },
  "guides/tasks.md": {
    references: ["../api-reference/veryfront/jobs.md"],
    snippets: [
      "veryfront task sync-data",
      "schedulable",
      "VeryfrontJobsClient",
    ],
  },
  "guides/tools.md": {
    references: ["../api-reference/veryfront/tool.md"],
    snippets: ["tool", "inputSchema", "toolRegistry"],
  },
  "guides/workflows.md": {
    references: ["../api-reference/veryfront/workflow.md"],
    snippets: ["workflow", "parallel", "waitForApproval"],
  },
  "guides/workflows-advanced.md": {
    references: ["../api-reference/veryfront/workflow.md"],
    snippets: [
      "loop",
      "doWhile",
      "blobStorage",
      "useWorkflow",
      "useWorkflowStart",
    ],
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

      // Link validity is covered by scripts/lint/check-doc-links.ts. Keep
      // these contracts focused on each page's core content.
      for (const snippet of contract.snippets) {
        assertStringIncludes(guide, snippet);
      }

      if (
        !CONCEPT_FILES.has(filename) &&
        filename !== "getting-started/index.md" &&
        filename !== "guides/index.md"
      ) {
        assertStringIncludes(guide, "## Verify it worked");
      }
    });
  }
});
