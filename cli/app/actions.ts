/**************************
 * CLI App Actions
 *
 * Opening a project in the browser, Studio, or an IDE. Everything that leaves
 * the process, spawning commands, opening URLs, touching disk, goes through
 * the LauncherHost seam, so IDE detection order, the Windows/POSIX split, and
 * the settings-file bootstrap are all reachable from a test.
 *
 * Two adapters justify the seam: the platform host in production, a fake in
 * tests.
 **************************/

import { openBrowser } from "../auth/browser.ts";
import { createFileSystem } from "veryfront/platform";
import { getOsType } from "veryfront/platform";
import { runCommand } from "#cli/process-command";
import { formatError } from "../utils/string.ts";
import { dirname, join } from "veryfront/platform/path";
import type { ProjectInfo } from "./state.ts";
import { getEnvironmentConfig } from "veryfront/config";

export type IDE = "cursor" | "code" | "zed" | "idea" | "webstorm";

export interface ActionResult {
  success: boolean;
  message?: string;
}

/** Everything the launcher needs from the outside world. */
export interface LauncherHost {
  openUrl(url: string): Promise<void>;
  /** Whether `command` is on PATH. */
  commandExists(command: string): Promise<boolean>;
  /** Run `command`; resolves to whether it succeeded. */
  run(command: string, args: string[]): Promise<boolean>;
  /** Create `path` with `contents` if it does not already exist. */
  ensureFile(path: string, contents: string): Promise<void>;
  homeDir(): string;
}

export interface Launcher {
  openInBrowser(project: ProjectInfo, port: number): Promise<ActionResult>;
  openInStudio(project: ProjectInfo): Promise<ActionResult>;
  openInIDE(project: ProjectInfo, ide?: IDE): Promise<ActionResult>;
  openMCPSettings(): Promise<ActionResult>;
}

const IDE_COMMANDS: Record<IDE, string> = {
  cursor: "cursor",
  code: "code",
  zed: "zed",
  idea: "idea",
  webstorm: "webstorm",
};

const IDE_NAMES: Record<IDE, string> = {
  cursor: "Cursor",
  code: "VS Code",
  zed: "Zed",
  idea: "IntelliJ IDEA",
  webstorm: "WebStorm",
};

/** First match wins. */
const IDE_DETECTION_ORDER: IDE[] = ["cursor", "code", "zed", "idea", "webstorm"];

export function createLauncher(host: LauncherHost): Launcher {
  async function open(url: string, describe: (url: string) => string): Promise<ActionResult> {
    try {
      await host.openUrl(url);
      return { success: true, message: describe(url) };
    } catch (error) {
      return { success: false, message: `Failed to open: ${formatError(error)}` };
    }
  }

  async function preferredIDE(): Promise<IDE | null> {
    for (const ide of IDE_DETECTION_ORDER) {
      if (await host.commandExists(IDE_COMMANDS[ide])) return ide;
    }
    return null;
  }

  async function openPath(path: string, ide?: IDE): Promise<{ ok: boolean; name: string }> {
    const target = ide ?? (await preferredIDE());
    if (!target) return { ok: false, name: "" };

    const ok = await host.run(IDE_COMMANDS[target], [path]);
    return { ok, name: IDE_NAMES[target] };
  }

  async function openFileInIDE(path: string): Promise<ActionResult> {
    const { ok, name } = await openPath(path);
    if (!name) {
      return {
        success: false,
        message: "No supported IDE found. Install VS Code, Cursor, or Zed.",
      };
    }
    return ok
      ? { success: true, message: `Opened in ${name}` }
      : { success: false, message: `Failed to open ${name}` };
  }

  return {
    openInBrowser(project, port) {
      return open(
        `http://${project.slug}.localhost:${port}`,
        (url) => `Opened ${url}`,
      );
    },

    openInStudio(project) {
      return open(
        `https://veryfront.com/projects/${project.slug}`,
        () => `Opened Studio for ${project.slug}`,
      );
    },

    async openInIDE(project, ide) {
      const { ok, name } = await openPath(project.path, ide);
      if (!name) {
        return {
          success: false,
          message: "No supported IDE found. Install VS Code, Cursor, or Zed.",
        };
      }
      return ok
        ? { success: true, message: `Opened ${project.slug} in ${name}` }
        : { success: false, message: `Failed to open ${name}` };
    },

    async openMCPSettings() {
      const home = host.homeDir().trim();
      if (!home) {
        // Joining "" would write .claude/settings.json into the current
        // directory and still report success.
        return { success: false, message: "Could not determine your home directory." };
      }

      const settingsPath = join(home, ".claude", "settings.json");

      // Every launcher method reports failure through ActionResult. Letting a
      // write error escape instead would reject inside the shell's key
      // handling, where it surfaces as a dead keypress rather than a log line.
      try {
        await host.ensureFile(settingsPath, `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`);
      } catch (error) {
        return { success: false, message: `Failed to write settings: ${formatError(error)}` };
      }

      return openFileInIDE(settingsPath);
    },
  };
}

/** The production host: real processes, real browser, real disk. */
export function createPlatformHost(): LauncherHost {
  return {
    openUrl: (url) => openBrowser(url),

    async commandExists(command) {
      const probe = getOsType() === "windows" ? "where" : "which";
      try {
        const result = await runCommand(probe, { args: [command] });
        return result.success;
      } catch {
        return false;
      }
    },

    async run(command, args) {
      try {
        const result = await runCommand(command, { args });
        return result.success;
      } catch {
        return false;
      }
    },

    async ensureFile(path, contents) {
      const fs = createFileSystem();

      try {
        await fs.mkdir(dirname(path), { recursive: true });
      } catch {
        // Already exists
      }

      if (!(await fs.exists(path))) await fs.writeTextFile(path, contents);
    },

    homeDir: () => getEnvironmentConfig().homeDir ?? "",
  };
}
