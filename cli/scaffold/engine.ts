import { dirname, join } from "#std/path.ts";
import { createFileSystem } from "veryfront/platform";
import { ensureDir, fileExists } from "../utils/fs.ts";
import { toComponentName, toSlug } from "../utils/string.ts";

export type ScaffoldRouter = "app-router" | "pages-router";
export const SCAFFOLD_TYPES = [
  "page",
  "api",
  "layout",
  "component",
  "tool",
  "agent",
  "prompt",
  "workflow",
  "task",
  "resource",
  "skill",
] as const;
export type ScaffoldType = typeof SCAFFOLD_TYPES[number];
export type ScaffoldHttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ScaffoldInput {
  projectDir: string;
  type: ScaffoldType;
  name: string;
  router?: ScaffoldRouter;
  methods?: ScaffoldHttpMethod[];
}

export interface ScaffoldFilePlan {
  path: string;
  content: string;
}

export interface ScaffoldPlan {
  type: ScaffoldType;
  name: string;
  files: ScaffoldFilePlan[];
}

export interface ScaffoldResult {
  success: boolean;
  files: Array<{ path: string; created: boolean }>;
  message: string;
}

interface ScaffoldDefinition {
  getPath: (input: ResolvedScaffoldInput) => string;
  getContent: (input: ResolvedScaffoldInput) => string;
}

interface ResolvedScaffoldInput extends Required<Omit<ScaffoldInput, "methods">> {
  slug: string;
  componentName: string;
  methods: ScaffoldHttpMethod[];
}

const DEFAULT_METHODS: ScaffoldHttpMethod[] = ["GET"];

const SCAFFOLD_DEFINITIONS: Record<ScaffoldType, ScaffoldDefinition> = {
  page: {
    getPath: ({ projectDir, router, slug }) =>
      router === "app-router"
        ? join(projectDir, "app", slug, "page.tsx")
        : joinPagesFile(join(projectDir, "pages"), slug, ".mdx"),
    getContent: ({ router, slug, componentName }) => {
      const title = slug.split("/").pop() || "Page";
      if (router === "app-router") return generateAppPageTemplate(title, componentName);
      return generatePagesPageTemplate(title);
    },
  },
  api: {
    getPath: ({ projectDir, router, slug }) =>
      router === "app-router"
        ? join(projectDir, "app", slug, "route.ts")
        : joinPagesFile(join(projectDir, "pages", "api"), slug, ".ts"),
    getContent: ({ router, methods }) => generateApiTemplate(methods, router),
  },
  layout: {
    getPath: ({ projectDir, router, slug, componentName }) =>
      router === "app-router"
        ? join(projectDir, "app", slug, "layout.tsx")
        : join(projectDir, "layouts", `${componentName || "Layout"}.mdx`),
    getContent: ({ router, slug, componentName }) =>
      router === "app-router"
        ? generateAppLayoutTemplate(slug)
        : generatePagesLayoutTemplate(slug, componentName),
  },
  component: {
    getPath: ({ projectDir, componentName }) =>
      join(projectDir, "components", `${componentName}.tsx`),
    getContent: ({ componentName }) => generateComponentTemplate(componentName),
  },
  tool: {
    getPath: ({ projectDir, slug }) => join(projectDir, "tools", `${slug}.ts`),
    getContent: ({ name }) => generateToolTemplate(name),
  },
  agent: {
    getPath: ({ projectDir, slug }) => join(projectDir, "agents", `${slug}.ts`),
    getContent: ({ name, slug }) => generateAgentTemplate(name, slug),
  },
  prompt: {
    getPath: ({ projectDir, slug }) => join(projectDir, "prompts", `${slug}.ts`),
    getContent: ({ slug }) => generatePromptTemplate(slug.replace(/-/g, "_")),
  },
  workflow: {
    getPath: ({ projectDir, slug }) => join(projectDir, "workflows", `${slug}.ts`),
    getContent: ({ slug }) => generateWorkflowTemplate(slug),
  },
  task: {
    getPath: ({ projectDir, slug }) => join(projectDir, "tasks", `${slug}.ts`),
    getContent: ({ slug }) => generateTaskTemplate(slug),
  },
  resource: {
    getPath: ({ projectDir, slug }) => join(projectDir, "resources", `${slug}.ts`),
    getContent: ({ slug }) => generateResourceTemplate(slug),
  },
  skill: {
    getPath: ({ projectDir, slug }) => join(projectDir, "skills", slug, "SKILL.md"),
    getContent: ({ slug }) => generateSkillTemplate(slug),
  },
};

export function isScaffoldType(type: string): type is ScaffoldType {
  return SCAFFOLD_TYPES.includes(type as ScaffoldType);
}

export function planScaffold(input: ScaffoldInput): ScaffoldPlan {
  const resolved = resolveInput(input);
  const definition = SCAFFOLD_DEFINITIONS[resolved.type];
  const file = {
    path: definition.getPath(resolved),
    content: definition.getContent(resolved),
  };

  return {
    type: resolved.type,
    name: resolved.name,
    files: [file],
  };
}

