/**
 * CLI App Actions
 *
 * Handlers for opening projects in browser, Studio, and IDE.
 * Uses cross-runtime platform abstractions for filesystem and command execution.
 */

import { openBrowser } from "../auth/browser.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getOsType, runCommand } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/platform/compat/path/index.ts";
import type { ProjectInfo } from "./state.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

// ============================================================================
// Types
// ============================================================================

export type IDE = "cursor" | "code" | "zed" | "idea" | "webstorm";

export interface ActionResult {
  success: boolean;
  message?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** IDE command-line executables */
const IDE_COMMANDS: Record<IDE, string> = {
  cursor: "cursor",
  code: "code",
  zed: "zed",
  idea: "idea",
  webstorm: "webstorm",
};

/** IDE display names */
const IDE_NAMES: Record<IDE, string> = {
  cursor: "Cursor",
  code: "VS Code",
  zed: "Zed",
  idea: "IntelliJ IDEA",
  webstorm: "WebStorm",
};

/** IDE detection order (preferred first) */
const IDE_DETECTION_ORDER: IDE[] = ["cursor", "code", "zed", "idea", "webstorm"];

/** Cache directories to clear relative to project path */
const PROJECT_CACHE_DIRS = [".cache", "node_modules/.cache"];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Format an error for display in action results
 */
function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Check if a command exists on the system
 * Uses cross-runtime command execution
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const whichCmd = getOsType() === "windows" ? "where" : "which";
    const result = await runCommand(whichCmd, { args: [cmd] });
    return result.success;
  } catch {
    return false;
  }
}

/**
 * Run a command and return success status
 * Uses cross-runtime command execution
 */
async function runCommandLocal(cmd: string, args: string[]): Promise<boolean> {
  try {
    const result = await runCommand(cmd, { args });
    return result.success;
  } catch {
    return false;
  }
}

// ============================================================================
// Browser Actions
// ============================================================================

/**
 * Open project preview in browser
 */
export async function openInBrowser(
  project: ProjectInfo,
  port: number,
): Promise<ActionResult> {
  const url = `http://${project.slug}.lvh.me:${port}`;
  try {
    await openBrowser(url);
    return { success: true, message: `Opened ${url}` };
  } catch (error) {
    return { success: false, message: `Failed to open browser: ${formatError(error)}` };
  }
}

/**
 * Open project in Veryfront Studio
 */
export async function openInStudio(project: ProjectInfo): Promise<ActionResult> {
  const url = `https://veryfront.com/projects/${project.slug}`;
  try {
    await openBrowser(url);
    return { success: true, message: `Opened Studio for ${project.slug}` };
  } catch (error) {
    return { success: false, message: `Failed to open Studio: ${formatError(error)}` };
  }
}

// ============================================================================
// IDE Actions
// ============================================================================

/**
 * Detect available IDEs on the system
 */
export async function detectIDEs(): Promise<IDE[]> {
  const available: IDE[] = [];

  for (const ide of IDE_DETECTION_ORDER) {
    if (await commandExists(IDE_COMMANDS[ide])) {
      available.push(ide);
    }
  }

  return available;
}

/**
 * Get the preferred IDE (first available in detection order)
 */
export async function getPreferredIDE(): Promise<IDE | null> {
  const ides = await detectIDEs();
  return ides[0] || null;
}

/**
 * Open a path (project directory or file) in an IDE
 */
async function openPathInIDE(path: string, ide?: IDE): Promise<ActionResult> {
  const targetIDE = ide || (await getPreferredIDE());

  if (!targetIDE) {
    return {
      success: false,
      message: "No supported IDE found. Install VS Code, Cursor, or Zed.",
    };
  }

  const cmd = IDE_COMMANDS[targetIDE];
  const name = IDE_NAMES[targetIDE];

  const success = await runCommandLocal(cmd, [path]);

  if (success) {
    return { success: true, message: `Opened in ${name}` };
  }
  return { success: false, message: `Failed to open ${name}` };
}

/**
 * Open project in IDE
 */
export async function openInIDE(project: ProjectInfo, ide?: IDE): Promise<ActionResult> {
  const result = await openPathInIDE(project.path, ide);
  if (result.success) {
    return {
      success: true,
      message: `Opened ${project.slug} in ${result.message?.split(" in ")[1]}`,
    };
  }
  return result;
}

/**
 * Open a file in IDE
 */
export function openFileInIDE(filePath: string, ide?: IDE): Promise<ActionResult> {
  return openPathInIDE(filePath, ide);
}

// ============================================================================
// Project Actions
// ============================================================================

/**
 * Clear caches for a project
 * Uses cross-runtime filesystem abstraction
 */
export async function clearProjectCache(project: ProjectInfo): Promise<ActionResult> {
  const fs = createFileSystem();
  let cleared = 0;

  for (const relativeDir of PROJECT_CACHE_DIRS) {
    const dir = join(project.path, relativeDir);
    try {
      await fs.remove(dir, { recursive: true });
      cleared++;
    } catch {
      // Directory doesn't exist
    }
  }

  const message = cleared > 0 ? `Cleared ${cleared} cache directories` : "No caches to clear";
  return { success: true, message };
}

// ============================================================================
// File Actions
// ============================================================================

/**
 * Open Claude Code settings.json in IDE
 */
export async function openMCPSettings(env: RuntimeEnv = getRuntimeEnv()): Promise<ActionResult> {
  const home = env.homeDir || "";
  const claudeDir = join(home, ".claude");
  const settingsPath = join(claudeDir, "settings.json");
  const fs = createFileSystem();

  try {
    await fs.mkdir(claudeDir, { recursive: true });
  } catch {
    // Already exists
  }

  const exists = await fs.exists(settingsPath);
  if (!exists) {
    const defaultSettings = { mcpServers: {} };
    await fs.writeTextFile(settingsPath, JSON.stringify(defaultSettings, null, 2));
  }

  return openFileInIDE(settingsPath);
}

// ============================================================================
// Quick Actions
// ============================================================================

/**
 * Execute quick action by number key (opens project in browser)
 */
export function quickOpen(
  projects: Array<{ slug: string; path: string }>,
  num: number,
  port: number,
): Promise<ActionResult> {
  const index = num - 1;
  if (index < 0 || index >= projects.length) {
    return Promise.resolve({ success: false, message: `No project at position ${num}` });
  }

  const project = projects[index]!;
  return openInBrowser({ slug: project.slug, path: project.path, type: "local" }, port);
}
