function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Keep Deno's named workspace member in sync without changing dependency pins. */
export function rewriteWorkspacePackageVersion(
  source: string,
  oldKey: string,
  newKey: string,
): string {
  const lock: unknown = JSON.parse(source);
  if (!isRecord(lock) || lock.version !== "5") {
    throw new Error("scripts/deno.lock must be a version 5 lockfile");
  }
  const workspace = lock.workspace;
  if (workspace === undefined) return source;
  if (!isRecord(workspace)) {
    throw new Error("Invalid scripts/deno.lock workspace");
  }
  const links = workspace.links;
  if (links === undefined) return source;
  if (!isRecord(links)) {
    throw new Error("Invalid scripts/deno.lock workspace links");
  }
  if (!Object.hasOwn(links, oldKey)) {
    const packagePrefix = oldKey.slice(0, oldKey.lastIndexOf("@") + 1);
    if (Object.keys(links).some((key) => key.startsWith(packagePrefix))) {
      throw new Error(
        `scripts/deno.lock workspace version does not match ${oldKey}`,
      );
    }
    // Older Deno locks identify members by relative path instead of name/version.
    return source;
  }
  if (Object.hasOwn(links, newKey)) {
    throw new Error(
      `scripts/deno.lock already contains workspace member ${newKey}`,
    );
  }
  workspace.links = Object.fromEntries(
    Object.entries(links).map((
      [key, value],
    ) => [key === oldKey ? newKey : key, value]),
  );
  return JSON.stringify(lock, null, 2) + "\n";
}
