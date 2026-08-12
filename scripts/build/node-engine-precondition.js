/**
 * Node.js engine precondition for the published `veryfront` bin shim.
 *
 * This module is copied verbatim next to `bin/veryfront.js` in the npm package
 * and is imported before any framework module. It therefore has to run on every
 * Node release a user might have installed, including ones far below the
 * supported floor:
 *
 *   - no dependencies, no framework imports, no polyfills
 *   - nothing newer than ES2020 syntax
 *
 * Without this gate the first framework module to load is
 * `src/platform/compat/native-brand-checks`, which needs
 * `process.getBuiltinModule` (added in Node 22.3.0). On older Node it throws
 * "The current server runtime does not expose complete node:util/types brand
 * checks" — an internal assertion with no version, no fix and no docs link.
 *
 * Keep MINIMUM_NODE_VERSION in sync with `runtime-support.ts`; a test locks the
 * two together.
 */

/** Minimum Node.js release supported by the published npm package. */
export const MINIMUM_NODE_VERSION = "22.3.0";

const DOCS_URL = "https://veryfront.com/docs/code/getting-started/installation";
const RELEASE_TRIPLE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseReleaseTriple(version) {
  if (typeof version !== "string") return undefined;
  const match = RELEASE_TRIPLE.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Whether `version` is at or above `minimum`.
 *
 * Fails open: a version this cannot parse as a plain `major.minor.patch`
 * release is allowed through. The gate exists to explain a crash, so it must
 * never become the reason a runtime that would have worked is refused.
 *
 * @param {string | undefined} version e.g. `process.versions.node`
 * @param {string} [minimum]
 * @returns {boolean}
 */
export function meetsMinimumNodeVersion(version, minimum = MINIMUM_NODE_VERSION) {
  const actual = parseReleaseTriple(version);
  const floor = parseReleaseTriple(minimum);
  if (!actual || !floor) return true;

  for (let index = 0; index < 3; index++) {
    if (actual[index] !== floor[index]) return actual[index] > floor[index];
  }
  return true;
}

/**
 * Human-readable, actionable message for an unsupported Node release.
 *
 * Mirrors the CLI error shape (`✗` headline, indented Detail / Suggestion /
 * Docs) so an engine failure reads like every other classified Veryfront
 * error rather than a raw stack trace.
 *
 * @param {string | undefined} version e.g. `process.versions.node`
 * @param {string} [minimum]
 * @returns {string}
 */
export function formatUnsupportedNodeMessage(version, minimum = MINIMUM_NODE_VERSION) {
  const detected = typeof version === "string" && version.trim() !== ""
    ? `Node.js ${version.trim()}`
    : "an unknown Node.js version";

  return [
    `  ✗ Veryfront requires Node.js ${minimum} or later`,
    `    Detail: This shell is running ${detected}.`,
    "    Suggestion: Upgrade Node.js, then run the command again. With nvm:" +
    ` nvm install ${minimum} && nvm use ${minimum}`,
    `    Docs: ${DOCS_URL}`,
  ].join("\n");
}
