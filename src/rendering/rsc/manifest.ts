import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { HASH_SEED_DJB2 } from "@veryfront/utils";

export interface GraphIds {
  client: { id: string; path: string; rel: string }[];
  server: { id: string; path: string; rel: string }[];
}

export interface ManifestModule {
  id: string;
  clientRef: string;
  exports: string[];
}

export interface Manifest {
  version: number;
  hash: string;
  modules: ManifestModule[];
}

function extractNamedExportsFromSource(source: string): string[] {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  for (const m of source.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  for (const m of source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  for (const m of source.matchAll(/export\s+let\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    const inner = m[1]?.split(",") ?? [];
    for (const seg of inner) {
      const part = seg.trim();
      if (!part) continue;
      const asMatch = part.match(/([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)/i);
      if (asMatch) names.add(asMatch[2]!);
      else {
        const plain = part.match(/^([A-Za-z0-9_]+)/);
        if (plain) names.add(plain[1]!);
      }
    }
  }
  return Array.from(names.values());
}

export async function buildRscModules(
  _projectDir: string,
  graphIds: GraphIds | undefined,
): Promise<ManifestModule[]> {
  if (!graphIds) return [];
  const modules: ManifestModule[] = [];

  const adapter = await getAdapter();

  for (const e of graphIds.client) {
    let exportsList: string[] = ["default"];
    try {
      const text = await adapter.fs.readFile(e.path);
      const names = extractNamedExportsFromSource(text);
      if (names.length > 0) exportsList = ["default", ...names];
    } catch {
    }
    modules.push({
      id: e.id,
      clientRef: `/app${e.rel}#default`,
      exports: exportsList,
    });
  }

  for (const e of graphIds.server) {
    let exportsList: string[] = ["default"];
    try {
      const text = await adapter.fs.readFile(e.path);
      const names = extractNamedExportsFromSource(text);
      if (names.length > 0) exportsList = ["default", ...names];
    } catch {
    }
    modules.push({
      id: e.id,
      clientRef: `/app${e.rel}#default`,
      exports: exportsList,
    });
  }
  return modules;
}

export async function buildVersionedManifest(
  projectDir: string,
  graphIds: GraphIds | undefined,
): Promise<Manifest> {
  const modules = await buildRscModules(projectDir, graphIds);
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(modules));
  let h = HASH_SEED_DJB2;
  for (let i = 0; i < data.length; i++) h = ((h << 5) + h) ^ data[i]!;
  const hash = (h >>> 0).toString(16);
  return { version: 1, hash, modules };
}
