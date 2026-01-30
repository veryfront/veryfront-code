/**
 * MCP tools for project discovery and analysis.
 */

import { z } from "zod";
import type { FileSystem } from "../../../platform/compat/fs.js";
import { join } from "../../../platform/compat/path/index.js";
import { cwd } from "../../../platform/compat/process.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import type { MCPTool } from "../tools.js";
import {
  directoryExists,
  fileExists,
  getFs,
  getProjectDir,
  type ProjectContext,
  ROUTE_FILTER_MAP,
  type RouteInfo,
  scanDirectory,
  toComponentName,
} from "./helpers.js";

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
