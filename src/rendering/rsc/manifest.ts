import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { HASH_SEED_DJB2 } from "#veryfront/utils";
import { extractExportNames } from "./export-extractor.ts";

export interface GraphIds {
  client: { id: string; path: string; rel: string }[];
  server: { id: string; path: string; rel: string }[];
}

export interface ManifestModule {
  id: string; // stable id
  clientRef: string; // client module reference + export
  exports: string[];
}

export interface Manifest {
  version: number;
  hash: string; // simple content hash over modules for cache-busting
  modules: ManifestModule[];
}

export async function buildRscModules(
  _projectDir: string,
  graphIds: GraphIds | undefined,
): Promise<ManifestModule[]> {
  if (!graphIds) return [];

  const adapter = await runtime.get();
  const allEntries = [...graphIds.client, ...graphIds.server];

  return Promise.all(
    allEntries.map(async (e) => {
      let exportsList: string[] = ["default"];

      try {
        const text = await adapter.fs.readFile(e.path);
        const names = extractExportNames(text);
        if (names.length > 0) exportsList = ["default", ...names];
      } catch {
        // ignore read errors; use default only
      }

      return {
        id: e.id,
        clientRef: `/app${e.rel}#default`,
        exports: exportsList,
      };
    }),
  );
}

export async function buildVersionedManifest(
  projectDir: string,
  graphIds: GraphIds | undefined,
): Promise<Manifest> {
  const modules = await buildRscModules(projectDir, graphIds);
  const data = new TextEncoder().encode(JSON.stringify(modules));

  // djb2 over bytes -> hex
  let h = HASH_SEED_DJB2;
  for (const byte of data) {
    h = ((h << 5) + h) ^ byte;
  }
  const hash = (h >>> 0).toString(16);

  return { version: 1, hash, modules };
}
