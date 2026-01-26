/****
 * Advanced MCP Tools for Coding Agents
 *
 * These tools give coding agents deep understanding of Veryfront projects
 * and scaffolding capabilities with guardrails.
 */
import * as dntShim from "../../../_dnt.shims.js";


import { z } from "zod";
import { createFileSystem, type FileSystem } from "../../platform/compat/fs.js";
import { join } from "../../platform/compat/path/index.js";
import { cwd } from "../../platform/compat/process.js";
import type { MCPTool } from "./tools.js";
import { ReloadNotifier } from "../../server/reload-notifier.js";
import { getErrorCollector } from "./error-collector.js";
import { getLogBuffer } from "./log-buffer.js";
import { getRuntimeEnv } from "../../config/runtime-env.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";

// ============================================================================
// Types
// ============================================================================

type RouteType = "page" | "layout" | "api" | "error" | "loading" | "not-found";

interface RouteInfo {
  path: string;
  type: RouteType;
  file: string;
  methods?: string[];
}

interface ProjectContext {
  name: string;
  router: "app" | "pages";
  routes: RouteInfo[];
  directories: {
    app?: string;
    pages?: string;
    components?: string;
    lib?: string;
    ai?: string;
  };
  hasAI: boolean;
  integrations: string[];
  features: string[];
}

interface ScaffoldResult {
  success: boolean;
  files: Array<{ path: string; created: boolean }>;
  message: string;
}

// ============================================================================
// Helpers
// ============================================================================

let cachedFs: FileSystem | null = null;

function getFs(): FileSystem {
  cachedFs ??= createFileSystem();
  return cachedFs;
}

function getProjectDir(projectPath?: string): string {
  return projectPath ?? cwd();
}

async function ensureDir(path: string): Promise<void> {
  try {
    await getFs().mkdir(path, { recursive: true });
  } catch {
    // Directory already exists
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const stat = await getFs().stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return await getFs().exists(path);
}

function toComponentName(slug: string): string {
  const base = slug.split("/").pop() || slug;
  return base
    .replace(/\W+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

function toSlug(name: string): string {
  return name
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_\-[\]/]/g, "")
    .replace(/\/+/g, "/")
    .toLowerCase();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ============================================================================
// Route Scanning
// ============================================================================

const ROUTE_FILE_MAP: Record<string, RouteType> = {
  "page.tsx": "page",
  "page.jsx": "page",
  "page.mdx": "page",
  "layout.tsx": "layout",
  "layout.jsx": "layout",
  "route.ts": "api",
  "route.js": "api",
  "error.tsx": "error",
  "error.jsx": "error",
  "loading.tsx": "loading",
  "loading.jsx": "loading",
  "not-found.tsx": "not-found",
  "not-found.jsx": "not-found",
};

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;

function toRouteSegment(dirName: string): string {
  if (dirName.startsWith("[...") && dirName.endsWith("]")) return `*${dirName.slice(4, -1)}`;
  if (dirName.startsWith("[") && dirName.endsWith("]")) return `:${dirName.slice(1, -1)}`;
  return dirName;
}

async function detectHttpMethods(filePath: string, fs: FileSystem): Promise<string[]> {
  const content = await fs.readTextFile(filePath);
  const methods: string[] = [];

  for (const method of HTTP_METHODS) {
    const regex = new RegExp(`export\\s+(const|function|async\\s+function)\\s+${method}`, "i");
    if (regex.test(content)) methods.push(method);
  }

  return methods.length ? methods : ["GET"];
}

async function scanDirectory(
  dir: string,
  baseRoute: string,
  routes: RouteInfo[],
  fs: FileSystem,
): Promise<void> {
  try {
    for await (const entry of fs.readDir(dir)) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (entry.name.startsWith("_")) continue;

        const segment = toRouteSegment(entry.name);
        const newRoute = baseRoute === "/" ? `/${segment}` : `${baseRoute}/${segment}`;
        await scanDirectory(fullPath, newRoute, routes, fs);
        continue;
      }

      if (!entry.isFile) continue;

      const routeType = ROUTE_FILE_MAP[entry.name.toLowerCase()];
      if (!routeType) continue;

      const routePath = baseRoute || "/";
      const routeInfo: RouteInfo = { path: routePath, type: routeType, file: fullPath };

      if (routeType === "api") routeInfo.methods = await detectHttpMethods(fullPath, fs);

      routes.push(routeInfo);
    }
  } catch {
    // Directory doesn't exist or permission error
  }
}