export async function writeScaffoldPlan(plan: ScaffoldPlan): Promise<ScaffoldResult> {
  const conflicts: string[] = [];

  for (const file of plan.files) {
    if (await fileExists(file.path)) conflicts.push(file.path);
  }

  if (conflicts.length) {
    return {
      success: false,
      files: conflicts.map((path) => ({ path, created: false })),
      message: `${plan.type} already exists at ${conflicts.join(", ")}`,
    };
  }

  const fs = createFileSystem();

  for (const file of plan.files) {
    await ensureDir(dirname(file.path));
    await fs.writeTextFile(file.path, file.content);
  }

  return {
    success: true,
    files: plan.files.map((file) => ({ path: file.path, created: true })),
    message: `Created ${plan.type} "${plan.name}" successfully`,
  };
}

export async function scaffoldProjectFile(input: ScaffoldInput): Promise<ScaffoldResult> {
  return writeScaffoldPlan(planScaffold(input));
}

function resolveInput(input: ScaffoldInput): ResolvedScaffoldInput {
  const slug = toSlug(input.name);
  return {
    projectDir: input.projectDir,
    type: input.type,
    name: input.name,
    router: input.router ?? "app-router",
    methods: input.methods?.length ? input.methods : DEFAULT_METHODS,
    slug,
    componentName: toComponentName(slug),
  };
}

function joinPagesFile(base: string, slug: string, extension: ".mdx" | ".ts"): string {
  const parts = slug.split("/").filter(Boolean);
  const fileName = `${parts.pop() || "index"}${extension}`;
  return parts.length ? join(base, ...parts, fileName) : join(base, fileName);
}

function generateAppPageTemplate(title: string, componentName: string): string {
  return `export default function ${componentName || "Page"}() {
  return <div>${title}</div>;
}
`;
}

function generatePagesPageTemplate(title: string): string {
  return `---
title: ${title}
---

# ${title}

This is a new page.
`;
}

function generateAppLayoutTemplate(slug: string): string {
  return `export default function Layout({ children }: { children: React.ReactNode }) {
  return <section data-route="${slug || "root"}">{children}</section>;
}
`;
}

function generatePagesLayoutTemplate(slug: string, componentName: string): string {
  const layoutName = componentName || "Layout";
  return `---
isLayout: true
---

export default function ${layoutName}({ children }) {
  return (
    <div className="${slug}-layout">
      <main>{children}</main>
    </div>
  );
}
`;
}

function generateApiTemplate(methods: ScaffoldHttpMethod[], router: ScaffoldRouter): string {
  const handlers = methods.map((method) => {
    if (method === "GET") {
      return router === "app-router"
        ? `export const GET = (_req: Request) => Response.json({ ok: true });`
        : `export function GET(_req: Request) {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
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
  return `import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

const inputSchema = defineSchema((v) => v.object({
  input: v.string().describe("Input parameter"),
}))();

export default tool({
  id: "${name}",
  description: "Description of what this tool does",
  inputSchema,
  execute: ({ input }) => {
    return { result: input };
  },
});
`;
}

function generateAgentTemplate(name: string, slug: string): string {
  return `import { agent } from "veryfront/agent";

export default agent({
  id: "${slug}",
  system: "You are an assistant specialized in ${name}. Answer clearly and ask for missing context.",
});
`;
}

function generatePromptTemplate(name: string): string {
  return `import { prompt } from "veryfront/prompt";

export default prompt({
  id: "${name}",
  description: "Description of this prompt template",
  content: "Use the following input:\\n\\n{input}",
});
`;
}

function generateWorkflowTemplate(slug: string): string {
  const title = toTitle(slug);
  return `import { step, workflow } from "veryfront/workflow";

export default workflow({
  id: "${slug}",
  description: "${title} workflow",
  steps: [
    step("start", {
      agent: "assistant",
    }),
  ],
});
`;
}

function generateTaskTemplate(slug: string): string {
  const title = toTitle(slug);
  return `export default {
  name: "${title}",
  description: "Run ${title.toLowerCase()}.",
  schedulable: false,
  async run() {
    return { ok: true };
  },
};
`;
}

function generateResourceTemplate(slug: string): string {
  const title = toTitle(slug);
  return `import { resource } from "veryfront/resource";
import { defineSchema } from "veryfront/schemas";

export default resource({
  description: "Load ${title.toLowerCase()}.",
  paramsSchema: defineSchema((v) => v.object({}))(),
  load: async () => {
    return { content: "${title}" };
  },
});
`;
}

function generateSkillTemplate(slug: string): string {
  const title = toTitle(slug);
  return `---
name: ${slug}
description: ${title} instructions.
---

# ${title}

Use this skill when the task requires ${title.toLowerCase()}.
`;
}

function toTitle(value: string): string {
  return value
    .split(/[-/_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Item";
}
