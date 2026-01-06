/**
 * Push command - Upload local project content to a new Veryfront branch
 *
 * Creates a new branch and uploads local pages, components, functions, and
 * virtual files. User can then merge in Studio.
 *
 * @module cli/commands/push
 */

import { join, relative } from "std/path/mod.ts";
import { cliLogger } from "@veryfront/utils";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";
import {
  type ApiClient,
  createApiClient,
  resolveConfig,
  type ResolvedConfig,
} from "../shared/config.ts";
import {
  confirmPrompt,
  createSpinner,
  logError,
  logInfo,
  logSuccess,
  logWarning,
} from "../utils/index.ts";

/**
 * Push command options
 */
export interface PushOptions {
  /** Project directory (defaults to cwd) */
  projectDir?: string;
  /** Branch name to create (auto-generated if not provided) */
  branch?: string;
  /** Entity types to include (default: all) */
  types?: string[];
  /** Force push without confirmation */
  force?: boolean;
  /** Dry run - show what would be uploaded without uploading */
  dryRun?: boolean;
}

/**
 * Entity upload operation
 */
interface UploadOp {
  path: string;
  content: string;
  entityType: "page" | "component" | "function" | "virtualFile";
  slug: string;
  name: string;
}

/**
 * API response for branch creation
 */
interface BranchResponse {
  id: string;
  name: string;
  projectId: string;
}

/**
 * Scan local project for entities to upload
 */
async function scanLocalEntities(
  projectDir: string,
  types?: string[],
): Promise<UploadOp[]> {
  const fs = createFileSystem();
  const ops: UploadOp[] = [];

  const includePages = !types || types.includes("page");
  const includeComponents = !types || types.includes("component");
  const includeFunctions = !types || types.includes("function");
  const includeVirtualFiles = !types || types.includes("virtualFile");

  // Scan pages in app/ directory
  if (includePages) {
    const appDir = join(projectDir, "app");
    if (await fs.exists(appDir)) {
      const pages = await scanPages(fs, appDir);
      ops.push(...pages);
    }
  }

  // Scan components in components/ directory
  if (includeComponents) {
    const componentsDir = join(projectDir, "components");
    if (await fs.exists(componentsDir)) {
      const components = await scanDirectory(fs, componentsDir, "component", [
        ".tsx",
        ".jsx",
      ]);
      ops.push(...components);
    }
  }

  // Scan functions in functions/ directory
  if (includeFunctions) {
    const functionsDir = join(projectDir, "functions");
    if (await fs.exists(functionsDir)) {
      const functions = await scanDirectory(fs, functionsDir, "function", [
        ".ts",
        ".js",
      ]);
      ops.push(...functions);
    }
  }

  // Scan virtual files (lib/, styles/, etc.)
  if (includeVirtualFiles) {
    const virtualDirs = ["lib", "styles", "public"];
    for (const dir of virtualDirs) {
      const dirPath = join(projectDir, dir);
      if (await fs.exists(dirPath)) {
        const virtualFiles = await scanVirtualFiles(fs, dirPath, projectDir);
        ops.push(...virtualFiles);
      }
    }
  }

  return ops;
}

/**
 * Scan app/ directory for page.tsx files
 */
async function scanPages(
  fs: ReturnType<typeof createFileSystem>,
  appDir: string,
): Promise<UploadOp[]> {
  const ops: UploadOp[] = [];

  async function walk(dir: string, slug: string) {
    const entries = await fs.readDir(dir);

    for await (const entry of entries) {
      const entryPath = join(dir, entry.name);

      if (entry.isDirectory) {
        const newSlug = slug ? `${slug}/${entry.name}` : entry.name;
        await walk(entryPath, newSlug);
      } else if (entry.name === "page.tsx" || entry.name === "page.jsx") {
        const content = await fs.readTextFile(entryPath);
        ops.push({
          path: entryPath,
          content,
          entityType: "page",
          slug: slug || "/",
          name: slug || "index",
        });
      }
    }
  }

  await walk(appDir, "");
  return ops;
}

/**
 * Scan a directory for entity files
 */
async function scanDirectory(
  fs: ReturnType<typeof createFileSystem>,
  dir: string,
  entityType: "component" | "function",
  extensions: string[],
): Promise<UploadOp[]> {
  const ops: UploadOp[] = [];

  async function walk(currentDir: string, prefix: string) {
    const entries = await fs.readDir(currentDir);

    for await (const entry of entries) {
      const entryPath = join(currentDir, entry.name);

      if (entry.isDirectory) {
        await walk(entryPath, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
        const content = await fs.readTextFile(entryPath);
        const nameWithoutExt = entry.name.replace(/\.[^.]+$/, "");
        const slug = prefix ? `${prefix}/${nameWithoutExt}` : nameWithoutExt;

        ops.push({
          path: entryPath,
          content,
          entityType,
          slug,
          name: nameWithoutExt,
        });
      }
    }
  }

  await walk(dir, "");
  return ops;
}

/**
 * Scan virtual file directories
 */
async function scanVirtualFiles(
  fs: ReturnType<typeof createFileSystem>,
  dir: string,
  projectDir: string,
): Promise<UploadOp[]> {
  const ops: UploadOp[] = [];

  async function walk(currentDir: string) {
    const entries = await fs.readDir(currentDir);

    for await (const entry of entries) {
      const entryPath = join(currentDir, entry.name);

      if (entry.isDirectory) {
        await walk(entryPath);
      } else {
        const content = await fs.readTextFile(entryPath);
        const relativePath = relative(projectDir, entryPath);

        ops.push({
          path: entryPath,
          content,
          entityType: "virtualFile",
          slug: relativePath,
          name: relativePath,
        });
      }
    }
  }

  await walk(dir);
  return ops;
}

/**
 * Generate a branch name for CLI push
 */
function generateBranchName(): string {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, "");
  return `cli/push-${timestamp}`;
}

