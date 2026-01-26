import { getOsType, runCommand } from "../../platform/compat/process.js";
import { getRuntimeEnv, type RuntimeEnv } from "../../config/runtime-env.js";

function getOpenCommand(): { cmd: string; args: string[] } {
  switch (getOsType()) {
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
  await runCommand(cmd, { args: [...args, url] });
}

export function canOpenBrowser(env: RuntimeEnv = getRuntimeEnv()): boolean {
  if (env.ci || env.continuousIntegration) return false;
  if (env.sshClient || env.sshTty) return false;

  if (getOsType() === "linux" && !(env.display || env.waylandDisplay)) return false;

  return true;
}
