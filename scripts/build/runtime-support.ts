/** Minimum Node.js release supported by the root and first-party npm packages. */
export const MINIMUM_NODE_VERSION = "22.3.0";

/** Current Node.js release line used by the clean-room npm smoke. */
export const CURRENT_NPM_SMOKE_NODE_RELEASE_LINE = "24";

/** Oldest supported Node.js release line, exercised at its latest patch. */
export const MINIMUM_NODE_RELEASE_LINE = MINIMUM_NODE_VERSION.slice(
  0,
  MINIMUM_NODE_VERSION.indexOf("."),
);

/**
 * Node.js releases that exercise the clean-room npm artifact boundary.
 *
 * These are release lines, so `setup-node` resolves each to its newest patch.
 * That covers the lines, not the exact `MINIMUM_NODE_VERSION` the published
 * `engines.node` accepts: the packed artifact fails from 22.3.0 through
 * 22.12.0, 22.13.x is unverified, and 22.14.0 is the first observed passing
 * version. Pin the exact floor here once veryfront-issue-inbox#748 either fixes
 * that range or raises the floor.
 */
export const NPM_SMOKE_NODE_VERSIONS = Object.freeze([
  MINIMUM_NODE_RELEASE_LINE,
  CURRENT_NPM_SMOKE_NODE_RELEASE_LINE,
]);

/** npm `engines.node` range derived from the single runtime-version contract. */
export const NPM_NODE_ENGINE = `>=${MINIMUM_NODE_VERSION}`;

/** Minimum Deno release with the synchronous builtin-module trust boundary. */
export const MINIMUM_DENO_VERSION = "2.2.0";
