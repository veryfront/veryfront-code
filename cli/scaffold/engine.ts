import {
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "veryfront/platform/path";
import { createFileSystem } from "veryfront/platform";
import { ensureDir, fileExists } from "../utils/fs.ts";
import { toComponentName, toSlug } from "../utils/string.ts";
import { filenameToId } from "veryfront/discovery";
import { getAuthTemplate } from "../../templates/loader.ts";

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
export const AUTH_PRESETS = ["authelia", "oidc", "microsoft-entra"] as const;
export type AuthPreset = typeof AUTH_PRESETS[number];
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
  type: ScaffoldType | "auth";
  name: string;
  files: ScaffoldFilePlan[];
}

export interface ScaffoldResult {
  success: boolean;
  files: Array<{ path: string; created: boolean }>;
  message: string;
}

export interface AuthScaffoldInput {
  projectDir: string;
  preset: AuthPreset;
  filesForTesting?: ScaffoldFilePlan[];
  templateFilesForTesting?: ScaffoldFilePlan[];
  beforeWriteForTesting?: (file: ScaffoldFilePlan) => Promise<void>;
  removeForTesting?: (path: string) => Promise<void>;
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
const MAX_AUTH_SCAFFOLD_FILES = 32;

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
    // Both routers serve API handlers from an "api" segment, so the segment is
    // owned by the scaffold rather than the caller. Accept a slug that already
    // spells it so `generate api api/users/[id]` does not nest a second one.
    getPath: ({ projectDir, router, slug }) =>
      router === "app-router"
        ? join(projectDir, "app", "api", stripApiPrefix(slug), "route.ts")
        : joinPagesFile(join(projectDir, "pages", "api"), stripApiPrefix(slug), ".ts"),
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
    // Discovery derives a tool's id from its filename, and an explicit `id`
    // overrides that. Declare the id discovery would have derived so the
    // generated tool registers under the name the filename promises.
    getContent: ({ slug }) => generateToolTemplate(filenameToId(`${slug}.ts`)),
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
  return SCAFFOLD_TYPES.some((candidate) => candidate === type);
}

