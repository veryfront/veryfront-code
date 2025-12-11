import { join } from "std/path/mod.ts";
import { HASH_SEED_DJB2 } from "@veryfront/utils";

export function computeStableId(relPath: string): string {
  let hash = HASH_SEED_DJB2;
  for (let i = 0; i < relPath.length; i++) {
    hash = (hash << 5) + hash + relPath.charCodeAt(i);
    hash = hash | 0;
  }
  const unsigned = hash >>> 0;
  return unsigned.toString(36);
}

export function withStableIds(
  projectDir: string,
  graph: { client: { path: string }[]; server: { path: string }[] },
): {
  client: { id: string; path: string; rel: string }[];
  server: { id: string; path: string; rel: string }[];
} {
  const appRoot = join(projectDir, "app");
  const mapEntry = (path: string) => {
    const rel = path.startsWith(appRoot) ? path.slice(appRoot.length) || "/" : path;
    const id = computeStableId(rel);
    return { id, path, rel };
  };
  return {
    client: graph.client.map((e) => mapEntry(e.path)).sort((a, b) => a.rel.localeCompare(b.rel)),
    server: graph.server.map((e) => mapEntry(e.path)).sort((a, b) => a.rel.localeCompare(b.rel)),
  };
}
