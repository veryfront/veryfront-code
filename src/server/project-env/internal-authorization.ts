import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { encodeBase64 } from "#veryfront/utils";
import { getEnvSource } from "#veryfront/utils/env-loader.ts";

const INTERNAL_USER_ENV = "VERYFRONT_API_INTERNAL_USER";
const INTERNAL_PASS_ENV = "VERYFRONT_API_INTERNAL_PASS";
const LOCAL_CLI_PROXY_MODE_ENV = "VERYFRONT_CLI_LOCAL_PROXY_MODE";

/** Whether project env reads require the hosted runtime's internal API credential. */
export function requiresProjectEnvInternalAuthorization(): boolean {
  if (getHostEnv("PROXY_MODE") !== "1") return false;
  const isLocalCliProxyMode = getHostEnv(LOCAL_CLI_PROXY_MODE_ENV) === "1" &&
    getEnvSource(LOCAL_CLI_PROXY_MODE_ENV).source === "process";
  return !isLocalCliProxyMode;
}

/** Name the missing hosted runtime credentials without exposing their values. */
export function getMissingProjectEnvInternalCredentialDetail(): string | undefined {
  const missing = [
    getHostEnv(INTERNAL_USER_ENV) ? undefined : INTERNAL_USER_ENV,
    getHostEnv(INTERNAL_PASS_ENV) ? undefined : INTERNAL_PASS_ENV,
  ].filter((name): name is string => name !== undefined);
  return missing.length > 0
    ? `${missing.join(" and ")} must be set in hosted proxy mode`
    : undefined;
}

/** Build the internal API authorization header when both credentials are present. */
export function getProjectEnvInternalAuthorization(): string | undefined {
  const username = getHostEnv(INTERNAL_USER_ENV);
  const password = getHostEnv(INTERNAL_PASS_ENV);
  if (!username || !password) return undefined;
  return `Basic ${encodeBase64(`${username}:${password}`)}`;
}
