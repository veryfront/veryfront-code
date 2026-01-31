import { getOsType, runCommand } from "#veryfront/platform/compat/process.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";

function getOpenCommand(): { cmd: string; args: string[] } {
  const osType = getOsType();

  if (osType === "darwin") return { cmd: "open", args: [] };
  if (osType === "windows") return { cmd: "cmd", args: ["/c", "start", ""] };

  return { cmd: "xdg-open", args: [] };
}

export async function openBrowser(url: string): Promise<void> {
  const { cmd, args } = getOpenCommand();
  await runCommand(cmd, { args: [...args, url] });
}

export function canOpenBrowser(env: RuntimeEnv = getRuntimeEnv()): boolean {
  if (env.ci || env.continuousIntegration) return false;
  if (env.sshClient || env.sshTty) return false;

  const osType = getOsType();
  if (osType === "linux" && !(env.display || env.waylandDisplay)) return false;

  return true;
}
