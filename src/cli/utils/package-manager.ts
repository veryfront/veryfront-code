
import { join } from "../../platform/compat/path/index.ts";
import { cliLogger as logger } from "@veryfront/utils";
import { createFileSystem } from "../../platform/compat/fs.ts";
import { isDeno, isNode } from "../../platform/compat/runtime.ts";

export type PackageManager = "npm" | "yarn" | "pnpm" | "bun";

function isWindows(): boolean {
  if (isDeno) {
    return Deno.build.os === "windows";
  }
  if (isNode) {
    // deno-lint-ignore no-explicit-any
    const nodeProcess = (globalThis as any).process;
    return nodeProcess?.platform === "win32";
  }
  return false;
}

async function executeCommand(
  cmd: string,
  args: string[],
  cwd: string,
  silent: boolean,
): Promise<number> {
  if (isDeno) {
    const process = new Deno.Command(cmd, {
      args,
      cwd,
      stdout: silent ? "null" : "inherit",
      stderr: silent ? "null" : "inherit",
    });
    const { code } = await process.output();
    return code;
  }

  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: silent ? "ignore" : "inherit",
      shell: isWindows(),
    });

    child.on("error", (error: Error) => {
      reject(error);
    });

    child.on("close", (code: number | null) => {
      resolve(code ?? 1);
    });
  });
}

export async function detectPackageManager(
  projectDir: string,
  preference?: PackageManager,
): Promise<PackageManager> {
  if (preference) {
    return preference;
  }

  const fs = createFileSystem();

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

  const parentDir = join(projectDir, "..");
  for (const { file, pm } of lockfiles) {
    const lockPath = join(parentDir, file);
    if (await fs.exists(lockPath)) {
      logger.debug(`Detected ${pm} from parent directory ${file}`);
      return pm;
    }
  }

  return "npm";
}

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
