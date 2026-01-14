/**
 * Cross-platform browser opening utility
 *
 * Opens URLs in the user's default browser across
 * macOS, Linux, and Windows.
 *
 * @module cli/auth/browser
 */

import { isDeno } from "@veryfront/platform/compat/runtime.ts";

/**
 * Get the command to open a URL in the default browser
 */
function getOpenCommand(): { cmd: string; args: string[] } {
  const platform = isDeno
    // @ts-ignore - Deno global
    ? Deno.build.os
    : process.platform;

  switch (platform) {
    case "darwin":
      return { cmd: "open", args: [] };
    case "win32":
    case "windows":
      return { cmd: "cmd", args: ["/c", "start", ""] };
    case "linux":
    default:
      return { cmd: "xdg-open", args: [] };
  }
}

/**
 * Open a URL in the user's default browser
 *
 * @param url - The URL to open
 * @returns Promise that resolves when the browser is opened
 */
export async function openBrowser(url: string): Promise<void> {
  const { cmd, args } = getOpenCommand();

  if (isDeno) {
    // @ts-ignore - Deno global
    const command = new Deno.Command(cmd, {
      args: [...args, url],
      stdout: "null",
      stderr: "null",
    });
    const process = command.spawn();
    // Don't wait for the browser to close
    process.unref();
  } else {
    const { spawn } = await import("node:child_process");
    const child = spawn(cmd, [...args, url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

/**
 * Check if a browser can likely be opened
 * (Not 100% reliable, but helps detect headless environments)
 */
export function canOpenBrowser(): boolean {
  // Check for common headless indicators
  const isCI = Boolean(
    isDeno
      // @ts-ignore - Deno global
      ? Deno.env.get("CI") || Deno.env.get("CONTINUOUS_INTEGRATION")
      : process.env.CI || process.env.CONTINUOUS_INTEGRATION,
  );

  // SSH sessions typically don't have a display
  const isSSH = Boolean(
    isDeno
      // @ts-ignore - Deno global
      ? Deno.env.get("SSH_CLIENT") || Deno.env.get("SSH_TTY")
      : process.env.SSH_CLIENT || process.env.SSH_TTY,
  );

  // Check for display on Linux
  const platform = isDeno
    // @ts-ignore - Deno global
    ? Deno.build.os
    : process.platform;

  if (platform === "linux") {
    const hasDisplay = Boolean(
      isDeno
        // @ts-ignore - Deno global
        ? Deno.env.get("DISPLAY") || Deno.env.get("WAYLAND_DISPLAY")
        : process.env.DISPLAY || process.env.WAYLAND_DISPLAY,
    );
    if (!hasDisplay) return false;
  }

  return !isCI && !isSSH;
}
