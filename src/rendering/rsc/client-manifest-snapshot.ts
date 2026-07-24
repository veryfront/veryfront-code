import type { ClientComponentMeta } from "./types.ts";

/**
 * Takes ownership of one client-manifest entry without retaining mutable
 * caller-owned containers.
 */
export function snapshotClientComponentMeta(
  meta: ClientComponentMeta,
): ClientComponentMeta {
  const id = meta.id;
  const path = meta.path;
  const sourcePath = meta.sourcePath;
  const rel = meta.rel;
  const contentHash = meta.contentHash;
  const exports = [...meta.exports];

  return {
    id,
    path,
    sourcePath,
    rel,
    contentHash,
    exports,
  };
}
