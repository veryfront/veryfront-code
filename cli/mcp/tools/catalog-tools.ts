/**
 * MCP tools for catalog browsing and project creation.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { join } from "veryfront/platform/path";
import { cwd } from "veryfront/platform";
import { withSpan } from "veryfront/observability/otlp-setup";
import { connectors } from "../../../src/integrations/_data.ts";
import { filterVisibleIntegrations } from "../../../src/integrations/feature-flags.ts";
import { INTEGRATION_CATEGORIES } from "../../commands/init/catalog.ts";
import type { MCPTool } from "../tools.ts";
import { directoryExists, formatError, toSlug } from "./helpers.ts";
import type { InitTemplate } from "../../commands/init/types.ts";

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
    name: "ai-agent",
    description: "Personal AI assistant with Gmail, Slack, and Calendar integrations",
    template: "ai-agent",
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
    template: "docs-agent",
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
    name: "ai-agent",
    description: "AI chatbot with agent, tools, and streaming chat UI",
    features: ["Chat UI", "AI tools", "Agent runtime", "Streaming"],
    recommended: true,
  },
  {
    name: "docs-agent",
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
  authType: "oauth2" | "oauth1" | "api-key";
}

function getMcpCategory(categoryName: string): string {
  switch (categoryName) {
    case "Communication":
      return "communication";
    case "Productivity":
      return "productivity";
    case "Development":
      return "development";
    case "Storage":
      return "data";
    case "Infrastructure":
      return "infrastructure";
    case "Sales & CRM":
      return "sales";
    case "Support":
      return "support";
    case "Finance":
      return "finance";
    case "Marketing":
      return "marketing";
    case "Design":
      return "design";
    case "AI Providers":
      return "ai";
    default:
      return "other";
  }
}

const connectorByName = new Map(connectors.map((connector) => [connector.name, connector]));

const INTEGRATIONS: IntegrationInfo[] = INTEGRATION_CATEGORIES.flatMap((category) =>
  category.integrations.flatMap((integration) => {
    const connector = connectorByName.get(integration.id);
    if (!connector) return [];

    return [{
      name: integration.id,
      displayName: integration.label,
      category: getMcpCategory(category.name),
      description: integration.description,
      authType: connector.auth.type as IntegrationInfo["authType"],
    }];
  })
);

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

const getListExamplesInput = defineSchema((v) => v.object({}));
const listExamplesInput = lazySchema(getListExamplesInput);

type ListExamplesInput = InferSchema<ReturnType<typeof getListExamplesInput>>;

export const vfListExamples: MCPTool<ListExamplesInput, ExampleInfo[]> = {
  name: "vf_list_examples",
  title: "List Examples",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to browse example projects that demonstrate Veryfront features and integrations. Returns an array of example info with name, description, and category. Do not use for project templates — use vf_list_templates instead.",
  inputSchema: listExamplesInput,
  execute: () => Promise.resolve(EXAMPLES),
};

// ============================================================================
// Tool: vf_list_templates
// ============================================================================

const getListTemplatesInput = defineSchema((v) => v.object({}));
const listTemplatesInput = lazySchema(getListTemplatesInput);

type ListTemplatesInput = InferSchema<ReturnType<typeof getListTemplatesInput>>;

export const vfListTemplates: MCPTool<ListTemplatesInput, TemplateInfo[]> = {
  name: "vf_list_templates",
  title: "List Templates",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }, // openWorldHint: templates come from remote catalog API
  description:
    "Use this when you need to list available project templates for creating new projects. Returns an array of template info with name and description. Do not use for example projects — use vf_list_examples instead.",
  inputSchema: listTemplatesInput,
  execute: () => Promise.resolve(TEMPLATES),
};

// ============================================================================
// Tool: vf_list_integrations
// ============================================================================

const getListIntegrationsInput = defineSchema((v) =>
  v.object({
    category: v
      .enum([
        "all",
        "productivity",
        "development",
        "communication",
        "data",
        "infrastructure",
        "sales",
        "support",
        "finance",
        "marketing",
        "design",
        "ai",
      ])
      .optional()
      .default("all")
      .describe("Filter integrations by category"),
  })
);
const listIntegrationsInput = lazySchema(getListIntegrationsInput);

type ListIntegrationsInput = InferSchema<ReturnType<typeof getListIntegrationsInput>>;

export const vfListIntegrations: MCPTool<ListIntegrationsInput, IntegrationInfo[]> = {
  name: "vf_list_integrations",
  title: "List Integrations",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to list available service integrations (Gmail, Slack, GitHub, etc.) that can be added to AI projects. Returns an array of integration info with name, category, and description. Do not use for adding integrations to a project — use vf_create_project with the integrations parameter instead.",
  inputSchema: listIntegrationsInput,
  execute: (input) => {
    const { category } = input;
    const integrations = filterVisibleIntegrations(INTEGRATIONS);
    if (category === "all") return Promise.resolve(integrations);
    return Promise.resolve(integrations.filter((i) => i.category === category));
  },
};

// ============================================================================
// Tool: vf_list_usecases
// ============================================================================

const getListUsecasesInput = defineSchema((v) => v.object({}));
const listUsecasesInput = lazySchema(getListUsecasesInput);

type ListUsecasesInput = InferSchema<ReturnType<typeof getListUsecasesInput>>;

export const vfListUsecases: MCPTool<ListUsecasesInput, UsecaseInfo[]> = {
  name: "vf_list_usecases",
  title: "List Use Cases",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need to browse pre-configured use-case templates with recommended integrations and UI layouts. Returns an array of use-case info with name, integrations, and layout. Do not use for raw templates — use vf_list_templates instead.",
  inputSchema: listUsecasesInput,
  execute: () => Promise.resolve(USECASES),
};

// ============================================================================
// Tool: vf_create_project
// ============================================================================

const getCreateProjectInput = defineSchema((v) =>
  v.object({
    name: v.string().describe("Project name (will be converted to slug for directory)"),
    template: v
      .enum([
        "ai-agent",
        "docs-agent",
        "multi-agent-system",
        "agentic-workflow",
        "coding-agent",
        "saas-starter",
        "minimal",
      ])
      .optional()
      .default("ai-agent")
      .describe("Project template to use"),
    integrations: v
      .array(v.string())
      .optional()
      .describe("Service integrations to include (e.g., ['gmail', 'slack'])"),
    directory: v
      .string()
      .optional()
      .describe("Parent directory to create project in (defaults to current directory)"),
  })
);
const createProjectInput = lazySchema(getCreateProjectInput);

export type CreateProjectInput = InferSchema<ReturnType<typeof getCreateProjectInput>>;

interface CreateProjectResult {
  success: boolean;
  projectDir?: string;
  message: string;
  nextSteps?: string[];
}

export function resolveCreateProjectPaths(
  input: Pick<CreateProjectInput, "name" | "directory">,
): { name: string; parentDir: string; projectDir: string } {
  const name = toSlug(input.name);
  const parentDir = input.directory ?? cwd();
  return { name, parentDir, projectDir: join(parentDir, name) };
}

export const vfCreateProject: MCPTool<CreateProjectInput, CreateProjectResult> = {
  name: "vf_create_project",
  title: "Create Project",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description:
    "Use this when you need to create a new Veryfront project from a template. Returns the project directory and next steps. Do not use for scaffolding individual files — use vf_scaffold instead.",
  inputSchema: createProjectInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_create_project",
      async () => {
        try {
          const { initCommand } = await import("../../commands/init/index.ts");

          const { name, parentDir, projectDir } = resolveCreateProjectPaths(input);

          if (await directoryExists(projectDir)) {
            return { success: false, message: `Directory already exists: ${projectDir}` };
          }

          await initCommand({
            name,
            parentDir,
            template: input.template as InitTemplate,
            integrations: input.integrations as
              | import("../../templates/types.ts").IntegrationName[]
              | undefined,
            skipInstall: false,
            skipEnvPrompt: true,
          });

          const nextSteps = [`cd ${projectDir}`, "deno task dev"];
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