// ============================================================================
// Tool: vf_list_routes
// ============================================================================

const listRoutesInput = z.object({
  type: z.enum(["all", "pages", "api", "layouts"]).optional().default("all").describe(
    "Filter routes by type",
  ),
  projectPath: z.string().optional().describe(
    "Project directory (defaults to current working directory)",
  ),
});

type ListRoutesInput = z.infer<typeof listRoutesInput>;

const ROUTE_FILTER_MAP: Record<string, RouteType[]> = {
  pages: ["page"],
  api: ["api"],
  layouts: ["layout"],
};

export const vfListRoutes: MCPTool<ListRoutesInput, RouteInfo[]> = {
  name: "vf_list_routes",
  description:
    "Discover all routes in the project. Returns pages, API routes, layouts, and special routes. Use this to understand the project structure before making changes.",
  inputSchema: listRoutesInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_list_routes",
      async () => {
        const projectDir = getProjectDir(input.projectPath);
        const appDir = join(projectDir, "app");
        const fs = getFs();
        const routes: RouteInfo[] = [];

        if (await directoryExists(appDir)) await scanDirectory(appDir, "", routes, fs);
        if (input.type === "all") return routes;

        const allowedTypes = ROUTE_FILTER_MAP[input.type] ?? [];
        return routes.filter((route) => allowedTypes.includes(route.type));
      },
      { "tool.filter_type": input.type },
    ),
};

// ============================================================================
// Tool: vf_get_project_context
// ============================================================================

const getProjectContextInput = z.object({
  projectPath: z.string().optional().describe(
    "Project directory (defaults to current working directory)",
  ),
});

type GetProjectContextInput = z.infer<typeof getProjectContextInput>;

const STANDARD_DIRS = ["app", "pages", "components", "lib", "ai"] as const;

const BUILTIN_AUTH_ROUTES = ["login", "logout", "me", "signup", "register"];

const FEATURE_PATTERNS: Array<[string, string]> = [
  ["lib/auth.ts", "auth"],
  ["lib/redis.ts", "redis"],
  ["workflows", "workflows"],
];

async function detectDirectories(projectDir: string): Promise<ProjectContext["directories"]> {
  const directories: ProjectContext["directories"] = {};
  for (const dir of STANDARD_DIRS) {
    if (await directoryExists(join(projectDir, dir))) directories[dir] = dir;
  }
  return directories;
}

async function detectIntegrations(projectDir: string, fs: FileSystem): Promise<string[]> {
  const authDir = join(projectDir, "app/api/auth");
  if (!await directoryExists(authDir)) return [];

  const integrations: string[] = [];
  try {
    for await (const entry of fs.readDir(authDir)) {
      if (entry.isDirectory && !BUILTIN_AUTH_ROUTES.includes(entry.name)) {
        integrations.push(entry.name);
      }
    }
  } catch {
    // Ignore read errors
  }

  return integrations;
}

async function detectFeatures(projectDir: string, hasAI: boolean): Promise<string[]> {
  const features: string[] = [];
  if (hasAI) features.push("ai");

  for (const [path, feature] of FEATURE_PATTERNS) {
    if (await fileExists(join(projectDir, path))) features.push(feature);
  }

  return features;
}

async function getProjectName(projectDir: string, fs: FileSystem): Promise<string> {
  try {
    const content = await fs.readTextFile(join(projectDir, "package.json"));
    const pkg = JSON.parse(content);
    if (pkg.name) return pkg.name;
  } catch {
    // Fall back to directory name
  }
  return projectDir.split("/").pop() || "project";
}

