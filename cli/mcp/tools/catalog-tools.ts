/**
 * MCP tools for catalog browsing and project creation.
 */

import { z } from "zod";
import { join } from "veryfront/platform/path";
import { cwd } from "veryfront/platform";
import { withSpan } from "veryfront/observability/otlp-setup";
import type { MCPTool } from "../tools.ts";
import { directoryExists, formatError, toSlug } from "./helpers.ts";

// ============================================================================
// Static Data
// ============================================================================

interface ExampleInfo {
  name: string;
  description: string;
  template: string;
  integrations: string[];
  features: string[];
  difficulty: "beginner" | "intermediate" | "advanced";
  path?: string;
}

const EXAMPLES: ExampleInfo[] = [
  {
    name: "ai-assistant",
    description: "Personal AI assistant with Gmail, Slack, and Calendar integrations",
    template: "ai-assistant",
    integrations: ["gmail", "slack", "calendar"],
    features: ["Chat UI", "Tool calling", "OAuth"],
    difficulty: "beginner",
  },
  {
    name: "developer-agent",
    description: "AI coding agent with GitHub, Jira, and Linear",
    template: "coding-agent",
    integrations: ["github", "jira", "linear"],
    features: ["Code review", "Issue tracking", "PR management"],
    difficulty: "intermediate",
  },
  {
    name: "support-bot",
    description: "Multi-agent customer support with Zendesk and Slack",
    template: "multi-agent-system",
    integrations: ["zendesk", "slack", "notion"],
    features: ["Ticket management", "Knowledge base", "Escalation"],
    difficulty: "intermediate",
  },
  {
    name: "data-analyst",
    description: "RAG-powered data analyst with Sheets and Snowflake",
    template: "chat-with-your-docs",
    integrations: ["sheets", "snowflake", "notion"],
    features: ["Document search", "Chart generation", "Reports"],
    difficulty: "advanced",
  },
  {
    name: "content-pipeline",
    description: "AI workflow for research, writing, and publishing",
    template: "agentic-workflow",
    integrations: ["notion", "slack"],
    features: ["Multi-step pipeline", "Approvals", "Parallel tasks"],
    difficulty: "intermediate",
  },
  {
    name: "saas-starter",
    description: "Full-stack AI SaaS with auth, billing, and per-user memory",
    template: "saas-starter",
    integrations: ["stripe"],
    features: ["Auth", "Per-user memory", "Dashboard", "API"],
    difficulty: "advanced",
  },
];

interface TemplateInfo {
  name: string;
  description: string;
  features: string[];
  recommended?: boolean;
}

const TEMPLATES: TemplateInfo[] = [
  {
    name: "ai-assistant",
    description: "AI chatbot with agent, tools, and streaming chat UI",
    features: ["Chat UI", "AI tools", "Agent runtime", "Streaming"],
    recommended: true,
  },
  {
    name: "chat-with-your-docs",
    description: "Chat with your docs using retrieval-augmented generation",
    features: ["Document search", "Source citations", "File-based knowledge"],
  },
  {
    name: "multi-agent-system",
    description: "Agents that delegate to each other as tools",
    features: ["Agent composition", "Orchestrator pattern", "Specialized agents"],
  },
  {
    name: "agentic-workflow",
    description: "Multi-step AI pipeline with approvals and parallelism",
    features: ["Step sequencing", "Approvals", "Parallel tasks", "React hooks"],
  },
  {
    name: "coding-agent",
    description: "AI code assistant with file read/write/edit tools",
    features: ["File tools", "Code generation", "Code review"],
  },
  {
    name: "saas-starter",
    description: "AI SaaS with auth, per-user chat, and memory",
    features: ["Auth", "Per-user memory", "Dashboard", "API routes"],
  },
  {
    name: "minimal",
    description: "Blank canvas with no extras",
    features: ["App Router", "Tailwind CSS", "TypeScript"],
  },
];

interface IntegrationInfo {
  name: string;
  displayName: string;
  category: string;
  description: string;
  authType: "oauth2" | "api-key";
}

