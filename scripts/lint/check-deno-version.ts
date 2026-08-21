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

/**
 * The message to show when the running Deno is not the pinned one, or null when
 * it matches.
 *
 * Split out from the entry point so the mismatch path is testable without
 * spawning a subprocess or pretending to be another Deno.
 */
export function denoVersionMismatchMessage(
  running: string,
  pinned: string,
): string | null {
  if (running === pinned) return null;
  return (
    `Deno ${running} is running, but this repository pins ${pinned}.\n` +
    `\n` +
    `Generated files embed line numbers and padded columns, so a different\n` +
    `Deno rewrites them even when nothing changed. Committing that output\n` +
    `breaks CI for everyone else.\n` +
    `\n` +
    `Switch to the pinned version, whichever way you manage toolchains:\n` +
    `  mise install          # reads .tool-versions\n` +
    `  asdf install          # reads .tool-versions\n` +
    `  deno upgrade ${pinned}   # replaces the deno on your PATH\n`
  );
}

if (import.meta.main) {
  const message = denoVersionMismatchMessage(
    runningDenoVersion(),
    await readPinnedDenoVersion(),
  );
  if (message) {
    console.error(message);
    Deno.exit(1);
  }
}
