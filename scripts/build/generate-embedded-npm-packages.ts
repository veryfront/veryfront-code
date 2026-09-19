#!/usr/bin/env -S deno run --allow-all
/**
 * Generate the npm package sets a compiled binary can resolve offline.
 *
 * `deno compile` freezes an npm snapshot into the binary from the lockfile it
 * resolves against. The snapshot is the lock's whole `npm` section, not the
 * subset the entry graph reaches: a package the compiler never sees statically
 * still resolves at run time through a dynamic import, and a package outside
 * the lock never resolves at all.
 *
 * There are TWO such lockfiles, because there are two binary profiles
 * (`createCompileArgs` in scripts/build/compile-binary.ts):
 *
 * - the full profile passes no `--lock`, so it resolves against this repo's
 *   own `deno.lock` (798 npm entries at the time of writing);
 * - the proxy profile passes `--lock scripts/build/proxy-deno.lock` (215).
 *
 * src/discovery is inside cli/proxy-main.ts's module graph, so one set for
 * both profiles would over-report the proxy binary's by hundreds of packages
 * -- and over-reporting is the unsafe direction: a package wrongly called
 * embedded is left external and then fails at run time with Deno's raw
 * constraint text. Both sets are therefore emitted, and
 * `embeddedNpmPackagesForRuntime` picks the one this binary actually froze.
 *
 * That frozen set is the only npm resolution a managed project agent gets, so
 * the discovery bundler has to know it at build time to tell a dependency the
 * runtime already carries -- which must keep resolving from the runtime, as a
 * single offline copy the framework registries can compare identities against
 * -- from one it has to inline from the project's declared pin. See
 * src/discovery/project-npm-imports.ts.
 *
 * Runs as part of `deno task generate`. `--check` fails CI on a stale commit,
 * which is what makes a framework dependency bump regenerate this file.
 */

import { dirname, fromFileUrl, join } from "#std/path.ts";
import { parseLock, parseNameVersion } from "../lib/deno-lock.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

const scriptDir = dirname(fromFileUrl(import.meta.url));
const projectRoot = join(scriptDir, "..", "..");
const fullLockPath = join(projectRoot, "deno.lock");
const proxyLockPath = join(projectRoot, "scripts", "build", "proxy-deno.lock");
const outputRelativePath = "src/discovery/embedded-npm-packages.generated.ts";
const outputPath = join(projectRoot, ...outputRelativePath.split("/"));

/**
 * Collapse deno.lock npm keys into `name -> versions`. A key carries a peer
 * suffix (`react-dom@19.2.0_react@19.2.0`) that `parseNameVersion` discards,
 * and one name is often embedded at several versions at once.
 *
 * @internal Exported for testing only.
 */
export function collectEmbeddedNpmPackages(
  lockText: string,
): Record<string, string[]> {
  return groupByName(
    Object.keys(parseLock(lockText).npm ?? {}),
    parseNameVersion,
  );
}

/**
 * Collapse deno.lock's `npm:` specifier keys into `name -> constraints`
 * (`npm:yaml@^2.4.0` is `yaml -> ^2.4.0`). A compiled binary resolves an
 * `npm:` import by looking its constraint up here, so a package present only
 * transitively is carried but not importable.
 *
 * @internal Exported for testing only.
 */
export function collectEmbeddedNpmConstraints(
  lockText: string,
): Record<string, string[]> {
  const keys = Object.keys(parseLock(lockText).specifiers ?? {});
  return groupByName(
    keys.filter((key) => key.startsWith("npm:")).map((key) => key.slice(4)),
    parseNameConstraint,
  );
}

/**
 * Split `<name>@<constraint>`, keeping the constraint whole. A specifier's
 * constraint is what the import wrote -- a range, or a dist-tag, which may
 * contain an underscore (`pkg@release_candidate`) -- so the peer-suffix cut
 * `parseNameVersion` makes for a package key would truncate it.
 */
function parseNameConstraint(
  key: string,
): { name: string; version: string } | null {
  const slash = key.startsWith("@") ? key.indexOf("/") : -1;
  if (key.startsWith("@") && slash < 0) return null;
  const at = key.indexOf("@", slash + 1);
  if (at <= 0) return null;
  const constraint = key.slice(at + 1);
  return constraint.length === 0
    ? null
    : { name: key.slice(0, at), version: constraint };
}

