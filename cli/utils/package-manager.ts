/**
 * Package manager detection and installation utilities
 * Uses cross-runtime platform abstractions.
 * @module cli/utils/package-manager
 */

import { join } from "veryfront/platform/path";
import { cliLogger as logger } from "#cli/utils";
import { createFileSystem, getEnv } from "veryfront/platform";
import { getOsType, runCommand } from "veryfront/platform";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun" | "deno";

/**
 * Detect package manager from npm_config_user_agent environment variable
 * This is set when running via `pnpm create`, `npm create`, etc.
 *
 * Format examples:
 * - pnpm/8.15.1 npm/? node/v20.11.0 darwin arm64
 * - npm/10.2.4 node/v20.11.0 darwin arm64
 * - yarn/1.22.21 npm/? node/v20.11.0 darwin arm64
 * - bun/1.0.0 node/v20.11.0 darwin arm64
 * - deno/2.0.4 npm/? deno/2.0.4 macos aarch64
 */
export function detectFromUserAgent(): PackageManager | undefined {
  const userAgent = getEnv("npm_config_user_agent");
  if (!userAgent) return undefined;

  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("deno/")) return "deno";
  if (userAgent.startsWith("npm/")) return "npm";

  return undefined;
}

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
  { file: "deno.lock", pm: "deno" },
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
 * Detect the package manager to use based on various signals
 *
 * Priority:
 * 1. Explicit preference (if provided)
 * 2. npm_config_user_agent env var (set when running via create-*)
 * 3. Existing lockfile in project directory
 * 4. Parent directory lockfile (for monorepos)
 * 5. Default to npm
 */
export async function detectPackageManager(
  projectDir: string,
  preference?: PackageManager,
): Promise<PackageManager> {
  if (preference) return preference;

  // Check user agent first (when running via pnpm create, npm create, etc.)
  const fromUserAgent = detectFromUserAgent();
  if (fromUserAgent) {
    logger.debug(`Detected ${fromUserAgent} from npm_config_user_agent`);
    return fromUserAgent;
  }

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
  deno: "deno install",
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
 * Get the run script command for a package manager
 * e.g., "pnpm dev" vs "npm run dev"
 */
export function getRunCommand(pm: PackageManager, script: string): string {
  // deno uses "deno task" for package.json scripts
  if (pm === "deno") return `deno task ${script}`;
  // bun and pnpm can run scripts directly without "run"
  if (pm === "bun" || pm === "pnpm") return `${pm} ${script}`;
  // yarn can also run scripts directly for common ones like "dev"
  if (pm === "yarn") return `yarn ${script}`;
  // npm requires "run"
  return `npm run ${script}`;
}

/**
 * Get the dlx/npx command for a package manager
 * Used for running one-off packages
 */
export function getDlxCommand(pm: PackageManager): string {
  switch (pm) {
    case "deno":
      return "dx";
    case "pnpm":
      return "pnpm dlx";
    case "yarn":
      return "yarn dlx";
    case "bun":
      return "bunx";
    case "npm":
    default:
      return "npx";
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
