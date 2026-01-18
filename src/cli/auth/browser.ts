import { getEnv, getOsType, runCommand } from "@veryfront/platform/compat/process.ts";

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
  // Use platform runCommand - open/xdg-open/start return quickly after launching browser
  await runCommand(cmd, { args: [...args, url] });
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
