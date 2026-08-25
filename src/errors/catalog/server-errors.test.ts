import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SERVER_ERROR_CATALOG } from "./server-errors.ts";

const EXPLICIT_URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s"\\]*/gi;
const PUBLIC_RECOVERY_ORIGIN = "https://veryfront.com";

describe("errors/catalog/server-errors", () => {
  describe("SERVER_ERROR_CATALOG", () => {
    it("should contain all server error slugs", () => {
      const expectedSlugs = [
        "port-in-use",
        "server-start-error",
        "cache-error",
        "cache-path-mismatch",
        "file-watch-error",
        "request-error",
        "service-overloaded",
        "network-error",
      ];

      for (const slug of expectedSlugs) {
        assertEquals(slug in SERVER_ERROR_CATALOG, true, `Missing error slug: ${slug}`);
      }
    });

    it("should have correct structure for each entry", () => {
      for (const [slug, solution] of Object.entries(SERVER_ERROR_CATALOG)) {
        assertEquals(solution.slug, slug, `slug mismatch for ${slug}`);
        assertEquals(typeof solution.title, "string", `title should be string for ${slug}`);
        assertEquals(typeof solution.message, "string", `message should be string for ${slug}`);
        assertEquals(typeof solution.docs, "string", `docs should be string for ${slug}`);
        assertEquals(Array.isArray(solution.steps), true, `steps should be array for ${slug}`);
        assertEquals(
          (solution.steps?.length ?? 0) > 0,
          true,
          `steps should not be empty for ${slug}`,
        );
      }
    });

    it("should have 8 entries", () => {
      assertEquals(Object.keys(SERVER_ERROR_CATALOG).length, 8);
    });

    it("port-in-use should have an example", () => {
      const solution = SERVER_ERROR_CATALOG["port-in-use"]!;
      assertEquals(typeof solution.example, "string");
      assertEquals(solution.example?.includes("port") ?? false, true);
    });

    it("cache-path-mismatch should only expose public recovery instructions", () => {
      const solution = SERVER_ERROR_CATALOG["cache-path-mismatch"];
      assertEquals(typeof solution?.example, "string");
      const serialized = JSON.stringify(solution);
      assertEquals(serialized.includes("/internal/"), false);
      assertEquals(serialized.includes("ADMIN_TOKEN"), false);
      assertEquals(serialized.includes("kubectl"), false);
      assertEquals(solution?.example?.includes("veryfront clean --cache"), true);

      for (const match of serialized.matchAll(EXPLICIT_URL_PATTERN)) {
        const normalized = new URL(match[0]);
        assertEquals(
          normalized.username,
          "",
          `cache-path-mismatch must not carry userinfo in ${match[0]}`,
        );
        assertEquals(
          normalized.password,
          "",
          `cache-path-mismatch must not carry credentials in ${match[0]}`,
        );
        assertEquals(
          normalized.origin,
          PUBLIC_RECOVERY_ORIGIN,
          `cache-path-mismatch must not expose ${match[0]}`,
        );
      }

      for (
        const text of [
          ...(solution?.steps ?? []),
          solution?.example ?? "",
          solution?.message ?? "",
        ]
      ) {
        const internalTokens = [...text.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)]
          .map((match) => match[0])
          .filter((token) => token !== "VERYFRONT_CACHE_DIR");
        assertEquals(
          internalTokens,
          [],
          `cache-path-mismatch must not name internal tokens: ${text}`,
        );
      }
    });

    it("should not accept credential-bearing URLs through origin alone", () => {
      const smuggled = new URL("https://private-control-plane.example@veryfront.com/runbook");

      assertEquals(smuggled.origin, PUBLIC_RECOVERY_ORIGIN, "origin normalizes userinfo away");
      assertEquals(smuggled.username, "private-control-plane.example");
    });

    it("should recognize URL schemes case-insensitively", () => {
      const serialized = JSON.stringify({ step: "Open HTTPS://internal.example/recovery" });

      assertEquals(
        [...serialized.matchAll(EXPLICIT_URL_PATTERN)].map((match) => match[0]),
        ["HTTPS://internal.example/recovery"],
      );
    });
  });
});
