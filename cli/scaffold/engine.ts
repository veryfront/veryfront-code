import { dirname, isAbsolute, join, normalize, relative, resolve } from "veryfront/platform/path";
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
  resultPathMode?: "absolute" | "relative";
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
  failureKind?: ScaffoldFailureKind;
}

export type ScaffoldFailureKind =
  | "conflict"
  | "filesystem"
  | "invalid"
  | "limit"
  | "unsafe-path";

export interface AuthScaffoldInput {
  projectDir: string;
  preset: AuthPreset;
  filesForTesting?: ScaffoldFilePlan[];
  templateFilesForTesting?: ScaffoldFilePlan[];
  beforeWriteForTesting?: (file: ScaffoldFilePlan) => Promise<void>;
  failWriteAfterBytesForTesting?: number;
  beforeOpenForTesting?: (file: ScaffoldFilePlan) => Promise<void>;
  afterOpenForTesting?: (file: ScaffoldFilePlan) => Promise<void>;
  identityForTesting?: (info: Deno.FileInfo) => FileIdentity;
  removeForTesting?: (path: string) => Promise<void>;
  realPathForTesting?: (path: string) => Promise<string>;
}

interface ScaffoldDefinition {
  getPath: (input: ResolvedScaffoldInput) => string;
  getContent: (input: ResolvedScaffoldInput) => string;
}

interface ResolvedScaffoldInput
  extends Required<Omit<ScaffoldInput, "methods" | "resultPathMode">> {
  slug: string;
  componentName: string;
  methods: ScaffoldHttpMethod[];
}

const DEFAULT_METHODS: ScaffoldHttpMethod[] = ["GET"];
const MAX_AUTH_SCAFFOLD_FILES = 32;
const MAX_SCAFFOLD_PATH_BYTES = 240;
const MAX_SCAFFOLD_FILE_BYTES = 256 * 1024;
const MAX_SCAFFOLD_TOTAL_BYTES = 384 * 1024;

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
      failureKind: "conflict",
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
  return writeGuardedMultiFilePlan(
    planScaffold(input),
    input.projectDir,
    {
      allowNestedPaths: true,
      resultPathMode: input.resultPathMode ?? "absolute",
    },
  );
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
  const projectDir = resolve(input.projectDir);
  const files = (template ?? []).map((file) => ({
    path: join(projectDir, file.path),
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
      failureKind: "invalid",
    };
  }

  let plan: ScaffoldPlan;
  try {
    plan = await planAuthScaffold(input);
  } catch (error) {
    if (error instanceof UnsafeAuthTemplatePathError) {
      return failure([], "Unsafe auth template path", "unsafe-path");
    }
    return failure([], "Failed to load auth template");
  }
  if (plan.files.length === 0) {
    return {
      success: false,
      files: [],
      message: `Unknown auth preset "${input.preset}". Valid presets: ${AUTH_PRESETS.join(", ")}`,
      failureKind: "invalid",
    };
  }

  return writeGuardedMultiFilePlan(
    plan,
    input.projectDir,
    {
      allowNestedPaths: input.filesForTesting !== undefined,
      resultPathMode: "relative",
      beforeWrite: input.beforeWriteForTesting,
      failWriteAfterBytes: input.failWriteAfterBytesForTesting,
      beforeOpen: input.beforeOpenForTesting,
      afterOpen: input.afterOpenForTesting,
      identity: input.identityForTesting ?? fileIdentity,
      remove: input.removeForTesting,
      realPath: input.realPathForTesting,
    },
  );
}

