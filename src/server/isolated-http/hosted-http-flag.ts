import { getHostEnvExcludingEnvFile } from "#veryfront/platform/compat/process.ts";

/** Host flag that enables isolated hosted HTTP execution. Default off. Node.js 22 or newer only. */
export const HOSTED_HTTP_ISOLATION_ENV = "VERYFRONT_HOSTED_HTTP_ISOLATION";

/**
 * Read the hosted HTTP isolation flag from the host environment, excluding project env
 * files. Unset, `0`, `false`, `no` and `off` are off; `1`, `true`, `yes` and `on` are on.
 * Any other value throws, so a misspelled flag never silently leaves isolation off.
 */
export function isHostedHttpIsolationEnabled(
  read: (key: string) => string | undefined = getHostEnvExcludingEnvFile,
): boolean {
  const flag = read(HOSTED_HTTP_ISOLATION_ENV)?.trim().toLowerCase() ?? "";
  if (["", "0", "false", "no", "off"].includes(flag)) return false;
  if (["1", "true", "yes", "on"].includes(flag)) return true;
  throw new TypeError(`${HOSTED_HTTP_ISOLATION_ENV} must be 1 or 0`);
}
