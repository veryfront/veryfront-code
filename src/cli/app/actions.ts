/**
 * CLI App Actions
 *
 * Handlers for opening projects in browser, Studio, and IDE.
 */

import { openBrowser } from "../auth/browser.ts";
import type { ProjectInfo } from "./state.ts";

// ============================================================================
// Types
// ============================================================================

export type IDE = "cursor" | "code" | "zed" | "idea" | "webstorm";

export interface ActionResult {
  success: boolean;
  message?: string;
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
    return {
      success: false,
      message: `Failed to open browser: ${error instanceof Error ? error.message : String(error)}`,
    };
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
    return {
      success: false,
      message: `Failed to open Studio: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// IDE Actions
// ============================================================================

/**
 * Check if a command exists on the system
 */
async function commandExists(cmd: string): Promise<boolean> {
  try {
    const command = new Deno.Command(
      Deno.build.os === "windows" ? "where" : "which",
      {
        args: [cmd],
        stdout: "null",
        stderr: "null",
      },
    );
    const { success } = await command.output();
    return success;
  } catch {
    return false;
  }
}

/**
 * IDE detection order (preferred first)
 */
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

/**
 * Detect available IDEs
 */
export async function detectIDEs(): Promise<IDE[]> {
  const available: IDE[] = [];
  const order: IDE[] = ["cursor", "code", "zed", "idea", "webstorm"];

  for (const ide of order) {
    if (await commandExists(IDE_COMMANDS[ide])) {
      available.push(ide);
    }
  }

  return available;
}

/**
 * Get the preferred IDE (first available)
 */
export async function getPreferredIDE(): Promise<IDE | null> {
  const ides = await detectIDEs();
  return ides[0] || null;
}

/**
 * Open project in IDE
 */
export async function openInIDE(
  project: ProjectInfo,
  ide?: IDE,
): Promise<ActionResult> {
  // Use specified IDE or detect preferred
  const targetIDE = ide || (await getPreferredIDE());

  if (!targetIDE) {
    return {
      success: false,
      message: "No supported IDE found. Install VS Code, Cursor, or Zed.",
    };
  }

  const cmd = IDE_COMMANDS[targetIDE];
  const name = IDE_NAMES[targetIDE];

  try {
    const command = new Deno.Command(cmd, {
      args: [project.path],
      stdout: "null",
      stderr: "null",
    });
    const { success } = await command.output();

    if (success) {
      return { success: true, message: `Opened ${project.slug} in ${name}` };
    } else {
      return { success: false, message: `Failed to open ${name}` };
    }
  } catch (error) {
    return {
      success: false,
      message: `Failed to open ${name}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================================================
// Project Actions
// ============================================================================

/**
 * Clear caches for a project
 */
export async function clearProjectCache(project: ProjectInfo): Promise<ActionResult> {
  const cacheDirs = [
    `${project.path}/.cache`,
    `${project.path}/node_modules/.cache`,
  ];

  let cleared = 0;
  for (const dir of cacheDirs) {
    try {
      await Deno.remove(dir, { recursive: true });
      cleared++;
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return {
    success: true,
    message: cleared > 0 ? `Cleared ${cleared} cache directories` : "No caches to clear",
  };
}

// ============================================================================
// Quick Actions (by number)
// ============================================================================

/**
 * Execute quick action by number key
 */
export async function quickOpen(
  projects: Array<{ slug: string; path: string }>,
  num: number,
  port: number,
): Promise<ActionResult> {
  const index = num - 1;
  if (index < 0 || index >= projects.length) {
    return { success: false, message: `No project at position ${num}` };
  }

  const project = projects[index]!;
  return openInBrowser(
    { slug: project.slug, path: project.path, type: "local" },
    port,
  );
}
