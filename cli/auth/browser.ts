import { runCommand } from "#cli/process-command";
import { getOsType } from "veryfront/platform";
import { type EnvironmentConfig, getEnvironmentConfig } from "veryfront/config";

function getOpenCommand(): { cmd: string; args: string[] } {
  const osType = getOsType();

  if (osType === "darwin") return { cmd: "open", args: [] };
  if (osType === "windows") return { cmd: "cmd", args: ["/c", "start", ""] };

  return { cmd: "xdg-open", args: [] };
}

export interface BrowserLaunchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function openBrowser(url: string, options?: BrowserLaunchOptions): Promise<void> {
  options?.signal?.throwIfAborted();
  if (
    options?.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
  ) {
    throw new Error("Browser launch deadline elapsed");
  }
  const { cmd, args } = getOpenCommand();
  const result = await runCommand(cmd, {
    args: [...args, url],
    ...(options ? { signal: options.signal, timeoutMs: options.timeoutMs } : {}),
  });
  options?.signal?.throwIfAborted();
  // Preserve the existing default login behavior; bounded lifecycle callers
  // must observe failed launch/termination without exposing subprocess output.
  if (options && !result.success) throw new Error("Browser launch failed or timed out");
}

export function canOpenBrowser(env: EnvironmentConfig = getEnvironmentConfig()): boolean {
  if (env.ci || env.continuousIntegration) return false;
  if (env.sshClient || env.sshTty) return false;

  const osType = getOsType();
  if (osType === "linux" && !(env.display || env.waylandDisplay)) return false;

  return true;
}