export const vfGetProjectContext: MCPTool<GetProjectContextInput, ProjectContext> = {
  name: "vf_get_project_context",
  description:
    "Get deep understanding of the project structure, conventions, and capabilities. Use this at the start of any coding session to understand the project before making changes.",
  inputSchema: getProjectContextInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_project_context",
      async () => {
        const projectDir = getProjectDir(input.projectPath);
        const fs = getFs();

        const hasApp = await directoryExists(join(projectDir, "app"));
        const hasPages = await directoryExists(join(projectDir, "pages"));
        const router = hasApp ? "app" : hasPages ? "pages" : "app";

        const routes: RouteInfo[] = [];
        if (hasApp) await scanDirectory(join(projectDir, "app"), "", routes, fs);

        const directories = await detectDirectories(projectDir);
        const hasAI = await directoryExists(join(projectDir, "ai")) ||
          await fileExists(join(projectDir, "app/api/chat/route.ts"));
        const integrations = await detectIntegrations(projectDir, fs);
        const features = await detectFeatures(projectDir, hasAI);
        const name = await getProjectName(projectDir, fs);

        return { name, router, routes, directories, hasAI, integrations, features };
      },
      { "tool.projectDir": input.projectPath ?? "cwd" },
    ),
};

// ============================================================================
// Tool: vf_scaffold
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
  return handlers.join("\n\n") + "\n";
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
  topic: z.enum(["all", "routing", "api", "components", "ai", "styling"]).optional().default("all")
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
    return Promise.resolve(convention ? [convention] : []);
  },
};

// ============================================================================
// Tool: vf_hot_reload
// ============================================================================

const hotReloadInput = z.object({
  file: z.string().optional().describe(
    "Specific file to trigger reload for (optional - reloads all if not specified)",
  ),
});

type HotReloadInput = z.infer<typeof hotReloadInput>;

interface HotReloadResult {
  success: boolean;
  message: string;
}

export const vfHotReload: MCPTool<HotReloadInput, HotReloadResult> = {
  name: "vf_hot_reload",
  description:
    "Trigger a hot reload of the dev server. Use after making changes to see them instantly.",
  inputSchema: hotReloadInput,
  execute: () =>
    Promise.resolve({
      success: true,
      message: "Hot reload triggered. Changes should be visible in the browser.",
    }),
};

// ============================================================================
// Tool: vf_get_debug_context
// ============================================================================

const getDebugContextInput = z.object({
  port: z.number().optional().default(8080).describe("Dev server port (defaults to 8080)"),
  project: z.string().optional().describe("Project slug to check (for multi-project mode)"),
});

type GetDebugContextInput = z.infer<typeof getDebugContextInput>;

interface DebugContextResult {
  success: boolean;
  context?: {
    projectSlug: string;
    projectDir: string;
    requestContextMode?: string;
    isMultiProjectMode: boolean;
  };
  error?: string;
}

export const vfGetDebugContext: MCPTool<GetDebugContextInput, DebugContextResult> = {
  name: "vf_get_debug_context",
  description:
    "Get the current server context including project info, environment, and mode. Useful for debugging server configuration issues.",
  inputSchema: getDebugContextInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_debug_context",
      async () => {
        const host = input.project ? `${input.project}.veryfront.me` : "veryfront.me";
        const url = `http://${host}:${input.port}/_vf_debug/context`;

        try {
          const response = await dntShim.fetch(url);
          if (!response.ok) {
            return {
              success: false,
              error: `Server returned ${response.status}: ${response.statusText}`,
            };
          }

          const data = await response.json();
          return {
            success: true,
            context: {
              projectSlug: data.context?.projectSlug || "",
              projectDir: data.context?.projectDir || "",
              requestContextMode: data.context?.requestContext?.mode || "unknown",
              isMultiProjectMode: data.adapter?.isMultiProjectMode || false,
            },
          };
        } catch (error) {
          return { success: false, error: formatError(error) };
        }
      },
      { "tool.port": input.port },
    ),
};

// ============================================================================
// Tool: vf_trigger_hmr
// ============================================================================

const triggerHmrInput = z.object({
  path: z.string().describe("File path that changed (e.g., 'app/page.tsx')"),
  port: z.number().optional().default(8080).describe("Dev server port (defaults to 8080)"),
});

type TriggerHmrInput = z.infer<typeof triggerHmrInput>;

interface TriggerHmrResult {
  success: boolean;
  message: string;
}

export const vfTriggerHmr: MCPTool<TriggerHmrInput, TriggerHmrResult> = {
  name: "vf_trigger_hmr",
  description:
    "Trigger Hot Module Replacement for a specific file. The browser will update without a full reload.",
  inputSchema: triggerHmrInput,
  execute: (input) => {
    const metrics = ReloadNotifier.getMetrics();
    if (metrics.activeReloadListeners <= 0) {
      return Promise.resolve({
        success: false,
        message: "No HMR listeners registered. Is the server running with HMR enabled?",
      });
    }

    ReloadNotifier.triggerReload([input.path]);

    return Promise.resolve({
      success: true,
      message: `HMR triggered for ${input.path}. Browser will refresh after debounce (300ms).`,
    });
  },
};

