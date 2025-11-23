import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { HASH_SEED_DJB2 } from "@veryfront/utils";

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

function extractNamedExportsFromSource(source: string): string[] {
  const names = new Set<string>();
  // export function Foo() {}
  for (const m of source.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  // export class Foo {}
  for (const m of source.matchAll(/export\s+class\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  // export const Foo =
  for (const m of source.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  // export let Foo =
  for (const m of source.matchAll(/export\s+let\s+([A-Za-z0-9_]+)/g)) {
    names.add(m[1]!);
  }
  // export { A, B as C }
  for (const m of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    const inner = m[1]?.split(",") ?? [];
    for (const seg of inner) {
      const part = seg.trim();
      if (!part) continue;
      // Handle "Name as Alias" or just "Name"
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

  // Emit client components with their own refs (use client)
  for (const e of graphIds.client) {
    let exportsList: string[] = ["default"];
    try {
      const text = await adapter.fs.readFile(e.path);
      const names = extractNamedExportsFromSource(text);
      if (names.length > 0) exportsList = ["default", ...names];
    } catch {
      /* ignore */
    }
    modules.push({
      id: e.id,
      clientRef: `/app${e.rel}#default`,
      exports: exportsList,
    });
  }

  // Emit server modules with placeholder clientRef (to be mapped to boundaries later)
  for (const e of graphIds.server) {
    let exportsList: string[] = ["default"];
    try {
      const text = await adapter.fs.readFile(e.path);
      const names = extractNamedExportsFromSource(text);
      if (names.length > 0) exportsList = ["default", ...names];
    } catch {
      // ignore read errors; default only
    }
    modules.push({
      id: e.id,
      clientRef: `/app${e.rel}#default`,
      exports: exportsList,
    });
  }
  // In the future, client components could also be emitted with their own ids if needed
  return modules;
}

/**
 * Build a versioned manifest with a simple content hash for cache-busting.
 */
export async function buildVersionedManifest(
  projectDir: string,
  graphIds: GraphIds | undefined,
): Promise<Manifest> {
  const modules = await buildRscModules(projectDir, graphIds);
  const enc = new TextEncoder();
  const data = enc.encode(JSON.stringify(modules));
  // djb2 over bytes -> hex
  let h = HASH_SEED_DJB2;
  for (let i = 0; i < data.length; i++) h = ((h << 5) + h) ^ data[i]!;
  const hash = (h >>> 0).toString(16);
  return { version: 1, hash, modules };
}
