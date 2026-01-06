/**
 * Pull command - Download project content from Veryfront API
 *
 * Downloads pages, components, functions, and virtual files from the remote
 * Veryfront project and writes them to the local filesystem.
 *
 * @module cli/commands/pull
 */

import { dirname, join } from "std/path/mod.ts";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { createApiClient, resolveConfig, type ResolvedConfig } from "../shared/config.ts";
import { confirmPrompt, createSpinner, logInfo, logSuccess, logWarning } from "../utils/index.ts";

/**
 * Pull command options
 */
export interface PullOptions {
  /** Project directory (defaults to cwd) */
  projectDir?: string;
  /** Branch name to pull from (optional) */
  branch?: string;
  /** Entity types to include (default: all) */
  types?: string[];
  /** Force overwrite without confirmation */
  force?: boolean;
  /** Dry run - show what would be written without writing */
  dryRun?: boolean;
}

/**
 * Sync response from API
 */
interface SyncResponse {
  data: {
    pages: SyncEntity[];
    components: SyncEntity[];
    functions: SyncEntity[];
    virtualFiles: VirtualFileEntity[];
  };
  metadata: {
    projectId: string;
    branchId: string | null;
    syncedAt: string;
    totalEntities: number;
  };
}

interface SyncEntity {
  id: string;
  entityType: string;
  name: string;
  slug: string;
  body: string | null;
}

interface VirtualFileEntity {
  id: string;
  entityType: string;
  path: string;
  body: string | null;
}

/**
 * File write operation
 */
interface WriteOp {
  path: string;
  content: string;
  entityType: string;
}

/**
 * Common file extensions to strip from slugs
 */
const STRIP_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];

/**
 * Strip file extension from slug if present
 */
function stripExtension(slug: string): string {
  for (const ext of STRIP_EXTENSIONS) {
    if (slug.endsWith(ext)) {
      return slug.slice(0, -ext.length);
    }
  }
  return slug;
}

/**
 * Convert entity to file path and content
 */
function entityToWriteOp(
  entity: SyncEntity,
  projectDir: string,
  entityType: "page" | "component" | "function",
): WriteOp | null {
  if (!entity.body) return null;

  let path: string;
  const ext = entityType === "function" ? ".ts" : ".tsx";

  // Strip extension from slug to avoid double extensions
  const cleanSlug = stripExtension(entity.slug);

  switch (entityType) {
    case "page": {
      // Pages go in app/{slug}/page.tsx
      // "index" or "/" → app/page.tsx
      // "about" → app/about/page.tsx
      const pageSlug = cleanSlug === "/" || cleanSlug === "index" ? "" : cleanSlug;
      path = join(projectDir, "app", pageSlug, "page.tsx");
      break;
    }
    case "component":
      // Components go in components/{slug}.tsx
      path = join(projectDir, "components", `${cleanSlug}${ext}`);
      break;
    case "function":
      // Functions go in functions/{slug}.ts
      path = join(projectDir, "functions", `${cleanSlug}${ext}`);
      break;
  }

  return { path, content: entity.body, entityType };
}

/**
 * Convert virtual file to write operation
 */
function virtualFileToWriteOp(
  vf: VirtualFileEntity,
  projectDir: string,
): WriteOp | null {
  if (!vf.body) return null;

  return {
    path: join(projectDir, vf.path),
    content: vf.body,
    entityType: "virtualFile",
  };
}

/**
 * Write files to disk
 */
async function writeFiles(
  ops: WriteOp[],
  dryRun: boolean,
): Promise<{ written: number; skipped: number }> {
  const fs = createFileSystem();
  let written = 0;
  let skipped = 0;

  for (const op of ops) {
    if (dryRun) {
      cliLogger.info(`  Would write: ${op.path}`);
      written++;
      continue;
    }

    try {
      // Ensure parent directory exists
      const dir = dirname(op.path);
      await fs.mkdir(dir, { recursive: true });

      // Write the file
      await fs.writeTextFile(op.path, op.content);
      written++;
    } catch (error) {
      cliLogger.error(`Failed to write ${op.path}:`, error);
      skipped++;
    }
  }

  return { written, skipped };
}

/**
 * Pull content from Veryfront API
 */
export async function pullCommand(options: PullOptions = {}): Promise<void> {
  const {
    projectDir = cwd(),
    branch,
    types,
    force = false,
    dryRun = false,
  } = options;

  const spinner = createSpinner("Resolving configuration...");
  spinner.start();

  let config: ResolvedConfig;
  try {
    config = await resolveConfig(projectDir);
  } catch (error) {
    spinner.stop();
    throw error;
  }

  spinner.update(`Fetching content from ${config.projectSlug}...`);

  const client = createApiClient(config);

  // Build query params
  const params: Record<string, string> = {};
  if (branch) {
    params.branch = branch;
  }
  if (types && types.length > 0) {
    params.types = types.join(",");
  }

  let syncData: SyncResponse;
  try {
    syncData = await client.get<SyncResponse>(
      `/projects/${config.projectSlug}/sync`,
      params,
    );
  } catch (error) {
    spinner.stop();
    throw error;
  }

  spinner.stop();

  // Convert to write operations
  const writeOps: WriteOp[] = [];

  // Pages
  for (const page of syncData.data.pages) {
    const op = entityToWriteOp(page, projectDir, "page");
    if (op) writeOps.push(op);
  }

  // Components
  for (const component of syncData.data.components) {
    const op = entityToWriteOp(component, projectDir, "component");
    if (op) writeOps.push(op);
  }

  // Functions
  for (const fn of syncData.data.functions) {
    const op = entityToWriteOp(fn, projectDir, "function");
    if (op) writeOps.push(op);
  }

  // Virtual files
  for (const vf of syncData.data.virtualFiles) {
    const op = virtualFileToWriteOp(vf, projectDir);
    if (op) writeOps.push(op);
  }

  if (writeOps.length === 0) {
    logInfo("No content to pull.");
    return;
  }

  // Show summary
  const counts = {
    page: syncData.data.pages.length,
    component: syncData.data.components.length,
    function: syncData.data.functions.length,
    virtualFile: syncData.data.virtualFiles.length,
  };

  cliLogger.info(`\nContent to ${dryRun ? "pull" : "write"}:`);
  if (counts.page > 0) cliLogger.info(`  Pages: ${counts.page}`);
  if (counts.component > 0) cliLogger.info(`  Components: ${counts.component}`);
  if (counts.function > 0) cliLogger.info(`  Functions: ${counts.function}`);
  if (counts.virtualFile > 0) {
    cliLogger.info(`  Virtual Files: ${counts.virtualFile}`);
  }
  cliLogger.info("");

  // Confirm if not forced
  if (!force && !dryRun) {
    const confirmed = await confirmPrompt(
      "This will overwrite local files. Continue?",
      false,
    );
    if (!confirmed) {
      cliLogger.info("Pull cancelled.");
      return;
    }
  }

  // Write files
  spinner.start();
  spinner.update("Writing files...");

  const result = await writeFiles(writeOps, dryRun);

  spinner.stop();

  if (dryRun) {
    logInfo(`Dry run complete. Would write ${result.written} files.`);
  } else {
    logSuccess(
      `Pulled ${result.written} files from ${config.projectSlug}${
        branch ? ` (branch: ${branch})` : ""
      }.`,
    );
    if (result.skipped > 0) {
      logWarning(`Skipped ${result.skipped} files due to errors.`);
    }
  }
}
