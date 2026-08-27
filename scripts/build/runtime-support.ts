/** Minimum Node.js release supported by the root and first-party npm packages. */
export const MINIMUM_NODE_VERSION = "22.3.0";

/** Current Node.js release line used by the clean-room npm smoke. */
export const CURRENT_NPM_SMOKE_NODE_RELEASE_LINE = "24";

/** Oldest supported Node.js release line. */
export const MINIMUM_NODE_RELEASE_LINE = MINIMUM_NODE_VERSION.slice(
  0,
  MINIMUM_NODE_VERSION.indexOf("."),
);

/**
 * Node.js releases that exercise the clean-room npm artifact boundary.
 *
 * The minimum is pinned exactly so CI proves the complete range accepted by
 * the published `engines.node` contract. The current release line resolves to
 * its newest patch through `setup-node`.
 */
export const NPM_SMOKE_NODE_VERSIONS = Object.freeze([
  MINIMUM_NODE_VERSION,
  CURRENT_NPM_SMOKE_NODE_RELEASE_LINE,
]);

/** npm `engines.node` range derived from the single runtime-version contract. */
export const NPM_NODE_ENGINE = `>=${MINIMUM_NODE_VERSION}`;

/** Minimum Deno release with the synchronous builtin-module trust boundary. */
export const MINIMUM_DENO_VERSION = "2.2.0";
