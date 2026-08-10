import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

/**
 * Bun's runtime resolver never hands a bare package specifier to a `--preload`
 * plugin -- `onResolve` is only consulted for relative paths and `#`-prefixed
 * subpath imports. So for every `veryfront/...` specifier in the sources, the
 * only mapping Bun can see is `tsconfig.json`'s `paths`, and it has to agree
 * with the import map Deno reads out of `deno.json`. When the two drift, the
 * Bun suite fails at module load with "Cannot find module", far from the edit
 * that caused it.
 */

type PathsMap = Record<string, string[]>;

// Anchored to this module rather than the working directory: the suite runs in
// parallel with tests that move the process out of the repository root.
const repoRoot = new URL("../../", import.meta.url);

function readRepoJson(name: string): Record<string, unknown> {
  return JSON.parse(Deno.readTextFileSync(new URL(name, repoRoot)));
}

const denoImports = readRepoJson("deno.json").imports as
  | Record<string, string>
  | undefined;
const tsconfigPaths =
  ((readRepoJson("tsconfig.json").compilerOptions as { paths?: PathsMap } | undefined)
    ?.paths ?? {}) as PathsMap;

/** Applies TypeScript's `paths` rules: exact key first, then longest prefix. */
function resolveThroughPaths(specifier: string, paths: PathsMap): string | null {
  const exact = paths[specifier]?.[0];
  if (exact) return exact;

  let best: { prefix: string; suffix: string; target: string } | null = null;
  for (const [pattern, targets] of Object.entries(paths)) {
    const star = pattern.indexOf("*");
    const target = targets[0];
    if (star === -1 || target === undefined) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    if (best && best.prefix.length >= prefix.length) continue;
    best = { prefix, suffix, target };
  }
  if (!best) return null;

  const captured = specifier.slice(
    best.prefix.length,
    specifier.length - best.suffix.length,
  );
  return best.target.replace("*", captured);
}

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
      if (Deno.statSync(new URL(candidate, repoRoot)).isFile) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

const bareVeryfrontImports = Object.entries(denoImports ?? {}).filter(
  ([specifier, target]) =>
    (specifier === "veryfront" || specifier.startsWith("veryfront/")) &&
    typeof target === "string" && target.startsWith("./"),
);

describe("config/tsconfig-paths-parity", () => {
  it("has bare veryfront specifiers to check", () => {
    assert(
      bareVeryfrontImports.length > 50,
      `expected deno.json to map many veryfront/* specifiers, found ${bareVeryfrontImports.length}`,
    );
  });

  it("resolves every bare veryfront specifier to the file deno.json names", () => {
    const drifted: string[] = [];
    for (const [specifier, denoTarget] of bareVeryfrontImports) {
      const expected = toExistingFile(denoTarget);
      if (expected === null) {
        drifted.push(`${specifier}: deno.json points at missing ${denoTarget}`);
        continue;
      }
      const viaPaths = resolveThroughPaths(specifier, tsconfigPaths);
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
