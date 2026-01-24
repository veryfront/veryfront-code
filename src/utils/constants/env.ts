export const ENV_VARS = {
  DEBUG: "VERYFRONT_DEBUG",
  DEEP_INSPECT: "VERYFRONT_DEEP_INSPECT",
  CACHE_DIR: "VERYFRONT_CACHE_DIR",
  PORT: "VERYFRONT_PORT",
  VERSION: "VERYFRONT_VERSION",
} as const;

type EnvAccessor = { get(key: string): string | undefined };

export function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false;

  const normalized = value.toLowerCase().trim();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function isDebugEnabled(env: EnvAccessor): boolean {
  return isTruthyEnvValue(env.get(ENV_VARS.DEBUG));
}

export function isDeepInspectEnabled(env: EnvAccessor): boolean {
  return isTruthyEnvValue(env.get(ENV_VARS.DEEP_INSPECT));
}

export function isAnyDebugEnabled(env: EnvAccessor): boolean {
  return isDebugEnabled(env) || isDeepInspectEnabled(env);
}
