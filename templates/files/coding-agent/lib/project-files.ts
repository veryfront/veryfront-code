import type { ToolExecutionContext } from "veryfront/tool";
import { cwd, exists, readDir, readTextFile, realPath, resolve, writeTextFile } from "veryfront/fs";

/**
 * Read and write the project's files wherever the agent runs.
 *
 * Locally (`veryfront dev`) the project is the folder the app runs from. On
 * Veryfront Cloud that folder is the runtime's own, so the tools use the
 * platform file operations that a hosted agent run grants to them through
 * `context.executePlatformTool`. Each tool declares the operations it calls in
 * `delegatedPlatformTools`.
 */
export interface ProjectFiles {
  /** Names of the files directly inside `directory`. */
  list(directory: string): Promise<{ files: string[] } | { notFound: true } | { escapes: true }>;
  read(path: string): Promise<{ content: string } | { notFound: true } | { escapes: true }>;
  write(path: string, content: string): Promise<void>;
  /** A sentence to add to a not-found answer when the files may live elsewhere, or "". */
  notFoundHint(): Promise<string>;
}

type ExecutePlatformTool = NonNullable<ToolExecutionContext["executePlatformTool"]>;

/**
 * Use the hosted file operations when the run grants them, else the local folder.
 *
 * The agent runtime offers `executePlatformTool` to every tool that declares
 * `delegatedPlatformTools`, including under `veryfront dev` and in runs that
 * admit no platform operation. There the first call is refused with
 * `permission-denied`, and the tools fall back to the folder they run from.
 */
export function projectFiles(context?: ToolExecutionContext, root: string = cwd()): ProjectFiles {
  const local = localProjectFiles(root);
  const execute = context?.executePlatformTool;
  if (!execute) return local;
  const branch = typeof context?.branch === "string" && context.branch !== "main"
    ? context.branch
    : undefined;
  return withLocalFallback(
    hostedProjectFiles(execute, context?.projectSlug ?? context?.projectId, branch),
    local,
  );
}

/** True for the runtime's refusal of a platform operation this run does not admit. */
function isNotGranted(error: unknown): boolean {
  return record(error).slug === "permission-denied";
}

/** True for a platform answer that the file does not exist, thrown or returned. */
function isNotFound(error: unknown): boolean {
  const { slug, status, message } = record(error);
  return slug === "resource-not-found" || slug === "not-found" || status === 404 ||
    (typeof message === "string" && /not found/i.test(message));
}

/** Throw a platform operation's returned error result instead of reading it as data. */
function assertNotErrorResult(result: Record<string, unknown>, name: string): void {
  if (result.isError !== true) return;
  const message = typeof result.message === "string" ? result.message : `${name} failed`;
  throw new Error(message);
}

/**
 * Use `hosted` until it refuses its first operation as not granted, then `local`.
 *
 * Once a hosted operation has succeeded the choice is fixed, so a refused save
 * after a hosted read surfaces instead of writing to the runtime's own folder.
 */
function withLocalFallback(hosted: ProjectFiles, local: ProjectFiles): ProjectFiles {
  let source: ProjectFiles | undefined;
  async function run<T>(operation: (files: ProjectFiles) => Promise<T>): Promise<T> {
    if (source) return await operation(source);
    try {
      const result = await operation(hosted);
      source = hosted;
      return result;
    } catch (error) {
      if (!isNotGranted(error)) throw error;
      source = local;
      return await operation(local);
    }
  }
  return {
    list: (directory) => run((files) => files.list(directory)),
    read: (path) => run((files) => files.read(path)),
    write: (path, content) => run((files) => files.write(path, content)),
    notFoundHint: () => (source ?? hosted).notFoundHint(),
  };
}

/** True when `target` is the same as, or nested under, `root` (both canonical). */
function isWithin(root: string, target: string): boolean {
  const r = root.replace(/\\/g, "/");
  const t = target.replace(/\\/g, "/");
  return t === r || t.startsWith(`${r}/`);
}

