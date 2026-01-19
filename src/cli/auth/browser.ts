import { getOsType, runCommand } from "@veryfront/platform/compat/process.ts";
import { getRuntimeEnv, type RuntimeEnv } from "@veryfront/config/runtime-env.ts";

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

/**
 * Check if browser can be opened in current environment.
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
export function canOpenBrowser(env: RuntimeEnv = getRuntimeEnv()): boolean {
  const isCI = env.ci || env.continuousIntegration;
  const isSSH = Boolean(env.sshClient || env.sshTty);

  if (getOsType() === "linux") {
    const hasDisplay = Boolean(env.display || env.waylandDisplay);
    if (!hasDisplay) return false;
  }

  return !isCI && !isSSH;
}