const INTEGRATIONS: IntegrationInfo[] = [
  {
    name: "gmail",
    displayName: "Gmail",
    category: "productivity",
    description: "Read, send, and manage emails",
    authType: "oauth2",
  },
  {
    name: "calendar",
    displayName: "Google Calendar",
    category: "productivity",
    description: "Manage events and schedules",
    authType: "oauth2",
  },
  {
    name: "slack",
    displayName: "Slack",
    category: "communication",
    description: "Send messages and manage channels",
    authType: "oauth2",
  },
  {
    name: "notion",
    displayName: "Notion",
    category: "productivity",
    description: "Read and write Notion pages",
    authType: "oauth2",
  },
  {
    name: "sheets",
    displayName: "Google Sheets",
    category: "data",
    description: "Read and write spreadsheets",
    authType: "oauth2",
  },
  {
    name: "drive",
    displayName: "Google Drive",
    category: "productivity",
    description: "Manage files and folders",
    authType: "oauth2",
  },
  {
    name: "docs-google",
    displayName: "Google Docs",
    category: "productivity",
    description: "Read and edit documents",
    authType: "oauth2",
  },
  {
    name: "github",
    displayName: "GitHub",
    category: "development",
    description: "Manage repos, issues, and PRs",
    authType: "oauth2",
  },
  {
    name: "gitlab",
    displayName: "GitLab",
    category: "development",
    description: "Manage projects and pipelines",
    authType: "oauth2",
  },
  {
    name: "jira",
    displayName: "Jira",
    category: "development",
    description: "Track issues and projects",
    authType: "oauth2",
  },
  {
    name: "linear",
    displayName: "Linear",
    category: "development",
    description: "Issue tracking and project management",
    authType: "oauth2",
  },
  {
    name: "sentry",
    displayName: "Sentry",
    category: "development",
    description: "Error tracking and monitoring",
    authType: "api-key",
  },
  {
    name: "teams",
    displayName: "Microsoft Teams",
    category: "communication",
    description: "Chat and collaboration",
    authType: "oauth2",
  },
  {
    name: "outlook",
    displayName: "Outlook",
    category: "communication",
    description: "Email and calendar",
    authType: "oauth2",
  },
  {
    name: "discord",
    displayName: "Discord",
    category: "communication",
    description: "Chat and community",
    authType: "oauth2",
  },
  {
    name: "zoom",
    displayName: "Zoom",
    category: "communication",
    description: "Video meetings",
    authType: "oauth2",
  },
  {
    name: "airtable",
    displayName: "Airtable",
    category: "data",
    description: "Database and spreadsheets",
    authType: "oauth2",
  },
  {
    name: "snowflake",
    displayName: "Snowflake",
    category: "data",
    description: "Data warehouse queries",
    authType: "api-key",
  },
  {
    name: "supabase",
    displayName: "Supabase",
    category: "data",
    description: "Database and auth",
    authType: "api-key",
  },
  {
    name: "neon",
    displayName: "Neon",
    category: "data",
    description: "Serverless Postgres",
    authType: "oauth2",
  },
  {
    name: "anthropic",
    displayName: "Anthropic",
    category: "ai",
    description: "Claude AI models",
    authType: "api-key",
  },
];

interface UsecaseInfo {
  name: string;
  displayName: string;
  description: string;
  integrations: string[];
  chatUI: string;
}

const USECASES: UsecaseInfo[] = [
  {
    name: "productivity",
    displayName: "Personal Productivity",
    description: "Email, calendar, and team communication management",
    integrations: ["gmail", "slack", "calendar"],
    chatUI: "full-page",
  },
  {
    name: "developer",
    displayName: "Developer Tools",
    description: "Code review, issue tracking, and team updates",
    integrations: ["github", "jira", "slack"],
    chatUI: "sidebar",
  },
  {
    name: "support",
    displayName: "Customer Support",
    description: "Ticket management, knowledge base, and escalation",
    integrations: ["zendesk", "slack", "notion"],
    chatUI: "widget",
  },
  {
    name: "social",
    displayName: "Social Media",
    description: "Content scheduling, posting, and monitoring",
    integrations: ["slack", "notion", "calendar"],
    chatUI: "cards",
  },
  {
    name: "custom",
    displayName: "Custom",
    description: "Build your own agent with custom integrations",
    integrations: [],
    chatUI: "full-page",
  },
];

// ============================================================================
// Tool: vf_list_examples
// ============================================================================

const listExamplesInput = z.object({});

type ListExamplesInput = z.infer<typeof listExamplesInput>;

