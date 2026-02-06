/**
 * Package manager detection and installation utilities
 * Uses cross-runtime platform abstractions.
 * @module cli/utils/package-manager
 */

import { join } from "#veryfront/compat/path/index.ts";
import { cliLogger as logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getOsType, runCommand } from "#veryfront/platform/compat/process.ts";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

function isWindows(): boolean {
  return getOsType() === "windows";
}

async function executeCommand(
  cmd: string,
  args: string[],
  cwd: string,
  silent: boolean,
): Promise<number> {
  const result = await runCommand(cmd, {
    args,
    cwd,
    inherit: !silent,
    shell: isWindows(), // Use shell on Windows for .cmd files
  });

  return result.code;
}

const LOCKFILES: Array<{ file: string; pm: PackageManager }> = [
  { file: "bun.lockb", pm: "bun" },
  { file: "pnpm-lock.yaml", pm: "pnpm" },
  { file: "yarn.lock", pm: "yarn" },
  { file: "package-lock.json", pm: "npm" },
];

async function detectFromDir(
  dir: string,
): Promise<{ pm: PackageManager; file: string } | undefined> {
  const fs = createFileSystem();

  for (const lock of LOCKFILES) {
    if (await fs.exists(join(dir, lock.file))) return lock;
  }

  return undefined;
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
  if (preference) return preference;

  const detected = await detectFromDir(projectDir);
  if (detected) {
    logger.debug(`Detected ${detected.pm} from ${detected.file}`);
    return detected.pm;
  }

  const detectedFromParent = await detectFromDir(join(projectDir, ".."));
  if (detectedFromParent) {
    logger.debug(
      `Detected ${detectedFromParent.pm} from parent directory ${detectedFromParent.file}`,
    );
    return detectedFromParent.pm;
  }

  return "npm";
}

const INSTALL_COMMANDS: Record<PackageManager, string> = {
  bun: "bun install",
  pnpm: "pnpm install",
  yarn: "yarn",
  npm: "npm install",
};

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(pm: PackageManager): string {
  return INSTALL_COMMANDS[pm];
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
  const silent = options.silent ?? false;
  const pm = await detectPackageManager(projectDir, options.packageManager);

  if (!silent) logger.info(`Installing dependencies with ${pm}...`);

  try {
    const [cmd, ...args] = getInstallCommand(pm).split(" ");
    if (!cmd) throw new Error("Invalid command");

    const code = await executeCommand(cmd, args, projectDir, silent);
    if (code !== 0) {
      logger.error(`Failed to install dependencies (exit code: ${code})`);
      return false;
    }

    if (!silent) logger.info("Dependencies installed successfully");
    return true;
  } catch (error) {
    logger.error(
      `Failed to install dependencies: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}
