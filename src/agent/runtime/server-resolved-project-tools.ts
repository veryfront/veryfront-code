/** Project-owned tool identities rebuilt by the API, not API-result waiters. */
export function getServerResolvedProjectToolNames(forwardedProps: unknown): Set<string> {
  if (!forwardedProps || typeof forwardedProps !== "object" || Array.isArray(forwardedProps)) {
    return new Set();
  }
  const overrides = (forwardedProps as Record<string, unknown>).runtimeOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return new Set();
  const names = (overrides as Record<string, unknown>).serverResolvedProjectTools;
  if (!Array.isArray(names)) return new Set();
  return new Set(
    names.filter((name): name is string => typeof name === "string" && name.length > 0),
  );
}