/**
 * Create a new branch for the push
 */
async function createBranch(
  client: ApiClient,
  projectSlug: string,
  branchName: string,
): Promise<BranchResponse> {
  return await client.post<BranchResponse>(`/projects/${projectSlug}/branches`, {
    name: branchName,
  });
}

/**
 * Upload entities to the API (on the created branch)
 */
async function uploadEntities(
  client: ApiClient,
  projectSlug: string,
  branchId: string,
  ops: UploadOp[],
  dryRun: boolean,
): Promise<{ uploaded: number; failed: number }> {
  let uploaded = 0;
  let failed = 0;

  for (const op of ops) {
    if (dryRun) {
      cliLogger.info(`  Would upload: ${op.entityType}/${op.slug}`);
      uploaded++;
      continue;
    }

    try {
      const basePath = `/projects/${projectSlug}`;
      const branchParam = `?branch=${branchId}`;

      switch (op.entityType) {
        case "page":
          await client.post(`${basePath}/pages${branchParam}`, {
            slug: op.slug,
            name: op.name,
            body: op.content,
          });
          break;

        case "component":
          await client.post(`${basePath}/components${branchParam}`, {
            slug: op.slug,
            name: op.name,
            body: op.content,
          });
          break;

        case "function":
          await client.post(`${basePath}/functions${branchParam}`, {
            slug: op.slug,
            name: op.name,
            body: op.content,
          });
          break;

        case "virtualFile":
          await client.post(`${basePath}/virtual-files${branchParam}`, {
            path: op.slug,
            body: op.content,
          });
          break;
      }

      uploaded++;
    } catch (error) {
      cliLogger.error(`Failed to upload ${op.entityType}/${op.slug}:`, error);
      failed++;
    }
  }

  return { uploaded, failed };
}

/**
 * Push local content to a new Veryfront branch
 */
export async function pushCommand(options: PushOptions = {}): Promise<void> {
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

  spinner.update("Scanning local files...");

  const ops = await scanLocalEntities(projectDir, types);

  if (ops.length === 0) {
    spinner.stop();
    logInfo("No content to push.");
    return;
  }

  spinner.stop();

  // Show summary
  const entityCounts = {
    page: ops.filter((o) => o.entityType === "page").length,
    component: ops.filter((o) => o.entityType === "component").length,
    function: ops.filter((o) => o.entityType === "function").length,
    virtualFile: ops.filter((o) => o.entityType === "virtualFile").length,
  };

  const branchName = branch || generateBranchName();

  cliLogger.info(`\nContent to push to branch "${branchName}":`);
  if (entityCounts.page > 0) cliLogger.info(`  Pages: ${entityCounts.page}`);
  if (entityCounts.component > 0) {
    cliLogger.info(`  Components: ${entityCounts.component}`);
  }
  if (entityCounts.function > 0) {
    cliLogger.info(`  Functions: ${entityCounts.function}`);
  }
  if (entityCounts.virtualFile > 0) {
    cliLogger.info(`  Virtual Files: ${entityCounts.virtualFile}`);
  }
  cliLogger.info("");

  // Confirm if not forced and not dry run
  if (!force && !dryRun) {
    const confirmed = await confirmPrompt(
      `Create branch "${branchName}" and upload ${ops.length} files?`,
      true,
    );
    if (!confirmed) {
      cliLogger.info("Push cancelled.");
      return;
    }
  }

  if (dryRun) {
    await uploadEntities(
      createApiClient(config),
      config.projectSlug,
      "",
      ops,
      true,
    );
    logInfo(
      `Dry run complete. Would upload ${ops.length} files to branch "${branchName}".`,
    );
    return;
  }

  const client = createApiClient(config);

  // Step 1: Create branch
  spinner.start();
  spinner.update(`Creating branch "${branchName}"...`);

  let createdBranch: BranchResponse;
  try {
    createdBranch = await createBranch(client, config.projectSlug, branchName);
  } catch (error) {
    spinner.stop();
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("already exists")) {
      logError(
        `Branch "${branchName}" already exists. Use --branch to specify a different name.`,
      );
    } else {
      logError(`Failed to create branch: ${message}`);
    }
    return;
  }

  // Step 2: Upload entities to the branch
  spinner.update("Uploading content...");

  const result = await uploadEntities(
    client,
    config.projectSlug,
    createdBranch.id,
    ops,
    false,
  );

  spinner.stop();

  if (result.uploaded > 0) {
    logSuccess(`Pushed ${result.uploaded} files to branch "${branchName}".`);
  }
  if (result.failed > 0) {
    logWarning(`Failed to upload ${result.failed} files.`);
  }

  // Show merge instructions
  cliLogger.info("");
  logInfo(`To merge your changes, open Studio and merge the branch:`);
  cliLogger.info(
    `  https://studio.veryfront.com/${config.projectSlug}/branches`,
  );
}
