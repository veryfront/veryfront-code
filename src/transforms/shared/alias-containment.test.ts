import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertContainedProjectAliasPath,
  isContainedProjectAliasPath,
} from "./alias-containment.ts";

describe("transforms/shared/alias-containment", () => {
  describe("isContainedProjectAliasPath", () => {
    const contained = [
      "components/Button",
      "components/Card.tsx",
      "lib/my.config.helper",
      "styles/globals.css",
      "post.mdx",
      "a/b/c/d/e",
      ".",
      "./Button",
      "components/../Button",
      "components/..",
      // A single dot inside a segment is a filename, not a dot segment.
      "lib/.eslintrc.json",
      "lib/..hidden/file",
    ];

    for (const path of contained) {
      it(`accepts ${JSON.stringify(path)}`, () => {
        assertEquals(isContainedProjectAliasPath(path), true);
      });
    }

    const escapes: ReadonlyArray<readonly [string, string]> = [
      ["", "an empty path composes bare /_vf_modules/"],
      ["..", "a lone parent segment"],
      ["../_veryfront/modules/foo", "a leading parent segment"],
      ["./../_veryfront/modules/foo", "a parent segment behind a current segment"],
      ["components/../../_veryfront/modules/foo", "parent segments in the middle"],
      ["%2e%2e/_veryfront/modules/foo", "percent-encoded dot segments"],
      ["%2E%2E/_veryfront/modules/foo", "upper-case percent-encoded dot segments"],
      // WHATWG parsing maps "\" onto "/" under a special scheme, so this is a
      // dot segment that a "/"-only pattern cannot see.
      ["..\\_veryfront/modules/foo", "a backslash-separated parent segment"],
      // NUL/TAB/CR/LF are removed before dot segments are collapsed, so the
      // authored text hides a traversal that only the parser reconstructs.
      ["..\t/_veryfront/modules/foo", "a tab-split parent segment"],
      ["..\n/_veryfront/modules/foo", "a newline-split parent segment"],
      ["..\r/_veryfront/modules/foo", "a carriage-return-split parent segment"],
      ["..\0/_veryfront/modules/foo", "a NUL-split parent segment"],
      ["foo\u007f/bar", "a DEL character"],
    ];

    for (const [path, why] of escapes) {
      it(`rejects ${JSON.stringify(path)} — ${why}`, () => {
        assertEquals(isContainedProjectAliasPath(path), false);
      });
    }

    it("judges the path, not the query or fragment", () => {
      // Dot segments after "?" or "#" land in the query or fragment, which
      // cannot move the resolved path, so they must not be rejected.
      assertEquals(isContainedProjectAliasPath("components/Card?from=../elsewhere"), true);
      assertEquals(isContainedProjectAliasPath("components/Card#../anchor"), true);
      // An escaping path is still rejected when a suffix follows it.
      assertEquals(isContainedProjectAliasPath("../secrets?ok=1"), false);
    });
  });

  describe("assertContainedProjectAliasPath", () => {
    it("returns for a contained path", () => {
      assertContainedProjectAliasPath("components/Button");
    });

    it("throws for an escaping path and names the alias", () => {
      const error = assertThrows(
        () => assertContainedProjectAliasPath("../_veryfront/modules/foo"),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
      // The testing front door types assertThrows as unknown.
      if (!(error instanceof Error)) throw new Error("Expected an Error");
      assertEquals(error.message.includes("@/../_veryfront/modules/foo"), true);
      assertEquals((error as Error & { slug?: string }).slug, "security-violation");
    });

    it("redacts the authored query and fragment from the message", () => {
      const error = assertThrows(
        () =>
          assertContainedProjectAliasPath(
            "../secrets?token=EXAMPLE-CREDENTIAL-VALUE#EXAMPLE-FRAGMENT",
          ),
        Error,
        "escapes the /_vf_modules/ module transport",
      );
      if (!(error instanceof Error)) throw new Error("Expected an Error");
      assertEquals(error.message.includes("EXAMPLE-CREDENTIAL-VALUE"), false);
      assertEquals(error.message.includes("EXAMPLE-FRAGMENT"), false);
      assertEquals(error.message.includes("<redacted suffix>"), true);
    });
  });
});
