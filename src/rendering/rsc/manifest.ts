import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { extractExportNames } from "./export-extractor.ts";

export interface GraphIds {
  client: { id: string; path: string; rel: string }[];
  server: { id: string; path: string; rel: string }[];
}

interface ManifestModule {
  id: string;
  clientRef: string;
  exports: string[];
}

export interface Manifest {
  version: number;
  hash: string;
  modules: ManifestModule[];
}

const MAX_MANIFEST_MODULES = 10_000;
const MAX_MODULE_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_MODULE_FIELD_LENGTH = 1_024;
const SAFE_EXPORT_NAME = /^[A-Za-z_$][A-Za-z0-9_$.-]*$/;

export async function buildRscModules(
  projectDir: string,
  graphIds: GraphIds | undefined,
  fs?: FileSystemAdapter,
): Promise<ManifestModule[]> {
  if (!graphIds) return [];
  if (!Array.isArray(graphIds.client) || !Array.isArray(graphIds.server)) {
    throw new TypeError("RSC graph IDs must contain client and server arrays");
  }

  const allEntries = [...graphIds.client, ...graphIds.server];
  if (allEntries.length > MAX_MANIFEST_MODULES) {
    throw new RangeError(`RSC manifest exceeds the ${MAX_MANIFEST_MODULES} module limit`);
  }
  if (allEntries.length === 0) return [];

  const normalizedProjectDir = normalize(projectDir);
  if (!projectDir || projectDir.includes("\0")) {
    throw new TypeError("RSC manifest project directory is invalid");
  }

  const adapter = fs ?? (await runtime.get()).fs;
  const canonicalProjectDir = adapter.realPath
    ? await adapter.realPath(normalizedProjectDir)
    : undefined;
  const ids = new Set<string>();
  const modules: ManifestModule[] = [];
  const entries = allEntries.map((entry) => validateEntry(entry, normalizedProjectDir));
  entries.sort((a, b) => a.id.localeCompare(b.id) || a.rel.localeCompare(b.rel));

  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new TypeError(`RSC manifest contains duplicate module ID "${entry.id}"`);
    }
    ids.add(entry.id);
  }

  for (const entry of entries) {
    const stat = adapter.lstat ? await adapter.lstat(entry.path) : await adapter.stat(entry.path);
    if (!stat.isFile || stat.isSymlink) {
      throw new TypeError("RSC manifest source must be a regular file");
    }
    if (stat.size > MAX_MODULE_SOURCE_BYTES) {
      throw new RangeError("RSC manifest source exceeds the size limit");
    }

    if (adapter.realPath && canonicalProjectDir) {
      const canonicalPath = await adapter.realPath(entry.path);
      if (!isPathWithinRoot(canonicalPath, canonicalProjectDir)) {
        throw new TypeError("RSC manifest source must stay inside the project");
      }
    }

    const source = await adapter.readFile(entry.path);
    if (new TextEncoder().encode(source).byteLength > MAX_MODULE_SOURCE_BYTES) {
      throw new RangeError("RSC manifest source exceeds the size limit");
    }

    const exports = [...new Set(await extractExportNames(source, entry.path))]
      .filter((name) => SAFE_EXPORT_NAME.test(name))
      .sort((a, b) => {
        if (a === "default") return -1;
        if (b === "default") return 1;
        return a.localeCompare(b);
      });
    if (exports.length === 0) {
      throw new TypeError(`RSC manifest module "${entry.id}" has no runtime exports`);
    }

    const exportName = exports.includes(entry.id)
      ? entry.id
      : exports.includes("default")
      ? "default"
      : exports[0]!;
    modules.push({
      id: entry.id,
      clientRef: `/app${entry.rel}#${exportName}`,
      exports,
    });
  }

  return modules;
}

export async function buildVersionedManifest(
  projectDir: string,
  graphIds: GraphIds | undefined,
  fs?: FileSystemAdapter,
): Promise<Manifest> {
  const modules = await buildRscModules(projectDir, graphIds, fs);
  return {
    version: 1,
    hash: await computeHash(JSON.stringify(modules)),
    modules,
  };
}

function validateEntry(
  entry: GraphIds["client"][number],
  projectDir: string,
): GraphIds["client"][number] {
  if (
    !entry || typeof entry.id !== "string" || entry.id.length === 0 ||
    entry.id.length > MAX_MODULE_FIELD_LENGTH || entry.id.includes("\0") ||
    entry.id.includes("#")
  ) {
    throw new TypeError("RSC manifest module ID is invalid");
  }
  if (
    typeof entry.rel !== "string" || entry.rel.length === 0 ||
    entry.rel.length > MAX_MODULE_FIELD_LENGTH || !entry.rel.startsWith("/") ||
    entry.rel.includes("\0") || entry.rel.includes("\\") || entry.rel.includes("?") ||
    entry.rel.includes("#") ||
    entry.rel.split("/").some((segment, index) =>
      index > 0 && (!segment || segment === "." || segment === "..")
    )
  ) {
    throw new TypeError("RSC manifest module reference is invalid");
  }
  if (typeof entry.path !== "string" || entry.path.length === 0 || entry.path.includes("\0")) {
    throw new TypeError("RSC manifest source path is invalid");
  }

  const path = isAbsolute(entry.path) ? normalize(entry.path) : join(projectDir, entry.path);
  if (!isPathWithinRoot(path, projectDir)) {
    throw new TypeError("RSC manifest source must stay inside the project");
  }

  return { id: entry.id, path, rel: entry.rel };
}

function isPathWithinRoot(path: string, root: string): boolean {
  const relativePath = relative(normalize(root), normalize(path));
  return relativePath === "" ||
    (!isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith("../"));
}
