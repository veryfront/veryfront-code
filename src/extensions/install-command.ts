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
 * Which npm-family client owns the project is decided by the lockfile, not by
 * `package.json`, and the table of lockfiles is shared with the CLI's own
 * detector (`cli/utils/package-manager.ts`) so the client Veryfront *prints*
 * cannot disagree with the client `veryfront init` *ran*. Printing
 * `npm install` into a pnpm or Yarn project writes a second, conflicting
 * `package-lock.json` and leaves the real lockfile stale, which a
 * frozen-lockfile CI rejects.
 *
 * @module extensions/install-command
 */

import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { type RuntimeKind, runtimeKind } from "#veryfront/platform/compat/runtime.ts";
import { existsSync } from "#veryfront/platform/compat/std/fs.ts";
import {
  LOCKFILE_CLIENTS,
  MANIFEST_CLIENTS,
  NPM_FAMILY_CLIENTS,
  type PackageClient,
} from "#veryfront/utils/package-client.ts";

const NPM_SPECIFIER_PREFIX = "npm:";

/**
 * How far above a workspace member to look for the lockfile that owns it.
 *
 * pnpm and Yarn workspaces keep one lockfile at the repository root while each
 * member keeps only a `package.json`, so the member directory alone cannot name
 * the client. Nesting deeper than `<root>/<group>/<scope>/<member>` is rare
 * enough that a bound is cheaper than walking to the filesystem root.
 */
const WORKSPACE_SEARCH_DEPTH = 4;

/** Package client that owns a project's dependencies. */
export type InstallTarget = PackageClient;

/** Return the client whose lockfile sits directly in `directory`. */
function lockfileClient(directory: string): InstallTarget | undefined {
  for (const [file, client] of LOCKFILE_CLIENTS) {
    if (existsSync(join(directory, file))) return client;
  }
  return undefined;
}

/** Return the client a manifest in `directory` names outright, if any. */
function manifestClient(directory: string): InstallTarget | undefined {
  for (const [file, client] of MANIFEST_CLIENTS) {
    if (existsSync(join(directory, file))) return client;
  }
  return undefined;
}

/**
 * Return the client the project at `projectDirectory` installs with, or
 * `undefined` when no manifest is readable (a hosted render, a directory
 * without read permission, a runtime with no synchronous filesystem).
 *
 * A lockfile in the directory decides on its own. Failing that, `deno.json`
 * decides, because Deno resolves dependencies from the manifest itself. A lone
 * `package.json` is npm-family but does not say which client, so the ancestors
 * are searched for the workspace lockfile that does; npm is the answer only
 * when no lockfile exists anywhere above it.
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

  try {
    const fromLockfile = lockfileClient(directory);
    if (fromLockfile !== undefined) return fromLockfile;

    const fromManifest = manifestClient(directory);
    // `deno.json` names its client; only a lone `package.json` stays ambiguous.
    if (fromManifest !== "npm") return fromManifest;

    // The lockfile that names the client may belong to the workspace root
    // above. Only an npm-family lockfile can claim a `package.json`; a
    // `deno.lock` in some enclosing repository does not make this a Deno
    // project, and answering `deno add` for it is the bug this module exists
    // to avoid.
    let ancestor = directory;
    for (let level = 0; level < WORKSPACE_SEARCH_DEPTH; level++) {
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
      const workspaceClient = lockfileClient(ancestor);
      if (workspaceClient !== undefined && NPM_FAMILY_CLIENTS.includes(workspaceClient)) {
        return workspaceClient;
      }
    }
    return "npm";
  } catch (_) {
    /* expected: no synchronous filesystem, or the path is unreadable */
    return undefined;
  }
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
      // Deno reads an unprefixed specifier as JSR, which hosts no `@veryfront`.
      return `deno add ${NPM_SPECIFIER_PREFIX}${bareName}`;
    case "bun":
      return `bun add ${bareName}`;
    case "pnpm":
      return `pnpm add ${bareName}`;
    case "yarn":
      return `yarn add ${bareName}`;
    default:
      return `npm install ${bareName}`;
  }
}
