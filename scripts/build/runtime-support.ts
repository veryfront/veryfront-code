/** Minimum Node.js release supported by the root and first-party npm packages. */
export const MINIMUM_NODE_VERSION = "22.3.0";

/** npm `engines.node` range derived from the single runtime-version contract. */
export const NPM_NODE_ENGINE = `>=${MINIMUM_NODE_VERSION}`;

/** Minimum Deno release with the synchronous builtin-module trust boundary. */
export const MINIMUM_DENO_VERSION = "2.2.0";
