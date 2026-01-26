/**
 * Package manager detection and installation utilities
 * Uses cross-runtime platform abstractions.
 * @module cli/utils/package-manager
 */

import { join } from "../../platform/compat/path/index.js";
import { cliLogger as logger } from "../../utils/index.js";
import { createFileSystem } from "../../platform/compat/fs.js";
import { getOsType, runCommand } from "../../platform/compat/process.js";

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

async function detectFromDir(dir: string): Promise<PackageManager | undefined> {
  const fs = createFileSystem();

  for (const { file, pm } of LOCKFILES) {
    const lockPath = join(dir, file);
    if (await fs.exists(lockPath)) {
      return pm;
    }
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
    const file = LOCKFILES.find((l) => l.pm === detected)?.file;
    if (file) logger.debug(`Detected ${detected} from ${file}`);
    return detected;
  }

  const parentDir = join(projectDir, "..");
  const detectedFromParent = await detectFromDir(parentDir);
  if (detectedFromParent) {
    const file = LOCKFILES.find((l) => l.pm === detectedFromParent)?.file;
    if (file) logger.debug(`Detected ${detectedFromParent} from parent directory ${file}`);
    return detectedFromParent;
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
  const command = getInstallCommand(pm);

  if (!silent) logger.info(`Installing dependencies with ${pm}...`);

  try {
    const [cmd, ...args] = command.split(" ");
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
