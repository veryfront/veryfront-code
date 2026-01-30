/**
 * MCP tools for catalog browsing and project creation.
 */
import { z } from "zod";
import { join } from "../../../platform/compat/path/index.js";
import { cwd } from "../../../platform/compat/process.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { directoryExists, formatError, toSlug } from "./helpers.js";
const EXAMPLES = [
    {
        name: "ai-assistant",
        description: "Personal AI assistant with Gmail, Slack, and Calendar integrations",
        template: "ai",
        integrations: ["gmail", "slack", "calendar"],
        features: ["Chat UI", "Tool calling", "OAuth"],
        difficulty: "beginner",
    },
    {
        name: "developer-agent",
        description: "AI agent for developers with GitHub, Jira, and Linear",
        template: "ai",
        integrations: ["github", "jira", "linear"],
        features: ["Code review", "Issue tracking", "PR management"],
        difficulty: "intermediate",
    },
    {
        name: "support-bot",
        description: "Customer support agent with Zendesk and Slack",
        template: "ai",
        integrations: ["zendesk", "slack", "notion"],
        features: ["Ticket management", "Knowledge base", "Escalation"],
        difficulty: "intermediate",
    },
    {
        name: "data-analyst",
        description: "AI data analyst with Sheets and Snowflake",
        template: "ai",
        integrations: ["sheets", "snowflake", "notion"],
        features: ["SQL queries", "Chart generation", "Reports"],
        difficulty: "advanced",
    },
    {
        name: "blog-starter",
        description: "MDX blog with syntax highlighting and RSS",
        template: "blog",
        integrations: [],
        features: ["MDX", "RSS feed", "SEO", "Dark mode"],
        difficulty: "beginner",
    },
    {
        name: "docs-site",
        description: "Documentation site with search and versioning",
        template: "docs",
        integrations: [],
        features: ["Search", "Sidebar nav", "Code blocks", "Versioning"],
        difficulty: "beginner",
    },
    {
        name: "saas-starter",
        description: "Full-stack SaaS with auth, billing, and dashboard",
        template: "app",
        integrations: ["stripe"],
        features: ["Auth", "Billing", "Dashboard", "API"],
        difficulty: "advanced",
    },
];
const TEMPLATES = [
    {
        name: "ai",
        description: "AI agent template with chat interface and tool calling",
        features: ["Chat UI", "AI tools", "Agent runtime", "Prompt templates"],
        recommended: true,
    },
    {
        name: "app",
        description: "Full-stack app with authentication and database",
        features: ["Auth", "API routes", "Database ready", "Dashboard"],
    },
    {
        name: "blog",
        description: "Content-focused blog with MDX support",
        features: ["MDX pages", "RSS feed", "SEO optimized", "Syntax highlighting"],
    },
    {
        name: "docs",
        description: "Documentation site with navigation and search",
        features: ["Sidebar nav", "Search", "Versioning", "Code blocks"],
    },
    {
        name: "minimal",
        description: "Bare-bones starter for custom projects",
        features: ["App Router", "Tailwind CSS", "TypeScript"],
    },
];
const INTEGRATIONS = [
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
const USECASES = [
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
export const vfListExamples = {
    name: "vf_list_examples",
    description: "List example projects that demonstrate Veryfront features. Use these as references or starting points for new projects.",
    inputSchema: listExamplesInput,
    execute: () => Promise.resolve(EXAMPLES),
};
// ============================================================================
// Tool: vf_list_templates
// ============================================================================
const listTemplatesInput = z.object({});
export const vfListTemplates = {
    name: "vf_list_templates",
    description: "List available project templates. Use this to help users choose the right starting point for their project.",
    inputSchema: listTemplatesInput,
    execute: () => Promise.resolve(TEMPLATES),
};
// ============================================================================
// Tool: vf_list_integrations
// ============================================================================
const listIntegrationsInput = z.object({
    category: z.enum(["all", "productivity", "development", "communication", "data", "ai"]).optional()
        .default("all")
        .describe("Filter integrations by category"),
});
export const vfListIntegrations = {
    name: "vf_list_integrations",
    description: "List available service integrations (Gmail, Slack, GitHub, etc.). These can be added to AI projects to give agents access to external services.",
    inputSchema: listIntegrationsInput,
    execute: (input) => {
        if (input.category === "all")
            return Promise.resolve(INTEGRATIONS);
        return Promise.resolve(INTEGRATIONS.filter((i) => i.category === input.category));
    },
};
// ============================================================================
// Tool: vf_list_usecases
// ============================================================================
const listUsecasesInput = z.object({});
export const vfListUsecases = {
    name: "vf_list_usecases",
    description: "List pre-configured use-case templates. Each includes recommended integrations and UI layout for common scenarios.",
    inputSchema: listUsecasesInput,
    execute: () => Promise.resolve(USECASES),
};
// ============================================================================
// Tool: vf_create_project
// ============================================================================
const createProjectInput = z.object({
    name: z.string().describe("Project name (will be converted to slug for directory)"),
    template: z.enum(["ai", "app", "blog", "docs", "minimal"]).optional().default("ai").describe("Project template to use"),
    integrations: z.array(z.string()).optional().describe("Service integrations to include (e.g., ['gmail', 'slack'])"),
    directory: z.string().optional().describe("Parent directory to create project in (defaults to current directory)"),
});
export const vfCreateProject = {
    name: "vf_create_project",
    description: "Create a new Veryfront project from a template. This is the MCP equivalent of 'veryfront init'. Returns the project directory and next steps.",
    inputSchema: createProjectInput,
    execute: (input) => withSpan("cli.mcp.tool.vf_create_project", async () => {
        try {
            const { initCommand } = await import("../../commands/init/index.js");
            const parentDir = input.directory ?? cwd();
            const projectDir = join(parentDir, toSlug(input.name));
            if (await directoryExists(projectDir)) {
                return { success: false, message: `Directory already exists: ${projectDir}` };
            }
            await initCommand({
                name: input.name,
                template: input.template,
                integrations: input.integrations,
                skipInstall: false,
                skipEnvPrompt: true,
            });
            const nextSteps = [`cd ${toSlug(input.name)}`, "deno task dev"];
            if (input.integrations?.length) {
                nextSteps.push("Configure integration credentials in .env");
            }
            return {
                success: true,
                projectDir,
                message: `Created project "${input.name}" with ${input.template} template`,
                nextSteps,
            };
        }
        catch (error) {
            return { success: false, message: `Failed to create project: ${formatError(error)}` };
        }
    }, { "tool.name": input.name, "tool.template": input.template }),
};
