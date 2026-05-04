import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { getProxyFailureLogLevel, isLikelyScannerProbePath } from "./log-noise.ts";

describe("proxy log noise classification", () => {
  it("classifies common scanner probe paths as noisy", () => {
    for (
      const path of [
        "/031.php",
        "//autoload_classmap.php",
        "/wp.php",
        "/shell20211028.php",
        "/about25.php",
        "/wp-admin/setup-config.php",
      ]
    ) {
      assertEquals(isLikelyScannerProbePath(path), true);
    }
  });

  it("does not classify normal app and framework paths as scanner probes", () => {
    for (
      const path of [
        "/",
        "/about",
        "/api/health",
        "/_veryfront/assets/app.js",
        "/blog/post.php-not-a-probe",
        "/api/render",
      ]
    ) {
      assertEquals(isLikelyScannerProbePath(path), false);
    }
  });

  it("classifies redirects below warning severity", () => {
    assertEquals(getProxyFailureLogLevel(302, "GET", "/"), "info");
    assertEquals(getProxyFailureLogLevel(304, "GET", "/asset.js"), "info");
  });

  it("downgrades scanner-probe 502s while preserving normal 5xx errors", () => {
    assertEquals(getProxyFailureLogLevel(502, "GET", "/wp.php"), "warn");
    assertEquals(getProxyFailureLogLevel(502, "HEAD", "//autoload_classmap.php"), "warn");
    assertEquals(getProxyFailureLogLevel(502, "POST", "/wp.php"), "error");
    assertEquals(getProxyFailureLogLevel(500, "GET", "/wp.php"), "error");
    assertEquals(getProxyFailureLogLevel(502, "GET", "/api/render"), "error");
    assertEquals(getProxyFailureLogLevel(404, "GET", "/wp.php"), "warn");
  });
});
