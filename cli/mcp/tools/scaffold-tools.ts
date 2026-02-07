/**
 * MCP tools for scaffolding and conventions.
 */

import { z } from "zod";
import { join } from "veryfront/platform/path";
import { withSpan } from "veryfront/observability/otlp-setup";
import type { MCPTool } from "../tools.ts";
import {
  ensureDir,
  fileExists,
  formatError,
  getFs,
  getProjectDir,
  type ScaffoldResult,
  toComponentName,
  toSlug,
} from "./helpers.ts";

// ============================================================================
// Scaffold Templates
// ============================================================================

function generatePageTemplate(name: string, componentName: string): string {
  return `export default function ${componentName}() {
  return (
    <div>
      <h1>${name}</h1>
      <p>This is the ${name} page.</p>
    </div>
  );
}
`;
}

function generateLayoutTemplate(name: string, componentName: string): string {
  return `export default function ${componentName}Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="${name}-layout">
      {children}
    </section>
  );
}
`;
}

function generateApiTemplate(methods: string[]): string {
  const handlers = methods.map((method) => {
    if (method === "GET") {
      return `export function GET(req: Request) {
  return Response.json({ ok: true });
}`;
    }

    return `export async function ${method}(req: Request) {
  const body = await req.json();
  return Response.json({ ok: true, received: body });
}`;
  });

  return `${handlers.join("\n\n")}\n`;
}

function generateComponentTemplate(componentName: string): string {
  return `interface ${componentName}Props {
  children?: React.ReactNode;
}

export function ${componentName}({ children }: ${componentName}Props) {
  return (
    <div className="${componentName.toLowerCase()}">
      {children}
    </div>
  );
}
`;
}

function generateToolTemplate(name: string): string {
  return `import { tool } from "veryfront/tool";
import { z } from "zod";

export default tool({
  id: "${name}",
  description: "Description of what this tool does",
  parameters: z.object({
    // Add your parameters here
    input: z.string().describe("Input parameter"),
  }),
  execute: async ({ input }) => {
    // Implement your tool logic here
    return { result: input };
  },
});
`;
}

function generateAgentTemplate(name: string, className: string): string {
  return `import { agent } from "veryfront/agent";

export default agent({
  id: "${className.toLowerCase()}",
  name: "${name}",
  description: "Description of this agent's capabilities",
  instructions: \`
    You are an AI assistant specialized in ${name}.

    Your capabilities:
    - List your agent's capabilities here

    Guidelines:
    - Be helpful and accurate
    - Ask for clarification when needed
  \`,
  tools: [
    // Add tools this agent can use
  ],
});
`;
}

function generatePromptTemplate(name: string): string {
  return `import { prompt } from "veryfront/prompt";
import { z } from "zod";

export default prompt({
  id: "${name}",
  description: "Description of this prompt template",
  argsSchema: z.object({
    input: z.string().describe("User input"),
  }),
  getContent: ({ input }) => [
    { role: "system", content: "Role: describe what this assistant should do and its limits." },
    { role: "user", content: input },
  ],
});
`;
}

// ============================================================================
// Scaffold Configuration
// ============================================================================

const scaffoldInput = z.object({
  type: z.enum(["page", "api", "layout", "component", "tool", "agent", "prompt"]).describe(
    "Type of entity to scaffold",
  ),
  name: z.string().describe(
    "Name/path of the entity (e.g., 'users', 'api/users', 'dashboard/settings')",
  ),
  methods: z.array(z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"])).optional().describe(
    "HTTP methods for API routes (defaults to GET)",
  ),
  projectPath: z.string().optional().describe(
    "Project directory (defaults to current working directory)",
  ),
});

type ScaffoldInput = z.infer<typeof scaffoldInput>;
type ScaffoldType = ScaffoldInput["type"];

interface ScaffoldConfig {
  getDirectory: (projectDir: string, slug: string) => string;
  getFilename: (slug: string, componentName: string) => string;
  getContent: (name: string, slug: string, componentName: string, methods?: string[]) => string;
}

