/**
 * Formats the whole remedy for a missing explicit-activation extension.
 *
 * A first-party `@veryfront/ext-*` package is inert until a project composes
 * it, so a hint that stops at the install command reads as actionable and
 * changes nothing. The composition step is a `veryfront.config.ts` `extensions`
 * entry -- and naming that file is only useful to a reader who has one.
 * `veryfront init --template minimal` writes `package.json`, `app/`, `public/`,
 * and `tsconfig.json`; no config file at all. Verified against published
 * 0.1.1232. So the hint must know whether the file exists, and say "create" or
 * "add to" accordingly.
 *
 * Naming the file is still not enough to act on, because the first line of the
 * file it asks for is exactly the line a reader cannot guess. The obvious
 * guess, `import { defineConfig } from "veryfront/config"`, is not an exported
 * subpath: `defineConfig` lives on the package root. Node rejects the guess
 * with ERR_PACKAGE_PATH_NOT_EXPORTED, which the config loader reports as a
 * bare "Failed to load veryfront.config.ts". So the hint carries the import
 * lines verbatim, and in the create case the complete file, on one line, ready
 * to paste.
 *
 * The local binding is this module's to choose: every first-party extension
 * exports its factory as the module default. It is derived from the package
 * name so the reader can see which import belongs to which entry.
 *
 * @module extensions/setup-hint
 */

import { join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { existsSync } from "#veryfront/platform/compat/std/fs.ts";
import {
  VERYFRONT_CONFIG_FILES,
  type VeryfrontConfigFileName,
} from "#veryfront/config/config-files.ts";
import {
  detectProjectInstallTarget,
  formatInstallCommand,
  type InstallTarget,
  runtimeInstallTarget,
} from "./install-command.ts";

const NPM_SPECIFIER_PREFIX = "npm:";

/** Config file a project is told to create when it has none. */
const DEFAULT_CONFIG_FILE: VeryfrontConfigFileName = "veryfront.config.ts";

/**
 * Where the recommended composition stops working.
 *
 * Veryfront Cloud evaluates a project's configuration file as data and never
 * imports it, so the import this hint asks for is rejected there. Saying so
 * here is the earliest the reader can learn it; `veryfront deploy` refuses the
 * same config, and without this line the hint reads as advice that quietly
 * costs the reader a deployable project.
 */
const HOSTED_CAVEAT =
  "Extensions run where you run the project; a configuration file that imports one cannot be " +
  "deployed to Veryfront Cloud.";

export interface ExtensionSetupHintOptions {
  /** Project root to inspect; defaults to the working directory. */
  readonly projectDirectory?: string;
  /** Package client to format the install command for; detected by default. */
  readonly installTarget?: InstallTarget;
}

/** Strip the registry prefix some recommendations record. */
function barePackageName(packageName: string): string {
  return packageName.startsWith(NPM_SPECIFIER_PREFIX)
    ? packageName.slice(NPM_SPECIFIER_PREFIX.length)
    : packageName;
}

/**
 * Return a legal JavaScript identifier for `packageName`'s default export.
 *
 * `@veryfront/ext-css-lightning` becomes `extCssLightning`. The scope is
 * dropped because it repeats on every first-party package, and every remaining
 * separator starts a new word.
 */
export function defaultImportBinding(packageName: string): string {
  const unscoped = barePackageName(packageName).replace(/^@[^/]+\//, "");
  const words = unscoped.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const binding = words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
  // A package whose name is only separators, or that starts with a digit,
  // cannot name a binding. Nothing first-party looks like that, but the
  // fallback keeps the emitted snippet parseable rather than plausible.
  return /^[A-Za-z_$]/.test(binding) ? binding : "extension";
}

/**
 * Return the config file the project keeps, or `undefined` when it has none.
 *
 * The loader accepts `.js`, `.ts`, and `.mjs` in that precedence, so a hint
 * that hard-codes `.ts` would send a reader who has `veryfront.config.js` to a
 * second file the loader never reaches.
 */
export function findExistingConfigFile(
  projectDirectory?: string,
): VeryfrontConfigFileName | undefined {
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
    for (const fileName of VERYFRONT_CONFIG_FILES) {
      if (existsSync(join(directory, fileName))) return fileName;
    }
  } catch (_) {
    /* expected: no synchronous filesystem, or the path is unreadable */
    return undefined;
  }
  return undefined;
}

/**
 * Return the install-and-compose instruction for `packageName`.
 *
 * Phrased as the tail of a sentence that has already stated the effect, so a
 * caller supplies its own "X is not active." lead.
 */
export function formatExtensionSetupHint(
  packageName: string,
  options?: ExtensionSetupHintOptions,
): string {
  const bareName = barePackageName(packageName);
  const binding = defaultImportBinding(bareName);
  const installTarget = options?.installTarget ??
    detectProjectInstallTarget(options?.projectDirectory) ?? runtimeInstallTarget();
  const install = formatInstallCommand(bareName, installTarget);
  const existingConfigFile = findExistingConfigFile(options?.projectDirectory);
  const importLine = `import ${binding} from "${bareName}";`;

  if (existingConfigFile === undefined) {
    return `Install one with: ${install}, then create ${DEFAULT_CONFIG_FILE} containing: ` +
      `import { defineConfig } from "veryfront"; ${importLine} ` +
      `export default defineConfig({ extensions: [${binding}()] });` +
      ` ${HOSTED_CAVEAT}`;
  }
  return `Install one with: ${install}, then activate it in ${existingConfigFile}: ` +
    `add ${importLine} and list ${binding}() in "extensions".` +
    ` ${HOSTED_CAVEAT}`;
}
