/**
 * MCP tools for scaffolding and conventions.
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { withSpan } from "veryfront/observability/otlp-setup";
import type { MCPTool } from "../tools.ts";
import {
  SCAFFOLD_TYPES,
  type ScaffoldHttpMethod,
  scaffoldProjectFile,
  type ScaffoldResult,
  type ScaffoldType,
} from "../../scaffold/engine.ts";
import { formatError, getProjectDir } from "./helpers.ts";

// ============================================================================
// Scaffold Configuration
// ============================================================================

const getScaffoldInput = defineSchema((v) =>
  v.object({
    type: v.enum(SCAFFOLD_TYPES).describe("Type of project file to scaffold"),
    name: v.string().describe(
      "Name/path of the entity (e.g., 'users', 'api/users', 'dashboard/settings')",
    ),
    methods: v.array(v.enum(["GET", "POST", "PUT", "DELETE", "PATCH"])).optional().describe(
      "HTTP methods for API routes (defaults to GET)",
    ),
    projectPath: v.string().optional().describe(
      "Project directory (defaults to current working directory)",
    ),
  })
);
const scaffoldInput = lazySchema(getScaffoldInput);

type ScaffoldInput = InferSchema<ReturnType<typeof getScaffoldInput>>;

export const vfScaffold: MCPTool<ScaffoldInput, ScaffoldResult> = {
  name: "vf_scaffold",
  title: "Scaffold Code",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  description:
    "Use this when you need to generate new pages, API routes, layouts, components, tools, agents, prompts, workflows, tasks, resources, or skills with Veryfront conventions. Returns created file paths and refuses existing target files. Do not use for creating entire projects. Use vf_create_project instead.",
  inputSchema: scaffoldInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_scaffold",
      async () => {
        const projectDir = getProjectDir(input.projectPath);
        try {
          return await scaffoldProjectFile({
            projectDir,
            type: input.type as ScaffoldType,
            name: input.name,
            methods: input.methods as ScaffoldHttpMethod[] | undefined,
          });
        } catch (error) {
          return {
            success: false,
            files: [],
            message: `Failed to create ${input.type}: ${formatError(error)}`,
          };
        }
      },
      { "tool.type": input.type, "tool.name": input.name },
    ),
};

// ============================================================================
// Tool: vf_get_conventions
// ============================================================================

const getGetConventionsInput = defineSchema((v) =>
  v.object({
    topic: v
      .enum(["all", "routing", "api", "components", "ai", "styling"])
      .optional()
      .default("all")
      .describe("Specific topic to get conventions for"),
  })
);
const getConventionsInput = lazySchema(getGetConventionsInput);

type GetConventionsInput = InferSchema<ReturnType<typeof getGetConventionsInput>>;

interface Convention {
  topic: string;
  rules: string[];
  examples: Array<{ good: string; bad?: string; explanation: string }>;
}

const CONVENTIONS: Record<string, Convention> = {
  routing: {
    topic: "Routing",
    rules: [
      "Use the app/ directory for App Router (recommended)",
      "Each route is a folder with page.tsx, layout.tsx, or route.ts",
      "Dynamic routes use [param] syntax (e.g., app/users/[id]/page.tsx)",
      "Catch-all routes use [...param] syntax",
      "API routes are route.ts files that export HTTP method handlers",
      "Layouts wrap child routes and persist across navigation",
    ],
    examples: [
      {
        good: "app/dashboard/page.tsx",
        bad: "pages/dashboard.tsx",
        explanation: "Use app/ directory with page.tsx convention",
      },
      {
        good: "app/api/users/route.ts",
        bad: "app/api/users.ts",
        explanation: "API routes must be in route.ts files",
      },
      {
        good: "app/blog/[slug]/page.tsx",
        explanation: "Dynamic routes use [param] folder names",
      },
    ],
  },
  api: {
    topic: "API Routes",
    rules: [
      "Export named functions for HTTP methods: GET, POST, PUT, DELETE, PATCH",
      "Accept Request object as first parameter",
      "Return Response object or use Response.json() helper",
      "Use async functions for database/external API calls",
      "Handle errors with try/catch and return appropriate status codes",
    ],
    examples: [
      {
        good: `export function GET(req: Request) {
  return Response.json({ users: [] });
}`,
        explanation: "Simple GET handler returning JSON",
      },
      {
        good: `export async function POST(req: Request) {
  const body = await req.json();
  // validate and save
  return Response.json({ created: true }, { status: 201 });
}`,
        explanation: "POST handler with body parsing",
      },
    ],
  },
  components: {
    topic: "Components",
    rules: [
      "Components go in components/ directory",
      "Use PascalCase for component names and files",
      "Prefer functional components with TypeScript interfaces for props",
      "Keep components focused on a single responsibility",
      "Use composition over prop drilling",
    ],
    examples: [
      {
        good: "components/UserCard.tsx",
        bad: "components/user-card.tsx",
        explanation: "Use PascalCase for component files",
      },
      {
        good: `interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
}`,
        explanation: "Define props with TypeScript interfaces",
      },
    ],
  },
  ai: {
    topic: "AI / Agents",
    rules: [
      "AI primitives live at the project root",
      "Tools go in tools/ directory",
      "Agents go in agents/ directory",
      "Prompts go in prompts/ directory",
      "Workflows go in workflows/ directory",
      "Tasks go in tasks/ directory",
      "Resources go in resources/ directory",
      "Skills go in skills/<id>/SKILL.md",
      "Use defineSchema for tool parameter validation",
      "Tools should be focused on a single capability",
      "Agents combine tools with instructions for complex tasks",
    ],
    examples: [
      {
        good: "tools/search-docs.ts",
        explanation: "Tools in dedicated directory with descriptive names",
      },
      {
        good: `export default tool({
  inputSchema: defineSchema((v) => v.object({
  query: v.string(),
}))(),
  execute: async ({ query }) => { /* ... */ }
});`,
        explanation: "Tool with schema-backed input and typed execute function",
      },
    ],
  },
  styling: {
    topic: "Styling",
    rules: [
      "Use Tailwind CSS for styling (included by default)",
      "Use className for styling, not inline styles",
      "Prefer utility classes over custom CSS",
      "Use CSS variables for theming (--color-*, etc.)",
      "Support dark mode with dark: variants",
    ],
    examples: [
      {
        good: '<div className="p-4 bg-white dark:bg-gray-800">',
        bad: '<div style={{ padding: 16, background: "white" }}>',
        explanation: "Use Tailwind utilities instead of inline styles",
      },
    ],
  },
};

export const vfGetConventions: MCPTool<GetConventionsInput, Convention[]> = {
  name: "vf_get_conventions",
  title: "Get Conventions",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  description:
    "Use this when you need Veryfront coding conventions and best practices for routing, API, components, AI, or styling. Do not use for project structure — use vf_get_project_context instead.",
  inputSchema: getConventionsInput,
  execute: (input) => {
    if (input.topic === "all") return Promise.resolve(Object.values(CONVENTIONS));

    const convention = CONVENTIONS[input.topic];
    if (!convention) return Promise.resolve([]);

    return Promise.resolve([convention]);
  },
};
