export function getProjectRunStringArrayConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): string[] {
  for (const key of keys) {
    const value = config[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }
  }
  return [];
}

export function getProjectRunStringConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function getProjectRunNumberConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

export function getProjectRunPositiveIntConfig(
  config: Record<string, unknown>,
  keys: readonly string[],
): number | undefined {
  const value = getProjectRunNumberConfig(config, keys);
  if (value === undefined) return undefined;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}
