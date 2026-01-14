import { isDeno } from "@veryfront/platform/compat/runtime.ts";

function getPlatform(): string {
  // @ts-ignore - Deno global
  return isDeno ? Deno.build.os : process.platform;
}

function getEnvVar(name: string): string | undefined {
  // @ts-ignore - Deno global
  return isDeno ? Deno.env.get(name) : process.env[name];
}

function getOpenCommand(): { cmd: string; args: string[] } {
  const platform = getPlatform();

  switch (platform) {
    case "darwin":
      return { cmd: "open", args: [] };
    case "win32":
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
    const proc = command.spawn();
    proc.unref();
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
  const isCI = Boolean(getEnvVar("CI") || getEnvVar("CONTINUOUS_INTEGRATION"));
  const isSSH = Boolean(getEnvVar("SSH_CLIENT") || getEnvVar("SSH_TTY"));

  if (getPlatform() === "linux") {
    const hasDisplay = Boolean(getEnvVar("DISPLAY") || getEnvVar("WAYLAND_DISPLAY"));
    if (!hasDisplay) return false;
  }

  return !isCI && !isSSH;
}