// ============================================================================
// Tool: vf_preview_route
// ============================================================================

const previewRouteInput = z.object({
  route: z.string().describe("Route path to preview (e.g., '/', '/dashboard', '/api/users')"),
  port: z.number().optional().default(8080).describe("Dev server port (defaults to 8080)"),
  format: z.enum(["html", "json", "status"]).optional().default("status").describe(
    "Output format: html (full page), json (API response), status (just HTTP status)",
  ),
});

type PreviewRouteInput = z.infer<typeof previewRouteInput>;

interface PreviewRouteResult {
  success: boolean;
  status: number;
  contentType?: string;
  body?: string;
  headers?: Record<string, string>;
  error?: string;
  renderTime?: number;
}

export const vfPreviewRoute: MCPTool<PreviewRouteInput, PreviewRouteResult> = {
  name: "vf_preview_route",
  description:
    "Preview a route by making a request to the dev server. Returns the rendered output, HTTP status, and render time. Perfect for testing changes instantly.",
  inputSchema: previewRouteInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_preview_route",
      async () => {
        const url = `http://localhost:${input.port}${input.route}`;
        const startTime = Date.now();

        try {
          const response = await dntShim.fetch(url, {
            headers: {
              Accept: input.format === "json" ? "application/json" : "text/html",
            },
          });

          const renderTime = Date.now() - startTime;
          const contentType = response.headers.get("content-type") || "";

          if (input.format === "status") {
            return { success: response.ok, status: response.status, contentType, renderTime };
          }

          const body = await response.text();
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });

          const maxLength = input.format === "html" ? 5000 : 10000;
          const truncatedBody = body.length > maxLength
            ? body.slice(0, maxLength) + `\n\n[... truncated ${body.length - maxLength} characters]`
            : body;

          return {
            success: response.ok,
            status: response.status,
            contentType,
            body: truncatedBody,
            headers,
            renderTime,
          };
        } catch (error) {
          return { success: false, status: 0, error: formatError(error) };
        }
      },
      { "tool.route": input.route, "tool.port": input.port },
    ),
};

// ============================================================================
// Tool: vf_get_component_tree
// ============================================================================

const getComponentTreeInput = z.object({
  route: z.string().describe("Route path to analyze (e.g., '/', '/dashboard')"),
  projectPath: z.string().optional().describe(
    "Project directory (defaults to current working directory)",
  ),
});

type GetComponentTreeInput = z.infer<typeof getComponentTreeInput>;

interface ComponentNode {
  name: string;
  type: "page" | "layout" | "component" | "provider";
  file: string;
  children?: ComponentNode[];
  props?: string[];
}

interface ComponentTreeResult {
  route: string;
  tree: ComponentNode[];
  layouts: string[];
  providers: string[];
}

function buildRoutePaths(route: string): string[] {
  const segments = route.split("/").filter(Boolean);
  const paths = [""];
  for (const segment of segments) paths.push(paths[paths.length - 1] + "/" + segment);
  return paths;
}

function toRelativePath(absolutePath: string, projectDir: string): string {
  return absolutePath.replace(projectDir + "/", "");
}

export const vfGetComponentTree: MCPTool<GetComponentTreeInput, ComponentTreeResult> = {
  name: "vf_get_component_tree",
  description:
    "Analyze the component hierarchy for a route. Shows layouts, providers, and components that render on this route. Helps understand the rendering structure.",
  inputSchema: getComponentTreeInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_component_tree",
      async () => {
        const projectDir = getProjectDir(input.projectPath);
        const fs = getFs();
        const tree: ComponentNode[] = [];
        const layouts: string[] = [];
        const providers: string[] = [];

        for (const routePath of buildRoutePaths(input.route)) {
          const layoutPath = join(projectDir, "app", routePath, "layout.tsx");
          if (!await fileExists(layoutPath)) continue;

          const relativePath = toRelativePath(layoutPath, projectDir);
          layouts.push(relativePath);
          tree.push({
            name: toComponentName(routePath || "Root") + "Layout",
            type: "layout",
            file: relativePath,
          });
        }

        const pagePath = join(projectDir, "app", input.route, "page.tsx");
        if (await fileExists(pagePath)) {
          tree.push({
            name: toComponentName(input.route || "Home") + "Page",
            type: "page",
            file: toRelativePath(pagePath, projectDir),
          });
        }

        const providersDir = join(projectDir, "providers");
        if (await directoryExists(providersDir)) {
          try {
            for await (const entry of fs.readDir(providersDir)) {
              if (entry.isFile && (entry.name.endsWith(".tsx") || entry.name.endsWith(".mdx"))) {
                providers.push(`providers/${entry.name}`);
              }
            }
          } catch {
            // No providers
          }
        }

        return { route: input.route, tree, layouts, providers };
      },
      { "tool.route": input.route },
    ),
};