/** The project folder on this machine. */
export function localProjectFiles(root: string): ProjectFiles {
  // Canonicalize both sides so a symlink that points outside the project is
  // resolved to its real target before the containment check.
  async function locate(path: string): Promise<string | { notFound: true } | { escapes: true }> {
    let projectDir: string;
    let absolute: string;
    try {
      projectDir = await realPath(root);
      absolute = await realPath(resolve(projectDir, path));
    } catch {
      return { notFound: true };
    }
    return isWithin(projectDir, absolute) ? absolute : { escapes: true };
  }

  return {
    async list(directory) {
      const absolute = await locate(directory);
      if (typeof absolute !== "string") return absolute;
      // `readDir` streams entries, so collect the files before filtering.
      const files: string[] = [];
      for await (const entry of readDir(absolute)) {
        if (entry.isFile) files.push(entry.name);
      }
      return { files };
    },
    async read(path) {
      const absolute = await locate(path);
      if (typeof absolute !== "string") return absolute;
      return { content: await readTextFile(absolute) };
    },
    async write(path, content) {
      const absolute = await locate(path);
      if (typeof absolute !== "string") {
        throw new Error(
          "escapes" in absolute
            ? `Path escapes project directory: ${path}`
            : `File not found: ${path}`,
        );
      }
      await writeTextFile(absolute, content);
    },
    async notFoundHint() {
      // A scaffolded project always has the `tools/` folder these tools live
      // in. Without it this process runs outside the project, as on Veryfront
      // Cloud when the run does not grant the platform file operations.
      if (await exists(resolve(root, "tools"))) return "";
      return "This runtime has no local copy of the project files. Run the agent with `veryfront dev` in the project folder, or from an agent run on Veryfront Cloud.";
    },
  };
}

/**
 * Normalize a project-relative path for the platform file API.
 *
 * Returns `null` for a path that leaves the project root. An empty string is
 * the project root.
 */
function projectPath(path: string): string | null {
  const segments: string[] = [];
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) return null;
  for (const segment of path.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

/** Upper bound on listing pages, so a misbehaving cursor cannot loop forever. */
const MAX_LIST_PAGES = 50;

/** The project's files through the platform file operations of a hosted run. */
export function hostedProjectFiles(
  execute: ExecutePlatformTool,
  projectReference?: string,
  branch?: string,
): ProjectFiles {
  // Read and save the content the run is on: its preview branch, else `main`.
  const scope = {
    ...(projectReference ? { project_reference: projectReference } : {}),
    ...(branch ? { branch_id: branch } : {}),
  };

  return {
    async list(directory) {
      const dir = projectPath(directory);
      if (dir === null) return { escapes: true };
      // `*` matches one path segment, so `app/*` is the files directly in `app`.
      const pattern = dir === "" ? "*" : `${dir}/*`;
      const files: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const result = record(
          await execute("veryfront__list_files", {
            ...scope,
            pattern,
            limit: 100,
            ...(cursor ? { cursor } : {}),
          }),
        );
        assertNotErrorResult(result, "veryfront__list_files");
        const entries = Array.isArray(result.data) ? result.data : [];
        for (const entry of entries) {
          // Every entry is a file; `type` is its kind (page, component, function or file).
          const { path } = record(entry);
          if (typeof path === "string") files.push(path.slice(path.lastIndexOf("/") + 1));
        }
        const next = record(result.page_info).next;
        if (typeof next !== "string" || next === "") break;
        cursor = next;
      }
      // The platform has files, not folders: a folder with no files is not found.
      if (files.length === 0 && dir !== "") return { notFound: true };
      return { files };
    },
    async read(path) {
      const file = projectPath(path);
      if (file === null) return { escapes: true };
      let result: Record<string, unknown>;
      try {
        result = record(await execute("veryfront__get_file", { ...scope, path: file }));
      } catch (error) {
        // Only a missing file is not found; other failures (network, server, cancellation) surface.
        if (isNotFound(error)) return { notFound: true };
        throw error;
      }
      // A returned error result for a read is the platform's not-found answer.
      return typeof result.content === "string" ? { content: result.content } : { notFound: true };
    },
    async write(path, content) {
      const file = projectPath(path);
      if (file === null) throw new Error(`Path escapes project directory: ${path}`);
      await execute("veryfront__update_file", { ...scope, path: file, content });
    },
    notFoundHint() {
      return Promise.resolve("");
    },
  };
}

/** Join a not-found answer and the source's hint into one message. */
export async function notFoundMessage(source: ProjectFiles, message: string): Promise<string> {
  const hint = await source.notFoundHint();
  return hint ? `${message}. ${hint}` : message;
}
