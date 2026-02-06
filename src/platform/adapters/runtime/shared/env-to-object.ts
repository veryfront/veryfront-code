export function envToObject(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value == null) continue;
    result[key] = value;
  }

  return result;
}
