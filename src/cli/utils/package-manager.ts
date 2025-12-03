/**
 * Package manager detection and installation utilities
 * @module cli/utils/package-manager
 */

import { join } from "std/path/mod.ts";
import { cliLogger as logger } from "@veryfront/utils";
import { createFileSystem } from "../../platform/compat/fs.ts";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

/**
 * Execute a shell command cross-runtime (Deno/Node.js)
 * @returns Promise with exit code
 */
async function executeCommand(
  cmd: string,
  args: string[],
  cwd: string,
  silent: boolean,
): Promise<number> {
  // Try Deno.Command first (Deno runtime)
  if (typeof Deno !== "undefined" && Deno.Command) {
    const process = new Deno.Command(cmd, {
      args,
      cwd,
      stdout: silent ? "null" : "inherit",
      stderr: silent ? "null" : "inherit",
    });
    const { code } = await process.output();
    return code;
  }

  // Fall back to Node.js child_process (npm package runtime)
  // Use dynamic import to avoid Deno type errors
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: silent ? "ignore" : "inherit",
      shell: process.platform === "win32", // Use shell on Windows for .cmd files
    });

    child.on("error", (error: Error) => {
      reject(error);
    });

    child.on("close", (code: number | null) => {
      resolve(code ?? 1);
    });
  });
}

/**
 * Detect the package manager to use based on lockfiles or user preference
 *
 * Priority:
 * 1. Explicit preference (if provided)
 * 2. Existing lockfile in project directory
 * 3. Parent directory lockfile (for monorepos)
 * 4. Default to npm
 */
export async function detectPackageManager(
  projectDir: string,
  preference?: PackageManager,
): Promise<PackageManager> {
  if (preference) {
    return preference;
  }

  const fs = createFileSystem();

  // Check for lockfiles in project directory
  const lockfiles: Array<{ file: string; pm: PackageManager }> = [
    { file: "bun.lockb", pm: "bun" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "package-lock.json", pm: "npm" },
  ];

  for (const { file, pm } of lockfiles) {
    const lockPath = join(projectDir, file);
    if (await fs.exists(lockPath)) {
      logger.debug(`Detected ${pm} from ${file}`);
      return pm;
    }
  }

  // Check parent directory (monorepo support)
  const parentDir = join(projectDir, "..");
  for (const { file, pm } of lockfiles) {
    const lockPath = join(parentDir, file);
    if (await fs.exists(lockPath)) {
      logger.debug(`Detected ${pm} from parent directory ${file}`);
      return pm;
    }
  }

  // Default to npm
  return "npm";
}

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(pm: PackageManager): string {
  switch (pm) {
    case "bun":
      return "bun install";
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn";
    case "npm":
    default:
      return "npm install";
  }
}

/**
 * Install dependencies using the detected package manager
 *
 * @param projectDir - Directory to install dependencies in
 * @param options - Installation options
 * @returns true if installation succeeded, false otherwise
 */
export async function installDependencies(
  projectDir: string,
  options: {
    packageManager?: PackageManager;
    silent?: boolean;
  } = {},
): Promise<boolean> {
  const pm = await detectPackageManager(projectDir, options.packageManager);
  const command = getInstallCommand(pm);

  if (!options.silent) {
    logger.info(`Installing dependencies with ${pm}...`);
  }

  try {
    const parts = command.split(" ");
    const cmd = parts[0];
    const args = parts.slice(1);
    if (!cmd) {
      throw new Error("Invalid command");
    }

    const code = await executeCommand(cmd, args, projectDir, options.silent ?? false);

    if (code === 0) {
      if (!options.silent) {
        logger.info(`Dependencies installed successfully`);
      }
      return true;
    } else {
      logger.error(`Failed to install dependencies (exit code: ${code})`);
      return false;
    }
  } catch (error) {
    logger.error(
      `Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
