import { isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import { HASH_SEED_DJB2 } from "#veryfront/utils";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { CLIENT_BOUNDARY_VIOLATION } from "#veryfront/errors/error-registry/boundary.ts";

export function computeStableId(relPath: string): string {
  let hash = HASH_SEED_DJB2;

  for (let i = 0; i < relPath.length; i++) {
    hash = (hash << 5) + hash + relPath.charCodeAt(i);
    hash |= 0;
  }

  return (hash >>> 0).toString(36);
}

type Graph = { client: { path: string }[]; server: { path: string }[] };
type Entry = { id: string; path: string; rel: string };

export function withStableIds(
  projectDir: string,
  graph: Graph,
): { client: Entry[]; server: Entry[] } {
  const appRoot = join(projectDir, "app");
  const ids = new Map<string, string>();

  const mapEntry = (path: string): Entry => {
    const relativePath = relative(appRoot, path).replaceAll("\\", "/");
    if (
      relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)
    ) {
      throw SECURITY_VIOLATION.create({
        detail: "RSC component path is outside the app directory",
      });
    }

    const rel = relativePath === "" ? "/" : `/${relativePath}`;
    const id = computeStableId(rel);
    const existingPath = ids.get(id);
    if (existingPath !== undefined && existingPath !== rel) {
      throw CLIENT_BOUNDARY_VIOLATION.create({
        detail: "Stable RSC component ID collision",
      });
    }
    ids.set(id, rel);
    return { id, path, rel };
  };

  const byRel = (a: Entry, b: Entry): number => a.rel.localeCompare(b.rel);

  return {
    client: graph.client.map(({ path }) => mapEntry(path)).sort(byRel),
    server: graph.server.map(({ path }) => mapEntry(path)).sort(byRel),
  };
}
