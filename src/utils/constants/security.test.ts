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
      assertEquals(SCANNER_PATH_PATTERN.test("/wp-config.php"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/xmlrpc.php"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/.git/config"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/cgi-bin/test.cgi"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/.env"), true);
      assertEquals(SCANNER_PATH_PATTERN.test("/.env.production"), true);
    });

    it("does not block normal nested application routes", () => {
      assertEquals(SCANNER_PATH_PATTERN.test("/"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/about"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/blog/wp-content/foo"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/docs/wp-admin-guide"), false);
      assertEquals(SCANNER_PATH_PATTERN.test("/assets/index.php.md"), false);
    });
  });
});