// ============================================================================
// Tool: vf_get_skills
// ============================================================================

const getSkillsInput = z.object({
  name: z.string().optional().describe(
    "Specific skill name to get full content for (omit for list of all skills)",
  ),
});

type GetSkillsInput = z.infer<typeof getSkillsInput>;

interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  tools?: string[];
}

interface SkillContent extends SkillMetadata {
  content: string;
  references?: string[];
}

interface GetSkillsResult {
  skills?: SkillMetadata[];
  skill?: SkillContent;
  error?: string;
}

function parseSkillFrontmatter(
  content: string,
): { metadata: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content };

  const [, yamlContent = "", body = ""] = match;
  const metadata: Record<string, unknown> = {};

  for (const line of yamlContent.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    metadata[key] = value;
  }

  return { metadata, body: body.trim() };
}

function getSkillsDir(): string {
  return join(cwd(), "src/cli/mcp/skills");
}

function parseToolsFromMetadata(metadata: Record<string, unknown>): string[] | undefined {
  const metadataObj = metadata.metadata as Record<string, unknown> | undefined;
  if (!metadataObj?.tools) return undefined;
  return String(metadataObj.tools).split(",").map((t) => t.trim());
}

export const vfGetSkills: MCPTool<GetSkillsInput, GetSkillsResult> = {
  name: "vf_get_skills",
  description:
    "Discover available Agent Skills for Veryfront development. Skills provide procedural knowledge for using MCP tools effectively. Call without name param to list all skills, or with name to get full skill content.",
  inputSchema: getSkillsInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_skills",
      async () => {
        const fs = getFs();
        const skillsDir = getSkillsDir();

        try {
          if (input.name) {
            const skillPath = join(skillsDir, input.name, "SKILL.md");
            const content = await fs.readTextFile(skillPath);
            const { metadata, body } = parseSkillFrontmatter(content);

            const references: string[] = [];
            const refsDir = join(skillsDir, input.name, "references");
            if (await directoryExists(refsDir)) {
              for await (const entry of fs.readDir(refsDir)) {
                if (entry.isFile && entry.name.endsWith(".md")) {
                  references.push(
                    `references/${entry.name}`,
                  );
                }
              }
            }

            const tools = parseToolsFromMetadata(metadata);

            return {
              skill: {
                name: String(metadata.name || input.name),
                description: String(metadata.description || ""),
                license: metadata.license ? String(metadata.license) : undefined,
                compatibility: metadata.compatibility ? String(metadata.compatibility) : undefined,
                tools,
                content: body,
                references: references.length ? references : undefined,
              },
            };
          }

          if (!await directoryExists(skillsDir)) return { skills: [] };

          const skills: SkillMetadata[] = [];
          for await (const entry of fs.readDir(skillsDir)) {
            if (!entry.isDirectory) continue;

            const skillPath = join(skillsDir, entry.name, "SKILL.md");
            if (!await fileExists(skillPath)) continue;

            try {
              const content = await fs.readTextFile(skillPath);
              const { metadata } = parseSkillFrontmatter(content);
              const tools = parseToolsFromMetadata(metadata);

              skills.push({
                name: String(metadata.name || entry.name),
                description: String(metadata.description || "No description"),
                license: metadata.license ? String(metadata.license) : undefined,
                compatibility: metadata.compatibility ? String(metadata.compatibility) : undefined,
                tools,
              });
            } catch {
              // Skip invalid skills
            }
          }

          return { skills };
        } catch (error) {
          return { error: formatError(error) };
        }
      },
      { "tool.skill_name": input.name ?? "list_all" },
    ),
};

