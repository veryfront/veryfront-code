import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SCANNER_PATH_PATTERN } from "./security.ts";

describe("constants/security", () => {
  describe("SCANNER_PATH_PATTERN", () => {
    it("matches common scanner probe paths", () => {
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-admin"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-admin/install.php"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-login.php"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-includes/js/wp-emoji.js"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-content/plugins/exploit"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-config.php"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/xmlrpc.php"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/.git/config"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/cgi-bin/test.cgi"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/.env"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/.env.production"), true);
      assertEquals(
        SCANNER_PATH_PATTERN.test("/WP-ADMIN"),
        true,
        "scanner matching must be case-insensitive",
      );
      assertEquals(
        SCANNER_PATH_PATTERN.test("/Wp-Config.php"),
        true,
        "mixed-case probe paths are still detected",
      );
      assertEquals(
        SCANNER_PATH_PATTERN.test("/.ENV"),
        true,
        "uppercase dotfile probes are still detected",
      );
    });

    it("does not block normal nested application routes", () => {
      assertEquals(SCANNER_PATH_PATTERN.test("/"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/about"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/blog/wp-content/foo"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/docs/wp-admin-guide"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/assets/index.php.md"), false);
      assertEquals(
        SCANNER_PATH_PATTERN.test("/wp-admin-guide"),
        false,
        "a root route that merely starts with wp-admin must not be treated as a scanner probe",
      );
      assertEquals(
        SCANNER_PATH_PATTERN.test("/wp-contents"),
        false,
        "a root route that merely starts with wp-content must not be treated as a scanner probe",
      );
      assertEquals(
        SCANNER_PATH_PATTERN.test("/wp-includes-docs"),
        false,
        "a root route that merely starts with wp-includes must not be treated as a scanner probe",
      );
      assertEquals(
        SCANNER_PATH_PATTERN.test("/cgi-binary"),
        false,
        "a root route that merely starts with cgi-bin must not be treated as a scanner probe",
      );
    });
  });
});
