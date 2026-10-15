import { BROWSER_SAFE_EXPORTS } from "./browser-safe-exports.mjs";
import {
  collectClientGraph,
  createRealReader,
  findServerOnlyLeaks,
  loadImportMap,
  traceLeak,
} from "../lint/client-bundle-graph.ts";

/** Normalize every module in the browser graph, including shared transitive leaves. */
export async function normalizeBrowserPackage(
  sourceRoot: URL,
  packageRoot: URL,
  exports: Record<string, string>,
): Promise<void> {
  const map = await loadImportMap(sourceRoot);
  const reader = createRealReader(sourceRoot);
  const paths = new Set<string>();
  for (const entry of BROWSER_SAFE_EXPORTS) {
    const source = exports[entry];
    if (!source) {
      throw new Error(`Missing browser-safe export source for ${entry}`);
    }
    const graph = await collectClientGraph(
      source.replace(/^\.\//, ""),
      map,
      reader,
    );
    const leaks = findServerOnlyLeaks(graph);
    if (leaks.length) {
      throw new Error(
        `${entry} reaches server modules:\n${
          leaks.map((leak) => traceLeak(graph, leak)).join("\n")
        }`,
      );
    }
    for (const path of graph.keys()) paths.add(path);
  }
  for (const path of paths) {
    if (!/\.tsx?$/.test(path)) continue;
    const builtPath = path.replace(/\.tsx?$/, ".js");
    const url = new URL(`esm/${builtPath}`, packageRoot);
    const source = await Deno.readTextFile(url);
    const normalized = normalizeBrowserModule(source);
    if (normalized !== source) await Deno.writeTextFile(url, normalized);
  }
}

/** dnt's globalThis shim imports the entire Deno/Node runtime, even in pure browser helpers. */
export function normalizeBrowserModule(source: string): string {
  const normalized = source
    .replace(/^import ["'](?:\.\.\/)+_dnt\.polyfills\.js["'];\r?\n/gm, "")
    .replace(
      /^import \* as dntShim from ["'](?:\.\.\/)+_dnt\.shims\.js["'];\r?\n/gm,
      "",
    )
    .replaceAll("dntShim.dntGlobalThis", "globalThis")
    .replace(
      /\bdntShim\.(Deno|crypto|setTimeout|clearTimeout|setInterval|clearInterval)\b/g,
      "globalThis.$1",
    );
  if (/\bdntShim\b/.test(normalized)) {
    throw new Error(
      "Unsupported dnt shim in browser module; supply a browser implementation",
    );
  }
  return normalized;
}
