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
  "concepts/app.md",
  "concepts/agent.md",
  "concepts/tool.md",
  "concepts/workflow.md",
  "concepts/task.md",
  "concepts/job.md",
  "concepts/cron-job.md",
  "concepts/prompt.md",
  "concepts/resource.md",
  "concepts/skill.md",
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
  "guides/build-a-rag-app.md": {
    references: [
      "../api-reference/veryfront/embedding.md",
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/chat.md",
    ],
    snippets: [
      "ragStore",
      "createUploadHandler",
      "../../../store.ts",
      "../../../../store.ts",
      "app/api/ingest/route.ts",
      "indexContentDir",
      "createAgUiHandler",
      "beforeStream",
      "useUploads",
      ".veryfront/rag/uploads/",
      "DocumentExtractor",
      "XLS, XLSX",
      "OCR is not a separate step.",
      "chunkOptions",
      "AI Gateway",
      "VERYFRONT_DEFAULT_EMBEDDING_MODEL",
    ],
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
  "guides/chat-hooks.md": {
    references: ["../api-reference/veryfront/chat.md"],
    snippets: ["useChat", "useAgent", "useCompletion"],
  },
  "guides/chat-ui.md": {
    references: [
      "../api-reference/veryfront/chat.md",
      "../api-reference/veryfront/agent.md",
      "../api-reference/veryfront/markdown.md",
    ],
    snippets: [
      "Chat",
      "useChat",
      "createAgUiHandler",
      "Chat.MessageList",
      "Message.Root",
      "ChatWithSidebar",
      "theme",
      "attachments",
      "chat context providers",
    ],
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
      "Pick one production path",
      "veryfront build",
      "veryfront serve",
      "veryfront deploy",
      "veryfront open",
    ],
  },
  "guides/extension-authoring.md": {
    references: [
      "../api-reference/veryfront/extensions.md",
      "../api-reference/veryfront/testing.md",
    ],
    snippets: [
      "veryfront extension init",
      "ExtensionFactory",
      "capabilities",
      "ExtensionLoader",
      "tryResolve",
      "veryfront.extension",
      "deno add",
      "setup()",
      "teardown()",
    ],
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
      "Coding agents",
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
      "Main surfaces",
    ],
  },
  "guides/index.md": {
    references: [],
    snippets: [
      "Guides are recipes for specific goals",
      "Start a project",
      "Build routes",
      "Add AI behavior",
      "Run background work",
      "Connect external systems",
      "Configuration",
      "Workflows",
      "Extensions",
      "Build and deploy",
    ],
  },
  "concepts/index.md": {
    references: [],
    snippets: [
      "How Veryfront framework primitives",
      "Concepts explain how Veryfront Code is organized",
      "Framework primitives",
      "Framework conventions",
      "Framework extensions",
      "Skill",
    ],
  },
  "concepts/framework-primitives.md": {
    references: [
      "../guides/choose-a-primitive.md",
      "../api-reference/veryfront/agent.md",
    ],
    snippets: [
      "App",
      "Agent",
      "Tool",
      "Workflow",
      "Task",
      "Job",
      "Cron job",
      "Prompt",
      "Resource",
      "Skill",
      "MCP server",
      "How primitives combine",
    ],
  },
  "concepts/framework-conventions.md": {
    references: [
      "../guides/project-structure.md",
      "../api-reference/veryfront/index.md",
    ],
    snippets: [
      "Directory roles",
      "Why this matters",
      "agents/",
      "tools/",
    ],
  },
  "concepts/app.md": {
    references: [
      "../guides/pages-and-routing.md",
      "../guides/api-routes.md",
    ],
    snippets: ["user-facing surface", "routes", "request and response boundary"],
  },
  "concepts/agent.md": {
    references: [
      "../guides/agents.md",
      "../api-reference/veryfront/agent.md",
    ],
    snippets: ["ReAct", "Reasoning", "Observation", "AG-UI"],
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
  "concepts/prompt.md": {
    references: ["../api-reference/veryfront/prompt.md"],
    snippets: ["instruction text", "template variables", "MCP"],
  },
  "concepts/resource.md": {
    references: ["../api-reference/veryfront/resource.md"],
    snippets: ["readable project data", "URI pattern", "MCP"],
  },
  "concepts/skill.md": {
    references: ["../guides/skills.md"],
    snippets: ["agent instructions", "allowed-tools policy", "SKILL.md"],
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
      "../api-reference/veryfront/extensions.md",
    ],
    snippets: [
      "What extensions own",
      "When to use extensions",
      "Contract",
      "Use a normal project module",
    ],
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
      "veryfront serve",
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
        filename !== "guides/index.md" &&
        filename !== "getting-started/installation.md"
      ) {
        assertStringIncludes(guide, "## Verify it worked");
      }

      if (filename === "getting-started/installation.md") {
        assertStringIncludes(guide, "## Verify the CLI");
      }
    });
  }
});