export function isAuthPreset(preset: string): preset is AuthPreset {
  return AUTH_PRESETS.some((candidate) => candidate === preset);
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

export async function planAuthScaffold(input: AuthScaffoldInput): Promise<ScaffoldPlan> {
  if (!isAuthPreset(input.preset)) {
    return { type: "auth", name: input.preset, files: [] };
  }

  if (input.filesForTesting) {
    return {
      type: "auth",
      name: input.preset,
      files: input.filesForTesting,
    };
  }

  const template = input.templateFilesForTesting ?? await getAuthTemplate(input.preset);
  if (template?.some((file) => !isSafeAuthTemplatePath(file.path))) {
    throw new UnsafeAuthTemplatePathError();
  }
  const files = (template ?? []).map((file) => ({
    path: join(input.projectDir, file.path),
    content: file.content,
  }));

  return {
    type: "auth",
    name: input.preset,
    files,
  };
}

export async function scaffoldAuthFiles(input: AuthScaffoldInput): Promise<ScaffoldResult> {
  if (!isAuthPreset(input.preset)) {
    return {
      success: false,
      files: [],
      message: `Unknown auth preset "${input.preset}". Valid presets: ${AUTH_PRESETS.join(", ")}`,
    };
  }

  let plan: ScaffoldPlan;
  try {
    plan = await planAuthScaffold(input);
  } catch (error) {
    if (error instanceof UnsafeAuthTemplatePathError) {
      return failure([], "Unsafe auth template path");
    }
    return failure([], "Failed to load auth template");
  }
  if (plan.files.length === 0) {
    return {
      success: false,
      files: [],
      message: `Unknown auth preset "${input.preset}". Valid presets: ${AUTH_PRESETS.join(", ")}`,
    };
  }

  return writeGuardedMultiFilePlan(
    plan,
    input.projectDir,
    input.beforeWriteForTesting,
    input.removeForTesting,
  );
}

async function writeGuardedMultiFilePlan(
  plan: ScaffoldPlan,
  projectDir: string,
  beforeWrite?: (file: ScaffoldFilePlan) => Promise<void>,
  remove?: (path: string) => Promise<void>,
): Promise<ScaffoldResult> {
  const root = resolve(projectDir);
  const normalizedFiles = validatePlanPaths(plan, root);
  if ("error" in normalizedFiles) return normalizedFiles.error;

  const conflicts: string[] = [];
  try {
    const rootStat = await Deno.stat(root);
    if (!rootStat.isDirectory) return failure([], "Unsafe scaffold project root");

    for (const file of normalizedFiles.files) {
      const unsafe = await findUnsafeExistingPrefix(root, file.path);
      if (unsafe) {
        return failure([], `Unsafe scaffold path: ${unsafe}`);
      }
      if (await pathExists(file.path)) conflicts.push(file.relativePath);
    }
  } catch {
    return failure([], "Scaffold filesystem preflight failed");
  }

  if (conflicts.length) {
    return {
      success: false,
      files: conflicts.map((path) => ({ path, created: false })),
      message: `${plan.type} already exists at ${conflicts.join(", ")}`,
    };
  }

  const createdFiles: string[] = [];
  const createdDirs: string[] = [];
  const defaultWriter = async (file: ScaffoldFilePlan) => {
    const handle = await Deno.open(file.path, { write: true, createNew: true });
    createdFiles.push(file.path);
    try {
      const content = new TextEncoder().encode(file.content);
      let offset = 0;
      while (offset < content.byteLength) {
        const written = await handle.write(content.subarray(offset));
        if (written === 0) throw new Error("filesystem write made no progress");
        offset += written;
      }
    } finally {
      handle.close();
    }
  };
  const removeCreatedPath = remove ?? ((path: string) => Deno.remove(path));

  try {
    for (const file of normalizedFiles.files) {
      await ensureSafeParentDirectories(root, dirname(file.path), createdDirs);
      await beforeWrite?.(file);
      const unsafe = await findUnsafeExistingPrefix(root, file.path);
      if (unsafe) throw new Error(`Unsafe scaffold path: ${unsafe}`);
      await defaultWriter(file);
    }
  } catch (error) {
    const cleanupErrors: string[] = [];
    for (const path of createdFiles.toReversed()) {
      try {
        await removeCreatedPath(path);
      } catch {
        cleanupErrors.push(relative(root, path));
      }
    }
    for (const path of createdDirs.toReversed()) {
      try {
        await removeCreatedPath(path);
      } catch {
        cleanupErrors.push(relative(root, path));
      }
    }

    const cleanup = cleanupErrors.length
      ? ` Rollback could not remove: ${cleanupErrors.join(", ")}`
      : "";
    return failure(
      [],
      `Failed to create scaffold: ${sanitizeError(error)}.${cleanup}`,
    );
  }

  return {
    success: true,
    files: normalizedFiles.files.map((file) => ({ path: file.relativePath, created: true })),
    message: `Created ${plan.type} "${plan.name}" successfully`,
  };
}

interface NormalizedFilePlan extends ScaffoldFilePlan {
  relativePath: string;
}

function validatePlanPaths(
  plan: ScaffoldPlan,
  root: string,
): { files: NormalizedFilePlan[] } | { error: ScaffoldResult } {
  if (plan.files.length === 0) return { error: failure([], "Scaffold plan must contain files") };
  if (plan.files.length > MAX_AUTH_SCAFFOLD_FILES) {
    return { error: failure([], "Scaffold plan contains too many files") };
  }

  const seen = new Set<string>();
  const normalized: NormalizedFilePlan[] = [];
  for (const file of plan.files) {
    if (!isSafeAbsoluteTargetPath(file.path, root)) {
      return { error: failure([], "Unsafe scaffold path") };
    }

    const absolute = normalize(file.path);
    const rel = relative(root, absolute);
    if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
      return { error: failure([], "Unsafe scaffold path") };
    }
    if (rel.split("/").some((part) => !part || part === "." || part === "..")) {
      return { error: failure([], "Unsafe scaffold path") };
    }
    if (seen.has(absolute)) return { error: failure([], "Duplicate scaffold path") };
    seen.add(absolute);
    normalized.push({ path: absolute, relativePath: rel, content: file.content });
  }

  return {
    files: normalized.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

function isSafeAuthTemplatePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\\")) return false;
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function isSafeAbsoluteTargetPath(path: string, root: string): boolean {
  if (!path || !isAbsolute(path)) return false;
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!path.startsWith(rootPrefix)) return false;

  const relativePath = path.slice(rootPrefix.length);
  if (!relativePath || relativePath.includes(sep === "/" ? "\\" : "/")) return false;
  return relativePath.split(sep).every((part) => part !== "" && part !== "." && part !== "..");
}

class UnsafeAuthTemplatePathError extends Error {}

async function findUnsafeExistingPrefix(root: string, target: string): Promise<string | null> {
  const relativeTarget = relative(root, target);
  let current = root;
  for (const part of relativeTarget.split("/").filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink) return relative(root, current);
      if (current !== target && !stat.isDirectory) return relative(root, current);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null;
      return relative(root, current);
    }
  }
  return null;
}

async function ensureSafeParentDirectories(
  root: string,
  parent: string,
  createdDirs: string[],
): Promise<void> {
  const relativeParent = relative(root, parent);
  let current = root;
  for (const part of relativeParent.split("/").filter(Boolean)) {
    current = join(current, part);
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink || !stat.isDirectory) {
        throw new Error(`Unsafe scaffold path: ${relative(root, current)}`);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await Deno.mkdir(current);
      createdDirs.push(current);
    }
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function failure(files: ScaffoldResult["files"], message: string): ScaffoldResult {
  return { success: false, files, message };
}

function sanitizeError(error: unknown): string {
  if (error instanceof Deno.errors.AlreadyExists) return "target already exists";
  if (error instanceof Error && error.message.startsWith("Unsafe scaffold path:")) {
    return error.message;
  }
  return "filesystem write failed";
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

function stripApiPrefix(slug: string): string {
  return slug === "api" ? "" : slug.replace(/^api\//, "");
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

function generateToolTemplate(id: string): string {
  return `import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

const inputSchema = defineSchema((v) => v.object({
  input: v.string().describe("Input parameter"),
}))();

export default tool({
  id: "${id}",
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