async function writeGuardedMultiFilePlan(
  plan: ScaffoldPlan,
  projectDir: string,
  options: {
    allowNestedPaths: boolean;
    resultPathMode: "absolute" | "relative";
    beforeWrite?: (file: ScaffoldFilePlan) => Promise<void>;
    failWriteAfterBytes?: number;
    beforeOpen?: (file: ScaffoldFilePlan) => Promise<void>;
    afterOpen?: (file: ScaffoldFilePlan) => Promise<void>;
    identity?: (info: Deno.FileInfo) => FileIdentity;
    remove?: (path: string) => Promise<void>;
    realPath?: (path: string) => Promise<string>;
  },
): Promise<ScaffoldResult> {
  const root = resolve(projectDir);
  const identity = options.identity ?? fileIdentity;
  const realPath = options.realPath ?? Deno.realPath;
  const normalizedFiles = validatePlanPaths(plan, root, {
    allowNestedPaths: options.allowNestedPaths,
  });
  if ("error" in normalizedFiles) return normalizedFiles.error;

  const conflicts: string[] = [];
  let rootGuard: RootGuard;
  try {
    const rootStat = await Deno.lstat(root);
    if (!rootStat.isDirectory || rootStat.isSymlink) {
      return failure([], "Unsafe scaffold project root", "unsafe-path");
    }
    rootGuard = {
      identity: identity(rootStat),
      realPath: await realPath(root),
    };

    for (const file of normalizedFiles.files) {
      const unsafe = await findUnsafeExistingPrefix(root, file.path);
      if (unsafe) {
        return failure([], `Unsafe scaffold path: ${unsafe}`, "unsafe-path");
      }
      if (await pathExists(file.path)) {
        conflicts.push(formatResultPath(file, options.resultPathMode));
      }
    }
  } catch {
    return failure([], "Scaffold filesystem preflight failed");
  }

  if (conflicts.length) {
    return {
      success: false,
      files: conflicts.map((path) => ({ path, created: false })),
      message: `${plan.type} already exists at ${conflicts.join(", ")}`,
      failureKind: "conflict",
    };
  }

  const createdFiles: OwnedPath[] = [];
  const createdDirs: OwnedPath[] = [];
  const defaultWriter = async (file: ScaffoldFilePlan) => {
    await assertRootIdentity(root, rootGuard, identity, realPath);
    await options.beforeOpen?.(file);
    await assertRootIdentity(root, rootGuard, identity, realPath);
    const handle = await Deno.open(file.path, { write: true, createNew: true });
    let closed = false;
    try {
      await options.afterOpen?.(file);
      let opened: OwnedPath;
      try {
        opened = await verifyOpenedTarget(
          root,
          rootGuard,
          file.path,
          handle,
          identity,
          realPath,
        );
      } catch (error) {
        const handleIdentity = identity(await handle.stat());
        handle.close();
        closed = true;
        await removeUnsafeOpenedTarget(file.path, handleIdentity, identity, removeCreatedPath);
        throw error;
      }
      const content = new TextEncoder().encode(file.content);
      createdFiles.push(opened);
      let offset = 0;
      while (offset < content.byteLength) {
        const remainingBeforeFailure = options.failWriteAfterBytes === undefined
          ? content.byteLength - offset
          : options.failWriteAfterBytes - offset;
        if (remainingBeforeFailure <= 0) throw new Error("simulated partial write failure");
        const chunk = content.subarray(
          offset,
          Math.min(content.byteLength, offset + remainingBeforeFailure),
        );
        const written = await handle.write(chunk);
        if (written === 0) throw new Error("filesystem write made no progress");
        offset += written;
        if (options.failWriteAfterBytes !== undefined && offset >= options.failWriteAfterBytes) {
          throw new Error("simulated partial write failure");
        }
      }
    } finally {
      if (!closed) handle.close();
    }
  };
  const removeCreatedPath = options.remove ?? ((path: string) => Deno.remove(path));

  try {
    for (const file of normalizedFiles.files) {
      await assertRootIdentity(root, rootGuard, identity, realPath);
      await ensureSafeParentDirectories(root, dirname(file.path), createdDirs, identity);
      await options.beforeWrite?.(file);
      const unsafe = await findUnsafeExistingPrefix(root, file.path);
      if (unsafe) throw new Error(`Unsafe scaffold path: ${unsafe}`);
      await defaultWriter(file);
    }
  } catch (error) {
    const cleanupErrors: string[] = [];
    for (const owned of createdFiles.toReversed()) {
      try {
        const removed = await removeOwnedPath(
          root,
          rootGuard,
          owned,
          removeCreatedPath,
          identity,
          realPath,
        );
        if (!removed) cleanupErrors.push(relative(root, owned.path));
      } catch {
        cleanupErrors.push(relative(root, owned.path));
      }
    }
    for (const owned of createdDirs.toReversed()) {
      try {
        const removed = await removeOwnedPath(
          root,
          rootGuard,
          owned,
          removeCreatedPath,
          identity,
          realPath,
        );
        if (!removed) cleanupErrors.push(relative(root, owned.path));
      } catch {
        cleanupErrors.push(relative(root, owned.path));
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
    files: normalizedFiles.files.map((file) => ({
      path: formatResultPath(file, options.resultPathMode),
      created: true,
    })),
    message: `Created ${plan.type} "${plan.name}" successfully`,
  };
}

function formatResultPath(
  file: NormalizedFilePlan,
  mode: "absolute" | "relative",
): string {
  return mode === "relative" ? file.relativePath : file.path;
}

interface NormalizedFilePlan extends ScaffoldFilePlan {
  relativePath: string;
}

function validatePlanPaths(
  plan: ScaffoldPlan,
  root: string,
  options: { allowNestedPaths: boolean },
): { files: NormalizedFilePlan[] } | { error: ScaffoldResult } {
  if (plan.files.length === 0) {
    return { error: failure([], "Scaffold plan must contain files", "invalid") };
  }
  if (plan.files.length > MAX_AUTH_SCAFFOLD_FILES) {
    return { error: failure([], "Scaffold plan contains too many files", "limit") };
  }

  const seen = new Set<string>();
  const normalized: NormalizedFilePlan[] = [];
  let totalBytes = 0;
  for (const file of plan.files) {
    if (!isSafeAbsoluteTargetPath(file.path, root)) {
      return { error: failure([], "Unsafe scaffold path", "unsafe-path") };
    }

    const absolute = normalize(file.path);
    const rel = relative(root, absolute);
    const relativeParts = pathParts(rel);
    if (!rel || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
      return { error: failure([], "Unsafe scaffold path", "unsafe-path") };
    }
    if (!options.allowNestedPaths && relativeParts.length !== 1) {
      return { error: failure([], "Unsafe scaffold path", "unsafe-path") };
    }
    if (relativeParts.some((part) => !isSafePathComponent(part))) {
      return { error: failure([], "Unsafe scaffold path", "unsafe-path") };
    }
    const pathBytes = new TextEncoder().encode(rel).byteLength;
    if (pathBytes > MAX_SCAFFOLD_PATH_BYTES) {
      return { error: failure([], "Scaffold path is too long", "limit") };
    }
    const contentBytes = new TextEncoder().encode(file.content).byteLength;
    if (contentBytes > MAX_SCAFFOLD_FILE_BYTES) {
      return { error: failure([], "Scaffold file is too large", "limit") };
    }
    totalBytes += contentBytes;
    if (totalBytes > MAX_SCAFFOLD_TOTAL_BYTES) {
      return { error: failure([], "Scaffold plan is too large", "limit") };
    }
    if (seen.has(absolute)) {
      return { error: failure([], "Duplicate scaffold path", "invalid") };
    }
    seen.add(absolute);
    normalized.push({ path: absolute, relativePath: rel, content: file.content });
  }

  return {
    files: normalized.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

function isSafeAuthTemplatePath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\\")) return false;
  const parts = path.split("/");
  if (parts.length !== 1) return false;
  return parts.every(isSafePathComponent);
}

function isSafeAbsoluteTargetPath(path: string, root: string): boolean {
  if (!path || !isAbsolute(path)) return false;
  const normalizedRoot = normalize(root);
  const normalizedPath = normalize(path);
  const lexicalRelativePath = lexicalRelativeChildPath(normalizedRoot, path);
  if (lexicalRelativePath === null) return false;
  if (!lexicalRelativePath.split(/[\\/]/).every(isSafePathComponent)) return false;
  const relativePath = relative(normalizedRoot, normalizedPath);
  if (!isContainedRelativePath(relativePath)) return false;
  return pathParts(relativePath).every(isSafePathComponent);
}

function pathParts(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part.length > 0);
}

function lexicalRelativeChildPath(root: string, path: string): string | null {
  const portableRoot = root.replaceAll("\\", "/");
  const portablePath = path.replaceAll("\\", "/");
  const prefix = portableRoot.endsWith("/") ? portableRoot : `${portableRoot}/`;
  if (!portablePath.startsWith(prefix)) return null;
  const relativePath = portablePath.slice(prefix.length);
  return relativePath.length === 0 ? null : relativePath;
}

function isSafePathComponent(part: string): boolean {
  if (!part || part === "." || part === ".." || part.includes(":")) return false;
  if (/[. ]$/.test(part)) return false;
  const base = part.split(".")[0] ?? part;
  return !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(base);
}

class UnsafeAuthTemplatePathError extends Error {}

export type FileIdentity = {
  dev: number;
  ino: number;
} | null;

interface RootGuard {
  identity: FileIdentity;
  realPath: string;
}

interface OwnedPath {
  path: string;
  identity: FileIdentity;
}

function fileIdentity(info: Deno.FileInfo): FileIdentity {
  if (typeof info.dev === "number" && typeof info.ino === "number") {
    return { dev: info.dev, ino: info.ino };
  }
  return null;
}

function sameIdentity(a: FileIdentity, b: FileIdentity): boolean {
  if (a === null || b === null) return false;
  return a.dev === b.dev && a.ino === b.ino;
}

async function assertRootIdentity(
  root: string,
  expected: RootGuard,
  identity: (info: Deno.FileInfo) => FileIdentity,
  realPath: (path: string) => Promise<string>,
): Promise<void> {
  const current = await Deno.lstat(root);
  if (!current.isDirectory || current.isSymlink) {
    throw new Error("Unsafe scaffold project root");
  }
  const currentIdentity = identity(current);
  if (expected.identity !== null && !sameIdentity(currentIdentity, expected.identity)) {
    throw new Error("Unsafe scaffold project root");
  }
  if (expected.identity === null && await realPath(root) !== expected.realPath) {
    throw new Error("Unsafe scaffold project root");
  }
}

async function verifyOpenedTarget(
  root: string,
  rootGuard: RootGuard,
  path: string,
  handle: Deno.FsFile,
  identity: (info: Deno.FileInfo) => FileIdentity,
  realPath: (path: string) => Promise<string>,
): Promise<OwnedPath> {
  await assertRootIdentity(root, rootGuard, identity, realPath);
  const targetRealPath = await realPath(path);
  if (!isRealPathInsideRoot(rootGuard.realPath, targetRealPath)) {
    throw new Error("Unsafe scaffold path");
  }
  const handleIdentity = identity(await handle.stat());
  const pathIdentity = identity(await Deno.lstat(path));
  if (
    handleIdentity !== null && pathIdentity !== null &&
    !sameIdentity(handleIdentity, pathIdentity)
  ) {
    throw new Error("Unsafe scaffold path");
  }
  return { path, identity: handleIdentity };
}

async function removeOwnedPath(
  root: string,
  rootGuard: RootGuard,
  owned: OwnedPath,
  remove: (path: string) => Promise<void>,
  identity: (info: Deno.FileInfo) => FileIdentity,
  realPath: (path: string) => Promise<string>,
): Promise<boolean> {
  if (owned.identity === null) return false;
  await assertRootIdentity(root, rootGuard, identity, realPath);
  const current = await Deno.lstat(owned.path);
  if (!sameIdentity(identity(current), owned.identity)) return false;
  await remove(owned.path);
  return true;
}

function isRealPathInsideRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return isContainedRelativePath(relativePath);
}

function isContainedRelativePath(relativePath: string): boolean {
  if (relativePath === "." || isAbsolute(relativePath)) return false;
  const firstPart = pathParts(relativePath)[0];
  return firstPart !== undefined && firstPart !== "..";
}

async function removeUnsafeOpenedTarget(
  path: string,
  handleIdentity: FileIdentity,
  identity: (info: Deno.FileInfo) => FileIdentity,
  remove: (path: string) => Promise<void>,
): Promise<void> {
  if (handleIdentity === null) return;
  let pathIdentity: FileIdentity;
  try {
    pathIdentity = identity(await Deno.lstat(path));
  } catch {
    return;
  }
  if (sameIdentity(handleIdentity, pathIdentity)) {
    await remove(path);
  }
}

async function findUnsafeExistingPrefix(root: string, target: string): Promise<string | null> {
  const relativeTarget = relative(root, target);
  let current = root;
  for (const part of pathParts(relativeTarget)) {
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
  createdDirs: OwnedPath[],
  identity: (info: Deno.FileInfo) => FileIdentity,
): Promise<void> {
  const relativeParent = relative(root, parent);
  let current = root;
  for (const part of pathParts(relativeParent)) {
    current = join(current, part);
    try {
      const stat = await Deno.lstat(current);
      if (stat.isSymlink || !stat.isDirectory) {
        throw new Error(`Unsafe scaffold path: ${relative(root, current)}`);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await Deno.mkdir(current);
      createdDirs.push({
        path: current,
        identity: identity(await Deno.lstat(current)),
      });
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

function failure(
  files: ScaffoldResult["files"],
  message: string,
  failureKind: ScaffoldFailureKind = "filesystem",
): ScaffoldResult {
  return { success: false, files, message, failureKind };
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
    projectDir: resolve(input.projectDir),
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
