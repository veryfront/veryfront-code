import { assert, assertEquals } from "#veryfront/testing/assert.ts";

/**
 * `src/index.client.ts` is the browser/SSR-safe mirror of the `veryfront` root
 * barrel — the module the import rewriter redirects `veryfront` to for a browser
 * target. It must never statically pull the server runtime adapters into the
 * client graph: constructing `DenoAdapter → DenoFileSystemAdapter →
 * NodeCompatibleFileSystemAdapter` in a browser dereferences a Node-absent
 * `fs.constants.O_NOFOLLOW` and kills hydration (#3661).
 *
 * This walks the *static* value-import graph from `index.client.ts` (the graph
 * that actually ships — dynamic `import()` is lazy and legitimately used by the
 * adapter registry, and `import type` is erased) and fails if it reaches any
 * server-only runtime module. Paths are resolved through `import.meta.url`, not
 * the cwd, so the check is location-independent.
 */

const REPO_ROOT = new URL("../", import.meta.url);

/**
 * The runtime adapter graph behind the #3661 crash: constructing any of these
 * in a browser reaches `NodeCompatibleFileSystemAdapter`'s `O_NOFOLLOW` read.
 * (The broader server→client leak surface — `adapters/fs/veryfront/*`,
 * `compat/process/command`, `production-server` — is the subject of the
 * fail-loud CI gate in #3670, not this focused regression.)
 */
const SERVER_ONLY_PATTERNS: readonly RegExp[] = [
  /\/platform\/adapters\/runtime\/(deno|node|bun|cloudflare)\/adapter\.ts$/,
  /\/platform\/adapters\/runtime\/(deno|node|bun|cloudflare)\/filesystem-adapter\.ts$/,
  /\/platform\/adapters\/runtime\/shared\/node-filesystem-adapter\.ts$/,
];

// Only follow value imports/exports with a `from` clause. Skipping `import type`
// / `export type` keeps erased type edges out, and requiring `from` skips bare
// side-effect and dynamic `import(...)` forms.
const STATIC_FROM_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;'"]*?\sfrom\s+["']([^"']+)["']/g;

let cachedImportMap: Record<string, string> | null = null;

async function loadImportMap(): Promise<Record<string, string>> {
  if (cachedImportMap) return cachedImportMap;
  const denoJson = JSON.parse(await Deno.readTextFile(new URL("deno.json", REPO_ROOT)));
  cachedImportMap = (denoJson.imports ?? {}) as Record<string, string>;
  return cachedImportMap;
}

/**
 * Resolve a specifier to a repo-relative `src/...` path, or `null` when it is
 * external (npm/jsr/node/`react`) or a runtime-provided `veryfront/*` bare
 * specifier the browser loads from the import map rather than the source tree.
 */
function resolveToRepoPath(
  spec: string,
  fromPath: string,
  map: Record<string, string>,
): string | null {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    const fromDir = fromPath.slice(0, fromPath.lastIndexOf("/") + 1);
    return normalize(fromDir + spec);
  }
  if (spec.startsWith("#")) {
    let bestKey = "";
    for (const key of Object.keys(map)) {
      const matches = spec === key || spec.startsWith(key.endsWith("/") ? key : key + "/");
      if (matches && key.length > bestKey.length) bestKey = key;
    }
    const mapped = map[bestKey];
    if (!mapped) return null;
    const target = mapped.replace(/^\.\//, "");
    return normalize(target + spec.slice(bestKey.length));
  }
  // Bare specifier: react, node:*, npm:*, jsr:*, veryfront/* → external.
  return null;
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

async function readModule(repoPath: string): Promise<{ path: string; source: string } | null> {
  const candidates = /\.[cm]?[jt]sx?$/.test(repoPath)
    ? [repoPath]
    : [repoPath + ".ts", repoPath + ".tsx", repoPath + "/index.ts", repoPath + "/index.tsx"];
  for (const candidate of candidates) {
    try {
      const source = await Deno.readTextFile(new URL(candidate, REPO_ROOT));
      return { path: candidate, source };
    } catch {
      // try the next extension form
    }
  }
  return null;
}

/** Walk the static value-import graph, returning every reached source path and the edge into it. */
async function collectStaticGraph(entry: string): Promise<Map<string, string | null>> {
  const map = await loadImportMap();
  const reached = new Map<string, string | null>();
  const queue: Array<{ repoPath: string; via: string | null }> = [{ repoPath: entry, via: null }];

  while (queue.length > 0) {
    const { repoPath, via } = queue.shift()!;
    const mod = await readModule(repoPath);
    if (!mod) continue;
    if (reached.has(mod.path)) continue;
    reached.set(mod.path, via);

    STATIC_FROM_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = STATIC_FROM_RE.exec(mod.source)) !== null) {
      const specifier = match[1];
      if (!specifier) continue;
      const next = resolveToRepoPath(specifier, mod.path, map);
      if (next) queue.push({ repoPath: next, via: mod.path });
    }
  }
  return reached;
}

Deno.test("index.client barrel never statically reaches a server runtime adapter (#3661)", async () => {
  const graph = await collectStaticGraph("src/index.client.ts");

  // Sanity: the walk actually resolved the barrel and its neighbourhood.
  assert(graph.has("src/index.client.ts"), "entry module was not read");
  assert(graph.size > 10, `expected a non-trivial graph, got ${graph.size} modules`);

  const leaks = [...graph.keys()].filter((path) =>
    SERVER_ONLY_PATTERNS.some((pattern) => pattern.test("/" + path))
  );

  if (leaks.length > 0) {
    const trace = (leak: string): string => {
      const chain = [leak];
      let cursor: string | null | undefined = graph.get(leak);
      while (cursor) {
        chain.push(cursor);
        cursor = graph.get(cursor);
      }
      return chain.reverse().join("\n   → ");
    };
    throw new Error(
      `index.client.ts statically reaches ${leaks.length} server-only module(s):\n` +
        leaks.map(trace).join("\n\n"),
    );
  }

  assertEquals(leaks, []);
});
