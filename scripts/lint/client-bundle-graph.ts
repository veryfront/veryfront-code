// This checker also runs from the root source-test config, which has no tooling aliases.
// deno-lint-ignore no-import-prefix
import { parse } from "npm:@babel/parser@7.29.2";
import { builtinModules } from "node:module";
import { BROWSER_MODULE_REPLACEMENTS } from "../build/browser-safe-exports.mjs";

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
  /^\/node:/,
  /\/security\/application-auth\/identity\.ts$/,
  /\/security\/application-auth\/trusted-proxy\.ts$/,
  /\/platform\/adapters\/runtime\/[^/]+\/(adapter|filesystem-adapter)\.ts$/,
  /\/platform\/adapters\/runtime\/shared\/node-filesystem-adapter\.ts$/,
  /\/platform\/adapters\/fs\/veryfront\//,
  /\/platform\/adapters\/veryfront-api-client(\.ts$|\/)/,
  /\/server\/production-server\.ts$/,
  /\/extensions\/distributed\/(redis-runtime-provider|owned-redis-client)\.ts$/,
  /\/platform\/compat\/process\/command\.ts$/,
  // The isolation worker pool spawns runtime workers and reads `node:util`
  // types at module scope — it crashes browser hydration (surfaced by the
  // `pages-server-import-leak/vector-a` reproducer's `isProxy` TypeError).
  /\/security\/sandbox\/(worker-pool|project-worker|worker-error-boundary|worker-script)\.ts$/,
];

const textEncoder = new TextEncoder();

/** Parse real module declarations; comments and documentation strings are not edges. */
export function* staticSpecifiers(source: string): Generator<string> {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  for (const node of ast.program.body) {
    if (node.type === "ImportDeclaration") {
      if (node.importKind === "type") continue;
      if (
        node.specifiers.length &&
        node.specifiers.every((specifier) =>
          specifier.type === "ImportSpecifier" &&
          specifier.importKind === "type"
        )
      ) continue;
      yield node.source.value;
    } else if (
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      if (!node.source || node.exportKind === "type") continue;
      if (
        node.type === "ExportNamedDeclaration" && node.specifiers.length &&
        node.specifiers.every((specifier) =>
          specifier.type === "ExportSpecifier" &&
          specifier.exportKind === "type"
        )
      ) continue;
      yield node.source.value;
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
 * external (npm/jsr/`react`) or a runtime-provided `veryfront/*` bare
 * specifier the browser loads from the import map rather than the source tree.
 * Node builtins remain graph nodes so the gate can reject them.
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
    // Deno import-map semantics: a bare key (`#veryfront/security`) maps only the
    // exact specifier — it points at a *file*. Only a trailing-slash key
    // (`#veryfront/`) maps sub-paths. Matching sub-paths against a bare key would
    // mis-resolve `#veryfront/security/sandbox/x.ts` onto the security barrel file
    // and silently drop the edge — hiding real server leaks.
    let bestKey = "";
    for (const key of Object.keys(importMap)) {
      const matches = key.endsWith("/") ? spec.startsWith(key) : spec === key;
      if (matches && key.length > bestKey.length) bestKey = key;
    }
    const mapped = importMap[bestKey];
    if (!mapped) {
      throw new Error(
        `Unresolved import-map specifier ${spec} from ${fromPath}`,
      );
    }
    if (/^(?:npm|jsr|https?):/.test(mapped)) return null;
    return normalizePath(
      mapped.replace(/^\.\//, "") + spec.slice(bestKey.length),
    );
  }
  if (spec.startsWith("node:")) return spec;
  if (builtinModules.includes(spec)) return `node:${spec}`;
  // Third-party dependencies are checked by the packed npm browser build.
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
    const browserPath = BROWSER_MODULE_REPLACEMENTS[repoPath] ?? repoPath;
    if (browserPath.startsWith("node:")) {
      if (!graph.has(browserPath)) graph.set(browserPath, { via, bytes: 0 });
      continue;
    }
    const mod = await readModule(browserPath);
    if (!mod) {
      throw new Error(
        `Cannot verify browser module ${browserPath} imported by ${via}`,
      );
    }
    if (graph.has(mod.path)) continue;
    graph.set(mod.path, { via, bytes: textEncoder.encode(mod.source).length });

    if (mod.path.endsWith(".json")) continue;
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
    const candidates = /\.(?:[cm]?[jt]sx?|json)$/.test(repoPath)
      ? [repoPath]
      : [
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
