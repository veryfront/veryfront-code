/**
 * The one table that maps a project's files to the client that installs into it.
 *
 * Two callers ask the same question for different reasons: `cli/utils/package-manager.ts`
 * picks the client it will *run* after `veryfront init`, and
 * `src/extensions/install-command.ts` picks the client it will *print* in a
 * missing-extension hint. A project that scaffolds with `pnpm` and is then told
 * to run `npm install` ends up with a `package-lock.json` beside a stale
 * `pnpm-lock.yaml`, which a frozen-lockfile CI rejects. Keeping one table means
 * the two answers cannot drift apart.
 *
 * This module holds data only -- no filesystem, no runtime detection -- so it is
 * safe to import from either layer.
 *
 * @module utils/package-client
 */

/** A client that can install packages into a project. */
export type PackageClient = "bun" | "deno" | "npm" | "pnpm" | "yarn";

/**
 * Lockfiles, in the order they settle ownership.
 *
 * A lockfile is written by the client that produced it, so it is the strongest
 * evidence available. Bun and Deno come first: both can keep a `package.json`
 * (and Bun a `package-lock.json` inherited from a migration) beside their own
 * lockfile, so a later npm-family match must not win over them.
 */
export const LOCKFILE_CLIENTS: readonly (readonly [file: string, client: PackageClient])[] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["deno.lock", "deno"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * Manifests, consulted only when no lockfile is present.
 *
 * A manifest names the project but not the client that installed it, so it
 * settles ownership only for Deno (which resolves dependencies from `deno.json`
 * itself). A lone `package.json` is npm-family but ambiguous between npm, pnpm,
 * and Yarn -- the lockfile that disambiguates it may live at a workspace root.
 */
export const MANIFEST_CLIENTS: readonly (readonly [file: string, client: PackageClient])[] = [
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["package.json", "npm"],
];

/**
 * Clients that install a `package.json`'s dependencies into `node_modules`.
 *
 * Only these can own a directory that holds a `package.json` and nothing else.
 * A `deno.lock` in an ancestor does not: Deno records its dependencies in
 * `deno.json`, and answering `deno add` for a Node project writes a `deno.json`
 * the project's own `npm ci` then ignores.
 */
export const NPM_FAMILY_CLIENTS: readonly PackageClient[] = ["bun", "npm", "pnpm", "yarn"];