export const vfListExamples: MCPTool<ListExamplesInput, ExampleInfo[]> = {
  name: "vf_list_examples",
  description:
    "List example projects that demonstrate Veryfront features. Use these as references or starting points for new projects.",
  inputSchema: listExamplesInput,
  execute: () => Promise.resolve(EXAMPLES),
};

// ============================================================================
// Tool: vf_list_templates
// ============================================================================

const listTemplatesInput = z.object({});

type ListTemplatesInput = z.infer<typeof listTemplatesInput>;

export const vfListTemplates: MCPTool<ListTemplatesInput, TemplateInfo[]> = {
  name: "vf_list_templates",
  description:
    "List available project templates. Use this to help users choose the right starting point for their project.",
  inputSchema: listTemplatesInput,
  execute: () => Promise.resolve(TEMPLATES),
};

// ============================================================================
// Tool: vf_list_integrations
// ============================================================================

const listIntegrationsInput = z.object({
  category: z
    .enum(["all", "productivity", "development", "communication", "data", "ai"])
    .optional()
    .default("all")
    .describe("Filter integrations by category"),
});

type ListIntegrationsInput = z.infer<typeof listIntegrationsInput>;

export const vfListIntegrations: MCPTool<ListIntegrationsInput, IntegrationInfo[]> = {
  name: "vf_list_integrations",
  description:
    "List available service integrations (Gmail, Slack, GitHub, etc.). These can be added to AI projects to give agents access to external services.",
  inputSchema: listIntegrationsInput,
  execute: (input) => {
    const { category } = input;
    if (category === "all") return Promise.resolve(INTEGRATIONS);
    return Promise.resolve(INTEGRATIONS.filter((i) => i.category === category));
  },
};

// ============================================================================
// Tool: vf_list_usecases
// ============================================================================

const listUsecasesInput = z.object({});

type ListUsecasesInput = z.infer<typeof listUsecasesInput>;

export const vfListUsecases: MCPTool<ListUsecasesInput, UsecaseInfo[]> = {
  name: "vf_list_usecases",
  description:
    "List pre-configured use-case templates. Each includes recommended integrations and UI layout for common scenarios.",
  inputSchema: listUsecasesInput,
  execute: () => Promise.resolve(USECASES),
};

// ============================================================================
// Tool: vf_create_project
// ============================================================================

const createProjectInput = z.object({
  name: z.string().describe("Project name (will be converted to slug for directory)"),
  template: z
    .enum(["ai-assistant", "chat-with-your-docs", "multi-agent-system", "agentic-workflow", "coding-agent", "saas-starter", "minimal"])
    .optional()
    .default("ai-assistant")
    .describe("Project template to use"),
  integrations: z
    .array(z.string())
    .optional()
    .describe("Service integrations to include (e.g., ['gmail', 'slack'])"),
  directory: z
    .string()
    .optional()
    .describe("Parent directory to create project in (defaults to current directory)"),
});

type CreateProjectInput = z.infer<typeof createProjectInput>;

interface CreateProjectResult {
  success: boolean;
  projectDir?: string;
  message: string;
  nextSteps?: string[];
}

export const vfCreateProject: MCPTool<CreateProjectInput, CreateProjectResult> = {
  name: "vf_create_project",
  description:
    "Create a new Veryfront project from a template. This is the MCP equivalent of 'veryfront init'. Returns the project directory and next steps.",
  inputSchema: createProjectInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_create_project",
      async () => {
        try {
          const { initCommand } = await import("../../commands/init/index.ts");

          const slug = toSlug(input.name);
          const parentDir = input.directory ?? cwd();
          const projectDir = join(parentDir, slug);

          if (await directoryExists(projectDir)) {
            return { success: false, message: `Directory already exists: ${projectDir}` };
          }

          await initCommand({
            name: input.name,
            template: input.template,
            integrations: input.integrations as
              | import("../../templates/types.ts").IntegrationName[]
              | undefined,
            skipInstall: false,
            skipEnvPrompt: true,
          });

          const nextSteps = [`cd ${slug}`, "deno task dev"];
          if (input.integrations?.length) {
            nextSteps.push("Configure integration credentials in .env");
          }

          return {
            success: true,
            projectDir,
            message: `Created project "${input.name}" with ${input.template} template`,
            nextSteps,
          };
        } catch (error) {
          return { success: false, message: `Failed to create project: ${formatError(error)}` };
        }
      },
      { "tool.name": input.name, "tool.template": input.template },
    ),
};