// ============================================================================
// Tool: vf_get_skill_reference
// ============================================================================

const getSkillReferenceInput = z.object({
  skill: z.string().describe("Skill name"),
  reference: z.string().describe("Reference file path (e.g., 'references/ROUTES.md')"),
});

type GetSkillReferenceInput = z.infer<typeof getSkillReferenceInput>;

interface GetSkillReferenceResult {
  content?: string;
  error?: string;
}

export const vfGetSkillReference: MCPTool<GetSkillReferenceInput, GetSkillReferenceResult> = {
  name: "vf_get_skill_reference",
  description:
    "Get a specific reference document from a skill. Use this to load detailed documentation on demand.",
  inputSchema: getSkillReferenceInput,
  execute: async (input) => {
    const fs = getFs();
    const refPath = join(getSkillsDir(), input.skill, input.reference);

    try {
      const content = await fs.readTextFile(refPath);
      return { content };
    } catch (error) {
      return { error: formatError(error) };
    }
  },
};

// ============================================================================
// Tool: vf_list_local_projects
// ============================================================================

const listLocalProjectsInput = z.object({
  directory: z.string().optional().describe(
    "Directory to scan for projects (defaults to current directory and common locations)",
  ),
  depth: z.number().optional().default(2).describe(
    "How deep to scan (1 = immediate children, 2 = grandchildren)",
  ),
});

type ListLocalProjectsInput = z.infer<typeof listLocalProjectsInput>;

interface LocalProjectInfo {
  name: string;
  path: string;
  template?: string;
  hasAI: boolean;
  integrations: string[];
  lastModified?: string;
}

async function detectVeryfrontProject(projectPath: string): Promise<LocalProjectInfo | null> {
  const fs = getFs();

  const configExists = await fileExists(join(projectPath, "veryfront.config.ts")) ||
    await fileExists(join(projectPath, "veryfront.config.js"));

  if (!configExists && !await fileExists(join(projectPath, ".veryfrontrc"))) return null;

  let name = projectPath.split("/").pop() || "unknown";
  try {
    const pkgContent = await fs.readTextFile(join(projectPath, "package.json"));
    const pkg = JSON.parse(pkgContent);
    if (pkg.name) name = pkg.name;
  } catch {
    // Use directory name
  }

  const hasAppDir = await directoryExists(join(projectPath, "app"));
  const hasAIDir = await directoryExists(join(projectPath, "ai"));
  const hasChatRoute = await fileExists(join(projectPath, "app/api/chat/route.ts"));
  const hasBlogDir = await directoryExists(join(projectPath, "app/blog")) ||
    await directoryExists(join(projectPath, "content"));
  const hasDocsDir = await directoryExists(join(projectPath, "app/docs")) ||
    await directoryExists(join(projectPath, "docs"));

  let template: string | undefined;
  if (hasAIDir || hasChatRoute) template = "ai";
  else if (hasBlogDir) template = "blog";
  else if (hasDocsDir) template = "docs";
  else if (hasAppDir) template = "app";

  const integrations: string[] = [];
  const authDir = join(projectPath, "app/api/auth");
  if (await directoryExists(authDir)) {
    try {
      for await (const entry of fs.readDir(authDir)) {
        if (
          entry.isDirectory &&
          !["login", "logout", "me", "signup", "register", "callback"].includes(entry.name)
        ) {
          integrations.push(entry.name);
        }
      }
    } catch {
      // Ignore
    }
  }

  return {
    name,
    path: projectPath,
    template,
    hasAI: hasAIDir || hasChatRoute,
    integrations,
  };
}

async function scanForProjects(
  baseDir: string,
  depth: number,
  projects: LocalProjectInfo[],
): Promise<void> {
  const fs = getFs();

  const project = await detectVeryfrontProject(baseDir);
  if (project) {
    projects.push(project);
    return;
  }

  if (depth <= 0) return;

  try {
    for await (const entry of fs.readDir(baseDir)) {
      if (!entry.isDirectory) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      await scanForProjects(join(baseDir, entry.name), depth - 1, projects);
    }
  } catch {
    // Permission error or not a directory
  }
}

