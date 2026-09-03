/**
 * Containment rule for the tenant-authored `@/` project alias path.
 *
 * Every rewriter that turns `@/<path>` into a `/_vf_modules/<path>` transport
 * URL composes that URL by concatenation, so the authored path decides where
 * the emitted specifier finally points. Dot segments — raw, percent-encoded
 * (`%2e%2e`) or backslash-separated — survive concatenation untouched and are
 * only collapsed later, by the browser, the SSR importer or the module server.
 * `@/../_veryfront/modules/foo` therefore leaves the transport and becomes an
 * ordinary same-origin fetch whose response is cached as an executable module.
 *
 * This module is the single definition of that rule. It is shared by the
 * `@/` rewriters in `transforms/esm/specifier-resolver.ts`,
 * `transforms/import-rewriter/strategies/alias-strategy.ts` and
 * `transforms/import-rewriter/ssr-adapter.ts` so that the browser, SSR and
 * module-cache paths cannot drift apart and leave one of them permissive.
 *
 * @module transforms/shared/alias-containment
 */

import { splitSpecifierSuffix } from "./specifier-suffix.ts";

const ReflectApply = Reflect.apply;
const RegExpTest = RegExp.prototype.test;
const StringCharCodeAt = String.prototype.charCodeAt;

function regexpTest(pattern: RegExp, value: string): boolean {
  return ReflectApply(RegExpTest, pattern, [value]) as boolean;
}

const BACKSLASH_CODE = 0x5c;
const DELETE_CODE = 0x7f;
const LAST_C0_CONTROL_CODE = 0x1f;

/**
 * True when a path contains a character that changes how the WHATWG URL parser
 * segments it.
 *
 * `\` is a path separator under special-scheme parsing, so `..\` is a dot
 * segment. NUL, TAB, CR and LF are *removed* before dot segments are
 * collapsed, so `..<TAB>/` is a traversal that no dot-segment pattern applied
 * to the authored text can see. Every C0 control and DEL is rejected rather
 * than just the strippable subset, so a parser change cannot widen the hole.
 *
 * The scan uses this module's snapshotted intrinsics and the string's own
 * `length`, so a poisoned prototype cannot defeat it.
 */
function hasUnsafePathCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = ReflectApply(StringCharCodeAt, value, [index]) as number;
    if (code <= LAST_C0_CONTROL_CODE || code === BACKSLASH_CODE || code === DELETE_CODE) {
      return true;
    }
  }
  return false;
}

/**
 * True when `aliasPath` — the text after `@/`, `?query`/`#hash` suffix
 * included — can be concatenated onto `/_vf_modules/` without the result
 * normalizing back out of the transport.
 *
 * The check applies to the path alone: dot segments inside a query or fragment
 * do not move the resolved path, and rejecting them would break aliases that
 * legitimately carry one.
 *
 * This is a pure guard, never a rewrite: an accepted path is emitted byte for
 * byte by the caller, so the several alias rewriters keep producing the exact
 * same URL for the same specifier. Two rewriters that disagreed on the shape
 * would resolve one import to two module instances.
 */
export function isContainedProjectAliasPath(aliasPath: string): boolean {
  const { path } = splitSpecifierSuffix(aliasPath);
  return path !== "" &&
    !regexpTest(/(^|\/)\.\.?(\/|$)/, path) &&
    !regexpTest(/%2e/i, path) &&
    !hasUnsafePathCharacter(path);
}

/**
 * Throw unless the text after `@/` is contained.
 *
 * A rewriter that is about to emit the composed URL has no safe "leave it
 * alone" outcome: returning the specifier unrewritten hands the escape to the
 * importing runtime, so it fails the build the way
 * `transforms/esm/specifier-resolver.ts` already does for the same input.
 * Read-only callers that merely classify an already-failed specifier use
 * `isContainedProjectAliasPath` instead, where a throw would replace a
 * diagnostic with a crash.
 *
 * The message names the alias by its path alone. The `?query`/`#hash` suffix
 * is tenant-authored and can carry credentials (`@/module?token=…`), which
 * AGENTS.md, "Secret and internal-detail safety", forbids echoing into error
 * messages.
 */
export function assertContainedProjectAliasPath(aliasPath: string): void {
  if (isContainedProjectAliasPath(aliasPath)) return;

  const { path, suffix } = splitSpecifierSuffix(aliasPath);
  const reportedAlias = suffix === "" ? `@/${path}` : `@/${path}<redacted suffix>`;
  throw new Error(
    `Refusing to rewrite project alias ${reportedAlias}: its path escapes the /_vf_modules/ module transport`,
  );
}
