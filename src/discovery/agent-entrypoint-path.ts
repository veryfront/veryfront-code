/** Shared by the signed invocation contract and exact-file discovery. */
export function isNormalizedAgentEntrypointPath(path: string): boolean {
  return path.length > 0 && path.length <= 1000 && path.startsWith("agents/") &&
    !path.includes("\\") &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
