import { readFileSync, statSync } from "node:fs";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { flattenTsconfigPaths, resolveTsconfigPath } from "./tsconfig-paths.ts";

/**
 * Bun resolves root project aliases through `tsconfig.json`. The Bun preload
 * deliberately leaves `veryfront/*` and `#veryfront/*` to that native resolver
 * because intercepting repeated dynamic aliases can leave an import pending.
 * These paths therefore have to agree with the import map Deno reads out of
 * `deno.json`. When the two drift, the Bun suite fails at module load with
 * "Cannot find module", far from the edit that caused it.
 */

type PathsMap = Record<string, string[]>;

// Anchored to this module rather than the working directory: the suite runs in
// parallel with tests that move the process out of the repository root.
const repoRoot = new URL("../../", import.meta.url);

function readRepoJson(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(name, repoRoot), "utf8"));
}

const denoImports = readRepoJson("deno.json").imports as
  | Record<string, string>
  | undefined;
const tsconfigPaths = flattenTsconfigPaths(
  ((readRepoJson("tsconfig.json").compilerOptions as { paths?: PathsMap } | undefined)
    ?.paths ?? {}) as PathsMap,
);

/** Collapses the extensionless and directory forms a resolver would accept. */
function toExistingFile(target: string): string | null {
  const candidates = [
    target,
    `${target}.ts`,
    `${target}.tsx`,
    `${target}/index.ts`,
    `${target}/index.tsx`,
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(new URL(candidate, repoRoot)).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

const localVeryfrontImports = Object.entries(denoImports ?? {}).filter(
  ([specifier, target]) =>
    (specifier === "veryfront" || specifier.startsWith("veryfront/") ||
      specifier === "#veryfront" || specifier.startsWith("#veryfront/")) &&
    typeof target === "string" && target.startsWith("./"),
);

describe("config/tsconfig-paths-parity", () => {
  it("has local Veryfront specifiers to check", () => {
    assert(
      localVeryfrontImports.length > 50,
      `expected deno.json to map many Veryfront specifiers, found ${localVeryfrontImports.length}`,
    );
  });

  it("resolves every local Veryfront specifier to the file deno.json names", () => {
    const drifted: string[] = [];
    for (const [specifier, denoTarget] of localVeryfrontImports) {
      const expected = toExistingFile(denoTarget);
      if (expected === null) {
        drifted.push(`${specifier}: deno.json points at missing ${denoTarget}`);
        continue;
      }
      const viaPaths = resolveTsconfigPath(tsconfigPaths, specifier);
      if (viaPaths === null) {
        drifted.push(`${specifier}: no tsconfig paths entry`);
        continue;
      }
      const actual = toExistingFile(viaPaths);
      if (actual !== expected) {
        drifted.push(
          `${specifier}: tsconfig resolves to ${actual ?? viaPaths}, deno.json to ${expected}`,
        );
      }
    }

    assertEquals(drifted, [], drifted.join("\n"));
  });
});
