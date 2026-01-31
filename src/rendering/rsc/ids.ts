import { join } from "#veryfront/platform/compat/path/index.ts";
import { HASH_SEED_DJB2 } from "#veryfront/utils";

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

  const mapEntry = (path: string): Entry => {
    const rel = path.startsWith(appRoot) ? path.slice(appRoot.length) || "/" : path;
    return { id: computeStableId(rel), path, rel };
  };

  const byRel = (a: Entry, b: Entry): number => a.rel.localeCompare(b.rel);

  return {
    client: graph.client.map(({ path }) => mapEntry(path)).sort(byRel),
    server: graph.server.map(({ path }) => mapEntry(path)).sort(byRel),
  };
}