const SCAFFOLD_CONFIGS: Record<ScaffoldType, ScaffoldConfig> = {
  page: {
    getDirectory: (projectDir, slug) => join(projectDir, "app", slug),
    getFilename: () => "page.tsx",
    getContent: (name, _slug, componentName) => generatePageTemplate(name, componentName),
  },
  api: {
    getDirectory: (projectDir, slug) => join(projectDir, "app", slug),
    getFilename: () => "route.ts",
    getContent: (_name, _slug, _componentName, methods) => generateApiTemplate(methods ?? ["GET"]),
  },
  layout: {
    getDirectory: (projectDir, slug) => join(projectDir, "app", slug),
    getFilename: () => "layout.tsx",
    getContent: (name, _slug, componentName) => generateLayoutTemplate(name, componentName),
  },
  component: {
    getDirectory: (projectDir) => join(projectDir, "components"),
    getFilename: (_slug, componentName) => `${componentName}.tsx`,
    getContent: (_name, _slug, componentName) => generateComponentTemplate(componentName),
  },
  tool: {
    getDirectory: (projectDir) => join(projectDir, "ai", "tools"),
    getFilename: (slug) => `${slug}.ts`,
    getContent: (name) => generateToolTemplate(name),
  },
  agent: {
    getDirectory: (projectDir) => join(projectDir, "ai", "agents"),
    getFilename: (slug) => `${slug}.ts`,
    getContent: (name, _slug, componentName) => generateAgentTemplate(name, componentName),
  },
  prompt: {
    getDirectory: (projectDir) => join(projectDir, "ai", "prompts"),
    getFilename: (slug) => `${slug}.ts`,
    getContent: (_name, slug) => generatePromptTemplate(slug.replace(/-/g, "_")),
  },
};

export const vfScaffold: MCPTool<ScaffoldInput, ScaffoldResult> = {
  name: "vf_scaffold",
  description:
    "Generate new entities (pages, API routes, layouts, components, AI tools, agents, prompts) with proper conventions. This is the recommended way to create new files in a Veryfront project.",
  inputSchema: scaffoldInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_scaffold",
      async () => {
        const projectDir = getProjectDir(input.projectPath);
        const fs = getFs();
        const slug = toSlug(input.name);
        const componentName = toComponentName(input.name);

        const config = SCAFFOLD_CONFIGS[input.type];
        const directory = config.getDirectory(projectDir, slug);
        const filename = config.getFilename(slug, componentName);
        const filePath = join(directory, filename);

        try {
          if (await fileExists(filePath)) {
            return {
              success: false,
              files: [],
              message: `${input.type} already exists at ${filePath}`,
            };
          }

          await ensureDir(directory);
          const content = config.getContent(input.name, slug, componentName, input.methods);
          await fs.writeTextFile(filePath, content);

          return {
            success: true,
            files: [{ path: filePath, created: true }],
            message: `Created ${input.type} "${input.name}" successfully`,
          };
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

const getConventionsInput = z.object({
  topic: z
    .enum(["all", "routing", "api", "components", "ai", "styling"])
    .optional()
    .default("all")
    .describe("Specific topic to get conventions for"),
});

type GetConventionsInput = z.infer<typeof getConventionsInput>;

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
      "AI tools go in ai/tools/ directory",
      "Agents go in ai/agents/ directory",
      "Prompts go in ai/prompts/ directory",
      "Use Zod for tool parameter validation",
      "Tools should be focused on a single capability",
      "Agents combine tools with instructions for complex tasks",
    ],
    examples: [
      {
        good: "ai/tools/search-docs.ts",
        explanation: "Tools in dedicated directory with descriptive names",
      },
      {
        good: `export const searchTool = {
  name: "search_docs",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => { /* ... */ }
};`,
        explanation: "Tool with Zod schema and typed execute function",
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
  description:
    "Get Veryfront coding conventions and best practices. Use this as guardrails when writing code to ensure consistency with the project standards.",
  inputSchema: getConventionsInput,
  execute: (input) => {
    if (input.topic === "all") return Promise.resolve(Object.values(CONVENTIONS));

    const convention = CONVENTIONS[input.topic];
    if (!convention) return Promise.resolve([]);

    return Promise.resolve([convention]);
  },
};
