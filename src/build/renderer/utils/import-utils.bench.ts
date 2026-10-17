/**
 * Advisory import-scanner benchmarks. Compare sizes on the same machine and
 * runtime; correctness tests deliberately impose no wall-clock thresholds.
 *
 * Run: deno bench --allow-all src/build/renderer/utils/import-utils.bench.ts
 */
import { extractImports, processImports } from "./import-utils.ts";
import {
  EXPORT_FROM_PATTERN,
  JSX_IMPORT_PATTERN,
  PROJECT_ALIAS_IMPORT_PATTERN,
  STATIC_IMPORT_PATTERN,
} from "../../../modules/loader-shared/patterns.ts";

for (const size of [800, 3_200, 6_400]) {
  const source = "const values = [" + "{},".repeat(size) + ']; import("./child.mdx")';
  Deno.bench({
    name: `${size} object literals`,
    group: "dependency extraction",
    baseline: size === 800,
    fn() {
      extractImports(source);
    },
  });
  Deno.bench({
    name: `${size} object literals`,
    group: "dependency rewriting",
    baseline: size === 800,
    async fn() {
      await processImports(
        source,
        "/project/page.ts",
        "/project",
        () => Promise.resolve("./resolved.mdx"),
      );
    },
  });
}

for (const size of [1_000, 10_000, 30_000]) {
  const source = "import missing ".repeat(size);
  Deno.bench({
    name: `${size} incomplete import keywords`,
    group: "malformed import declarations",
    baseline: size === 1_000,
    fn() {
      for (
        const pattern of [
          STATIC_IMPORT_PATTERN,
          EXPORT_FROM_PATTERN,
          JSX_IMPORT_PATTERN,
          PROJECT_ALIAS_IMPORT_PATTERN,
        ]
      ) {
        [...source.matchAll(pattern)];
      }
    },
  });
}

for (const size of [26, 128, 1_024]) {
  const source = "import {\n" + "// comment\n".repeat(size);
  const multilinePattern = new RegExp(STATIC_IMPORT_PATTERN.source, "gmu");
  Deno.bench({
    name: `${size} line comments in an incomplete import`,
    group: "malformed multiline imports",
    baseline: size === 26,
    fn() {
      [...source.matchAll(multilinePattern)];
    },
  });
}