function groupByName(
  keys: readonly string[],
  parse: (key: string) => { name: string; version: string } | null,
): Record<string, string[]> {
  // A Map, not an object literal: a package named `constructor` must not read
  // Object.prototype.constructor as its version list.
  const byName = new Map<string, string[]>();
  for (const key of keys) {
    const parsed = parse(key);
    if (!parsed) continue;
    const versions = byName.get(parsed.name) ?? [];
    byName.set(parsed.name, versions);
    if (!versions.includes(parsed.version)) versions.push(parsed.version);
  }
  const grouped: Record<string, string[]> = {};
  for (const [name, versions] of byName) {
    // Sorted only so an unrelated lock reshuffle cannot churn the diff.
    Object.defineProperty(grouped, name, {
      value: versions.toSorted(compareStrings),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return grouped;
}

function renderEntries(byName: Record<string, string[]>): string {
  return Object.keys(byName).sort(compareStrings).map((name) => {
    const versions = byName[name]!.map((version) => JSON.stringify(version))
      .join(", ");
    return `  ${JSON.stringify(name)}: [${versions}],`;
  }).join("\n");
}

/** One lockfile's embedded packages and import constraints. */
export interface EmbeddedNpmTables {
  packages: Record<string, string[]>;
  constraints: Record<string, string[]>;
}

/** @internal Exported for testing only. */
export function collectEmbeddedNpmTables(lockText: string): EmbeddedNpmTables {
  return {
    packages: collectEmbeddedNpmPackages(lockText),
    constraints: collectEmbeddedNpmConstraints(lockText),
  };
}

/** @internal Exported for testing only. */
export function renderModule(
  full: EmbeddedNpmTables,
  proxy: EmbeddedNpmTables,
): string {
  return `/**
 * npm packages frozen into the compiled runtime binaries, by package name.
 *
 * AUTO-GENERATED by scripts/build/generate-embedded-npm-packages.ts from
 * deno.lock and scripts/build/proxy-deno.lock. Do not edit manually -- run
 * \`deno task generate\` to regenerate.
 * @module
 */

/**
 * Every version of a package \`deno compile\` embeds in the FULL binary, which
 * resolves against this repo's own deno.lock. A name maps to more than one
 * version whenever the dependency graph pins two of them side by side.
 */
// deno-fmt-ignore -- one package per line keeps the generated diff readable.
export const EMBEDDED_NPM_PACKAGES: Readonly<Record<string, readonly string[]>> = {
${renderEntries(full.packages)}
};

/**
 * The same, for the PROXY binary, which \`deno compile\` resolves against
 * scripts/build/proxy-deno.lock. It is a strict subset in practice, and
 * src/discovery is in cli/proxy-main.ts's graph, so claiming the full set on a
 * proxy binary would leave hundreds of packages external that the proxy cannot
 * resolve.
 */
// deno-fmt-ignore -- one package per line keeps the generated diff readable.
export const PROXY_EMBEDDED_NPM_PACKAGES: Readonly<Record<string, readonly string[]>> = {
${renderEntries(proxy.packages)}
};

/**
 * Every \`npm:\` import constraint the FULL binary can resolve, by package name
 * (\`npm:yaml@2.9.0\` is \`yaml: ["2.9.0"]\`). A compiled binary answers an import
 * by looking its constraint up here, not by searching the packages above.
 */
// deno-fmt-ignore -- one package per line keeps the generated diff readable.
export const EMBEDDED_NPM_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = {
${renderEntries(full.constraints)}
};

/** The same, for the PROXY binary. */
// deno-fmt-ignore -- one package per line keeps the generated diff readable.
export const PROXY_EMBEDDED_NPM_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = {
${renderEntries(proxy.constraints)}
};
`;
}

if (import.meta.main) {
  const full = collectEmbeddedNpmTables(await Deno.readTextFile(fullLockPath));
  const proxy = collectEmbeddedNpmTables(
    await Deno.readTextFile(proxyLockPath),
  );
  const output = renderModule(full, proxy);

  // --check makes a stale committed set fail CI instead of relying on someone
  // noticing it missing from a dependency-bump PR diff.
  if (Deno.args.includes("--check")) {
    const committed = await Deno.readTextFile(outputPath).catch(() => null);
    if (committed !== output) {
      console.error(
        `[generate-embedded-npm-packages] ${outputRelativePath} is stale.\n` +
          `  The committed package sets do not match deno.lock / proxy-deno.lock.\n` +
          `  Run \`deno task generate\` and commit the result.`,
      );
      Deno.exit(1);
    }
    console.log(
      "[generate-embedded-npm-packages] Committed package sets are up to date",
    );
  } else {
    await Deno.writeTextFile(outputPath, output);
    console.log(
      `[generate-embedded-npm-packages] Written to ${outputRelativePath} ` +
        `(full: ${Object.keys(full.packages).length} packages, ` +
        `proxy: ${Object.keys(proxy.packages).length})`,
    );
  }
}