export const vfListLocalProjects: MCPTool<ListLocalProjectsInput, LocalProjectInfo[]> = {
  name: "vf_list_local_projects",
  description:
    "Discover Veryfront projects on the local filesystem. Scans for veryfront.config.ts files and returns project info including template type and integrations.",
  inputSchema: listLocalProjectsInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_list_local_projects",
      async () => {
        const projects: LocalProjectInfo[] = [];
        await scanForProjects(input.directory ?? cwd(), input.depth, projects);
        return projects.sort((a, b) => a.name.localeCompare(b.name));
      },
      { "tool.depth": input.depth },
    ),
};

// ============================================================================
// Tool: vf_list_examples
// ============================================================================

const listExamplesInput = z.object({});

type ListExamplesInput = z.infer<typeof listExamplesInput>;

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

interface TemplateInfo {
  name: string;
  description: string;
  features: string[];
  recommended?: boolean;
}

const TEMPLATES: TemplateInfo[] = [
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
  category: z.enum(["all", "productivity", "development", "communication", "data", "ai"]).optional()
    .default("all")
    .describe("Filter integrations by category"),
});

type ListIntegrationsInput = z.infer<typeof listIntegrationsInput>;

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

export const vfListIntegrations: MCPTool<ListIntegrationsInput, IntegrationInfo[]> = {
  name: "vf_list_integrations",
  description:
    "List available service integrations (Gmail, Slack, GitHub, etc.). These can be added to AI projects to give agents access to external services.",
  inputSchema: listIntegrationsInput,
  execute: (input) => {
    if (input.category === "all") return Promise.resolve(INTEGRATIONS);
    return Promise.resolve(INTEGRATIONS.filter((i) => i.category === input.category));
  },
};

// ============================================================================
// Tool: vf_list_usecases
// ============================================================================

const listUsecasesInput = z.object({});

type ListUsecasesInput = z.infer<typeof listUsecasesInput>;

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
  template: z.enum(["ai", "app", "blog", "docs", "minimal"]).optional().default("ai").describe(
    "Project template to use",
  ),
  integrations: z.array(z.string()).optional().describe(
    "Service integrations to include (e.g., ['gmail', 'slack'])",
  ),
  directory: z.string().optional().describe(
    "Parent directory to create project in (defaults to current directory)",
  ),
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
          const { initCommand } = await import("../commands/init/index.js");

          const parentDir = input.directory ?? cwd();
          const projectDir = join(parentDir, toSlug(input.name));

          if (await directoryExists(projectDir)) {
            return { success: false, message: `Directory already exists: ${projectDir}` };
          }

          await initCommand({
            name: input.name,
            template: input.template,
            integrations: input.integrations as
              | import("../templates/types.js").IntegrationName[]
              | undefined,
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
        } catch (error) {
          return { success: false, message: `Failed to create project: ${formatError(error)}` };
        }
      },
      { "tool.name": input.name, "tool.template": input.template },
    ),
};

// ============================================================================
// Tool: vf_wait_for_ready
// ============================================================================

const waitForReadyInput = z.object({
  port: z.number().optional().default(8080).describe("Server port to check (defaults to 8080)"),
  timeout: z.number().optional().default(30000).describe(
    "Maximum time to wait in milliseconds (defaults to 30000)",
  ),
  interval: z.number().optional().default(500).describe(
    "Polling interval in milliseconds (defaults to 500)",
  ),
});

type WaitForReadyInput = z.infer<typeof waitForReadyInput>;

interface WaitForReadyResult {
  success: boolean;
  message: string;
  elapsed?: number;
}

export const vfWaitForReady: MCPTool<WaitForReadyInput, WaitForReadyResult> = {
  name: "vf_wait_for_ready",
  description:
    "Wait for the server to be ready by polling the health endpoint. Use this after starting the server to ensure it's accepting requests.",
  inputSchema: waitForReadyInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_wait_for_ready",
      async () => {
        const startTime = Date.now();
        const deadline = startTime + input.timeout;
        const url = `http://localhost:${input.port}/`;

        while (Date.now() < deadline) {
          try {
            const response = await dntShim.fetch(url, {
              method: "HEAD",
              signal: AbortSignal.timeout(2000),
            });

            if (response.ok || response.status < 500) {
              const elapsed = Date.now() - startTime;
              return { success: true, message: `Server ready on port ${input.port}`, elapsed };
            }
          } catch {
            // Server not ready yet, continue polling
          }

          await new Promise((resolve) => dntShim.setTimeout(resolve, input.interval));
        }

        return {
          success: false,
          message: `Timeout waiting for server on port ${input.port} after ${input.timeout}ms`,
          elapsed: input.timeout,
        };
      },
      { "tool.port": input.port, "tool.timeout": input.timeout },
    ),
};

