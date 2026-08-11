/**
 * Formats the package-install command a reader can actually paste.
 *
 * First-party extensions are published to npm only: `@veryfront/ext-*` exists
 * on registry.npmjs.org, while jsr.io hosts no `@veryfront` scope. A hint that
 * hard-codes `deno add <bare specifier>` therefore fails twice -- Deno resolves
 * an unprefixed specifier against JSR and exits with "is missing a prefix", and
 * a Deno command is a non-sequitur in the npm project `veryfront init`
 * scaffolds. Derive the command from the runtime that is printing the hint.
 *
 * @module extensions/install-command
 */

import { type RuntimeKind, runtimeKind } from "#veryfront/platform/compat/runtime.ts";

const NPM_SPECIFIER_PREFIX = "npm:";

/**
 * Return the command that installs `packageName` under `runtime`.
 *
 * `packageName` may carry an `npm:` prefix (recommendations record some
 * entries that way); the prefix is re-applied per runtime rather than passed
 * through, so no caller can emit `npm install npm:@veryfront/ext-redis`.
 */
export function formatInstallCommand(
  packageName: string,
  runtime: RuntimeKind = runtimeKind,
): string {
  const bareName = packageName.startsWith(NPM_SPECIFIER_PREFIX)
    ? packageName.slice(NPM_SPECIFIER_PREFIX.length)
    : packageName;
  switch (runtime) {
    case "deno":
      return `deno add ${NPM_SPECIFIER_PREFIX}${bareName}`;
    case "bun":
      return `bun add ${bareName}`;
    default:
      // Node, Cloudflare, and unclassified hosts all consume the npm registry;
      // npm ships with Node, so it is the one client always present.
      return `npm install ${bareName}`;
  }
}
