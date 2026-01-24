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

  function mapEntry(path: string): Entry {
    const rel = path.startsWith(appRoot) ? path.slice(appRoot.length) || "/" : path;
    return { id: computeStableId(rel), path, rel };
  }

  function byRel(a: Entry, b: Entry): number {
    return a.rel.localeCompare(b.rel);
  }

  return {
    client: graph.client.map((e) => mapEntry(e.path)).sort(byRel),
    server: graph.server.map((e) => mapEntry(e.path)).sort(byRel),
  };
}