// ============================================================================
// Tool: vf_get_flywheel_status
// ============================================================================

const getFlywheelStatusInput = z.object({
  port: z.number().optional().default(8080).describe("Server port (defaults to 8080)"),
});

type GetFlywheelStatusInput = z.infer<typeof getFlywheelStatusInput>;

interface FlywheelStatus {
  server: {
    running: boolean;
    port: number;
    url: string;
    uptime?: number;
  };
  errors: {
    total: number;
    compile: number;
    runtime: number;
    bundle: number;
    hmr: number;
    module: number;
    latest?: {
      type: string;
      message: string;
      file?: string;
      timestamp: number;
    };
  };
  logs: {
    total: number;
    errors: number;
    warnings: number;
  };
  hmr: {
    enabled: boolean;
    reloadListeners: number;
    invalidateListeners: number;
    triggerCalls: number;
    broadcastsSent: number;
  };
}

export const vfGetFlywheelStatus: MCPTool<GetFlywheelStatusInput, FlywheelStatus> = {
  name: "vf_get_flywheel_status",
  description:
    "Get aggregated status for the development flywheel. Shows server state, error counts, log summary, and HMR status in one view.",
  inputSchema: getFlywheelStatusInput,
  execute: (input) =>
    withSpan(
      "cli.mcp.tool.vf_get_flywheel_status",
      async () => {
        const port = input.port;
        const errorCollector = getErrorCollector();
        const logBuffer = getLogBuffer();
        const hmrMetrics = ReloadNotifier.getMetrics();

        let serverRunning = false;
        try {
          const response = await dntShim.fetch(`http://localhost:${port}/`, {
            method: "HEAD",
            signal: AbortSignal.timeout(2000),
          });
          serverRunning = response.ok || response.status < 500;
        } catch {
          serverRunning = false;
        }

        const errorCounts = errorCollector.countByType();
        const allErrors = errorCollector.getAll();
        const latestError = allErrors.at(-1);

        const logCounts = logBuffer.countByLevel();

        let uptime: number | undefined;
        const env = getRuntimeEnv();
        if (env.serverStartTime) uptime = Date.now() - parseInt(env.serverStartTime, 10);

        return {
          server: {
            running: serverRunning,
            port,
            url: `http://localhost:${port}`,
            uptime,
          },
          errors: {
            total: allErrors.length,
            compile: errorCounts.compile,
            runtime: errorCounts.runtime,
            bundle: errorCounts.bundle,
            hmr: errorCounts.hmr,
            module: errorCounts.module,
            latest: latestError
              ? {
                type: latestError.type,
                message: latestError.message,
                file: latestError.file,
                timestamp: latestError.timestamp,
              }
              : undefined,
          },
          logs: {
            total: logBuffer.count,
            errors: logCounts.error,
            warnings: logCounts.warn,
          },
          hmr: {
            enabled: hmrMetrics.activeReloadListeners > 0,
            reloadListeners: hmrMetrics.activeReloadListeners,
            invalidateListeners: hmrMetrics.activeInvalidateListeners,
            triggerCalls: hmrMetrics.triggerCalls,
            broadcastsSent: hmrMetrics.broadcastsSent,
          },
        };
      },
      { "tool.port": input.port },
    ),
};

// ============================================================================
// All Tools
// ============================================================================

export const advancedTools: MCPTool[] = [
  vfGetSkills,
  vfGetSkillReference,
  vfListLocalProjects,
  vfListExamples,
  vfListTemplates,
  vfListIntegrations,
  vfListUsecases,
  vfCreateProject,
  vfGetProjectContext,
  vfListRoutes,
  vfGetConventions,
  vfScaffold,
  vfPreviewRoute,
  vfGetDebugContext,
  vfGetComponentTree,
  vfHotReload,
  vfTriggerHmr,
  vfWaitForReady,
  vfGetFlywheelStatus,
];
