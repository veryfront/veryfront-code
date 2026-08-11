/**
 * Formats the package-install command a reader can actually paste.
 *
 * First-party extensions are published to npm only: `@veryfront/ext-*` exists
 * on registry.npmjs.org, while jsr.io hosts no `@veryfront` scope. A hint that
 * hard-codes `deno add <bare specifier>` therefore fails twice -- Deno resolves
 * an unprefixed specifier against JSR and exits with "is missing a prefix", and
 * a Deno command is a non-sequitur in the npm project `veryfront init`
 * scaffolds.
 *
 * The command follows the manifest that owns the project's dependencies, not
 * the runtime executing Veryfront: the compiled Deno binary builds npm
 * projects, and telling one of those to run `deno add` writes a deno.json the
 * project's own `npm ci` then ignores. The runtime decides only when no
 * manifest is readable.
 *
 * @module extensions/install-command
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { type RuntimeKind, runtimeKind } from "#veryfront/platform/compat/runtime.ts";
import { existsSync } from "#veryfront/platform/compat/std/fs.ts";

const NPM_SPECIFIER_PREFIX = "npm:";

/** Package client that owns a project's dependencies. */
export type InstallTarget = "bun" | "deno" | "npm";

/**
 * Manifests in the order they decide ownership. A Bun project keeps a
 * package.json, and a Deno project can keep one too, so the more specific
 * manifest is read first.
 */
const MANIFESTS: readonly (readonly [string, InstallTarget])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["package.json", "npm"],
];

/**
 * Return the client the project at `projectDirectory` installs with, or
 * `undefined` when no manifest is readable (a hosted render, a directory
 * without read permission, a runtime with no synchronous filesystem).
 */
export function detectProjectInstallTarget(
  projectDirectory?: string,
): InstallTarget | undefined {
  let directory = projectDirectory;
  if (directory === undefined) {
    try {
      directory = cwd();
    } catch (_) {
      /* expected: cwd() is unavailable in runtimes without a process */
      return undefined;
    }
  }
  for (const [manifest, target] of MANIFESTS) {
    try {
      if (existsSync(join(directory, manifest))) return target;
    } catch (_) {
      /* expected: no synchronous filesystem, or the path is unreadable */
      return undefined;
    }
  }
  return undefined;
}

/** Return the client that ships with `runtime`. */
export function runtimeInstallTarget(runtime: RuntimeKind = runtimeKind): InstallTarget {
  if (runtime === "deno") return "deno";
  if (runtime === "bun") return "bun";
  // Node, Cloudflare, and unclassified hosts all consume the npm registry;
  // npm ships with Node, so it is the one client always present.
  return "npm";
}

/**
 * Return the command that installs `packageName` with `target`.
 *
 * `packageName` may carry an `npm:` prefix (recommendations record some
 * entries that way); the prefix is re-applied per target rather than passed
 * through, so no caller can emit `npm install npm:@veryfront/ext-redis`.
 */
export function formatInstallCommand(
  packageName: string,
  target: InstallTarget = detectProjectInstallTarget() ?? runtimeInstallTarget(),
): string {
  const bareName = packageName.startsWith(NPM_SPECIFIER_PREFIX)
    ? packageName.slice(NPM_SPECIFIER_PREFIX.length)
    : packageName;
  switch (target) {
    case "deno":
      return `deno add ${NPM_SPECIFIER_PREFIX}${bareName}`;
    case "bun":
      return `bun add ${bareName}`;
    default:
      return `npm install ${bareName}`;
  }
}
