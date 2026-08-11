/**
 * Shared string utilities for CLI commands and MCP tools.
 */

/** Convert a name to a URL-safe slug (preserves case). */
export function toSlug(name: string): string {
  return name
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_\-[\]/]/g, "")
    .replace(/\/+/g, "/");
}

/** Convert a slug to a PascalCase component name. */
export function toComponentName(slug: string): string {
  const base = slug.split("/").pop() || slug;
  return base
    .replace(/\W+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}

/** Safely extract an error message from an unknown thrown value. */
export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
