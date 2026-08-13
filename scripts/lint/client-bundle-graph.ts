/**
 * Static client-bundle import-graph analysis, shared by the fail-loud lint
 * (`audit-client-bundle.ts`) and its tests.
 *
 * A client-tree entrypoint that value-imports a server helper drags the server
 * platform into the browser — the class of regression behind #3661, where the
 * Deno filesystem adapter reached the browser and crashed hydration on a
 * Node-absent `O_NOFOLLOW`. This walks the *static* value-import graph that
 * actually ships — following named/side-effect imports and re-exports, skipping
 * erased `import type` and lazy `import()` — so a server module reaching a
 * browser entrypoint is a hard error at the boundary (#3670).
 */

export interface ClientModuleNode {
  /** The module that first imported this one (`null` for the entrypoint). */
  readonly via: string | null;
  /** UTF-8 byte length of this module's source. */
  readonly bytes: number;
}

export type ClientGraph = Map<string, ClientModuleNode>;

export type ReadModule = (
  repoPath: string,
) => Promise<{ path: string; source: string } | null>;

/**
 * Internal modules that must never appear in a browser graph. Matched against a
 * leading-slash-normalised repo path so a tail match cannot be spoofed by a
 * same-named project directory.
 */
export const SERVER_ONLY_MODULE_PATTERNS: readonly RegExp[] = [
  /\/platform\/adapters\/runtime\/[^/]+\/(adapter|filesystem-adapter)\.ts$/,
  /\/platform\/adapters\/runtime\/shared\/node-filesystem-adapter\.ts$/,
  /\/platform\/adapters\/fs\/veryfront\//,
  /\/platform\/adapters\/veryfront-api-client(\.ts$|\/)/,
  /\/server\/production-server\.ts$/,
  /\/extensions\/distributed\/(redis-runtime-provider|owned-redis-client)\.ts$/,
  /\/platform\/compat\/process\/command\.ts$/,
];

// Edges that actually ship code into the browser graph:
//  - `import … from "x"` / `export … from "x"` — value imports and re-exports
//    (`import type` / `export type` are erased and excluded);
//  - `import "x"` — a bare side-effect import still evaluates the module.
// A dynamic `import("x")` is lazy (parenthesised, no `from`, no trailing quote
// after whitespace), so neither pattern matches it.
const VALUE_FROM_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?\sfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;

const textEncoder = new TextEncoder();

export function* staticSpecifiers(source: string): Generator<string> {
  for (const pattern of [VALUE_FROM_RE, SIDE_EFFECT_IMPORT_RE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) yield match[1];
    }
  }
}

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/**
 * Resolve a specifier to a repo-relative `src/...` path, or `null` when it is
 * external (npm/jsr/node/`react`) or a runtime-provided `veryfront/*` bare
 * specifier the browser loads from the import map rather than the source tree.
 */
export function resolveSpecifier(
  spec: string,
  fromPath: string,
  importMap: Record<string, string>,
): string | null {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const fromDir = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
    return normalizePath(fromDir + spec);
  }
  if (spec.startsWith("#")) {
    let bestKey = "";
    for (const key of Object.keys(importMap)) {
      const matches = spec === key ||
        spec.startsWith(key.endsWith("/") ? key : key + "/");
      if (matches && key.length > bestKey.length) bestKey = key;
    }
    const mapped = importMap[bestKey];
    if (!mapped) return null;
    return normalizePath(
      mapped.replace(/^\.\//, "") + spec.slice(bestKey.length),
    );
  }
  // Bare specifier: react / node:* / npm:* / jsr:* / veryfront/* → external.
  return null;
}

/** Walk the static value-import graph, mapping each reached module to its edge + byte size. */
export async function collectClientGraph(
  entry: string,
  importMap: Record<string, string>,
  readModule: ReadModule,
): Promise<ClientGraph> {
  const graph: ClientGraph = new Map();
  const queue: Array<{ repoPath: string; via: string | null }> = [{
    repoPath: entry,
    via: null,
  }];

  while (queue.length > 0) {
    const { repoPath, via } = queue.shift()!;
    const mod = await readModule(repoPath);
    if (!mod || graph.has(mod.path)) continue;
    graph.set(mod.path, { via, bytes: textEncoder.encode(mod.source).length });

    for (const specifier of staticSpecifiers(mod.source)) {
      const next = resolveSpecifier(specifier, mod.path, importMap);
      if (next) queue.push({ repoPath: next, via: mod.path });
    }
  }
  return graph;
}

export function findServerOnlyLeaks(
  graph: ClientGraph,
  patterns: readonly RegExp[] = SERVER_ONLY_MODULE_PATTERNS,
): string[] {
  return [...graph.keys()].filter((path) =>
    patterns.some((pattern) => pattern.test("/" + path))
  );
}

/** Render the import chain into `leak`, entrypoint first, for a legible failure. */
export function traceLeak(graph: ClientGraph, leak: string): string {
  const chain = [leak];
  let cursor: string | null | undefined = graph.get(leak)?.via;
  while (cursor) {
    chain.push(cursor);
    cursor = graph.get(cursor)?.via ?? null;
  }
  return chain.reverse().join(" → ");
}

export function summarizeGraph(
  graph: ClientGraph,
): { moduleCount: number; byteCount: number } {
  let byteCount = 0;
  for (const node of graph.values()) byteCount += node.bytes;
  return { moduleCount: graph.size, byteCount };
}

// --- Source-tree helpers (resolve through a repo-root URL, never the cwd) ---

export async function loadImportMap(
  rootUrl: URL,
): Promise<Record<string, string>> {
  const denoJson = JSON.parse(
    await Deno.readTextFile(new URL("deno.json", rootUrl)),
  );
  return (denoJson.imports ?? {}) as Record<string, string>;
}

export function createRealReader(rootUrl: URL): ReadModule {
  return async (repoPath) => {
    const candidates = /\.[cm]?[jt]sx?$/.test(repoPath) ? [repoPath] : [
      repoPath + ".ts",
      repoPath + ".tsx",
      repoPath + "/index.ts",
      repoPath + "/index.tsx",
    ];
    for (const candidate of candidates) {
      try {
        return {
          path: candidate,
          source: await Deno.readTextFile(new URL(candidate, rootUrl)),
        };
      } catch {
        // try the next extension form
      }
    }
    return null;
  };
}
