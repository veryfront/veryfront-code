import { isDeno } from "@veryfront/platform/compat/runtime.ts";
import { getEnv, getOsType } from "@veryfront/platform/compat/process.ts";

function getOpenCommand(): { cmd: string; args: string[] } {
  const platform = getOsType();

  switch (platform) {
    case "darwin":
      return { cmd: "open", args: [] };
    case "windows":
      return { cmd: "cmd", args: ["/c", "start", ""] };
    default:
      return { cmd: "xdg-open", args: [] };
  }
}

export async function openBrowser(url: string): Promise<void> {
  const { cmd, args } = getOpenCommand();

  if (isDeno) {
    // @ts-ignore - Deno global
    const command = new Deno.Command(cmd, {
      args: [...args, url],
      stdout: "null",
      stderr: "null",
    });
    // Wait for the command to complete (open returns quickly after launching browser)
    await command.output();
  } else {
    const { spawn } = await import("node:child_process");
    const child = spawn(cmd, [...args, url], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

export function canOpenBrowser(): boolean {
  const isCI = Boolean(getEnv("CI") || getEnv("CONTINUOUS_INTEGRATION"));
  const isSSH = Boolean(getEnv("SSH_CLIENT") || getEnv("SSH_TTY"));

  if (getOsType() === "linux") {
    const hasDisplay = Boolean(getEnv("DISPLAY") || getEnv("WAYLAND_DISPLAY"));
    if (!hasDisplay) return false;
  }

  return !isCI && !isSSH;
}
