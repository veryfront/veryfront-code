/**
 * Keep the local toolchain on the version CI uses.
 *
 * Generated artifacts are committed: the API reference pins declaration line
 * numbers, and the template manifests embed generated output. Those pins are
 * column-padded, so a different Deno emits different files for identical
 * sources. Regenerating with the wrong version therefore produces a diff that
 * looks like real drift, and committing it turns CI red for everyone else.
 *
 * `.tool-versions` is the single source of truth. This module both enforces
 * that the CI action agrees with it and, when run directly, that the Deno
 * executing a generator agrees with it too.
 *
 * @module scripts/lint/check-deno-version
 */

const TOOL_VERSIONS = ".tool-versions";
const SETUP_ACTION = ".github/actions/setup-deno/action.yml";

/** The Deno version this repository pins, read from `.tool-versions`. */
export async function readPinnedDenoVersion(): Promise<string> {
  const text = await Deno.readTextFile(TOOL_VERSIONS);
  const match = text.match(/^deno\s+(\S+)\s*$/m);
  if (!match) {
    throw new Error(`${TOOL_VERSIONS} does not pin a deno version.`);
  }
  return match[1];
}

/**
 * Every Deno version literal the CI setup action carries.
 *
 * Matches only the sites that select a Deno: the install step's assignment and
 * the cache keys. Other actions pinned in the same file have their own
 * versions, which are none of this check's business.
 */
export async function readActionDenoVersions(): Promise<string[]> {
  const text = await Deno.readTextFile(SETUP_ACTION);
  const install = [...text.matchAll(/^\s*version="(\d+\.\d+\.\d+)"/gm)];
  const cacheKeys = [...text.matchAll(/veryfront-deno-v\d+-[^\n]*?-(\d+\.\d+\.\d+)-/g)];
  return [...install, ...cacheKeys].map((m) => m[1]);
}

/** The running Deno, normalized to `major.minor.patch`. */
export function runningDenoVersion(): string {
  return Deno.version.deno;
}

if (import.meta.main) {
  const pinned = await readPinnedDenoVersion();
  const running = runningDenoVersion();

  if (running !== pinned) {
    console.error(
      `Deno ${running} is running, but this repository pins ${pinned}.\n` +
        `\n` +
        `Generated files embed line numbers and padded columns, so a different\n` +
        `Deno rewrites them even when nothing changed. Committing that output\n` +
        `breaks CI for everyone else.\n` +
        `\n` +
        `Install the pinned version (asdf and mise both read .tool-versions):\n` +
        `  mise install       # or: asdf install\n` +
        `\n` +
        `Or run the generator with a pinned binary first on PATH:\n` +
        `  curl -sL -o deno.zip https://github.com/denoland/deno/releases/download/v${pinned}/deno-$(uname -m)-apple-darwin.zip\n` +
        `  unzip -oq deno.zip && chmod +x deno\n` +
        `  PATH="$PWD:$PATH" ./deno task docs\n`,
    );
    Deno.exit(1);
  }
}
